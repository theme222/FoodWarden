"""Unit tests for CloudClient and CloudSyncManager (Rubric E4 Store-and-Forward)."""

import json
from pathlib import Path

import httpx
import pytest

from foodwarden_camera.cloud.client import CloudClient
from foodwarden_camera.cloud.sync_manager import CloudSyncManager
from foodwarden_camera.models.ble_fuc import SensorSample
from foodwarden_camera.models.cloud_cbs import (
    VALID_DOOR_EVENT_STATUSES,
    CheckInCommitPayload,
    CheckOutCommitPayload,
    DoorEventSyncPayload,
    NodeStatusItem,
    StatusPayload,
)
from foodwarden_camera.storage.offline_queue import OfflineQueue


def mock_api_handler(request: httpx.Request) -> httpx.Response:
    """Simulates Firebase Cloud Functions endpoints per CBS.md & Server 'S'."""
    path = request.url.path
    if request.method == "GET" and path.endswith("/health"):
        return httpx.Response(200, json={"ok": True})

    # Check Bearer auth header
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer test_token"):
        return httpx.Response(401, json={"error": "UNAUTHORIZED"})

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
        body = json.loads(request.content.decode("utf-8"))
        if "estimated_expiry_date" not in body:
            return httpx.Response(400, json={"error": "INVALID_PAYLOAD"})
        return httpx.Response(
            201,
            json={
                "success": True,
                "item_id": "item_12345",
                "message": "Item successfully added to inventory.",
            },
        )

    if path.endswith("/inventory/checkout/draft"):
        return httpx.Response(
            200,
            json={
                "match_type": "EXACT_MATCH",
                "candidate_matches": [
                    {
                        "item_id": "item_fefo_1",
                        "name_th": "นมสดพาสเจอร์ไรส์",
                        "name_en": "Pasteurized Whole Milk",
                        "category": "Dairy",
                        "category_th": "นมและผลิตภัณฑ์นม",
                        "estimated_expiry_date": "2026-11-10",
                    }
                ],
                "confidence": 0.92,
                "reasoning": "Matched earliest expiring milk carton",
            },
        )

    if path.endswith("/inventory/checkout"):
        body = json.loads(request.content.decode("utf-8"))
        if not body.get("item_id"):
            return httpx.Response(400, json={"error": "INVALID_PAYLOAD"})
        return httpx.Response(
            200,
            json={
                "success": True,
                "item_id": "item_fefo_1",
                "status": "deleted",
                "message": "Item and associated image permanently removed from inventory.",
            },
        )

    if path.endswith("/telemetry"):
        body = json.loads(request.content.decode("utf-8"))
        samples = body.get("samples")
        if not isinstance(samples, list) or not samples:
            return httpx.Response(400, json={"error": "INVALID_PAYLOAD"})
        for sample in samples:
            if "node_id" not in sample or "timestamp_s" not in sample:
                return httpx.Response(400, json={"error": "INVALID_PAYLOAD"})
        return httpx.Response(200, json={"success": True, "ingested_count": len(samples)})

    if path.endswith("/door_events"):
        body = json.loads(request.content.decode("utf-8"))
        events = body.get("events")
        if not isinstance(events, list) or not events:
            return httpx.Response(400, json={"error": "INVALID_PAYLOAD"})
        for evt in events:
            if evt.get("status") not in VALID_DOOR_EVENT_STATUSES or "timestamp_s" not in evt:
                return httpx.Response(400, json={"error": "INVALID_PAYLOAD"})
        return httpx.Response(200, json={"success": True, "ingested_count": len(events)})

    if path.endswith("/status"):
        body = json.loads(request.content.decode("utf-8"))
        nodes = body.get("nodes")
        if not isinstance(nodes, list) or not any(n.get("node_id") == "C0" for n in nodes):
            return httpx.Response(400, json={"error": "INVALID_PAYLOAD"})
        return httpx.Response(200, json={"success": True, "updated_count": len(nodes)})

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
    assert commit_res.status == "deleted"


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


def test_cloud_health_status_and_door_event_normalization(
    mock_cloud_client: CloudClient,
) -> None:
    assert mock_cloud_client.check_health() is True

    status_payload = StatusPayload(
        nodes=[
            NodeStatusItem(node_id="C0", last_seen_s=1729930000),
            NodeStatusItem(node_id="F0", last_seen_s=None),
            NodeStatusItem(node_id="D0", last_seen_s=1729929990),
        ]
    )
    assert mock_cloud_client.sync_status(status_payload) is True

    captured_bodies: list[dict[str, object]] = []

    def spy_handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            captured_bodies.append(json.loads(request.content.decode("utf-8")))
        return mock_api_handler(request)

    spy_client = CloudClient(base_url="https://test.local/api", gateway_token="test_token")
    spy_client._get_client = lambda: httpx.Client(  # type: ignore[method-assign]
        base_url=spy_client.base_url,
        headers=spy_client._headers,
        transport=httpx.MockTransport(spy_handler),
    )

    door_payload = DoorEventSyncPayload(
        node_id="D0",
        event_type="IR_LIGHT_MISMATCH_ERROR",
        timestamp=1729930050,
        details={"ldr_light": 250},
    )
    assert spy_client.sync_door_event(door_payload) is True
    assert len(captured_bodies) == 1
    events = captured_bodies[0]["events"]
    assert isinstance(events, list)
    assert events[0] == {
        "node_id": "D0",
        "timestamp_s": 1729930050,
        "status": "CONTRADICTION_ERROR",
    }


def test_sync_manager_batch_telemetry_and_status_heartbeat(
    tmp_path: Path, mock_cloud_client: CloudClient
) -> None:
    queue = OfflineQueue(db_path=str(tmp_path / "batch_heartbeat.db"))

    offline_client = CloudClient(base_url="https://offline.local/api", gateway_token="test")
    failing_transport = httpx.MockTransport(lambda req: httpx.Response(503))
    offline_client._get_client = lambda: httpx.Client(  # type: ignore[method-assign]
        base_url=offline_client.base_url,
        headers=offline_client._headers,
        transport=failing_transport,
    )

    manager = CloudSyncManager(offline_client, queue, captures_dir=str(tmp_path / "captures"))
    samples = [
        SensorSample.from_raw(1729930000, 320, 100, 30),
        SensorSample.from_raw(1729930030, 330, 110, 35),
    ]
    assert manager.send_or_enqueue_telemetry_batch("F0", samples) is False
    assert len(queue.get_pending_telemetry()) == 2

    manager.client = mock_cloud_client
    counts = manager.flush_offline_queue()
    assert counts["telemetry"] == 2
    assert len(queue.get_pending_telemetry()) == 0

    assert manager.send_or_enqueue_telemetry_batch("F0", samples) is True
    manager.record_node_seen("F0", 1729930030)
    manager.record_node_seen("D0", 1729930040)
    assert manager.send_status_heartbeat() is True
