"""Main Window coordinating screens and hardware navigation for 5-inch LCD (800x480).

Renders the primary PyQt6 interface, managing state transitions between Idle,
Check-In, and Check-Out workflows with keyboard navigation emulation per ARCHITECTURE.md.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from PyQt6.QtCore import Qt, QThread, pyqtSignal
from PyQt6.QtGui import QKeyEvent
from PyQt6.QtWidgets import (
    QMainWindow,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from foodwarden_camera.hardware.buttons import ButtonController, ButtonType
from foodwarden_camera.models.cloud_cbs import CheckInDraftResult, CheckOutCandidate
from foodwarden_camera.ui.screens.alert_overlay import AlertBanner
from foodwarden_camera.ui.screens.checkin_screen import CheckInScreen
from foodwarden_camera.ui.screens.checkout_screen import CheckOutScreen
from foodwarden_camera.ui.screens.idle_screen import IdleScreen
from foodwarden_camera.ui.styles import (
    DARK_STYLESHEET,
    MAIN_WINDOW_HEIGHT,
    MAIN_WINDOW_WIDTH,
)

logger = logging.getLogger(__name__)


class FoodWardenMainWindow(QMainWindow):
    """Main window hosting the stacked screens on 800x480 resolution."""

    # Cross-thread Qt signals for safe background thread -> GUI updates
    _sig_button_up = pyqtSignal()
    _sig_button_down = pyqtSignal()
    _sig_button_select = pyqtSignal()
    _sig_button_cancel = pyqtSignal()
    _sig_update_frame = pyqtSignal(object)
    _sig_update_telemetry = pyqtSignal(object, object, object)
    _sig_update_door_state = pyqtSignal(bool, float)
    _sig_update_wifi_status = pyqtSignal(bool)
    _sig_person_abort_alert = pyqtSignal()
    _sig_offline_warning = pyqtSignal()

    def __init__(
        self,
        button_controller: ButtonController,
        on_trigger_checkin_capture: Callable[[], None] | None = None,
        on_trigger_checkout_capture: Callable[[], None] | None = None,
        on_commit_checkin: Callable[[CheckInDraftResult, str], None] | None = None,
        on_commit_checkout: Callable[[CheckOutCandidate], None] | None = None,
    ) -> None:
        super().__init__()
        self.button_controller = button_controller
        self.on_trigger_checkin_capture = on_trigger_checkin_capture
        self.on_trigger_checkout_capture = on_trigger_checkout_capture
        self.on_commit_checkin = on_commit_checkin
        self.on_commit_checkout = on_commit_checkout

        self.setWindowTitle("FoodWarden Gateway (Node 'C')")
        self.setFixedSize(MAIN_WINDOW_WIDTH, MAIN_WINDOW_HEIGHT)
        self.setStyleSheet(DARK_STYLESHEET)

        self._init_ui()
        self._bind_button_controller()

    def _init_ui(self) -> None:
        central_widget = QWidget(self)
        self.setCentralWidget(central_widget)

        root_layout = QVBoxLayout(central_widget)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        # 1. Alert Banner Overlay (Top)
        self.alert_banner = AlertBanner(central_widget)
        root_layout.addWidget(self.alert_banner)

        # 2. Stacked Screen Views
        self.stack = QStackedWidget(central_widget)

        # Screen 0: Idle Screen
        self.idle_screen = IdleScreen(self.stack)
        self.stack.addWidget(self.idle_screen)

        # Screen 1: Check-In Screen
        self.checkin_screen = CheckInScreen(
            on_confirm_callback=self._handle_checkin_confirmed,
            on_cancel_callback=self.show_idle_screen,
            parent=self.stack,
        )
        self.stack.addWidget(self.checkin_screen)

        # Screen 2: Check-Out Screen
        self.checkout_screen = CheckOutScreen(
            on_confirm_callback=self._handle_checkout_confirmed,
            on_cancel_callback=self.show_idle_screen,
            parent=self.stack,
        )
        self.stack.addWidget(self.checkout_screen)

        root_layout.addWidget(self.stack)

        # Start on Idle screen
        self.show_idle_screen()

    def _bind_button_controller(self) -> None:
        """Connects Pi-top button controller events to UI state machine."""
        self._sig_button_up.connect(self._handle_button_up)
        self._sig_button_down.connect(self._handle_button_down)
        self._sig_button_select.connect(self._handle_button_select)
        self._sig_button_cancel.connect(self._handle_button_cancel)
        self._sig_update_frame.connect(self.idle_screen.update_frame)
        self._sig_update_telemetry.connect(self.idle_screen.update_telemetry)
        self._sig_update_door_state.connect(self.idle_screen.update_door_state)
        self._sig_update_wifi_status.connect(self.idle_screen.update_wifi_status)
        self._sig_person_abort_alert.connect(self.alert_banner.show_person_abort_alert)
        self._sig_offline_warning.connect(self.alert_banner.show_offline_warning)

        self.button_controller.register_callback(ButtonType.UP, self._on_button_up)
        self.button_controller.register_callback(ButtonType.DOWN, self._on_button_down)
        self.button_controller.register_callback(ButtonType.SELECT, self._on_button_select)
        self.button_controller.register_callback(ButtonType.CANCEL, self._on_button_cancel)

    def _is_gui_thread(self) -> bool:
        return QThread.currentThread() == self.thread()

    # ==========================================================================
    # Screen Transitions
    # ==========================================================================

    def show_idle_screen(self) -> None:
        """Transitions to Idle home screen."""
        self.stack.setCurrentIndex(0)
        logger.info("Transitioned to Idle screen")

    def show_checkin_draft(self, draft: CheckInDraftResult, image_bytes: bytes) -> None:
        """Transitions to Check-In screen with loaded AI metadata."""
        self.checkin_screen.load_draft(draft, image_bytes)
        self.stack.setCurrentIndex(1)
        logger.info("Transitioned to Check-In screen for '%s'", draft.name_en)

    def show_checkout_candidates(self, candidates: list[CheckOutCandidate]) -> None:
        """Transitions to Check-Out screen with FEFO candidate matches."""
        self.checkout_screen.load_candidates(candidates)
        self.stack.setCurrentIndex(2)
        logger.info("Transitioned to Check-Out screen with %d candidates", len(candidates))

    # ==========================================================================
    # Button Event Handlers
    # ==========================================================================

    def _on_button_select(self) -> None:
        """Handler for 'O' (Select/Confirm)."""
        if not self._is_gui_thread():
            self._sig_button_select.emit()
            return
        self._handle_button_select()

    def _handle_button_select(self) -> None:
        idx = self.stack.currentIndex()
        if idx == 0:
            # Idle screen -> Trigger Check-In capture
            logger.info("User triggered Check-In from Idle screen")
            if self.on_trigger_checkin_capture:
                self.on_trigger_checkin_capture()
        elif idx == 1:
            self.checkin_screen.handle_select()
        elif idx == 2:
            self.checkout_screen.handle_select()

    def _on_button_cancel(self) -> None:
        """Handler for 'X' (Cancel/Back)."""
        if not self._is_gui_thread():
            self._sig_button_cancel.emit()
            return
        self._handle_button_cancel()

    def _handle_button_cancel(self) -> None:
        idx = self.stack.currentIndex()
        if idx == 0:
            # Idle screen -> Trigger Check-Out capture
            logger.info("User triggered Check-Out from Idle screen")
            if self.on_trigger_checkout_capture:
                self.on_trigger_checkout_capture()
        elif idx == 1:
            self.checkin_screen.handle_cancel()
        elif idx == 2:
            self.checkout_screen.handle_cancel()

    def _on_button_up(self) -> None:
        """Handler for '▲' (Up)."""
        if not self._is_gui_thread():
            self._sig_button_up.emit()
            return
        self._handle_button_up()

    def _handle_button_up(self) -> None:
        idx = self.stack.currentIndex()
        if idx == 1:
            self.checkin_screen.handle_up()
        elif idx == 2:
            self.checkout_screen.handle_up()

    def _on_button_down(self) -> None:
        """Handler for '▼' (Down)."""
        if not self._is_gui_thread():
            self._sig_button_down.emit()
            return
        self._handle_button_down()

    def _handle_button_down(self) -> None:
        idx = self.stack.currentIndex()
        if idx == 1:
            self.checkin_screen.handle_down()
        elif idx == 2:
            self.checkout_screen.handle_down()

    # ==========================================================================
    # Commit Handlers
    # ==========================================================================

    def _handle_checkin_confirmed(self, draft: CheckInDraftResult, expiry_date: str) -> None:
        logger.info("Check-in confirmed with expiry: %s", expiry_date)
        if self.on_commit_checkin:
            self.on_commit_checkin(draft, expiry_date)
        self.show_idle_screen()

    def _handle_checkout_confirmed(self, candidate: CheckOutCandidate) -> None:
        logger.info("Check-out confirmed for item: %s", candidate.item_id)
        if self.on_commit_checkout:
            self.on_commit_checkout(candidate)
        self.show_idle_screen()

    # ==========================================================================
    # Dev / PC Keyboard Navigation Fallback
    # ==========================================================================

    def keyPressEvent(self, event: QKeyEvent | None) -> None:
        """Maps standard PC keyboard keys to Pi-top case buttons for dev testing."""
        if event is None:
            return

        key = event.key()
        if key in (Qt.Key.Key_O, Qt.Key.Key_Return, Qt.Key.Key_Space):
            self.button_controller.emit_button_press(ButtonType.SELECT)
        elif key in (Qt.Key.Key_X, Qt.Key.Key_Escape, Qt.Key.Key_Backspace):
            self.button_controller.emit_button_press(ButtonType.CANCEL)
        elif key == Qt.Key.Key_Up:
            self.button_controller.emit_button_press(ButtonType.UP)
        elif key == Qt.Key.Key_Down:
            self.button_controller.emit_button_press(ButtonType.DOWN)
        else:
            super().keyPressEvent(event)

    # ==========================================================================
    # External Update Methods
    # ==========================================================================

    def update_camera_frame(self, frame_bgr: Any) -> None:
        if self._is_gui_thread():
            self.idle_screen.update_frame(frame_bgr)
        else:
            self._sig_update_frame.emit(frame_bgr)

    def update_telemetry(self, temp_c: float | None, voc: int | None, light: int | None) -> None:
        if self._is_gui_thread():
            self.idle_screen.update_telemetry(temp_c, voc, light)
        else:
            self._sig_update_telemetry.emit(temp_c, voc, light)

    def update_door_state(self, is_open: bool, ajar_duration_s: float = 0.0) -> None:
        if self._is_gui_thread():
            self.idle_screen.update_door_state(is_open, ajar_duration_s)
        else:
            self._sig_update_door_state.emit(is_open, ajar_duration_s)

    def update_wifi_status(self, is_online: bool) -> None:
        if self._is_gui_thread():
            self.idle_screen.update_wifi_status(is_online)
        else:
            self._sig_update_wifi_status.emit(is_online)

    def show_person_abort_alert(self) -> None:
        if self._is_gui_thread():
            self.alert_banner.show_person_abort_alert()
        else:
            self._sig_person_abort_alert.emit()

    def show_offline_warning(self) -> None:
        if self._is_gui_thread():
            self.alert_banner.show_offline_warning()
        else:
            self._sig_offline_warning.emit()
