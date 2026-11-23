"""Mouse-Only Settings & Window Control Screen aligned with Web Prototype theme."""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from PyQt6.QtCore import QPointF, QSize, Qt
from PyQt6.QtGui import QColor, QIcon, QPainter, QPen, QPixmap
from PyQt6.QtWidgets import (
    QApplication,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QSizePolicy,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from foodwarden_camera.ui.styles import (
    COLOR_BAD,
    COLOR_DARK,
    COLOR_FRESH,
    COLOR_INK,
    COLOR_LIME_SOFT,
    COLOR_MUTED,
    COLOR_ON_BAD,
    COLOR_ON_DARK,
    COLOR_ON_FRESH,
    COLOR_RULE,
    COLOR_SURFACE,
    COLOR_SURFACE_2,
    FS_BODY,
    FS_LABEL,
    FS_SMALL,
    FS_TITLE,
    card_style,
)

_CONTROL_H = 48  # inputs, steppers, token buttons
_ICON_BTN = 46  # square window-control buttons
_FOOTER_H = 54
_STEP_H = 42  # − value + stepper row (compact)
_CONTENT_MAX_W = 1100


def _make_mouse_button(
    text: str,
    bg_color: str,
    hover_color: str,
    fg_color: str,
    parent: QWidget,
    callback: Callable[[], None] | None,
    *,
    min_width: int = 44,
    min_height: int = _CONTROL_H,
    font_px: int = FS_LABEL,
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
            border-radius: 12px;
            font-size: {font_px}px;
            font-weight: bold;
            padding: 4px 14px;
        }}
        QPushButton:hover {{ background-color: {hover_color}; }}
        """
    )
    if callback is not None:
        btn.clicked.connect(callback)
    return btn


IconKind = Literal["minimize", "fullscreen", "quit"]


def _paint_icon(kind: IconKind, color: str, size: int = 22) -> QIcon:
    """Draws a simple line icon so it renders identically on every OS font."""
    scale = 3  # supersample for crisp lines on HiDPI
    pix = QPixmap(size * scale, size * scale)
    pix.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pix)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    pen = QPen(QColor(color), 2.6 * scale)
    pen.setCapStyle(Qt.PenCapStyle.RoundCap)
    pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
    painter.setPen(pen)
    m = 4 * scale  # margin
    full = size * scale
    if kind == "minimize":
        painter.drawLine(QPointF(m, full - m - scale), QPointF(full - m, full - m - scale))
    elif kind == "fullscreen":
        c = 4 * scale  # corner arm length (short, so it reads as "expand")
        for x, y, dx, dy in (
            (m, m, 1, 1),
            (full - m, m, -1, 1),
            (m, full - m, 1, -1),
            (full - m, full - m, -1, -1),
        ):
            painter.drawLine(QPointF(x, y), QPointF(x + dx * c, y))
            painter.drawLine(QPointF(x, y), QPointF(x, y + dy * c))
    else:
        painter.drawLine(QPointF(m, m), QPointF(full - m, full - m))
        painter.drawLine(QPointF(full - m, m), QPointF(m, full - m))
    painter.end()
    pix.setDevicePixelRatio(scale)
    return QIcon(pix)


def _make_icon_button(
    kind: IconKind,
    tooltip: str,
    bg_color: str,
    hover_color: str,
    fg_color: str,
    border_color: str,
    parent: QWidget,
    callback: Callable[[], None] | None,
) -> QPushButton:
    """Square icon-only window-control button (label lives in the tooltip)."""
    btn = _make_mouse_button(
        "",
        bg_color,
        hover_color,
        fg_color,
        parent,
        callback,
        min_width=_ICON_BTN,
        min_height=_ICON_BTN,
        border_color=border_color,
    )
    btn.setFixedSize(_ICON_BTN, _ICON_BTN)
    btn.setIcon(_paint_icon(kind, fg_color))
    btn.setIconSize(QSize(22, 22))
    btn.setToolTip(tooltip)
    btn.setAccessibleName(tooltip)
    return btn


class SettingsScreen(QWidget):
    """Touch/mouse-controlled settings and window management screen.

    Layout (800×480):
        header   ตั้งค่าระบบ ................. [—] [⛶] [✕]   (window controls, icon only)
        token    Gateway Token [••••••] [แสดง] [วาง] [ล้าง]
        grid     ยืนยันอัตโนมัติ | พักหน้าจอ
                 เซ็นเซอร์การเคลื่อนไหว | ปิดประตูอัตโนมัติ
        footer   [ย้อนกลับ]   ใช้เมาส์หรือแตะหน้าจอ   [บันทึก]
    """

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
    ) -> QFrame:
        card = QFrame(self)
        card.setObjectName(object_name)
        card.setStyleSheet(card_style(object_name, bg=COLOR_SURFACE, border=COLOR_RULE, radius=14))
        # Never grow taller than its content (keeps title + stepper together on big screens).
        card.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Maximum)
        col = QVBoxLayout(card)
        col.setContentsMargins(14, 10, 14, 12)
        col.setSpacing(8)

        lbl = QLabel(title_text, card)
        lbl.setStyleSheet(f"font-size: {FS_BODY}px; font-weight: bold; color: {COLOR_INK};")

        row = QHBoxLayout()
        row.setSpacing(8)
        spin.setButtonSymbols(QSpinBox.ButtonSymbols.NoButtons)
        spin.setAlignment(Qt.AlignmentFlag.AlignCenter)
        spin.setFixedHeight(_STEP_H)
        spin.setMinimumWidth(100)
        spin.setStyleSheet(
            f"background-color: {COLOR_SURFACE_2}; color: {COLOR_INK}; "
            f"border: 1.5px solid {COLOR_RULE}; border-radius: 10px; "
            f"font-size: {FS_LABEL + 2}px; font-weight: bold;"
        )

        def _step_btn(text: str, cb: Callable[[], None]) -> QPushButton:
            btn = _make_mouse_button(
                text, COLOR_SURFACE_2, COLOR_LIME_SOFT, COLOR_INK, card, cb, font_px=FS_LABEL + 4
            )
            btn.setFixedSize(52, _STEP_H)
            return btn

        row.addWidget(_step_btn("−", on_minus))
        row.addWidget(spin, stretch=1)
        row.addWidget(_step_btn("+", on_plus))
        col.addWidget(lbl)
        col.addLayout(row)
        return card

    def _init_ui(self) -> None:
        # Content column is capped at _CONTENT_MAX_W and centred, so fullscreen on a
        # large monitor doesn't stretch controls edge-to-edge.
        outer = QHBoxLayout(self)
        outer.setContentsMargins(14, 10, 14, 12)
        outer.addStretch(1)
        content = QWidget(self)
        content.setMaximumWidth(_CONTENT_MAX_W)
        content.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        outer.addWidget(content, stretch=100)
        outer.addStretch(1)

        root_layout = QVBoxLayout(content)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(10)
        # Spare height is split above and below, keeping the whole block together and
        # vertically centred on large screens (no gap opens between cards and footer).
        root_layout.addStretch(1)

        # 1. Header: title + icon-only window controls
        header = QHBoxLayout()
        header.setSpacing(8)
        title = QLabel("ตั้งค่าระบบ", self)
        title.setStyleSheet(f"font-size: {FS_TITLE}px; font-weight: bold; color: {COLOR_INK};")

        self.btn_minimize = _make_icon_button(
            "minimize",
            "ย่อหน้าต่าง",
            COLOR_SURFACE,
            COLOR_SURFACE_2,
            COLOR_INK,
            COLOR_RULE,
            self,
            self._on_minimize,
        )
        self.btn_fullscreen = _make_icon_button(
            "fullscreen",
            "เต็มจอ / หน้าต่าง",
            COLOR_SURFACE,
            COLOR_SURFACE_2,
            COLOR_INK,
            COLOR_RULE,
            self,
            self._on_toggle_fullscreen,
        )
        self.btn_quit = _make_icon_button(
            "quit",
            "ปิดโปรแกรม",
            COLOR_BAD,
            "#B91C1C",
            COLOR_ON_BAD,
            COLOR_BAD,
            self,
            self._on_quit,
        )

        header.addWidget(title)
        header.addStretch()
        header.addWidget(self.btn_minimize)
        header.addWidget(self.btn_fullscreen)
        header.addWidget(self.btn_quit)
        root_layout.addLayout(header)

        # 2. Gateway Token Card
        token_card = QFrame(self)
        token_card.setObjectName("TokenCard")
        token_card.setStyleSheet(
            card_style("TokenCard", bg=COLOR_SURFACE, border=COLOR_RULE, radius=14)
        )
        token_col = QVBoxLayout(token_card)
        token_col.setContentsMargins(14, 8, 14, 10)
        token_col.setSpacing(6)

        token_lbl = QLabel("Gateway Token (รหัสเชื่อมต่อเซิร์ฟเวอร์)", token_card)
        token_lbl.setStyleSheet(f"font-size: {FS_BODY}px; font-weight: bold; color: {COLOR_INK};")

        token_row = QHBoxLayout()
        token_row.setSpacing(8)
        self.token_input = QLineEdit(token_card)
        self.token_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.token_input.setPlaceholderText("GATEWAY_TOKEN")
        self.token_input.setFixedHeight(_CONTROL_H)
        self.token_input.setStyleSheet(
            f"background-color: {COLOR_SURFACE_2}; color: {COLOR_INK}; "
            f"border: 1.5px solid {COLOR_RULE}; border-radius: 12px; "
            f"padding: 4px 12px; font-size: {FS_LABEL}px; font-weight: bold;"
        )

        self.btn_toggle_echo = _make_mouse_button(
            "แสดง",
            COLOR_SURFACE_2,
            COLOR_LIME_SOFT,
            COLOR_INK,
            token_card,
            self._toggle_token_visibility,
            min_width=76,
        )
        self.btn_paste_token = _make_mouse_button(
            "วาง",
            COLOR_DARK,
            "#2B3322",
            COLOR_ON_DARK,
            token_card,
            self._paste_token_from_clipboard,
            min_width=68,
            border_color=COLOR_DARK,
        )
        self.btn_clear_token = _make_mouse_button(
            "ล้าง",
            COLOR_BAD,
            "#B91C1C",
            COLOR_ON_BAD,
            token_card,
            lambda: self.token_input.clear(),
            min_width=68,
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
        grid.setSpacing(10)

        self.autocomplete_spin = QSpinBox(self)
        self.autocomplete_spin.setRange(1, 120)
        self.autocomplete_spin.setSuffix(" วินาที")

        self.sleep_spin = QSpinBox(self)
        self.sleep_spin.setRange(5, 7200)
        self.sleep_spin.setSuffix(" วินาที")

        self.pir_pin_spin = QSpinBox(self)
        self.pir_pin_spin.setRange(-1, 27)
        self.pir_pin_spin.setSpecialValueText("ปิดใช้งาน")
        self.pir_pin_spin.setPrefix("GPIO ")

        self.door_close_spin = QSpinBox(self)
        self.door_close_spin.setRange(3, 600)
        self.door_close_spin.setSuffix(" วินาที")

        card_auto = self._build_stepper_card(
            "CardAuto",
            "ยืนยันอัตโนมัติหลัง",
            self.autocomplete_spin,
            lambda: self._adjust_autocomplete(-1),
            lambda: self._adjust_autocomplete(1),
        )
        card_sleep = self._build_stepper_card(
            "CardSleep",
            "พักหน้าจอเมื่อไม่มีคนหลัง",
            self.sleep_spin,
            lambda: self._adjust_sleep(-30),
            lambda: self._adjust_sleep(30),
        )
        card_pir = self._build_stepper_card(
            "CardPir",
            "ขาเซ็นเซอร์ตรวจจับการเคลื่อนไหว",
            self.pir_pin_spin,
            lambda: self.pir_pin_spin.setValue(self.pir_pin_spin.value() - 1),
            lambda: self.pir_pin_spin.setValue(self.pir_pin_spin.value() + 1),
        )
        card_door = self._build_stepper_card(
            "CardDoor",
            "ปิดประตูอัตโนมัติเมื่อเปิดค้าง",
            self.door_close_spin,
            lambda: self._adjust_door_close(-5),
            lambda: self._adjust_door_close(5),
        )

        grid.addWidget(card_auto, 0, 0)
        grid.addWidget(card_sleep, 0, 1)
        grid.addWidget(card_pir, 1, 0)
        grid.addWidget(card_door, 1, 1)
        root_layout.addLayout(grid)
        root_layout.addSpacing(4)

        # 4. Footer: Back (left) · hint · Save (right)
        footer = QHBoxLayout()
        footer.setSpacing(10)

        self.btn_back = _make_mouse_button(
            "‹  ย้อนกลับ",
            COLOR_SURFACE,
            COLOR_SURFACE_2,
            COLOR_INK,
            self,
            self._handle_back,
            min_width=170,
            min_height=_FOOTER_H,
            font_px=FS_BODY - 1,
        )
        hint = QLabel("ใช้เมาส์หรือแตะหน้าจอ", self)
        hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hint.setStyleSheet(f"font-size: {FS_SMALL}px; color: {COLOR_MUTED};")
        self.btn_save = _make_mouse_button(
            "บันทึก",
            COLOR_FRESH,
            "#245618",
            COLOR_ON_FRESH,
            self,
            self._handle_save,
            min_width=200,
            min_height=_FOOTER_H,
            font_px=FS_BODY,
            border_color=COLOR_FRESH,
        )

        footer.addWidget(self.btn_back)
        footer.addStretch()
        footer.addWidget(hint)
        footer.addStretch()
        footer.addWidget(self.btn_save)
        root_layout.addLayout(footer)
        root_layout.addStretch(1)

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
