"""Unit tests for PyQt6 Bilingual User Interface (FoodWardenMainWindow)."""

import os
from collections.abc import Generator

import pytest
from PyQt6.QtWidgets import QApplication

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
