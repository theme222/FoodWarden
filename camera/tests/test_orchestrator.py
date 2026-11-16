"""Integration tests for GatewayOrchestrator and Safety Loop Reflex."""

import os
import time
from collections.abc import Generator
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest
from PyQt6.QtWidgets import QApplication

import foodwarden_camera.config as config_module
from foodwarden_camera.config import GatewaySettings
from foodwarden_camera.models.ble_fuc import SensorPacket, SensorSample, TelemetryHeader
from foodwarden_camera.models.cloud_cbs import CheckInDraftResult
from foodwarden_camera.models.mqtt_cbd import (
    ClosingEventData,
    DoorEventEnvelope,
    DoorTelemetryPayload,
    FaultLockoutEventData,
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


def test_pir_sleep_and_wake_controls_camera(test_orchestrator: GatewayOrchestrator) -> None:
    test_orchestrator._on_pir_sleep()
    test_orchestrator.camera.stop.assert_called_once()

    test_orchestrator._on_pir_wake()
    test_orchestrator.camera.start.assert_called_once()


def test_apply_settings_updates_runtime_subsystems(
    test_orchestrator: GatewayOrchestrator,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(config_module, "env_path", tmp_path / ".env")

    test_orchestrator.apply_settings(
        gateway_token="gw_tok_updated",
        autocomplete_timeout_s=11,
        sleep_timeout_s=180,
    )

    assert test_orchestrator.cloud_client.gateway_token == "gw_tok_updated"
    assert test_orchestrator.pir.inactivity_timeout_s == 180.0
    assert test_orchestrator.window.checkin_screen.autocomplete_timeout_s == 11
    assert test_orchestrator.window.checkout_screen.autocomplete_timeout_s == 11

    test_orchestrator.apply_pir_pin(17)
    assert test_orchestrator.pir.gpio_pin == 17
    assert "PIR_GPIO_PIN='17'" in (tmp_path / ".env").read_text(
        encoding="utf-8"
    ) or "PIR_GPIO_PIN=17" in (tmp_path / ".env").read_text(encoding="utf-8")


def test_ble_multi_sample_telemetry_and_last_seen(test_orchestrator: GatewayOrchestrator) -> None:
    sample1 = SensorSample.from_raw(1729930000, 320, 110, 40)
    sample2 = SensorSample.from_raw(1729930030, 340, 120, 45)
    header = TelemetryHeader(version=1, node_id="F0", session_salt=b"12345678", counter=2)
    packet = SensorPacket(header=header, samples=[sample1, sample2])

    test_orchestrator._on_ble_telemetry(packet)

    assert "3.4 °C" in test_orchestrator.window.idle_screen.temp_label.text()
    test_orchestrator.sync_manager.record_node_seen.assert_called_once_with("F0", 1729930030)
    test_orchestrator.sync_manager.send_or_enqueue_telemetry_batch.assert_called_once_with(
        "F0", [sample1, sample2]
    )


def test_door_fault_lockout_clears_closing_state(test_orchestrator: GatewayOrchestrator) -> None:
    test_orchestrator._is_door_closing = True
    fault_env = DoorEventEnvelope(
        node_id="D0",
        event=FaultLockoutEventData(),
        timestamp=1729930200,
    )

    test_orchestrator._on_door_event(fault_env)

    assert test_orchestrator._is_door_closing is False
    test_orchestrator.sync_manager.record_node_seen.assert_called_once_with("D0", 1729930200)


def test_checkin_and_checkout_422_shows_unidentifiable_not_offline(
    test_orchestrator: GatewayOrchestrator,
) -> None:
    # 1. Check-in HTTP 422 must stay on Idle screen and NOT enqueue offline capture
    test_orchestrator.cloud_client.checkin_draft.return_value = (
        False,
        None,
        "HTTP 422 UNIDENTIFIABLE: Item could not be reliably identified.",
    )
    test_orchestrator.handle_checkin_capture()

    assert test_orchestrator.window.stack.currentIndex() == 0
    test_orchestrator.sync_manager.enqueue_offline_checkin.assert_not_called()
    assert "ไม่พบอาหาร" in test_orchestrator.window.alert_banner.label_th.text()

    # 2. Check-out HTTP 422 must alert unidentifiable instead of offline warning
    test_orchestrator.cloud_client.checkout_draft.return_value = (
        False,
        None,
        "Check-out draft error: HTTP 422 - UNIDENTIFIABLE",
    )
    test_orchestrator.handle_checkout_capture()

    assert "ไม่พบอาหาร" in test_orchestrator.window.alert_banner.label_th.text()
    assert "ไม่มีสัญญาณอินเทอร์เน็ต" not in test_orchestrator.window.alert_banner.label_th.text()

    # 3. Genuine network failure still buffers offline capture and transitions screen
    test_orchestrator.cloud_client.checkin_draft.return_value = (
        False,
        None,
        "Network connection error during check-in draft: timed out",
    )
    test_orchestrator.handle_checkin_capture()

    test_orchestrator.sync_manager.enqueue_offline_checkin.assert_called_once()
    assert test_orchestrator.window.stack.currentIndex() == 1
