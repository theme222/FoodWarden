"""Unit tests for CloudClient and CloudSyncManager (Rubric E4 Store-and-Forward)."""

from pathlib import Path

import httpx
import pytest

from foodwarden_camera.cloud.client import CloudClient
from foodwarden_camera.cloud.sync_manager import CloudSyncManager
from foodwarden_camera.models.ble_fuc import SensorSample
from foodwarden_camera.models.cloud_cbs import (
    CheckInCommitPayload,
    CheckOutCommitPayload,
)
from foodwarden_camera.storage.offline_queue import OfflineQueue


def mock_api_handler(request: httpx.Request) -> httpx.Response:
    """Simulates Firebase Cloud Functions endpoints per CBS.md."""
    # Check Bearer auth header
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer test_token"):
        return httpx.Response(401, json={"error": "UNAUTHORIZED"})

    path = request.url.path

    if path.endswith("/inventory/checkin/draft"):
        return httpx.Response(
            200,
            json={
                "name_th": "นมสดพาสเจอร์ไรส์",
                "name_en": "Pasteurized Whole Milk",
                "category": "Dairy",
                "category_th": "นมและผลิตภัณฑ์นม",
                "estimated_shelf_life_days": 10,
                "estimated_expiry_date": "2026-11-17",
                "storage_recommendation_th": "เก็บในช่องแช่เย็นหลัก",
                "storage_recommendation_en": "Store on main shelf",
                "image_storage_path": "fridges/f1/raw.jpg",
                "confidence": 0.95,
            },
        )

    if path.endswith("/inventory/checkin"):
        return httpx.Response(
            200,
            json={
                "item_id": "item_12345",
                "created_at": 1729930050,
                "status": "COMMITTED",
            },
        )

    if path.endswith("/inventory/checkout/draft"):
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "item_id": "item_fefo_1",
                        "name_th": "นมสดพาสเจอร์ไรส์",
                        "name_en": "Pasteurized Whole Milk",
                        "category": "Dairy",
                        "category_th": "นมและผลิตภัณฑ์นม",
                        "expiry_date": "2026-11-10",
                        "confidence": 0.92,
                    }
                ]
            },
        )

    if path.endswith("/inventory/checkout"):
        return httpx.Response(
            200,
            json={
                "item_id": "item_fefo_1",
                "removed_at": 1729930100,
                "status": "REMOVED",
            },
        )

    if path.endswith(("/telemetry", "/events/door")):
        return httpx.Response(200, json={"status": "OK"})

    return httpx.Response(404, json={"error": "NOT_FOUND"})


@pytest.fixture
def mock_cloud_client() -> CloudClient:
    transport = httpx.MockTransport(mock_api_handler)
    client = CloudClient(
        base_url="https://test.local/api",
        gateway_token="test_token",
    )
    # Patch _get_client to use mock transport
    client._get_client = lambda: httpx.Client(  # type: ignore[method-assign]
        base_url=client.base_url,
        headers=client._headers,
        transport=transport,
    )
    return client


def test_cloud_checkin_draft_and_commit(mock_cloud_client: CloudClient) -> None:
    # 1. Draft
    dummy_jpeg = b"\xff\xd8\xff\xe0test_jpeg"
    ok, draft_res, _ = mock_cloud_client.checkin_draft(dummy_jpeg)

    assert ok is True
    assert draft_res is not None
    assert draft_res.name_en == "Pasteurized Whole Milk"
    assert draft_res.estimated_expiry_date == "2026-11-17"

    # 2. Commit
    payload = CheckInCommitPayload(
        name_th=draft_res.name_th,
        name_en=draft_res.name_en,
        category=draft_res.category,
        category_th=draft_res.category_th,
        estimated_shelf_life_days=draft_res.estimated_shelf_life_days,
        expiry_date=draft_res.estimated_expiry_date,
        storage_recommendation_th=draft_res.storage_recommendation_th,
        storage_recommendation_en=draft_res.storage_recommendation_en,
        image_storage_path=draft_res.image_storage_path,
        confidence=draft_res.confidence,
    )
    commit_ok, commit_res, _ = mock_cloud_client.checkin_commit(payload)

    assert commit_ok is True
    assert commit_res is not None
    assert commit_res.item_id == "item_12345"


def test_cloud_checkout_draft_and_commit(mock_cloud_client: CloudClient) -> None:
    dummy_jpeg = b"\xff\xd8\xff\xe0test_jpeg"
    ok, draft_res, _ = mock_cloud_client.checkout_draft(dummy_jpeg)

    assert ok is True
    assert draft_res is not None
    assert len(draft_res.candidates) == 1
    assert draft_res.candidates[0].item_id == "item_fefo_1"

    # Commit checkout hard delete
    commit_payload = CheckOutCommitPayload(item_id="item_fefo_1")
    commit_ok, commit_res, _ = mock_cloud_client.checkout_commit(commit_payload)

    assert commit_ok is True
    assert commit_res is not None
    assert commit_res.status == "REMOVED"


def test_sync_manager_store_and_forward(tmp_path: Path) -> None:
    db_path = str(tmp_path / "test_store_forward.db")
    captures_dir = str(tmp_path / "captures")
    queue = OfflineQueue(db_path=db_path)

    # Simulate failing offline client
    offline_client = CloudClient(base_url="https://offline.local/api", gateway_token="test")
    failing_transport = httpx.MockTransport(lambda req: httpx.Response(503))
    offline_client._get_client = lambda: httpx.Client(  # type: ignore[method-assign]
        base_url=offline_client.base_url,
        headers=offline_client._headers,
        transport=failing_transport,
    )

    manager = CloudSyncManager(offline_client, queue, captures_dir=captures_dir)

    # 1. Send telemetry when offline -> must buffer to queue
    sample = SensorSample.from_raw(1729930000, 320, 100, 30)
    synced = manager.send_or_enqueue_telemetry("F0", sample)
    assert synced is False
    assert manager.is_online is False
    assert len(queue.get_pending_telemetry()) == 1

    # 2. Send door event when offline -> must buffer to queue
    evt_synced = manager.send_or_enqueue_door_event(
        "D0", "SUCCESS", 1729930010, {"duration_ms": 4000}
    )
    assert evt_synced is False
    assert len(queue.get_pending_door_events()) == 1

    # 3. Enqueue offline checkin
    dummy_jpeg = b"\xff\xd8\xff\xe0offline_image"
    checkin_id = manager.enqueue_offline_checkin(dummy_jpeg, confirmed_expiry="2026-11-15")
    assert checkin_id > 0
    assert len(queue.get_pending_checkins()) == 1

    # 4. Network restored: swap client to working mock transport and flush
    working_transport = httpx.MockTransport(mock_api_handler)
    working_client = CloudClient(base_url="https://test.local/api", gateway_token="test_token")
    working_client._get_client = lambda: httpx.Client(  # type: ignore[method-assign]
        base_url=working_client.base_url,
        headers=working_client._headers,
        transport=working_transport,
    )
    manager.client = working_client

    counts = manager.flush_offline_queue()
    assert counts["telemetry"] == 1
    assert counts["door_events"] == 1
    assert counts["checkins"] == 1
    assert manager.is_online is True

    # Queue should be completely empty after successful flush
    assert len(queue.get_pending_telemetry()) == 0
    assert len(queue.get_pending_door_events()) == 0
    assert len(queue.get_pending_checkins()) == 0
