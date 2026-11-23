"""Main Window coordinating screens and hardware navigation for 5-inch LCD (800x480).

Renders the primary PyQt6 interface, managing state transitions between Idle,
Check-In, and Check-Out workflows with keyboard navigation emulation per ARCHITECTURE.md.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any, cast

from PyQt6.QtCore import Qt, QThread, pyqtSignal
from PyQt6.QtGui import QColor, QKeyEvent, QMouseEvent, QPainter, QPaintEvent, QResizeEvent
from PyQt6.QtWidgets import (
    QApplication,
    QFrame,
    QLabel,
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
from foodwarden_camera.ui.screens.confirm_screen import ConfirmScreen
from foodwarden_camera.ui.screens.idle_screen import IdleScreen
from foodwarden_camera.ui.screens.result_screen import ResultKind, ResultScreen, ResultStatus
from foodwarden_camera.ui.screens.settings_screen import SettingsScreen
from foodwarden_camera.ui.styles import (
    DARK_STYLESHEET,
    MAIN_WINDOW_HEIGHT,
    MAIN_WINDOW_WIDTH,
)
from foodwarden_camera.ui.widgets import days_left_badge

logger = logging.getLogger(__name__)

# QStackedWidget page indices
IDX_IDLE = 0
IDX_CHECKIN = 1
IDX_CHECKOUT = 2
IDX_SETTINGS = 3
IDX_CONFIRM = 4
IDX_RESULT = 5


def _format_thai_date(iso_date: str) -> str:
    """'2026-11-25' -> '25/11/2026' (falls back to the raw string)."""
    try:
        return datetime.strptime(iso_date, "%Y-%m-%d").strftime("%d/%m/%Y")
    except ValueError:
        return iso_date


class _SleepOverlay(QFrame):
    """Pure-black sleep cover keeping the HDMI/DP video link alive (avoids No-Signal blue screen)."""

    def __init__(
        self,
        parent: QWidget,
        on_wake_requested: Callable[[], None] | None = None,
    ) -> None:
        super().__init__(parent)
        self._on_wake_requested = on_wake_requested
        self.setObjectName("SleepOverlay")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setAutoFillBackground(True)
        self.setStyleSheet("#SleepOverlay { background-color: #000000; border: none; }")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.addStretch()

        hint = QLabel(
            "พักหน้าจอ — โบกมือหรือแตะเพื่อปลุก\nDisplay Sleeping — Wave or tap to wake",
            self,
        )
        hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hint.setStyleSheet("color: #1F2937; font-size: 14px; background-color: #000000;")
        layout.addWidget(hint)
        self.hide()

    def paintEvent(self, event: QPaintEvent | None) -> None:
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor("#000000"))
        super().paintEvent(event)

    def mousePressEvent(self, event: QMouseEvent | None) -> None:
        if self._on_wake_requested is not None:
            self._on_wake_requested()
        if event is not None:
            event.accept()


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
    _sig_update_node_status = pyqtSignal(str, object, bool, bool)
    _sig_update_motion_state = pyqtSignal(bool, float, str)
    _sig_update_person_state = pyqtSignal(bool, float, int)
    _sig_person_abort_alert = pyqtSignal()
    _sig_door_closing_alert = pyqtSignal()
    _sig_offline_warning = pyqtSignal()
    _sig_show_alert = pyqtSignal(str, str, bool, int)
    _sig_show_idle_screen = pyqtSignal()
    _sig_show_checkin_loading = pyqtSignal(bytes)
    _sig_show_checkin_draft = pyqtSignal(object, bytes)
    _sig_show_checkout_loading = pyqtSignal(bytes)
    _sig_show_checkout_candidates = pyqtSignal(object, bytes)
    _sig_set_display_sleep = pyqtSignal(bool)
    _sig_show_commit_result = pyqtSignal(str, str, str, str)

    def __init__(
        self,
        button_controller: ButtonController,
        on_trigger_checkin_capture: Callable[[], None] | None = None,
        on_trigger_checkout_capture: Callable[[], None] | None = None,
        on_commit_checkin: Callable[[CheckInDraftResult, str], None] | None = None,
        on_commit_checkout: Callable[[CheckOutCandidate], None] | None = None,
        on_cancel_capture: Callable[[], None] | None = None,
        on_save_settings: Callable[[str, int, int], None] | None = None,
        on_save_pir_pin: Callable[[int], None] | None = None,
        on_save_door_close_timeout: Callable[[int], None] | None = None,
        on_wake_requested: Callable[[], None] | None = None,
        initial_token: str = "",
        autocomplete_timeout_s: int = 5,
        sleep_timeout_s: int = 600,
        initial_pir_gpio_pin: int = 22,
        initial_door_close_timeout_s: int = 60,
    ) -> None:
        super().__init__()
        self.button_controller = button_controller
        self.on_trigger_checkin_capture = on_trigger_checkin_capture
        self.on_trigger_checkout_capture = on_trigger_checkout_capture
        self.on_commit_checkin = on_commit_checkin
        self.on_commit_checkout = on_commit_checkout
        self.on_cancel_capture = on_cancel_capture
        self.on_save_settings = on_save_settings
        self.on_save_pir_pin = on_save_pir_pin
        self.on_save_door_close_timeout = on_save_door_close_timeout
        self.on_wake_requested = on_wake_requested

        self._current_token = initial_token
        self._current_autocomplete_s = autocomplete_timeout_s
        self._current_sleep_s = sleep_timeout_s
        self._current_pir_gpio_pin = initial_pir_gpio_pin
        self._current_door_close_s = initial_door_close_timeout_s
        self._is_display_sleeping = False

        self.setWindowTitle("FoodWarden Gateway (Node 'C')")
        self.resize(MAIN_WINDOW_WIDTH, MAIN_WINDOW_HEIGHT)
        self.setMinimumSize(640, 400)
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
        self.idle_screen = IdleScreen(
            parent=self.stack,
            on_open_settings=self.show_settings_screen,
        )
        self.stack.addWidget(self.idle_screen)

        # Screen 1: Check-In Screen
        self.checkin_screen = CheckInScreen(
            on_confirm_callback=self._handle_checkin_confirmed,
            on_cancel_callback=self._handle_workflow_cancelled,
            autocomplete_timeout_s=self._current_autocomplete_s,
            parent=self.stack,
            on_review_callback=self._handle_checkin_review,
        )
        self.stack.addWidget(self.checkin_screen)

        # Screen 2: Check-Out Screen
        self.checkout_screen = CheckOutScreen(
            on_confirm_callback=self._handle_checkout_confirmed,
            on_cancel_callback=self._handle_workflow_cancelled,
            autocomplete_timeout_s=self._current_autocomplete_s,
            parent=self.stack,
            on_review_callback=self._handle_checkout_review,
        )
        self.stack.addWidget(self.checkout_screen)

        # Screen 3: Mouse-Only Settings Screen
        self.settings_screen = SettingsScreen(
            on_save_settings=self._handle_settings_saved,
            on_back=self.show_idle_screen,
            on_minimize=self.minimize_window,
            on_toggle_fullscreen=self.toggle_fullscreen,
            on_quit=self.quit_application,
            on_save_pir_pin=self._handle_pir_pin_saved,
            on_save_door_close_timeout=self._handle_door_close_timeout_saved,
            initial_token=self._current_token,
            initial_autocomplete_s=self._current_autocomplete_s,
            initial_sleep_s=self._current_sleep_s,
            initial_pir_gpio_pin=self._current_pir_gpio_pin,
            initial_door_close_s=self._current_door_close_s,
            parent=self.stack,
        )
        self.stack.addWidget(self.settings_screen)

        # Screen 4: "Are you sure?" step after a manual Check-In / Check-Out edit
        self.confirm_screen = ConfirmScreen(
            on_confirm=self._handle_confirm_accepted,
            on_back=self._handle_confirm_back,
            parent=self.stack,
        )
        self.stack.addWidget(self.confirm_screen)
        self._pending_checkin: tuple[CheckInDraftResult, str] | None = None
        self._pending_checkout: CheckOutCandidate | None = None

        # Screen 5: "Saved ✓" outcome card
        self.result_screen = ResultScreen(on_done=self.show_idle_screen, parent=self.stack)
        self.stack.addWidget(self.result_screen)

        root_layout.addWidget(self.stack)

        self._sleep_overlay = _SleepOverlay(self, on_wake_requested=self.on_wake_requested)

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
        self._sig_update_node_status.connect(self.idle_screen.update_node_status)
        self._sig_update_motion_state.connect(self.idle_screen.update_motion_state)
        self._sig_update_person_state.connect(self.idle_screen.update_person_state)
        self._sig_person_abort_alert.connect(self.alert_banner.show_person_abort_alert)
        self._sig_door_closing_alert.connect(self.alert_banner.show_door_closing_alert)
        self._sig_offline_warning.connect(self.alert_banner.show_offline_warning)
        self._sig_show_alert.connect(self._apply_show_alert)
        self._sig_show_idle_screen.connect(self._apply_show_idle_screen)
        self._sig_show_checkin_loading.connect(self._apply_show_checkin_loading)
        self._sig_show_checkin_draft.connect(self._apply_show_checkin_draft)
        self._sig_show_checkout_loading.connect(self._apply_show_checkout_loading)
        self._sig_show_checkout_candidates.connect(self._apply_show_checkout_candidates)
        self._sig_set_display_sleep.connect(self._apply_display_sleep)
        self._sig_show_commit_result.connect(self._apply_show_commit_result)

        self.button_controller.register_callback(ButtonType.UP, self._on_button_up)
        self.button_controller.register_callback(ButtonType.DOWN, self._on_button_down)
        self.button_controller.register_callback(ButtonType.SELECT, self._on_button_select)
        self.button_controller.register_callback(ButtonType.CANCEL, self._on_button_cancel)

    def _is_gui_thread(self) -> bool:
        return QThread.currentThread() == self.thread()

    # ==========================================================================
    # Screen Transitions
    # ==========================================================================

    def _apply_show_idle_screen(self) -> None:
        self.stack.setCurrentIndex(0)
        logger.info("Transitioned to Idle screen")

    def show_idle_screen(self) -> None:
        """Transitions to Idle home screen (safe across threads)."""
        if self._is_gui_thread():
            self._apply_show_idle_screen()
        else:
            self._sig_show_idle_screen.emit()

    def _apply_show_checkin_loading(self, image_bytes: bytes) -> None:
        self.checkin_screen.load_loading(image_bytes)
        self.stack.setCurrentIndex(1)
        logger.info("Transitioned to Check-In loading screen")

    def show_checkin_loading(self, image_bytes: bytes = b"") -> None:
        """Immediately shows captured photo in Check-In loading state (thread-safe)."""
        if self._is_gui_thread():
            self._apply_show_checkin_loading(image_bytes)
        else:
            self._sig_show_checkin_loading.emit(image_bytes)

    def _apply_show_checkin_draft(self, draft: CheckInDraftResult, image_bytes: bytes) -> None:
        self.checkin_screen.load_draft(draft, image_bytes)
        self.stack.setCurrentIndex(1)
        logger.info("Transitioned to Check-In screen for '%s'", draft.name_en)

    def show_checkin_draft(self, draft: CheckInDraftResult, image_bytes: bytes) -> None:
        """Transitions to Check-In screen with loaded AI metadata (thread-safe)."""
        if self._is_gui_thread():
            self._apply_show_checkin_draft(draft, image_bytes)
        else:
            self._sig_show_checkin_draft.emit(draft, image_bytes)

    def _apply_show_checkout_loading(self, image_bytes: bytes) -> None:
        self.checkout_screen.load_loading(image_bytes)
        self.stack.setCurrentIndex(2)
        logger.info("Transitioned to Check-Out loading screen")

    def show_checkout_loading(self, image_bytes: bytes = b"") -> None:
        """Immediately shows captured photo in Check-Out loading state (thread-safe)."""
        if self._is_gui_thread():
            self._apply_show_checkout_loading(image_bytes)
        else:
            self._sig_show_checkout_loading.emit(image_bytes)

    def _apply_show_checkout_candidates(
        self, candidates: list[CheckOutCandidate], image_bytes: bytes = b""
    ) -> None:
        self.checkout_screen.load_candidates(candidates, image_bytes)
        self.stack.setCurrentIndex(2)
        logger.info("Transitioned to Check-Out screen with %d candidates", len(candidates))

    def show_checkout_candidates(
        self, candidates: list[CheckOutCandidate], image_bytes: bytes = b""
    ) -> None:
        """Transitions to Check-Out screen with FEFO candidate matches (thread-safe)."""
        if self._is_gui_thread():
            self._apply_show_checkout_candidates(candidates, image_bytes)
        else:
            self._sig_show_checkout_candidates.emit(candidates, image_bytes)

    def _handle_workflow_cancelled(self) -> None:
        if self.on_cancel_capture is not None:
            self.on_cancel_capture()
        self.show_idle_screen()

    def show_settings_screen(self) -> None:
        """Transitions to mouse-only Settings screen."""
        self.settings_screen.load_values(
            self._current_token,
            self._current_autocomplete_s,
            self._current_sleep_s,
            self._current_pir_gpio_pin,
            self._current_door_close_s,
        )
        self.stack.setCurrentIndex(3)
        logger.info("Transitioned to Settings screen (mouse-only)")

    def resizeEvent(self, event: QResizeEvent | None) -> None:
        super().resizeEvent(event)
        self._sleep_overlay.setGeometry(self.rect())

    @property
    def is_display_sleeping(self) -> bool:
        """Returns whether the software pure-black sleep cover is currently active."""
        return self._is_display_sleeping

    def _apply_display_sleep(self, sleeping: bool) -> None:
        self._is_display_sleeping = sleeping
        if sleeping:
            self.stack.hide()
            self._sleep_overlay.setGeometry(self.rect())
            self._sleep_overlay.show()
            self._sleep_overlay.raise_()
        else:
            self._sleep_overlay.hide()
            self.stack.show()

    # ==========================================================================
    # Window & Runtime Controls
    # ==========================================================================

    def set_autocomplete_timeout(self, seconds: int) -> None:
        """Updates Check-In and Check-Out auto-confirm timeout in seconds."""
        self._current_autocomplete_s = max(1, seconds)
        self.checkin_screen.set_autocomplete_timeout(self._current_autocomplete_s)
        self.checkout_screen.set_autocomplete_timeout(self._current_autocomplete_s)

    def minimize_window(self) -> None:
        """Minimizes the gateway window."""
        self.showMinimized()
        logger.info("Window minimized")

    def unfullscreen_window(self) -> None:
        """Restores normal windowed mode at default LCD dimensions."""
        self.showNormal()
        self.resize(MAIN_WINDOW_WIDTH, MAIN_WINDOW_HEIGHT)
        logger.info("Window restored from fullscreen")

    def toggle_fullscreen(self) -> None:
        """Toggles between fullscreen and windowed mode."""
        if self.isFullScreen():
            self.unfullscreen_window()
        else:
            self.showFullScreen()
            logger.info("Window switched to fullscreen")

    def quit_application(self) -> None:
        """Closes window and exits the Qt application loop."""
        logger.info("Quit requested from UI")
        self.close()
        app = QApplication.instance()
        if app is not None:
            app.quit()

    # ==========================================================================
    # Button Event Handlers
    # ==========================================================================

    def _wake_if_sleeping(self) -> bool:
        """Clears sleep overlay and wakes PIR timer, consuming only the wake button press."""
        if not self._is_display_sleeping:
            return False
        self._apply_display_sleep(False)
        if self.on_wake_requested is not None:
            self.on_wake_requested()
        return True

    def _on_button_select(self) -> None:
        """Handler for 'O' (Select/Confirm)."""
        if not self._is_gui_thread():
            self._sig_button_select.emit()
            return
        self._handle_button_select()

    def _handle_button_select(self) -> None:
        if self._wake_if_sleeping():
            return
        idx = self.stack.currentIndex()
        if idx == IDX_SETTINGS:
            return
        if idx == IDX_RESULT:
            self.result_screen.handle_any_button()
            return
        if idx == IDX_CONFIRM:
            self.confirm_screen.handle_select()
            return
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
        if self._wake_if_sleeping():
            return
        idx = self.stack.currentIndex()
        if idx == IDX_SETTINGS:
            return
        if idx == IDX_RESULT:
            self.result_screen.handle_any_button()
            return
        if idx == IDX_CONFIRM:
            self.confirm_screen.handle_cancel()
            return
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
        if self._wake_if_sleeping():
            return
        idx = self.stack.currentIndex()
        if idx == IDX_RESULT:
            self.result_screen.handle_any_button()
            return
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
        if self._wake_if_sleeping():
            return
        idx = self.stack.currentIndex()
        if idx == IDX_RESULT:
            self.result_screen.handle_any_button()
            return
        if idx == 1:
            self.checkin_screen.handle_down()
        elif idx == 2:
            self.checkout_screen.handle_down()

    # ==========================================================================
    # Commit & Settings Handlers
    # ==========================================================================

    def _handle_settings_saved(self, gateway_token: str, autocomplete_s: int, sleep_s: int) -> None:
        self._current_token = gateway_token
        self._current_autocomplete_s = max(1, autocomplete_s)
        self._current_sleep_s = sleep_s
        self.set_autocomplete_timeout(self._current_autocomplete_s)
        if self.on_save_settings:
            self.on_save_settings(gateway_token, self._current_autocomplete_s, sleep_s)
        logger.info(
            "Settings updated (autocomplete=%ds, sleep=%ds)",
            self._current_autocomplete_s,
            sleep_s,
        )

    def _handle_pir_pin_saved(self, pir_gpio_pin: int) -> None:
        self._current_pir_gpio_pin = pir_gpio_pin
        if self.on_save_pir_pin:
            self.on_save_pir_pin(pir_gpio_pin)

    def _handle_door_close_timeout_saved(self, door_close_s: int) -> None:
        self._current_door_close_s = max(3, door_close_s)
        if self.on_save_door_close_timeout:
            self.on_save_door_close_timeout(self._current_door_close_s)

    # --- Confirm step (only after a manual edit / explicit O press) -------------

    def _handle_checkin_review(self, draft: CheckInDraftResult, expiry_date: str) -> None:
        self._pending_checkin = (draft, expiry_date)
        self._pending_checkout = None
        try:
            badge = days_left_badge(datetime.strptime(expiry_date, "%Y-%m-%d").date())
        except ValueError:
            badge = None
        self.confirm_screen.show_confirm(
            "checkin",
            draft.name_th,
            f"หมดอายุ {_format_thai_date(expiry_date)}",
            badge,
            self.checkin_screen.current_pixmap,
        )
        self.stack.setCurrentIndex(IDX_CONFIRM)
        logger.info("Check-in review requested (expiry %s)", expiry_date)

    def _handle_checkout_review(self, candidate: CheckOutCandidate) -> None:
        self._pending_checkout = candidate
        self._pending_checkin = None
        try:
            badge = days_left_badge(datetime.strptime(candidate.expiry_date, "%Y-%m-%d").date())
        except ValueError:
            badge = None
        self.confirm_screen.show_confirm(
            "checkout",
            candidate.name_th,
            f"หมดอายุ {_format_thai_date(candidate.expiry_date)}",
            badge,
            self.checkout_screen.current_pixmap,
        )
        self.stack.setCurrentIndex(IDX_CONFIRM)
        logger.info("Check-out review requested for item: %s", candidate.item_id)

    def _handle_confirm_accepted(self) -> None:
        if self.confirm_screen.kind == "checkin" and self._pending_checkin is not None:
            draft, expiry = self._pending_checkin
            self._pending_checkin = None
            self._handle_checkin_confirmed(draft, expiry)
        elif self.confirm_screen.kind == "checkout" and self._pending_checkout is not None:
            candidate = self._pending_checkout
            self._pending_checkout = None
            self._handle_checkout_confirmed(candidate)
        else:
            self.show_idle_screen()

    def _handle_confirm_back(self) -> None:
        """X on the confirm step: return to editing (countdown stays off)."""
        if self.confirm_screen.kind == "checkin":
            self.checkin_screen.resume_editing()
            self.stack.setCurrentIndex(IDX_CHECKIN)
        else:
            self.stack.setCurrentIndex(IDX_CHECKOUT)

    # --- Commit + outcome card ------------------------------------------------

    def _handle_checkin_confirmed(self, draft: CheckInDraftResult, expiry_date: str) -> None:
        logger.info("Check-in confirmed with expiry: %s", expiry_date)
        # Show "saving" first: the commit callback may report its result synchronously.
        self.result_screen.show_saving("checkin", draft.name_th)
        self.stack.setCurrentIndex(IDX_RESULT)
        if self.on_commit_checkin:
            self.on_commit_checkin(draft, expiry_date)

    def _handle_checkout_confirmed(self, candidate: CheckOutCandidate) -> None:
        logger.info("Check-out confirmed for item: %s", candidate.item_id)
        self.result_screen.show_saving("checkout", candidate.name_th)
        self.stack.setCurrentIndex(IDX_RESULT)
        if self.on_commit_checkout:
            self.on_commit_checkout(candidate)

    def show_commit_result(
        self, kind: ResultKind, status: ResultStatus, item_name: str, message: str = ""
    ) -> None:
        """Reports a commit outcome from any thread (orchestrator worker threads)."""
        if self._is_gui_thread():
            self._apply_show_commit_result(kind, status, item_name, message)
        else:
            self._sig_show_commit_result.emit(kind, status, item_name, message)

    def _apply_show_commit_result(
        self, kind: str, status: str, item_name: str, message: str
    ) -> None:
        on_result_card = (
            self.stack.currentIndex() == IDX_RESULT
            and self.result_screen.status == "saving"
            and self.result_screen.kind == kind
        )
        if on_result_card:
            self.result_screen.show_outcome(cast(ResultStatus, status), message)
            return
        # User already left the card: fall back to the top banner.
        verb_th = "นำเข้า" if kind == "checkin" else "นำออก"
        verb_en = "Checked in" if kind == "checkin" else "Checked out"
        if status == "success":
            self.alert_banner.show_success(f"{verb_th}แล้ว: {item_name}", f"{verb_en}: {item_name}")
        elif status == "queued":
            self.alert_banner.show_alert(
                f"บันทึก{verb_th}ไว้ในเครื่อง: {item_name}",
                "Saved offline — will sync when online",
                is_critical=False,
            )
        elif status == "failed":
            self.alert_banner.show_alert(
                f"{verb_th}ไม่สำเร็จ: {item_name}",
                message or f"{verb_en} failed — please retry",
                is_critical=True,
            )

    # ==========================================================================
    # Dev / PC Keyboard Navigation Fallback
    # ==========================================================================

    def keyPressEvent(self, event: QKeyEvent | None) -> None:
        """Maps standard PC keyboard keys to Pi-top case buttons for dev testing."""
        if event is None:
            return

        key = event.key()
        if key == Qt.Key.Key_F11:
            self.toggle_fullscreen()
            return

        if self.stack.currentIndex() == 3:
            super().keyPressEvent(event)
            return

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

    def update_node_status(
        self,
        node_id: str,
        age_s: float | None,
        is_connected: bool = False,
        is_offline: bool = False,
    ) -> None:
        """Updates F0/D0 Gray->Green->Yellow->Red freshness indicator safely across threads."""
        if self._is_gui_thread():
            self.idle_screen.update_node_status(
                node_id,
                age_s,
                is_connected=is_connected,
                is_offline=is_offline,
            )
        else:
            self._sig_update_node_status.emit(node_id, age_s, is_connected, is_offline)

    def update_motion_state(
        self,
        has_motion: bool,
        idle_duration_s: float = 0.0,
        hw_status: str = "",
    ) -> None:
        if self._is_gui_thread():
            self.idle_screen.update_motion_state(has_motion, idle_duration_s, hw_status)
        else:
            self._sig_update_motion_state.emit(has_motion, idle_duration_s, hw_status)

    def update_person_state(
        self,
        is_person: bool,
        confidence: float = 0.0,
        person_count: int = 0,
    ) -> None:
        """Updates YOLO person detection badge & diagnostics label safely across threads."""
        if self._is_gui_thread():
            self.idle_screen.update_person_state(is_person, confidence, person_count)
        else:
            self._sig_update_person_state.emit(is_person, confidence, person_count)

    def set_display_sleep(self, sleeping: bool) -> None:
        """Activates or clears the software sleep cover safely across threads."""
        if self._is_gui_thread():
            self._apply_display_sleep(sleeping)
        else:
            self._sig_set_display_sleep.emit(sleeping)

    def show_person_abort_alert(self) -> None:
        if self._is_gui_thread():
            self.alert_banner.show_person_abort_alert()
        else:
            self._sig_person_abort_alert.emit()

    def show_door_closing_alert(self) -> None:
        if self._is_gui_thread():
            self.alert_banner.show_door_closing_alert()
        else:
            self._sig_door_closing_alert.emit()

    def _apply_show_alert(
        self,
        message_th: str,
        message_en: str,
        is_critical: bool,
        duration_ms: int,
    ) -> None:
        self.alert_banner.show_alert(
            message_th,
            message_en,
            is_critical=is_critical,
            duration_ms=duration_ms,
        )

    def show_alert(
        self,
        message_th: str,
        message_en: str,
        *,
        is_critical: bool = True,
        duration_ms: int = 5000,
    ) -> None:
        """Displays a bilingual alert banner safely across threads."""
        if self._is_gui_thread():
            self._apply_show_alert(message_th, message_en, is_critical, duration_ms)
        else:
            self._sig_show_alert.emit(message_th, message_en, is_critical, duration_ms)

    def show_offline_warning(self) -> None:
        if self._is_gui_thread():
            self.alert_banner.show_offline_warning()
        else:
            self._sig_offline_warning.emit()
