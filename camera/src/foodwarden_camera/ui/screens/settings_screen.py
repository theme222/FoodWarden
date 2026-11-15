"""Mouse-only Settings Screen for FoodWarden 5-inch LCD (800x480).

Allows adjusting GATEWAY_TOKEN, action autocomplete timeout, screen/camera sleep
timeout, and window controls (minimize, unfullscreen/fullscreen, quit) strictly
via mouse/pointer input without physical Pi-top button triggers.
"""

from __future__ import annotations

from collections.abc import Callable

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QApplication,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)


def _make_mouse_button(
    text: str,
    style: str,
    parent: QWidget,
    callback: Callable[[], None] | None = None,
) -> QPushButton:
    """Creates a mouse-clickable button that ignores physical button focus."""
    btn = QPushButton(text, parent)
    btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)
    btn.setCursor(Qt.CursorShape.PointingHandCursor)
    btn.setStyleSheet(style)
    if callback is not None:
        btn.clicked.connect(callback)
    return btn


class SettingsScreen(QWidget):
    """Mouse-controlled system settings and window management screen."""

    def __init__(
        self,
        on_save_settings: Callable[[str, int, int], None] | None = None,
        on_back: Callable[[], None] | None = None,
        on_minimize: Callable[[], None] | None = None,
        on_toggle_fullscreen: Callable[[], None] | None = None,
        on_quit: Callable[[], None] | None = None,
        initial_token: str = "",
        initial_autocomplete_s: int = 5,
        initial_sleep_s: int = 600,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._on_save_settings = on_save_settings
        self._on_back = on_back
        self._on_minimize = on_minimize
        self._on_toggle_fullscreen = on_toggle_fullscreen
        self._on_quit = on_quit

        self._initial_token = initial_token
        self._initial_autocomplete_s = initial_autocomplete_s
        self._initial_sleep_s = sleep_timeout_clamp(initial_sleep_s)

        self._init_ui()
        self.load_values(initial_token, initial_autocomplete_s, initial_sleep_s)

    def _init_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(16, 10, 16, 10)
        main_layout.setSpacing(8)

        # 1. Header Bar
        header = QHBoxLayout()
        title_box = QVBoxLayout()
        title_th = QLabel("ตั้งค่าระบบ (Settings)", self)
        title_th.setStyleSheet("font-size: 18px; font-weight: bold; color: #FFFFFF;")
        title_en = QLabel(
            "Mouse-Only Configuration (Pi-top physical buttons are disabled on this page)",
            self,
        )
        title_en.setStyleSheet("font-size: 11px; color: #9CA3AF;")
        title_box.addWidget(title_th)
        title_box.addWidget(title_en)
        header.addLayout(title_box)
        header.addStretch()

        mouse_badge = QLabel("🖱 Mouse Only", self)
        mouse_badge.setStyleSheet(
            "background-color: #1E3A8A; color: #93C5FD; font-size: 11px; "
            "font-weight: bold; padding: 4px 10px; border-radius: 4px;"
        )
        header.addWidget(mouse_badge)
        main_layout.addLayout(header)

        card_style = "background-color: #1E1E1E; border: 1px solid #2D2D2D; border-radius: 6px;"
        btn_neutral_style = (
            "QPushButton { background-color: #374151; color: #FFFFFF; font-size: 12px; "
            "font-weight: bold; padding: 6px 10px; border-radius: 5px; border: 1px solid #4B5563; } "
            "QPushButton:hover { background-color: #4B5563; }"
        )
        btn_step_style = (
            "QPushButton { background-color: #1F2937; color: #E5E7EB; font-size: 12px; "
            "font-weight: bold; padding: 5px 9px; border-radius: 4px; border: 1px solid #374151; } "
            "QPushButton:hover { background-color: #374151; }"
        )
        spin_style = (
            "QSpinBox { background-color: #111827; color: #FFFFFF; font-size: 14px; "
            "font-weight: bold; padding: 4px 8px; border: 1px solid #3B82F6; border-radius: 4px; }"
        )

        # 2. Authentication Token Card
        token_card = QFrame(self)
        token_card.setStyleSheet(card_style)
        token_layout = QVBoxLayout(token_card)
        token_layout.setContentsMargins(12, 8, 12, 8)
        token_layout.setSpacing(6)

        token_lbl = QLabel(
            "โทเคนยืนยันตัวตน / Authentication Token (GATEWAY_TOKEN):",
            token_card,
        )
        token_lbl.setStyleSheet("font-size: 13px; font-weight: bold; color: #E5E7EB; border: none;")
        token_layout.addWidget(token_lbl)

        token_row = QHBoxLayout()
        token_row.setSpacing(6)
        self.token_input = QLineEdit(token_card)
        self.token_input.setFocusPolicy(Qt.FocusPolicy.ClickFocus)
        self.token_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.token_input.setPlaceholderText("กรอกหรือวาง GATEWAY_TOKEN / Enter Gateway Token")
        self.token_input.setStyleSheet(
            "QLineEdit { background-color: #111827; color: #FFFFFF; font-size: 13px; "
            "padding: 6px 8px; border: 1px solid #4B5563; border-radius: 4px; }"
        )
        token_row.addWidget(self.token_input, stretch=1)

        self.btn_toggle_echo = _make_mouse_button(
            "แสดง/ซ่อน (Show/Hide)",
            btn_neutral_style,
            token_card,
            self._toggle_token_visibility,
        )
        self.btn_paste_token = _make_mouse_button(
            "วาง (Paste)",
            btn_neutral_style,
            token_card,
            self._paste_token_from_clipboard,
        )
        self.btn_clear_token = _make_mouse_button(
            "ล้าง (Clear)",
            btn_neutral_style,
            token_card,
            self.token_input.clear,
        )
        token_row.addWidget(self.btn_toggle_echo)
        token_row.addWidget(self.btn_paste_token)
        token_row.addWidget(self.btn_clear_token)
        token_layout.addLayout(token_row)
        main_layout.addWidget(token_card)

        # 3. Timeouts Card (Autocomplete & Sleep)
        timeout_card = QFrame(self)
        timeout_card.setStyleSheet(card_style)
        timeout_layout = QVBoxLayout(timeout_card)
        timeout_layout.setContentsMargins(12, 8, 12, 8)
        timeout_layout.setSpacing(8)

        # 3a. Autocomplete delay
        auto_row = QHBoxLayout()
        auto_row.setSpacing(6)
        auto_label_box = QVBoxLayout()
        auto_th = QLabel("เวลายืนยันคำสั่งอัตโนมัติ (Autocomplete Delay)", timeout_card)
        auto_th.setStyleSheet("font-size: 13px; font-weight: bold; color: #E5E7EB; border: none;")
        auto_en = QLabel("Seconds before Check-In / Check-Out auto-confirms", timeout_card)
        auto_en.setStyleSheet("font-size: 11px; color: #9CA3AF; border: none;")
        auto_label_box.addWidget(auto_th)
        auto_label_box.addWidget(auto_en)
        auto_row.addLayout(auto_label_box)
        auto_row.addStretch()

        self.autocomplete_spin = QSpinBox(timeout_card)
        self.autocomplete_spin.setFocusPolicy(Qt.FocusPolicy.ClickFocus)
        self.autocomplete_spin.setRange(1, 120)
        self.autocomplete_spin.setSuffix(" s")
        self.autocomplete_spin.setFixedWidth(84)
        self.autocomplete_spin.setStyleSheet(spin_style)

        auto_row.addWidget(
            _make_mouse_button(
                "-5s", btn_step_style, timeout_card, lambda: self._adjust_autocomplete(-5)
            )
        )
        auto_row.addWidget(
            _make_mouse_button(
                "-1s", btn_step_style, timeout_card, lambda: self._adjust_autocomplete(-1)
            )
        )
        auto_row.addWidget(self.autocomplete_spin)
        auto_row.addWidget(
            _make_mouse_button(
                "+1s", btn_step_style, timeout_card, lambda: self._adjust_autocomplete(1)
            )
        )
        auto_row.addWidget(
            _make_mouse_button(
                "+5s", btn_step_style, timeout_card, lambda: self._adjust_autocomplete(5)
            )
        )
        timeout_layout.addLayout(auto_row)

        # 3b. Sleep delay (screen + camera off)
        sleep_row = QHBoxLayout()
        sleep_row.setSpacing(6)
        sleep_label_box = QVBoxLayout()
        sleep_th = QLabel("เวลาพักหน้าจอและปิดกล้อง (Sleep Timeout)", timeout_card)
        sleep_th.setStyleSheet("font-size: 13px; font-weight: bold; color: #E5E7EB; border: none;")
        sleep_en = QLabel("Seconds with no motion before turning screen & camera off", timeout_card)
        sleep_en.setStyleSheet("font-size: 11px; color: #9CA3AF; border: none;")
        sleep_label_box.addWidget(sleep_th)
        sleep_label_box.addWidget(sleep_en)
        sleep_row.addLayout(sleep_label_box)
        sleep_row.addStretch()

        self.sleep_spin = QSpinBox(timeout_card)
        self.sleep_spin.setFocusPolicy(Qt.FocusPolicy.ClickFocus)
        self.sleep_spin.setRange(5, 7200)
        self.sleep_spin.setSuffix(" s")
        self.sleep_spin.setFixedWidth(84)
        self.sleep_spin.setStyleSheet(spin_style)

        sleep_row.addWidget(
            _make_mouse_button(
                "-60s", btn_step_style, timeout_card, lambda: self._adjust_sleep(-60)
            )
        )
        sleep_row.addWidget(
            _make_mouse_button(
                "-10s", btn_step_style, timeout_card, lambda: self._adjust_sleep(-10)
            )
        )
        sleep_row.addWidget(self.sleep_spin)
        sleep_row.addWidget(
            _make_mouse_button("+10s", btn_step_style, timeout_card, lambda: self._adjust_sleep(10))
        )
        sleep_row.addWidget(
            _make_mouse_button("+60s", btn_step_style, timeout_card, lambda: self._adjust_sleep(60))
        )
        timeout_layout.addLayout(sleep_row)

        main_layout.addWidget(timeout_card)

        # 4. Window & App Controls Card
        win_card = QFrame(self)
        win_card.setStyleSheet(card_style)
        win_layout = QVBoxLayout(win_card)
        win_layout.setContentsMargins(12, 8, 12, 8)
        win_layout.setSpacing(6)

        win_lbl = QLabel("จัดการหน้าต่างและแอปพลิเคชัน / Window & Application Controls:", win_card)
        win_lbl.setStyleSheet("font-size: 13px; font-weight: bold; color: #E5E7EB; border: none;")
        win_layout.addWidget(win_lbl)

        win_row = QHBoxLayout()
        win_row.setSpacing(8)
        self.btn_minimize = _make_mouse_button(
            "🗕 ย่อหน้าต่าง (Minimize)",
            btn_neutral_style,
            win_card,
            self._on_minimize,
        )
        self.btn_fullscreen = _make_mouse_button(
            "❐ ย่อ/ขยายเต็มจอ (Unfullscreen / Fullscreen)",
            btn_neutral_style,
            win_card,
            self._on_toggle_fullscreen,
        )
        self.btn_quit = _make_mouse_button(
            "✕ ปิดแอปพลิเคชัน (Quit Application)",
            "QPushButton { background-color: #991B1B; color: #FFFFFF; font-size: 12px; "
            "font-weight: bold; padding: 6px 12px; border-radius: 5px; border: 1px solid #DC2626; } "
            "QPushButton:hover { background-color: #DC2626; }",
            win_card,
            self._on_quit,
        )
        win_row.addWidget(self.btn_minimize)
        win_row.addWidget(self.btn_fullscreen)
        win_row.addStretch()
        win_row.addWidget(self.btn_quit)
        win_layout.addLayout(win_row)
        main_layout.addWidget(win_card)

        # 5. Footer Navigation & Save Row
        footer = QHBoxLayout()
        footer.setSpacing(12)
        self.btn_back = _make_mouse_button(
            "← ย้อนกลับ (Back)",
            btn_neutral_style,
            self,
            self._handle_back,
        )
        self.btn_save = _make_mouse_button(
            "💾 บันทึกการตั้งค่า (Save Settings)",
            "QPushButton { background-color: #059669; color: #FFFFFF; font-size: 13px; "
            "font-weight: bold; padding: 8px 18px; border-radius: 6px; border: 1px solid #10B981; } "
            "QPushButton:hover { background-color: #10B981; }",
            self,
            self._handle_save,
        )
        footer.addWidget(self.btn_back)
        footer.addStretch()
        footer.addWidget(self.btn_save)
        main_layout.addLayout(footer)

    def load_values(self, token: str, autocomplete_s: int, sleep_s: int) -> None:
        """Populates controls with current runtime settings."""
        self.token_input.setText(token)
        self.autocomplete_spin.setValue(max(1, min(120, autocomplete_s)))
        self.sleep_spin.setValue(sleep_timeout_clamp(sleep_s))

    def _toggle_token_visibility(self) -> None:
        if self.token_input.echoMode() == QLineEdit.EchoMode.Password:
            self.token_input.setEchoMode(QLineEdit.EchoMode.Normal)
        else:
            self.token_input.setEchoMode(QLineEdit.EchoMode.Password)

    def _paste_token_from_clipboard(self) -> None:
        clipboard = QApplication.clipboard()
        if clipboard is not None:
            text = clipboard.text().strip()
            if text:
                self.token_input.setText(text)

    def _adjust_autocomplete(self, delta: int) -> None:
        self.autocomplete_spin.setValue(self.autocomplete_spin.value() + delta)

    def _adjust_sleep(self, delta: int) -> None:
        self.sleep_spin.setValue(self.sleep_spin.value() + delta)

    def _handle_back(self) -> None:
        if self._on_back is not None:
            self._on_back()

    def _handle_save(self) -> None:
        token = self.token_input.text().strip()
        autocomplete_s = int(self.autocomplete_spin.value())
        sleep_s = int(self.sleep_spin.value())
        if self._on_save_settings is not None:
            self._on_save_settings(token, autocomplete_s, sleep_s)
        if self._on_back is not None:
            self._on_back()


def sleep_timeout_clamp(value: int) -> int:
    """Clamps sleep timeout into the spinbox range [5, 7200]."""
    return max(5, min(7200, value))
