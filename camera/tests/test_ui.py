"""Unit tests for PyQt6 Bilingual User Interface (FoodWardenMainWindow)."""

import os
from collections.abc import Generator
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QKeyEvent
from PyQt6.QtWidgets import QApplication

from foodwarden_camera.config import GatewaySettings
from foodwarden_camera.hardware.buttons import ButtonController, ButtonType
from foodwarden_camera.models.cloud_cbs import CheckInDraftResult, CheckOutCandidate
from foodwarden_camera.ui.main_window import FoodWardenMainWindow

# Enforce offscreen QPA platform for headless testing
os.environ["QT_QPA_PLATFORM"] = "offscreen"


@pytest.fixture(scope="session")
def qapp() -> Generator[QApplication, None, None]:
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    yield app  # type: ignore[misc]


def test_main_window_initialization(qapp: QApplication) -> None:
    button_ctrl = ButtonController()
    window = FoodWardenMainWindow(button_ctrl)

    assert window.width() == 800
    assert window.height() == 480
    assert window.stack.currentIndex() == 0  # Starts on Idle screen


def test_idle_screen_triggers(qapp: QApplication) -> None:
    button_ctrl = ButtonController()
    checkin_triggered = False
    checkout_triggered = False

    def on_checkin() -> None:
        nonlocal checkin_triggered
        checkin_triggered = True

    def on_checkout() -> None:
        nonlocal checkout_triggered
        checkout_triggered = True

    _window = FoodWardenMainWindow(
        button_controller=button_ctrl,
        on_trigger_checkin_capture=on_checkin,
        on_trigger_checkout_capture=on_checkout,
    )

    # Trigger Check-In from Idle screen with 'O'
    button_ctrl.emit_button_press(ButtonType.SELECT)
    assert checkin_triggered is True

    # Trigger Check-Out from Idle screen with 'X'
    button_ctrl.emit_button_press(ButtonType.CANCEL)
    assert checkout_triggered is True


def test_checkin_screen_workflow_and_cancellation(qapp: QApplication) -> None:
    button_ctrl = ButtonController()
    committed_date = ""

    def on_commit(draft: CheckInDraftResult, date_str: str) -> None:
        nonlocal committed_date
        committed_date = date_str

    window = FoodWardenMainWindow(
        button_controller=button_ctrl,
        on_commit_checkin=on_commit,
    )

    draft = CheckInDraftResult(
        name_th="ไข่ไก่สด",
        name_en="Fresh Eggs",
        category="Poultry",
        category_th="ไข่และสัตว์ปีก",
        estimated_shelf_life_days=14,
        estimated_expiry_date="2026-11-21",
        storage_recommendation_th="เก็บในช่องเก็บไข่",
        storage_recommendation_en="Store in egg rack",
        image_storage_path="eggs.jpg",
        confidence=0.92,
    )

    # Load draft -> transitions to Check-In screen (index 1)
    window.show_checkin_draft(draft, b"")
    assert window.stack.currentIndex() == 1
    assert window.checkin_screen.name_th.text() == "ไข่ไก่สด"

    # Press 'X' -> cancels and returns to Idle screen (index 0)
    button_ctrl.emit_button_press(ButtonType.CANCEL)
    assert window.stack.currentIndex() == 0
    assert committed_date == ""


def test_checkout_screen_fefo_navigation(qapp: QApplication) -> None:
    button_ctrl = ButtonController()
    selected_candidate: CheckOutCandidate | None = None

    def on_commit(cand: CheckOutCandidate) -> None:
        nonlocal selected_candidate
        selected_candidate = cand

    window = FoodWardenMainWindow(
        button_controller=button_ctrl,
        on_commit_checkout=on_commit,
    )

    c1 = CheckOutCandidate(
        item_id="cand_1",
        name_th="นมสดพาสเจอร์ไรส์",
        name_en="Whole Milk",
        category="Dairy",
        category_th="นมและผลิตภัณฑ์นม",
        expiry_date="2026-11-10",
        confidence=0.90,
    )
    c2 = CheckOutCandidate(
        item_id="cand_2",
        name_th="นมสดพาสเจอร์ไรส์",
        name_en="Whole Milk",
        category="Dairy",
        category_th="นมและผลิตภัณฑ์นม",
        expiry_date="2026-11-15",
        confidence=0.88,
    )

    # Show candidates -> transitions to Check-Out screen (index 2)
    window.show_checkout_candidates([c1, c2])
    assert window.stack.currentIndex() == 2
    assert window.checkout_screen.list_widget.currentRow() == 0  # Top FEFO selected by default

    # Navigate down -> selects c2
    button_ctrl.emit_button_press(ButtonType.DOWN)
    assert window.checkout_screen.list_widget.currentRow() == 1

    # Confirm selection with 'O'
    button_ctrl.emit_button_press(ButtonType.SELECT)
    assert selected_candidate is not None
    assert selected_candidate.item_id == "cand_2"
    # Returns to Idle screen
    assert window.stack.currentIndex() == 0


def test_alert_banner_display(qapp: QApplication) -> None:
    button_ctrl = ButtonController()
    window = FoodWardenMainWindow(button_ctrl)
    window.show()

    assert window.alert_banner.isHidden() is True

    window.show_person_abort_alert()
    assert window.alert_banner.isHidden() is False
    assert "ตรวจพบบุคคล" in window.alert_banner.label_th.text()
    window.close()


def test_settings_screen_mouse_only_and_save(qapp: QApplication, tmp_path: Path) -> None:
    button_ctrl = ButtonController()
    saved_values: list[tuple[str, int, int]] = []
    checkin_called = False

    def on_checkin() -> None:
        nonlocal checkin_called
        checkin_called = True

    def on_save(token: str, autocomplete_s: int, sleep_s: int) -> None:
        saved_values.append((token, autocomplete_s, sleep_s))

    window = FoodWardenMainWindow(
        button_controller=button_ctrl,
        on_trigger_checkin_capture=on_checkin,
        on_save_settings=on_save,
        initial_token="old_tok",
        autocomplete_timeout_s=7,
        sleep_timeout_s=600,
    )

    # Open Settings via Idle screen mouse button
    window.idle_screen.btn_settings.click()
    assert window.stack.currentIndex() == 3
    assert window.settings_screen.token_input.text() == "old_tok"
    assert window.settings_screen.autocomplete_spin.value() == 7
    assert window.settings_screen.sleep_spin.value() == 600

    # Physical buttons & keyboard shortcuts for O/X must NOT trigger actions on Settings page
    button_ctrl.emit_button_press(ButtonType.SELECT)
    button_ctrl.emit_button_press(ButtonType.CANCEL)
    button_ctrl.emit_button_press(ButtonType.UP)
    button_ctrl.emit_button_press(ButtonType.DOWN)
    key_o = QKeyEvent(QKeyEvent.Type.KeyPress, Qt.Key.Key_O, Qt.KeyboardModifier.NoModifier, "o")
    window.keyPressEvent(key_o)
    assert window.stack.currentIndex() == 3
    assert checkin_called is False

    # Adjust values via UI controls and save
    window.settings_screen.token_input.setText("new_secret_token")
    window.settings_screen.autocomplete_spin.setValue(12)
    window.settings_screen.sleep_spin.setValue(300)
    window.settings_screen.btn_save.click()

    assert saved_values == [("new_secret_token", 12, 300)]
    assert window.stack.currentIndex() == 0
    assert window.checkin_screen.autocomplete_timeout_s == 12
    assert window.checkout_screen.autocomplete_timeout_s == 12

    # Verify GatewaySettings persists values to .env
    env_file = tmp_path / ".env"
    cfg = GatewaySettings()
    cfg.save_runtime_settings("new_secret_token", 12, 300, target_env_path=env_file)
    content = env_file.read_text(encoding="utf-8")
    assert (
        "GATEWAY_TOKEN='new_secret_token'" in content or "GATEWAY_TOKEN=new_secret_token" in content
    )
    assert "AUTOCOMPLETE_TIMEOUT_S='12'" in content or "AUTOCOMPLETE_TIMEOUT_S=12" in content
    assert "SLEEP_TIMEOUT_S='300'" in content or "SLEEP_TIMEOUT_S=300" in content


def test_configurable_countdown_timers(qapp: QApplication) -> None:
    button_ctrl = ButtonController()
    window = FoodWardenMainWindow(
        button_controller=button_ctrl,
        autocomplete_timeout_s=9,
    )

    draft = CheckInDraftResult(
        name_th="นมสด",
        name_en="Milk",
        category="Dairy",
        category_th="นม",
        estimated_shelf_life_days=7,
        estimated_expiry_date="2026-11-23",
        storage_recommendation_th="แช่เย็น",
        storage_recommendation_en="Keep cold",
        image_storage_path="milk.jpg",
        confidence=0.95,
    )
    window.show_checkin_draft(draft, b"")
    assert "9" in window.checkin_screen.countdown_label.text()
    window.checkin_screen.handle_cancel()

    cand = CheckOutCandidate(
        item_id="cand_9",
        name_th="นมสด",
        name_en="Milk",
        category="Dairy",
        category_th="นม",
        expiry_date="2026-11-23",
        confidence=0.95,
    )
    window.show_checkout_candidates([cand])
    assert "9" in window.checkout_screen.countdown_label.text()
    window.checkout_screen.handle_cancel()


def test_node_connection_badges_and_display_sleep_overlay(
    qapp: QApplication,
    tmp_path: Path,
) -> None:
    button_ctrl = ButtonController()
    checkin_calls = 0
    door_close_saved: list[int] = []

    def on_checkin() -> None:
        nonlocal checkin_calls
        checkin_calls += 1

    window = FoodWardenMainWindow(
        button_controller=button_ctrl,
        on_trigger_checkin_capture=on_checkin,
        on_save_door_close_timeout=door_close_saved.append,
        initial_door_close_timeout_s=15,
    )

    # Gray -> Green -> Yellow -> Red progression for Node 'F' and Node 'D'
    window.update_node_status("F0", None)
    assert "Wait" in window.idle_screen.pill_node_f.text()
    assert "#374151" in window.idle_screen.pill_node_f.styleSheet()

    window.update_node_status("F0", 1.0, is_connected=True)
    assert "LIVE" in window.idle_screen.pill_node_f.text()
    assert "#064E3B" in window.idle_screen.pill_node_f.styleSheet()

    window.update_node_status("F0", 75.0)
    assert "1m15s" in window.idle_screen.pill_node_f.text()
    assert "#78350F" in window.idle_screen.pill_node_f.styleSheet()

    window.update_node_status("D0", 25.0, is_offline=True)
    assert "Off 25s" in window.idle_screen.pill_node_d.text()
    assert "#7F1D1D" in window.idle_screen.pill_node_d.styleSheet()

    # Sleep overlay renders solid black #000000 and wakes cleanly on button press
    window.show()
    window.set_display_sleep(True)
    qapp.processEvents()
    assert window.is_display_sleeping is True
    assert window.stack.isVisible() is False
    assert window.grab().toImage().pixelColor(400, 200).name() == "#000000"

    button_ctrl.emit_button_press(ButtonType.SELECT)
    qapp.processEvents()
    assert window.is_display_sleeping is False
    assert window.stack.isVisible() is True
    assert checkin_calls == 0
    window.close()

    # Door close alert banner
    window.show_door_closing_alert()
    assert "CLOSE_DOOR" in window.alert_banner.label_en.text()

    # Door close delay editable on Settings screen and saved to .env
    window.idle_screen.btn_settings.click()
    assert window.settings_screen.door_close_spin.value() == 15
    window.settings_screen.door_close_spin.setValue(8)
    window.settings_screen.btn_save.click()
    assert door_close_saved == [8]

    env_file = tmp_path / ".env"
    cfg = GatewaySettings()
    cfg.save_runtime_settings("tok", 5, 600, door_close_timeout_s=8, target_env_path=env_file)
    content = env_file.read_text(encoding="utf-8")
    assert "DOOR_CLOSE_TIMEOUT_S='8'" in content or "DOOR_CLOSE_TIMEOUT_S=8" in content


def test_window_controls_and_motion_debug_ui(
    qapp: QApplication, monkeypatch: pytest.MonkeyPatch
) -> None:
    button_ctrl = ButtonController()
    window = FoodWardenMainWindow(button_ctrl)
    window.show()

    # Motion sensor UI updates (active vs. idle duration + hw status)
    window.update_motion_state(True, 0.0, "GPIO 22: HW")
    assert "DETECTED" in window.idle_screen.pill_motion.text()
    assert "GPIO 22: HW" in window.idle_screen.pill_motion.text()
    assert "พบการเคลื่อนไหว" in window.idle_screen.motion_label.text()

    window.update_motion_state(False, 75.0, "PIR Disabled")
    assert "1m 15s" in window.idle_screen.pill_motion.text()
    assert "PIR Disabled" in window.idle_screen.motion_label.text()
    assert "1 นาที 15 วินาที" in window.idle_screen.motion_label.text()

    # YOLO person detection debug UI updates
    window.update_person_state(True, 0.87, 1)
    assert "87%" in window.idle_screen.pill_person.text()
    assert "พบคน" in window.idle_screen.person_label.text()
    assert "87%" in window.idle_screen.person_label.text()

    window.update_person_state(False, 0.0, 0)
    assert "Clear" in window.idle_screen.pill_person.text()
    assert "ไม่พบคน" in window.idle_screen.person_label.text()

    # Fullscreen / Unfullscreen / Minimize controls
    window.showFullScreen()
    window.unfullscreen_window()
    assert window.isFullScreen() is False
    assert window.width() == 800
    assert window.height() == 480

    window.toggle_fullscreen()
    assert window.isFullScreen() is True
    window.toggle_fullscreen()
    assert window.isFullScreen() is False

    window.minimize_window()
    assert window.isMinimized() is True

    # Quit application closes window and triggers app.quit()
    quit_mock = MagicMock()
    monkeypatch.setattr(qapp, "quit", quit_mock)
    window.quit_application()
    assert window.isVisible() is False
    quit_mock.assert_called_once()


def test_loading_states_ignore_select_until_ai_responds(qapp: QApplication) -> None:
    button_ctrl = ButtonController()
    commit_calls = 0
    cancel_calls = 0

    def on_commit(_draft: CheckInDraftResult, _date_str: str) -> None:
        nonlocal commit_calls
        commit_calls += 1

    def on_cancel() -> None:
        nonlocal cancel_calls
        cancel_calls += 1

    window = FoodWardenMainWindow(
        button_controller=button_ctrl,
        on_commit_checkin=on_commit,
        on_cancel_capture=on_cancel,
    )

    # Check-In loading state shows immediately and blocks SELECT / UP / DOWN until draft arrives
    window.show_checkin_loading(b"")
    assert window.stack.currentIndex() == 1
    assert "กำลังวิเคราะห์" in window.checkin_screen.name_th.text()
    button_ctrl.emit_button_press(ButtonType.SELECT)
    assert commit_calls == 0

    # Cancelling during loading returns to Idle immediately and fires on_cancel_capture
    button_ctrl.emit_button_press(ButtonType.CANCEL)
    assert window.stack.currentIndex() == 0
    assert cancel_calls == 1

    # Check-Out loading state shows immediately and locks SELECT until candidates load
    window.show_checkout_loading(b"")
    assert window.stack.currentIndex() == 2
    assert "Loading" in window.checkout_screen.countdown_label.text()
    button_ctrl.emit_button_press(ButtonType.SELECT)
    assert window.stack.currentIndex() == 2
    button_ctrl.emit_button_press(ButtonType.CANCEL)
    assert window.stack.currentIndex() == 0
    assert cancel_calls == 2
