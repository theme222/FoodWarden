"""Unit tests for SQLite Offline Queue (Rubric E4 Store-and-Forward)."""

import pytest

from foodwarden_camera.models.ble_fuc import SensorSample
from foodwarden_camera.storage.offline_queue import OfflineQueue


@pytest.fixture
def temp_queue(tmp_path: pytest.TempPathFactory) -> OfflineQueue:
    db_file = str(tmp_path / "test_gateway.db")  # type: ignore
    return OfflineQueue(db_path=db_file)


def test_telemetry_offline_buffering(temp_queue: OfflineQueue) -> None:
    # Initially empty
    assert len(temp_queue.get_pending_telemetry()) == 0

    samples = [
        SensorSample.from_raw(1729930000, 320, 100, 40),
        SensorSample.from_raw(1729930060, 325, 105, 42),
    ]

    count = temp_queue.enqueue_telemetry_batch("F0", samples)
    assert count == 2

    pending = temp_queue.get_pending_telemetry(limit=10)
    assert len(pending) == 2
    assert pending[0]["node_id"] == "F0"
    assert pending[0]["timestamp_s"] == 1729930000
    assert pending[0]["temp_cdeg"] == 3.20

    # Delete first item
    first_id = pending[0]["id"]
    deleted = temp_queue.delete_telemetry([first_id])
    assert deleted == 1

    remaining = temp_queue.get_pending_telemetry()
    assert len(remaining) == 1
    assert remaining[0]["timestamp_s"] == 1729930060


def test_door_event_offline_buffering(temp_queue: OfflineQueue) -> None:
    assert len(temp_queue.get_pending_door_events()) == 0

    event_id = temp_queue.enqueue_door_event(
        node_id="D0",
        event_type="OBSTRUCTION_ERROR",
        timestamp=1729930018,
        details={"stall_current_ma": 1340, "retracted": True},
    )
    assert event_id > 0

    pending = temp_queue.get_pending_door_events()
    assert len(pending) == 1
    assert pending[0]["event_type"] == "OBSTRUCTION_ERROR"
    assert pending[0]["details"]["stall_current_ma"] == 1340

    deleted = temp_queue.delete_door_events([event_id])
    assert deleted == 1
    assert len(temp_queue.get_pending_door_events()) == 0


def test_offline_grocery_checkin_buffering(temp_queue: OfflineQueue) -> None:
    checkin_id = temp_queue.enqueue_checkin(
        image_path="/tmp/grocery_offline.jpg",
        captured_at=1729930050,
        confirmed_expiry="2026-11-10",
    )
    assert checkin_id > 0

    pending = temp_queue.get_pending_checkins()
    assert len(pending) == 1
    assert pending[0]["image_path"] == "/tmp/grocery_offline.jpg"
    assert pending[0]["confirmed_expiry"] == "2026-11-10"

    deleted = temp_queue.delete_checkin(checkin_id)
    assert deleted == 1
    assert len(temp_queue.get_pending_checkins()) == 0
