"""Mouse-Only Settings & Window Control Screen aligned with Web Prototype theme."""

from __future__ import annotations

from collections.abc import Callable

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QApplication,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from foodwarden_camera.ui.styles import (
    COLOR_BAD,
    COLOR_DARK,
    COLOR_FRESH,
    COLOR_INK,
    COLOR_LIME_INK,
    COLOR_LIME_SOFT,
    COLOR_MUTED,
    COLOR_ON_BAD,
    COLOR_ON_DARK,
    COLOR_ON_FRESH,
    COLOR_RULE,
    COLOR_SURFACE,
    COLOR_SURFACE_2,
    card_style,
    pill_style,
)


def _make_mouse_button(
    text: str,
    bg_color: str,
    hover_color: str,
    fg_color: str,
    parent: QWidget,
    callback: Callable[[], None] | None,
    *,
    min_width: int = 44,
    min_height: int = 38,
    font_px: int = 15,
    border_color: str = COLOR_RULE,
) -> QPushButton:
    """Builds a touch-sized button disabled from hardware key focus."""
    btn = QPushButton(text, parent)
    btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)
    btn.setMinimumSize(min_width, min_height)
    btn.setStyleSheet(
        f"""
        QPushButton {{
            background-color: {bg_color};
            color: {fg_color};
            border: 1.5px solid {border_color};
            border-radius: 10px;
            font-size: {font_px}px;
            font-weight: bold;
            padding: 4px 12px;
        }}
        QPushButton:hover {{ background-color: {hover_color}; }}
        """
    )
    if callback is not None:
        btn.clicked.connect(callback)
    return btn


class SettingsScreen(QWidget):
    """Touch/mouse-controlled settings and window management screen."""

    def __init__(
        self,
        on_save_settings: Callable[[str, int, int], None] | None = None,
        on_back: Callable[[], None] | None = None,
        on_minimize: Callable[[], None] | None = None,
        on_toggle_fullscreen: Callable[[], None] | None = None,
        on_quit: Callable[[], None] | None = None,
        on_save_pir_pin: Callable[[int], None] | None = None,
        on_save_door_close_timeout: Callable[[int], None] | None = None,
        initial_token: str = "",
        initial_autocomplete_s: int = 5,
        initial_sleep_s: int = 600,
        initial_pir_gpio_pin: int = 22,
        initial_door_close_s: int = 60,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._on_save_settings = on_save_settings
        self._on_back = on_back
        self._on_minimize = on_minimize
        self._on_toggle_fullscreen = on_toggle_fullscreen
        self._on_quit = on_quit
        self._on_save_pir_pin = on_save_pir_pin
        self._on_save_door_close_timeout = on_save_door_close_timeout

        self._initial_token = initial_token
        self._initial_autocomplete_s = initial_autocomplete_s
        self._initial_sleep_s = initial_sleep_s
        self._initial_pir_gpio_pin = initial_pir_gpio_pin
        self._initial_door_close_s = initial_door_close_s

        self._init_ui()
        self.load_values(
            initial_token,
            initial_autocomplete_s,
            initial_sleep_s,
            initial_pir_gpio_pin,
            initial_door_close_s,
        )

    def _build_stepper_card(
        self,
        object_name: str,
        title_text: str,
        spin: QSpinBox,
        on_minus: Callable[[], None],
        on_plus: Callable[[], None],
        spin_width: int = 100,
    ) -> QFrame:
        card = QFrame(self)
        card.setObjectName(object_name)
        card.setStyleSheet(card_style(object_name, bg=COLOR_SURFACE, border=COLOR_RULE, radius=14))
        col = QVBoxLayout(card)
        col.setContentsMargins(12, 10, 12, 10)
        col.setSpacing(8)

        lbl = QLabel(title_text, card)
        lbl.setStyleSheet(f"font-size: 14px; font-weight: bold; color: {COLOR_MUTED};")

        row = QHBoxLayout()
        row.setSpacing(8)
        spin.setButtonSymbols(QSpinBox.ButtonSymbols.NoButtons)
        spin.setAlignment(Qt.AlignmentFlag.AlignCenter)
        spin.setFixedSize(spin_width, 40)
        spin.setStyleSheet(
            f"background-color: {COLOR_SURFACE_2}; color: {COLOR_INK}; "
            f"border: 1.5px solid {COLOR_RULE}; border-radius: 10px; "
            "font-size: 18px; font-weight: bold;"
        )

        btn_minus = _make_mouse_button(
            "−",
            COLOR_SURFACE_2,
            COLOR_LIME_SOFT,
            COLOR_INK,
            card,
            on_minus,
            min_width=48,
            font_px=18,
        )
        btn_plus = _make_mouse_button(
            "+",
            COLOR_SURFACE_2,
            COLOR_LIME_SOFT,
            COLOR_INK,
            card,
            on_plus,
            min_width=48,
            font_px=18,
        )

        row.addWidget(btn_minus)
        row.addWidget(spin, stretch=1)
        row.addWidget(btn_plus)
        col.addWidget(lbl)
        col.addLayout(row)
        return card

    def _init_ui(self) -> None:
        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(14, 10, 14, 10)
        root_layout.setSpacing(8)

        # 1. Header
        header = QHBoxLayout()
        title = QLabel("ตั้งค่าระบบ", self)
        title.setStyleSheet(f"font-size: 22px; font-weight: bold; color: {COLOR_INK};")

        mouse_badge = QLabel("Mouse / Touch", self)
        mouse_badge.setStyleSheet(pill_style(COLOR_LIME_SOFT, COLOR_LIME_INK, font_px=12))

        self.btn_back = _make_mouse_button(
            "ย้อนกลับ",
            COLOR_SURFACE,
            COLOR_SURFACE_2,
            COLOR_INK,
            self,
            self._handle_back,
            min_width=96,
            min_height=36,
            font_px=14,
        )

        header.addWidget(title)
        header.addWidget(mouse_badge)
        header.addStretch()
        header.addWidget(self.btn_back)
        root_layout.addLayout(header)

        # 2. Gateway Token Card
        token_card = QFrame(self)
        token_card.setObjectName("TokenCard")
        token_card.setStyleSheet(
            card_style("TokenCard", bg=COLOR_SURFACE, border=COLOR_RULE, radius=14)
        )
        token_col = QVBoxLayout(token_card)
        token_col.setContentsMargins(12, 8, 12, 8)
        token_col.setSpacing(6)

        token_lbl = QLabel("Gateway Token", token_card)
        token_lbl.setStyleSheet(f"font-size: 14px; font-weight: bold; color: {COLOR_MUTED};")

        token_row = QHBoxLayout()
        token_row.setSpacing(6)
        self.token_input = QLineEdit(token_card)
        self.token_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.token_input.setPlaceholderText("GATEWAY_TOKEN")
        self.token_input.setFixedHeight(38)
        self.token_input.setStyleSheet(
            f"background-color: {COLOR_SURFACE_2}; color: {COLOR_INK}; "
            f"border: 1.5px solid {COLOR_RULE}; border-radius: 10px; "
            "padding: 4px 10px; font-size: 15px; font-weight: bold;"
        )

        self.btn_toggle_echo = _make_mouse_button(
            "แสดง",
            COLOR_SURFACE_2,
            COLOR_LIME_SOFT,
            COLOR_INK,
            token_card,
            self._toggle_token_visibility,
            min_width=64,
        )
        self.btn_paste_token = _make_mouse_button(
            "วาง",
            COLOR_DARK,
            "#2B3322",
            COLOR_ON_DARK,
            token_card,
            self._paste_token_from_clipboard,
            min_width=58,
            border_color=COLOR_DARK,
        )
        self.btn_clear_token = _make_mouse_button(
            "ล้าง",
            COLOR_BAD,
            "#B91C1C",
            COLOR_ON_BAD,
            token_card,
            lambda: self.token_input.clear(),
            min_width=58,
            border_color=COLOR_BAD,
        )

        token_row.addWidget(self.token_input, stretch=1)
        token_row.addWidget(self.btn_toggle_echo)
        token_row.addWidget(self.btn_paste_token)
        token_row.addWidget(self.btn_clear_token)
        token_col.addWidget(token_lbl)
        token_col.addLayout(token_row)
        root_layout.addWidget(token_card)

        # 3. 2x2 Numeric Settings Grid
        grid = QGridLayout()
        grid.setSpacing(8)

        self.autocomplete_spin = QSpinBox(self)
        self.autocomplete_spin.setRange(1, 120)
        self.autocomplete_spin.setSuffix(" s")

        self.sleep_spin = QSpinBox(self)
        self.sleep_spin.setRange(5, 7200)
        self.sleep_spin.setSuffix(" s")

        self.pir_pin_spin = QSpinBox(self)
        self.pir_pin_spin.setRange(-1, 27)
        self.pir_pin_spin.setSpecialValueText("-1 (Off)")
        self.pir_pin_spin.setPrefix("GPIO ")

        self.door_close_spin = QSpinBox(self)
        self.door_close_spin.setRange(3, 600)
        self.door_close_spin.setSuffix(" s")

        card_auto = self._build_stepper_card(
            "CardAuto",
            "ยืนยันอัตโนมัติ (วินาที)",
            self.autocomplete_spin,
            lambda: self._adjust_autocomplete(-1),
            lambda: self._adjust_autocomplete(1),
        )
        card_sleep = self._build_stepper_card(
            "CardSleep",
            "พักหน้าจอ (วินาที)",
            self.sleep_spin,
            lambda: self._adjust_sleep(-30),
            lambda: self._adjust_sleep(30),
        )
        card_pir = self._build_stepper_card(
            "CardPir",
            "ขา PIR Motion (GPIO)",
            self.pir_pin_spin,
            lambda: self.pir_pin_spin.setValue(self.pir_pin_spin.value() - 1),
            lambda: self.pir_pin_spin.setValue(self.pir_pin_spin.value() + 1),
            spin_width=116,
        )
        card_door = self._build_stepper_card(
            "CardDoor",
            "ปิดประตูอัตโนมัติ (วินาที)",
            self.door_close_spin,
            lambda: self._adjust_door_close(-5),
            lambda: self._adjust_door_close(5),
        )

        grid.addWidget(card_auto, 0, 0)
        grid.addWidget(card_sleep, 0, 1)
        grid.addWidget(card_pir, 1, 0)
        grid.addWidget(card_door, 1, 1)
        root_layout.addLayout(grid, stretch=1)

        # 4. Footer Window Controls & Save
        footer = QHBoxLayout()
        footer.setSpacing(8)

        self.btn_minimize = _make_mouse_button(
            "ย่อหน้าต่าง",
            COLOR_SURFACE,
            COLOR_SURFACE_2,
            COLOR_INK,
            self,
            self._on_minimize,
            min_width=96,
            min_height=42,
        )
        self.btn_fullscreen = _make_mouse_button(
            "เต็มจอ / หน้าต่าง",
            COLOR_SURFACE,
            COLOR_SURFACE_2,
            COLOR_INK,
            self,
            self._on_toggle_fullscreen,
            min_width=128,
            min_height=42,
        )
        self.btn_quit = _make_mouse_button(
            "ปิดโปรแกรม",
            COLOR_BAD,
            "#B91C1C",
            COLOR_ON_BAD,
            self,
            self._on_quit,
            min_width=102,
            min_height=42,
            border_color=COLOR_BAD,
        )
        self.btn_save = _make_mouse_button(
            "บันทึก",
            COLOR_FRESH,
            "#245618",
            COLOR_ON_FRESH,
            self,
            self._handle_save,
            min_width=140,
            min_height=42,
            font_px=17,
            border_color=COLOR_FRESH,
        )

        footer.addWidget(self.btn_minimize)
        footer.addWidget(self.btn_fullscreen)
        footer.addWidget(self.btn_quit)
        footer.addStretch()
        footer.addWidget(self.btn_save)
        root_layout.addLayout(footer)

    def load_values(
        self,
        token: str,
        autocomplete_s: int,
        sleep_s: int,
        pir_gpio_pin: int = 22,
        door_close_s: int | None = None,
    ) -> None:
        """Populates controls with current runtime settings."""
        self.token_input.setText(token)
        self.autocomplete_spin.setValue(max(1, min(120, autocomplete_s)))
        self.sleep_spin.setValue(sleep_timeout_clamp(sleep_s))
        self.pir_pin_spin.setValue(max(-1, min(27, pir_gpio_pin)))
        if door_close_s is not None:
            self.door_close_spin.setValue(door_close_timeout_clamp(door_close_s))

    def _toggle_token_visibility(self) -> None:
        if self.token_input.echoMode() == QLineEdit.EchoMode.Password:
            self.token_input.setEchoMode(QLineEdit.EchoMode.Normal)
            self.btn_toggle_echo.setText("ซ่อน")
        else:
            self.token_input.setEchoMode(QLineEdit.EchoMode.Password)
            self.btn_toggle_echo.setText("แสดง")

    def _paste_token_from_clipboard(self) -> None:
        clipboard = QApplication.clipboard()
        if clipboard is not None:
            text = clipboard.text().strip()
            if text:
                self.token_input.setText(text)

    def _adjust_autocomplete(self, delta: int) -> None:
        self.autocomplete_spin.setValue(self.autocomplete_spin.value() + delta)

    def _adjust_sleep(self, delta: int) -> None:
        self.sleep_spin.setValue(sleep_timeout_clamp(self.sleep_spin.value() + delta))

    def _adjust_door_close(self, delta: int) -> None:
        self.door_close_spin.setValue(
            door_close_timeout_clamp(self.door_close_spin.value() + delta)
        )

    def _handle_back(self) -> None:
        if self._on_back is not None:
            self._on_back()

    def _handle_save(self) -> None:
        token = self.token_input.text().strip()
        autocomplete_s = int(self.autocomplete_spin.value())
        sleep_s = int(self.sleep_spin.value())
        pir_pin = int(self.pir_pin_spin.value())
        door_close_s = int(self.door_close_spin.value())
        if self._on_save_settings is not None:
            self._on_save_settings(token, autocomplete_s, sleep_s)
        if self._on_save_pir_pin is not None:
            self._on_save_pir_pin(pir_pin)
        if self._on_save_door_close_timeout is not None:
            self._on_save_door_close_timeout(door_close_s)
        if self._on_back is not None:
            self._on_back()


def sleep_timeout_clamp(value: int) -> int:
    """Clamps sleep timeout into the spinbox range [5, 7200]."""
    return max(5, min(7200, value))


def door_close_timeout_clamp(value: int) -> int:
    """Clamps auto door close timeout into [3, 600] seconds."""
    return max(3, min(600, value))
