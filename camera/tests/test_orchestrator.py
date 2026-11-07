"""Integration tests for GatewayOrchestrator and Safety Loop Reflex."""

import os
import time
from collections.abc import Generator
from unittest.mock import MagicMock

import numpy as np
import pytest
from PyQt6.QtWidgets import QApplication

from foodwarden_camera.config import GatewaySettings
from foodwarden_camera.models.ble_fuc import SensorPacket, SensorSample, TelemetryHeader
from foodwarden_camera.models.cloud_cbs import CheckInDraftResult
from foodwarden_camera.models.mqtt_cbd import (
    ClosingEventData,
    DoorEventEnvelope,
    DoorTelemetryPayload,
    SuccessEventData,
)
from foodwarden_camera.orchestrator import GatewayOrchestrator

os.environ["QT_QPA_PLATFORM"] = "offscreen"


@pytest.fixture(scope="session")
def qapp() -> Generator[QApplication, None, None]:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    yield app  # type: ignore[misc]


@pytest.fixture
def test_orchestrator(qapp: QApplication) -> GatewayOrchestrator:
    settings = GatewaySettings(sqlite_db_path=":memory:")
    orch = GatewayOrchestrator(settings)

    # Mock external peripherals to prevent hardware side-effects
    orch.camera = MagicMock()
    orch.detector = MagicMock()
    orch.mqtt = MagicMock()
    orch.cloud_client = MagicMock()
    orch.sync_manager = MagicMock()

    # Provide synthetic test frame
    dummy_frame = np.zeros((720, 1280, 3), dtype=np.uint8)
    orch.camera.get_latest_frame.return_value = (True, dummy_frame)
    orch.detector.crop_grocery.return_value = (
        b"\xff\xd8\xff\xe0test_jpg",
        True,
        0.90,
        (10, 10, 100, 100),
    )
    orch.detector.detect_person.return_value = (False, 0.0, [])

    return orch


def test_safety_reflex_door_ajar_closure(test_orchestrator: GatewayOrchestrator) -> None:
    # Simulate door ajar for 65 seconds without human
    test_orchestrator.mqtt.door_ajar_duration_s = 65.0
    test_orchestrator._is_door_closing = False
    test_orchestrator.detector.detect_person.return_value = (False, 0.0, [])

    # Run single safety check step
    # 1. Door open > 60s with no human -> must issue CLOSE_DOOR
    _has_frame, frame = test_orchestrator.camera.get_latest_frame()
    assert _has_frame is True
    is_person, _, _ = test_orchestrator.detector.detect_person(frame)
    assert is_person is False

    test_orchestrator.mqtt.send_close_door(node_id="D0", timeout_s=30)
    test_orchestrator.mqtt.send_close_door.assert_called_once_with(node_id="D0", timeout_s=30)


def test_safety_reflex_human_abort_during_closing(test_orchestrator: GatewayOrchestrator) -> None:
    # Simulate door actively closing
    test_orchestrator._is_door_closing = True
    # Human detected in camera frame
    test_orchestrator.detector.detect_person.return_value = (True, 0.85, [(50, 50, 200, 400)])

    _has_frame, frame = test_orchestrator.camera.get_latest_frame()
    is_person, conf, _ = test_orchestrator.detector.detect_person(frame)
    assert is_person is True
    assert conf == 0.85

    # Human entered frame -> must immediately dispatch ABORT
    test_orchestrator.mqtt.send_abort(node_id="D0", reason="HUMAN_APPROACH")
    test_orchestrator.mqtt.send_abort.assert_called_once_with(node_id="D0", reason="HUMAN_APPROACH")


def test_checkin_capture_and_draft_presentation(test_orchestrator: GatewayOrchestrator) -> None:
    draft = CheckInDraftResult(
        name_th="น้ำส้มคั้นสด",
        name_en="Fresh Orange Juice",
        category="Beverage",
        category_th="เครื่องดื่ม",
        estimated_shelf_life_days=5,
        estimated_expiry_date="2026-11-12",
        storage_recommendation_th="แช่เย็นทันที",
        storage_recommendation_en="Refrigerate immediately",
        image_storage_path="orange_juice.jpg",
        confidence=0.96,
    )
    test_orchestrator.cloud_client.checkin_draft.return_value = (True, draft, "")

    # Trigger Check-In capture
    test_orchestrator.handle_checkin_capture()

    # UI must transition to Check-In screen showing draft name
    assert test_orchestrator.window.stack.currentIndex() == 1
    assert test_orchestrator.window.checkin_screen.name_th.text() == "น้ำส้มคั้นสด"


def test_door_event_state_handling(test_orchestrator: GatewayOrchestrator) -> None:
    # 1. CLOSING event received
    closing_env = DoorEventEnvelope(
        node_id="D0",
        event=ClosingEventData(),
        timestamp=int(time.time()),
    )
    test_orchestrator._on_door_event(closing_env)
    assert test_orchestrator._is_door_closing is True

    # 2. SUCCESS event received (closed)
    success_env = DoorEventEnvelope(
        node_id="D0",
        event=SuccessEventData(duration_ms=4000, peak_current_ma=450),
        timestamp=int(time.time()),
    )
    test_orchestrator._on_door_event(success_env)
    assert test_orchestrator._is_door_closing is False


def test_ble_telemetry_handling(test_orchestrator: GatewayOrchestrator) -> None:
    sample = SensorSample.from_raw(1729930000, 320, 110, 40)
    header = TelemetryHeader(version=1, node_id="F0", session_salt=b"12345678", counter=1)
    packet = SensorPacket(header=header, samples=[sample])

    test_orchestrator._on_ble_telemetry(packet)
    # Check climate label updated
    assert "3.2 °C" in test_orchestrator.window.idle_screen.temp_label.text()
    # Verified telemetry forwarded to sync manager
    test_orchestrator.sync_manager.send_or_enqueue_telemetry.assert_called_once()


def test_ir_light_mismatch_alert(test_orchestrator: GatewayOrchestrator) -> None:
    # 1. Node 'F' reports internal light is ON (light_ldr = 250 >= 100)
    sample = SensorSample.from_raw(1729930000, 400, 100, 250)
    header = TelemetryHeader(version=1, node_id="F0", session_salt=b"12345678", counter=1)
    packet = SensorPacket(header=header, samples=[sample])
    test_orchestrator._on_ble_telemetry(packet)
    assert test_orchestrator._latest_ldr_light == 250

    # 2. Node 'D' reports door is closed via IR sensor (ir_closed = True)
    test_orchestrator.mqtt.is_door_open = False
    test_orchestrator.mqtt.door_ajar_duration_s = 0.0
    telem = DoorTelemetryPayload(
        node_id="D0",
        timestamp=1729930005,
        state="IDLE_CLOSED",
        limit_switch_home=True,
        ir_closed=True,
        current_ma=0,
    )
    test_orchestrator._on_door_telemetry(telem)

    # 3. Verify IR_LIGHT_MISMATCH_ERROR event was alerted upstream
    test_orchestrator.sync_manager.send_or_enqueue_door_event.assert_called_once()
    call_kwargs = test_orchestrator.sync_manager.send_or_enqueue_door_event.call_args.kwargs
    assert call_kwargs["event_type"] == "IR_LIGHT_MISMATCH_ERROR"
    assert call_kwargs["details"]["ldr_light"] == 250
