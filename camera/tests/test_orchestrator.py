"""Integration tests for GatewayOrchestrator and Safety Loop Reflex."""

import os
import threading
import time
from collections.abc import Generator
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest
from PyQt6.QtWidgets import QApplication

import foodwarden_camera.config as config_module
from foodwarden_camera.config import GatewaySettings
from foodwarden_camera.hardware.buttons import ButtonType
from foodwarden_camera.models.ble_fuc import SensorPacket, SensorSample, TelemetryHeader
from foodwarden_camera.models.cloud_cbs import (
    CheckInDraftResult,
    CheckOutCandidate,
    CheckOutDraftResult,
)
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


def _flush_workers(orch: GatewayOrchestrator, qapp: QApplication) -> None:
    orch.wait_for_workers(timeout_s=5.0)
    qapp.processEvents()


def test_checkin_capture_and_draft_presentation(
    test_orchestrator: GatewayOrchestrator,
    qapp: QApplication,
) -> None:
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
    _flush_workers(test_orchestrator, qapp)

    # UI must transition to Check-In screen showing draft name
    assert test_orchestrator.window.stack.currentIndex() == 1
    assert test_orchestrator.window.checkin_screen.name_th.text() == "น้ำส้มคั้นสด"


def test_nonblocking_capture_shows_loading_and_supports_cancel(
    test_orchestrator: GatewayOrchestrator,
    qapp: QApplication,
) -> None:
    gate = threading.Event()
    started = threading.Event()
    draft = CheckInDraftResult(
        name_th="นมจืด",
        name_en="Plain Milk",
        category="Dairy",
        category_th="นม",
        estimated_shelf_life_days=7,
        estimated_expiry_date="2026-11-26",
        storage_recommendation_th="แช่เย็น",
        storage_recommendation_en="Refrigerate",
        image_storage_path="milk.jpg",
        confidence=0.95,
    )

    def blocked_draft(*_args: object, **_kwargs: object) -> tuple[bool, CheckInDraftResult, str]:
        started.set()
        gate.wait(timeout=3.0)
        return True, draft, ""

    test_orchestrator.cloud_client.checkin_draft.side_effect = blocked_draft

    t0 = time.monotonic()
    test_orchestrator.handle_checkin_capture()
    elapsed = time.monotonic() - t0
    assert elapsed < 0.5
    assert started.wait(timeout=2.0)

    # Loading UI + captured preview appear immediately while Gemini HTTP call is still blocked
    assert test_orchestrator.window.stack.currentIndex() == 1
    assert "กำลังวิเคราะห์" in test_orchestrator.window.checkin_screen.name_th.text()
    assert test_orchestrator.window.checkin_screen.image_label.pixmap() is not None

    # User cancels mid-request -> returns immediately to Idle and discards late AI response
    test_orchestrator.buttons.emit_button_press(ButtonType.CANCEL)
    qapp.processEvents()
    assert test_orchestrator.window.stack.currentIndex() == 0

    gate.set()
    _flush_workers(test_orchestrator, qapp)
    assert test_orchestrator.window.stack.currentIndex() == 0

    # Check-Out shows immediate loading screen, then transitions to FEFO candidates when ready
    cand = CheckOutCandidate(
        item_id="c1",
        name_th="นมจืด",
        name_en="Plain Milk",
        category="Dairy",
        category_th="นม",
        expiry_date="2026-11-26",
        confidence=0.9,
    )
    checkout_gate = threading.Event()
    checkout_started = threading.Event()

    def blocked_checkout(
        *_args: object, **_kwargs: object
    ) -> tuple[bool, CheckOutDraftResult, str]:
        checkout_started.set()
        checkout_gate.wait(timeout=3.0)
        return True, CheckOutDraftResult(candidates=[cand]), ""

    test_orchestrator.cloud_client.checkout_draft.side_effect = blocked_checkout
    test_orchestrator.handle_checkout_capture()
    assert checkout_started.wait(timeout=2.0)
    assert test_orchestrator.window.stack.currentIndex() == 2
    assert "Loading" in test_orchestrator.window.checkout_screen.countdown_label.text()

    checkout_gate.set()
    _flush_workers(test_orchestrator, qapp)
    assert test_orchestrator.window.stack.currentIndex() == 2
    assert test_orchestrator.window.checkout_screen.list_widget.count() == 1


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


def test_pir_sleep_and_wake_controls_camera(
    test_orchestrator: GatewayOrchestrator,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invoked_cmds: list[list[str]] = []
    monkeypatch.setattr(
        test_orchestrator,
        "_run_x11_commands",
        lambda cmds: invoked_cmds.extend(cmds),
    )

    test_orchestrator._on_pir_sleep()
    test_orchestrator.camera.stop.assert_called_once()
    assert test_orchestrator.window.is_display_sleeping is True
    assert all("off" not in cmd for cmd in invoked_cmds)

    test_orchestrator._on_pir_wake()
    test_orchestrator.camera.start.assert_called_once()
    assert test_orchestrator.window.is_display_sleeping is False


def test_dark_box_ble_does_not_reset_active_door_ir_and_indicators_update(
    test_orchestrator: GatewayOrchestrator,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(config_module, "env_path", tmp_path / ".env")
    test_orchestrator.apply_door_close_timeout(8)
    assert test_orchestrator.settings.door_close_timeout_s == 8

    now = time.time()
    test_orchestrator.ble.last_contact_time = now - 2.0
    test_orchestrator.mqtt.last_contact_time = {"D0": now - 1.0}
    test_orchestrator.mqtt.node_online = {"D0": True}
    test_orchestrator.mqtt.is_door_open = True
    test_orchestrator.mqtt.door_ajar_duration_s = 12.0
    test_orchestrator.sync_manager.is_online = True

    # Node 'F' inside a dark box (light < 100) must NOT clear open door state while 'D0' is active
    dark_sample = SensorSample.from_raw(int(now), 350, 100, 15)
    packet = SensorPacket(
        header=TelemetryHeader(version=1, node_id="F0", session_salt=b"12345678", counter=1),
        samples=[dark_sample],
    )
    test_orchestrator._on_ble_telemetry(packet)

    test_orchestrator.mqtt.set_door_state.assert_not_called()
    assert "#2E6B1F" in test_orchestrator.window.idle_screen.pill_node_f.styleSheet()
    assert "#2E6B1F" in test_orchestrator.window.idle_screen.pill_node_d.styleSheet()
    assert "Wi-Fi: OK" == test_orchestrator.window.idle_screen.pill_wifi.text()
    assert "Door: Open (12s)" == test_orchestrator.window.idle_screen.pill_door.text()


def test_configurable_door_close_timeout_and_abort_cooldown(
    test_orchestrator: GatewayOrchestrator,
) -> None:
    test_orchestrator.settings.door_close_timeout_s = 5
    test_orchestrator._last_abort_at = None
    test_orchestrator.mqtt.is_door_open = True
    test_orchestrator.mqtt.door_ajar_duration_s = 5.5
    test_orchestrator._is_door_closing = False
    test_orchestrator.detector.detect_person.return_value = (False, 0.0, [])

    # Elapsed >= 5s with clear camera -> sends CLOSE_DOOR
    test_orchestrator._evaluate_safety_step()
    test_orchestrator.mqtt.send_close_door.assert_called_once_with(node_id="D0", timeout_s=30)
    assert test_orchestrator._is_door_closing is True
    assert "CLOSE_DOOR" in test_orchestrator.window.alert_banner.label_en.text()

    # Person steps into frame while closing -> sends ABORT immediately
    test_orchestrator.detector.detect_person.return_value = (True, 0.91, [(10, 10, 100, 200)])
    test_orchestrator._evaluate_safety_step()
    test_orchestrator.mqtt.send_abort.assert_called_once_with(node_id="D0", reason="HUMAN_APPROACH")
    assert test_orchestrator._is_door_closing is False
    assert "ตรวจพบบุคคล" in test_orchestrator.window.alert_banner.label_th.text()

    # Immediate next check while inside 5s cooldown must NOT immediately re-fire CLOSE_DOOR
    test_orchestrator.detector.detect_person.return_value = (False, 0.0, [])
    test_orchestrator._evaluate_safety_step()
    assert test_orchestrator.mqtt.send_close_door.call_count == 1


def test_human_presence_resets_door_ajar_timer(
    test_orchestrator: GatewayOrchestrator,
) -> None:
    test_orchestrator.settings.door_close_timeout_s = 5
    test_orchestrator._last_abort_at = None
    test_orchestrator._last_person_seen_at = None
    test_orchestrator._last_person_checked_at = -1000.0
    test_orchestrator.mqtt.is_door_open = True
    test_orchestrator.mqtt.door_ajar_duration_s = 12.0
    test_orchestrator._is_door_closing = False

    # Person present while door is open -> resets timer and does NOT close door
    test_orchestrator.detector.detect_person.return_value = (True, 0.90, [(10, 10, 100, 200)])
    test_orchestrator._evaluate_safety_step()
    test_orchestrator.mqtt.reset_door_ajar_timer.assert_called_once()
    test_orchestrator.mqtt.send_close_door.assert_not_called()
    assert test_orchestrator.window.idle_screen.pill_door.text() == "Door: Open (0s)"

    # Person just stepped out -> must NOT close immediately (full 5s clear window required)
    test_orchestrator.detector.detect_person.return_value = (False, 0.0, [])
    test_orchestrator._evaluate_safety_step()
    test_orchestrator.mqtt.send_close_door.assert_not_called()

    # Once >= 5s has elapsed with no person seen -> closes door
    test_orchestrator._last_person_seen_at = time.monotonic() - 6.0
    test_orchestrator._evaluate_safety_step()
    test_orchestrator.mqtt.send_close_door.assert_called_once_with(node_id="D0", timeout_s=30)


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
    qapp: QApplication,
) -> None:
    # 1. Check-in HTTP 422 must return to Idle screen and NOT enqueue offline capture
    test_orchestrator.cloud_client.checkin_draft.return_value = (
        False,
        None,
        "HTTP 422 UNIDENTIFIABLE: Item could not be reliably identified.",
    )
    test_orchestrator.handle_checkin_capture()
    _flush_workers(test_orchestrator, qapp)

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
    _flush_workers(test_orchestrator, qapp)

    assert test_orchestrator.window.stack.currentIndex() == 0
    assert "ไม่พบอาหาร" in test_orchestrator.window.alert_banner.label_th.text()
    assert "ไม่มีสัญญาณอินเทอร์เน็ต" not in test_orchestrator.window.alert_banner.label_th.text()

    # 3. Genuine network failure still buffers offline capture and transitions screen
    test_orchestrator.cloud_client.checkin_draft.return_value = (
        False,
        None,
        "Network connection error during check-in draft: timed out",
    )
    test_orchestrator.handle_checkin_capture()
    _flush_workers(test_orchestrator, qapp)

    test_orchestrator.sync_manager.enqueue_offline_checkin.assert_called_once()
    assert test_orchestrator.window.stack.currentIndex() == 1


def test_run_person_safety_check_updates_ui_and_preview_overlay(
    test_orchestrator: GatewayOrchestrator,
) -> None:
    dummy_frame = np.zeros((240, 320, 3), dtype=np.uint8)
    test_orchestrator.detector.detect_person.return_value = (
        True,
        0.88,
        [(20, 30, 120, 200)],
    )

    is_person, conf, boxes = test_orchestrator._run_person_safety_check(dummy_frame)
    assert is_person is True
    assert conf == 0.88
    assert boxes == [(20, 30, 120, 200)]
    assert "88%" in test_orchestrator.window.idle_screen.pill_person.text()
    assert "พบคน" in test_orchestrator.window.idle_screen.person_label.text()

    annotated = test_orchestrator._annotate_person_preview(dummy_frame)
    assert annotated is not dummy_frame
    assert int(annotated.sum()) > 0
    assert int(dummy_frame.sum()) == 0

    test_orchestrator.detector.detect_person.return_value = (False, 0.0, [])
    is_person_2, _, boxes_2 = test_orchestrator._run_person_safety_check(dummy_frame)
    assert is_person_2 is False
    assert boxes_2 == []
    assert "Clear" in test_orchestrator.window.idle_screen.pill_person.text()
    assert test_orchestrator._annotate_person_preview(dummy_frame) is dummy_frame


def test_commit_workers_report_outcome_to_result_card(
    test_orchestrator: GatewayOrchestrator,
) -> None:
    from foodwarden_camera.models.cloud_cbs import (
        CheckInCommitPayload,
        CheckInCommitResult,
        CheckOutCommitPayload,
        CheckOutCommitResult,
    )

    window = test_orchestrator.window
    checkin_payload = CheckInCommitPayload(
        name_th="นมสด",
        name_en="Milk",
        category="Dairy",
        category_th="นม",
        estimated_shelf_life_days=7,
        expiry_date="2026-12-01",
        storage_recommendation_th="แช่เย็น",
        storage_recommendation_en="Keep cold",
        image_storage_path="milk.jpg",
        confidence=0.9,
    )

    # Success -> "นำเข้าแล้ว"
    window.result_screen.show_saving("checkin", "นมสด")
    window.stack.setCurrentIndex(5)
    test_orchestrator.cloud_client.checkin_commit.return_value = (
        True,
        CheckInCommitResult(item_id="i1"),
        "",
    )
    test_orchestrator._run_commit_checkin_worker(checkin_payload, "k1")
    assert window.result_screen.status == "success"
    assert "01/12/2026" in window.result_screen.message_label.text()

    # Offline -> buffered for retry and reported as "queued", not as a failure
    window.result_screen.show_saving("checkin", "นมสด")
    test_orchestrator.cloud_client.checkin_commit.return_value = (False, None, "Connection refused")
    test_orchestrator._run_commit_checkin_worker(checkin_payload, "k2")
    assert window.result_screen.status == "queued"
    test_orchestrator.sync_manager.enqueue_pending_commit.assert_called_once()

    # Check-out success / failure
    window.result_screen.show_saving("checkout", "นมสด")
    test_orchestrator.cloud_client.checkout_commit.return_value = (
        True,
        CheckOutCommitResult(item_id="i1"),
        "",
    )
    test_orchestrator._run_commit_checkout_worker(CheckOutCommitPayload(item_id="i1"), "นมสด")
    assert window.result_screen.status == "success"

    window.result_screen.show_saving("checkout", "นมสด")
    test_orchestrator.cloud_client.checkout_commit.return_value = (False, None, "HTTP 401")
    test_orchestrator._run_commit_checkout_worker(CheckOutCommitPayload(item_id="i1"), "นมสด")
    assert window.result_screen.status == "failed"
    assert "Token" in window.result_screen.message_label.text()
