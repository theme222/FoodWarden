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

    # 'O' opens the confirm step; nothing is committed yet
    button_ctrl.emit_button_press(ButtonType.SELECT)
    assert window.stack.currentIndex() == 4
    assert selected_candidate is None

    # 'O' again confirms -> committed and the result card is shown
    button_ctrl.emit_button_press(ButtonType.SELECT)
    assert selected_candidate is not None
    assert selected_candidate.item_id == "cand_2"
    assert window.stack.currentIndex() == 5

    # Any button on the result card returns to Idle
    button_ctrl.emit_button_press(ButtonType.SELECT)
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

    # Wait -> Fresh Green -> Amber Soon -> Red Critical progression for Node 'F' and Node 'D'
    window.update_node_status("F0", None)
    assert "Fridge: Wait" in window.idle_screen.pill_node_f.text()
    assert "#D8E2C2" in window.idle_screen.pill_node_f.styleSheet()

    window.update_node_status("F0", 1.0, is_connected=True)
    assert "LIVE" in window.idle_screen.pill_node_f.text()
    assert "#2E6B1F" in window.idle_screen.pill_node_f.styleSheet()

    window.update_node_status("F0", 75.0)
    assert "1m15s" in window.idle_screen.pill_node_f.text()
    assert "#F2A33A" in window.idle_screen.pill_node_f.styleSheet()

    window.update_node_status("D0", 25.0, is_offline=True)
    assert "Door: Off 25s" in window.idle_screen.pill_node_d.text()
    assert "#D6432C" in window.idle_screen.pill_node_d.styleSheet()

    # Awake renders pale-lime Web Prototype canvas (#E9F2D2); Sleep renders solid black #000000
    window.show()
    qapp.processEvents()
    assert window.grab().toImage().pixelColor(4, 4).name() == "#e9f2d2"

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
    assert "GPIO" not in window.idle_screen.pill_motion.text()
    assert "GPIO" not in window.idle_screen.motion_label.text()
    assert "พบการเคลื่อนไหว" in window.idle_screen.motion_label.text()

    window.update_motion_state(False, 75.0, "PIR Disabled")
    assert "1m 15s" in window.idle_screen.pill_motion.text()
    assert "ปิดใช้งาน" in window.idle_screen.motion_label.text()
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


def _make_candidates(n: int) -> list[CheckOutCandidate]:
    return [
        CheckOutCandidate(
            item_id=f"cand_{i}",
            name_th=f"รายการ {i}",
            name_en=f"Item {i}",
            category="Dairy",
            category_th="นม",
            expiry_date="2026-12-01",
            confidence=0.9,
        )
        for i in range(n)
    ]


def _expire(screen_timer_owner: object, attr: str = "_tick_countdown") -> None:
    """Ticks a screen's countdown until it fires (each tick = 1 simulated second)."""
    owner = screen_timer_owner
    while getattr(owner, "_countdown_timer").isActive():  # noqa: B009
        getattr(owner, attr)()


def test_checkout_scroll_restarts_30s_countdown(qapp: QApplication) -> None:
    button_ctrl = ButtonController()
    window = FoodWardenMainWindow(button_controller=button_ctrl, autocomplete_timeout_s=10)
    screen = window.checkout_screen
    window.show_checkout_candidates(_make_candidates(3))

    # The list must never take keyboard focus, or it would swallow ↑/↓.
    assert screen.list_widget.focusPolicy() == Qt.FocusPolicy.NoFocus
    assert screen._countdown_seconds == 10
    assert "ยกเลิกอัตโนมัติใน 10" in screen.countdown_label.text()

    # Keyboard ↓ (routed like the Pi-top button) switches to the 30 s countdown...
    screen._tick_countdown()
    window.keyPressEvent(
        QKeyEvent(QKeyEvent.Type.KeyPress, Qt.Key.Key_Down, Qt.KeyboardModifier.NoModifier)
    )
    assert screen.list_widget.currentRow() == 1
    assert screen.is_manual and screen._countdown_timer.isActive()
    assert screen._countdown_seconds == 30

    # ...which restarts on every move, including at the bottom edge and touch.
    for _ in range(5):
        screen._tick_countdown()
    button_ctrl.emit_button_press(ButtonType.DOWN)
    assert screen._countdown_seconds == 30
    screen._tick_countdown()
    button_ctrl.emit_button_press(ButtonType.DOWN)  # already at the last row
    assert screen.list_widget.currentRow() == 2
    assert screen._countdown_seconds == 30
    screen._tick_countdown()
    screen.list_widget.setCurrentRow(0)
    assert screen._countdown_seconds == 30
    screen.handle_cancel()


def test_checkout_timeouts_never_remove_item(qapp: QApplication) -> None:
    button_ctrl = ButtonController()
    committed: list[str] = []
    window = FoodWardenMainWindow(
        button_controller=button_ctrl,
        on_commit_checkout=lambda c: committed.append(c.item_id),
        autocomplete_timeout_s=10,
    )
    screen = window.checkout_screen

    # 1) Untouched 10 s -> not removed, result card says so.
    window.show_checkout_candidates(_make_candidates(2))
    _expire(screen)
    assert committed == []
    assert window.stack.currentIndex() == 5
    assert window.result_screen.status == "skipped"
    assert "ไม่ได้นำออก" in window.result_screen.headline_label.text()
    assert window.result_screen.name_label.text() == "รายการ 0"

    # 2) Scrolled, then 30 s -> not removed (reports the item that was selected).
    window.show_checkout_candidates(_make_candidates(2))
    button_ctrl.emit_button_press(ButtonType.DOWN)
    _expire(screen)
    assert committed == []
    assert window.result_screen.status == "skipped"
    assert window.result_screen.name_label.text() == "รายการ 1"

    # 3) O -> confirm step with 7 s countdown; expiry -> not removed.
    window.show_checkout_candidates(_make_candidates(2))
    button_ctrl.emit_button_press(ButtonType.SELECT)
    assert window.stack.currentIndex() == 4
    assert "ยกเลิกอัตโนมัติใน 7" in window.confirm_screen.countdown_label.text()
    _expire(window.confirm_screen)
    assert committed == []
    assert window.result_screen.status == "skipped"

    # 4) O, X (back, 30 s again), O, O -> removed.
    window.show_checkout_candidates(_make_candidates(2))
    button_ctrl.emit_button_press(ButtonType.SELECT)
    button_ctrl.emit_button_press(ButtonType.CANCEL)
    assert window.stack.currentIndex() == 2
    assert screen._countdown_seconds == 30
    button_ctrl.emit_button_press(ButtonType.SELECT)
    button_ctrl.emit_button_press(ButtonType.SELECT)
    assert committed == ["cand_0"]
    assert window.result_screen.status == "saving"
    window.show_commit_result("checkout", "success", "รายการ 0")
    assert "นำออกแล้ว" in window.result_screen.headline_label.text()


def test_checkin_timeouts_always_save(qapp: QApplication) -> None:
    button_ctrl = ButtonController()
    committed: list[str] = []
    window = FoodWardenMainWindow(
        button_controller=button_ctrl,
        on_commit_checkin=lambda _d, date_str: committed.append(date_str),
        autocomplete_timeout_s=10,
    )
    draft = CheckInDraftResult(
        name_th="นมสด",
        name_en="Milk",
        category="Dairy",
        category_th="นม",
        estimated_shelf_life_days=7,
        estimated_expiry_date="2099-01-10",
        storage_recommendation_th="แช่เย็น",
        storage_recommendation_en="Keep cold",
        image_storage_path="milk.jpg",
        confidence=0.95,
    )
    screen = window.checkin_screen

    # 1) Untouched 10 s -> saved directly (no confirm step) and the result card shows it.
    window.show_checkin_draft(draft, b"")
    assert screen._countdown_seconds == 10
    assert "บันทึกอัตโนมัติใน 10" in screen.countdown_label.text()
    _expire(screen)
    assert committed == ["2099-01-10"]
    assert window.stack.currentIndex() == 5
    window.show_commit_result("checkin", "success", "นมสด")
    assert "นำเข้าแล้ว" in window.result_screen.headline_label.text()
    button_ctrl.emit_button_press(ButtonType.CANCEL)  # any button -> Idle
    assert window.stack.currentIndex() == 0

    # 2) Editing -> 30 s countdown restarting on every press; expiry saves the edit.
    committed.clear()
    window.show_checkin_draft(draft, b"")
    button_ctrl.emit_button_press(ButtonType.UP)
    assert screen.is_manual and screen._countdown_seconds == 30
    for _ in range(12):
        screen._tick_countdown()
    button_ctrl.emit_button_press(ButtonType.UP)
    assert screen._countdown_seconds == 30
    _expire(screen)
    assert committed == ["2099-01-12"]
    assert window.stack.currentIndex() == 5

    # 3) O through Day -> Month -> Year opens confirm with a 7 s countdown; expiry saves.
    committed.clear()
    window.show_checkin_draft(draft, b"")
    for _ in range(3):
        button_ctrl.emit_button_press(ButtonType.SELECT)
    assert window.stack.currentIndex() == 4
    assert "บันทึกอัตโนมัติใน 7" in window.confirm_screen.countdown_label.text()
    _expire(window.confirm_screen)
    assert committed == ["2099-01-10"]
    assert window.stack.currentIndex() == 5

    # 4) X on confirm goes back to editing with the 30 s countdown; O confirms.
    committed.clear()
    window.show_checkin_draft(draft, b"")
    for _ in range(3):
        button_ctrl.emit_button_press(ButtonType.SELECT)
    button_ctrl.emit_button_press(ButtonType.CANCEL)
    assert window.stack.currentIndex() == 1
    assert screen._countdown_seconds == 30
    for _ in range(3):
        button_ctrl.emit_button_press(ButtonType.SELECT)
    button_ctrl.emit_button_press(ButtonType.SELECT)
    assert committed == ["2099-01-10"]

    # Outcome that arrives after the user left the card goes to the banner instead.
    button_ctrl.emit_button_press(ButtonType.SELECT)
    assert window.stack.currentIndex() == 0
    window.show_commit_result("checkin", "queued", "นมสด")
    assert "นมสด" in window.alert_banner.label_th.text()


def test_checkin_expiry_never_before_today(qapp: QApplication) -> None:
    from datetime import date, timedelta

    button_ctrl = ButtonController()
    committed: list[str] = []
    window = FoodWardenMainWindow(
        button_controller=button_ctrl,
        on_commit_checkin=lambda _d, date_str: committed.append(date_str),
    )
    screen = window.checkin_screen
    today = date.today()

    draft = CheckInDraftResult(
        name_th="นมสด",
        name_en="Milk",
        category="Dairy",
        category_th="นม",
        estimated_shelf_life_days=7,
        estimated_expiry_date=(today - timedelta(days=10)).isoformat(),
        storage_recommendation_th="แช่เย็น",
        storage_recommendation_en="Keep cold",
        image_storage_path="milk.jpg",
        confidence=0.95,
    )
    # A past AI date is clamped to today on load.
    window.show_checkin_draft(draft, b"")
    assert screen._current_date == today

    # Day / Month / Year ↓ can never go below today.
    for segment in range(3):
        screen._selected_segment = segment
        for _ in range(5):
            button_ctrl.emit_button_press(ButtonType.DOWN)
            assert screen._current_date >= today

    # From a future date, month/year ↓ stop at today instead of overshooting.
    screen._current_date = today + timedelta(days=20)
    screen._selected_segment = 1
    button_ctrl.emit_button_press(ButtonType.DOWN)
    assert screen._current_date == today
    screen._current_date = today + timedelta(days=200)
    screen._selected_segment = 2
    button_ctrl.emit_button_press(ButtonType.DOWN)
    assert screen._current_date == today

    # Up still works and commit sends an ISO date >= today.
    screen._selected_segment = 0
    button_ctrl.emit_button_press(ButtonType.UP)
    assert screen._current_date == today + timedelta(days=1)
    screen._selected_segment = 2
    button_ctrl.emit_button_press(ButtonType.SELECT)  # -> confirm step
    assert committed == []
    button_ctrl.emit_button_press(ButtonType.SELECT)  # confirm
    assert committed == [(today + timedelta(days=1)).isoformat()]


def test_add_months_clamps_day_to_month_length() -> None:
    from datetime import date

    from foodwarden_camera.ui.screens.checkin_screen import _add_months, _add_years

    assert _add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert _add_months(date(2026, 12, 15), 1) == date(2027, 1, 15)
    assert _add_months(date(2027, 1, 15), -1) == date(2026, 12, 15)
    assert _add_years(date(2028, 2, 29), 1) == date(2029, 2, 28)
