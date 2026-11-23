"""Idle Home Screen displaying live camera preview and fridge/node telemetry."""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QImage, QPixmap
from PyQt6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from foodwarden_camera.ui.i18n import bind_text, t
from foodwarden_camera.ui.styles import (
    COLOR_BAD,
    COLOR_DARK,
    COLOR_FRESH,
    COLOR_INK,
    COLOR_LIME,
    COLOR_LIME_INK,
    COLOR_MUTED,
    COLOR_ON_BAD,
    COLOR_ON_DARK,
    COLOR_ON_DARK_2,
    COLOR_ON_FRESH,
    COLOR_ON_SOON,
    COLOR_ON_TAKE,
    COLOR_RULE,
    COLOR_SOON,
    COLOR_SURFACE,
    COLOR_SURFACE_2,
    COLOR_TAKE_SOLID,
    COLOR_WAIT_BG,
    COLOR_WAIT_FG,
    COLOR_WARN_TEXT,
    card_style,
    pill_style,
)
from foodwarden_camera.ui.widgets import FitLabel

PILL_PX = 14  # Status pills; header must fit brand + 3 worst-case pills + settings in 800px
TILE_TITLE_PX = 15
TILE_VALUE_PX = 20

_NODE_BADGE_THRESHOLDS: dict[str, tuple[float, float]] = {
    "F0": (45.0, 120.0),
    "D0": (5.0, 20.0),
}


def _format_elapsed_short(age_s: float) -> str:
    """Formats elapsed seconds cleanly (e.g. 12s, 1m15s, 2h05m)."""
    secs = max(0, int(age_s))
    if secs < 60:
        return f"{secs}s"
    if secs < 3600:
        mins, rem = divmod(secs, 60)
        return f"{mins}m{rem:02d}s"
    hours, rem_m = divmod(secs // 60, 60)
    return f"{hours}h{rem_m:02d}m"


_NODE_DISPLAY_NAMES: dict[str, str] = {"F": "Fridge", "D": "Door"}


def _node_display_name(node_id: str) -> str:
    """'F0' -> 'Fridge', 'D0' -> 'Door' (unknown ids are shown as-is)."""
    return _NODE_DISPLAY_NAMES.get(node_id[:1].upper(), node_id)


def format_node_badge(
    node_id: str,
    age_s: float | None,
    *,
    is_connected: bool = False,
    is_offline: bool = False,
) -> tuple[str, str, str, str]:
    """Returns (pill_text, detail_text, bg_hex, fg_hex) matching Web Prototype colors."""
    green_max_s, yellow_max_s = _NODE_BADGE_THRESHOLDS.get(node_id, (45.0, 120.0))
    name = _node_display_name(node_id)

    if age_s is None and not is_connected:
        return (
            f"● {name}: Wait",
            f"{name}: {t('node.wait')}",
            COLOR_WAIT_BG,
            COLOR_WAIT_FG,
        )

    elapsed = _format_elapsed_short(0.0 if age_s is None else age_s)

    if is_offline:
        return (
            f"● {name}: Off {elapsed}",
            f"{name}: {t('node.lost', t=elapsed)}",
            COLOR_BAD,
            COLOR_ON_BAD,
        )

    if is_connected or (age_s is not None and age_s <= green_max_s):
        state_txt = "LIVE" if is_connected and (age_s is None or age_s < 2.0) else elapsed
        return (
            f"● {name}: {state_txt}",
            f"{name}: {state_txt}",
            COLOR_FRESH,
            COLOR_ON_FRESH,
        )

    if age_s is not None and age_s <= yellow_max_s:
        return (
            f"● {name}: {elapsed}",
            f"{name}: {t('node.slow', t=elapsed)}",
            COLOR_SOON,
            COLOR_ON_SOON,
        )

    return (
        f"● {name}: {elapsed}!",
        f"{name}: {t('node.stale', t=elapsed)}",
        COLOR_BAD,
        COLOR_ON_BAD,
    )


def _create_header_button(
    text: str,
    parent: QWidget,
    callback: Callable[[], None] | None,
) -> QPushButton:
    """Builds the touch-friendly header settings button."""
    btn = QPushButton(text, parent)
    btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)
    btn.setFixedHeight(40)
    btn.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)
    btn.setStyleSheet(
        f"""
        QPushButton {{
            background-color: {COLOR_SURFACE};
            color: {COLOR_INK};
            border: 1.5px solid {COLOR_RULE};
            border-radius: 10px;
            font-size: 17px;
            font-weight: bold;
            padding: 4px 14px;
        }}
        QPushButton:hover {{ background-color: {COLOR_SURFACE_2}; }}
        """
    )
    if callback is not None:
        btn.clicked.connect(callback)
    return btn


def _fixed(widget: QWidget) -> QWidget:
    """Prevents a header widget from being squeezed (clipped) by its neighbours."""
    widget.setSizePolicy(QSizePolicy.Policy.Fixed, QSizePolicy.Policy.Fixed)
    return widget


class _StatusTile(QFrame):
    """#F2F7E3 tile: [title ........ status pill] over one single-line value."""

    def __init__(
        self,
        object_name: str,
        title_key: str,
        initial_value: str,
        value_px: int,
        parent: QWidget,
        *,
        pill_text: str | None = None,
    ) -> None:
        super().__init__(parent)
        self.setObjectName(object_name)
        self.setStyleSheet(
            card_style(object_name, bg=COLOR_SURFACE_2, border=COLOR_RULE, radius=12)
        )
        self.value_px = value_px

        col = QVBoxLayout(self)
        col.setContentsMargins(12, 6, 10, 8)
        col.setSpacing(0)

        top = QHBoxLayout()
        top.setSpacing(6)
        self.title_label = bind_text(QLabel(self), title_key)
        self.title_label.setStyleSheet(
            f"font-size: {TILE_TITLE_PX}px; font-weight: bold; color: {COLOR_MUTED};"
        )
        top.addWidget(self.title_label)
        top.addStretch()
        self.pill: QLabel | None = None
        if pill_text is not None:
            self.pill = QLabel(pill_text, self)
            self.pill.setStyleSheet(pill_style(COLOR_WAIT_BG, COLOR_WAIT_FG, font_px=PILL_PX))
            top.addWidget(self.pill)

        # Single line on purpose: a wrapped value overflows the fixed-height tile.
        self.value_label: QLabel = FitLabel(initial_value, self, min_px=14)
        self.set_value(initial_value, COLOR_INK)

        col.addLayout(top)
        col.addWidget(self.value_label)

    def set_value(self, text: str, color: str) -> None:
        self.value_label.setText(text)
        self.value_label.setStyleSheet(
            f"font-size: {self.value_px}px; font-weight: bold; color: {color};"
        )

    def set_pill(self, text: str, bg: str, fg: str) -> None:
        if self.pill is not None:
            self.pill.setText(text)
            self.pill.setStyleSheet(pill_style(bg, fg, font_px=PILL_PX))


def _create_action_pill(
    object_name: str,
    key_text: str,
    title_key: str,
    bg_color: str,
    fg_color: str,
    badge_bg: str,
    badge_fg: str,
    parent: QWidget,
) -> QFrame:
    """Builds a bold bottom action guidance pill matching Web Prototype CTAs."""
    frame = QFrame(parent)
    frame.setObjectName(object_name)
    frame.setFixedHeight(60)
    frame.setStyleSheet(card_style(object_name, bg=bg_color, border=bg_color, radius=14))

    row = QHBoxLayout(frame)
    row.setContentsMargins(10, 6, 14, 6)
    row.setSpacing(12)

    badge = QLabel(key_text, frame)
    badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
    badge.setFixedSize(42, 42)
    badge.setStyleSheet(
        f"background-color: {badge_bg}; color: {badge_fg}; "
        "font-size: 22px; font-weight: bold; border-radius: 10px;"
    )

    label = bind_text(QLabel(frame), title_key)
    label.setStyleSheet(f"font-size: 22px; font-weight: bold; color: {fg_color};")

    row.addWidget(badge)
    row.addWidget(label)
    row.addStretch()
    return frame


class IdleScreen(QWidget):
    """Home screen providing high-contrast telemetry, camera feed, and CTA triggers.

    Layout (800×480):
        header   [FW FoodWarden] ........ [Wi-Fi] [F0] [D0] [ตั้งค่า]
        body     [camera preview] | [temp | VOC] / [door] / [PIR] / [YOLO]
        actions  [O นำเข้าอาหาร] [X นำออกอาหาร]

    Window controls (minimise / fullscreen / quit) live on the Settings screen
    so they can't be hit by accident and don't crowd the header.
    """

    def __init__(
        self,
        parent: QWidget | None = None,
        on_open_settings: Callable[[], None] | None = None,
    ) -> None:
        super().__init__(parent)
        self._on_open_settings = on_open_settings
        # Last values shown, replayed by retranslate() after a language switch.
        self._last_temp: float | None = None
        self._last_voc: int | None = None
        self._last_light: int | None = None
        self._last_door: tuple[bool, float] = (False, 0.0)
        self._last_wifi: bool | None = None
        self._last_nodes: dict[str, tuple[float | None, bool, bool]] = {}
        self._last_motion: tuple[bool, float, str] | None = None
        self._last_person: tuple[bool, float, int] | None = None
        self._init_ui()

    def retranslate(self) -> None:
        """Re-renders the dynamic tile texts in the current language."""
        if (
            self._last_temp is not None
            or self._last_voc is not None
            or self._last_light is not None
        ):
            self.update_telemetry(self._last_temp, self._last_voc, self._last_light)
        else:
            self.door_tile.set_value(t("idle.door_closed"), COLOR_INK)
        self.update_door_state(*self._last_door)
        if self._last_wifi is not None:
            self.update_wifi_status(self._last_wifi)
        for node_id, (age_s, connected, offline) in list(self._last_nodes.items()):
            self.update_node_status(node_id, age_s, connected, offline)
        if self._last_motion is not None:
            self.update_motion_state(*self._last_motion)
        if self._last_person is not None:
            self.update_person_state(*self._last_person)
        if self.camera_label.pixmap() is None or self.camera_label.pixmap().isNull():
            self.camera_label.setText(t("idle.waiting_camera"))

    def _init_ui(self) -> None:
        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(12, 10, 12, 10)
        root_layout.setSpacing(8)

        root_layout.addLayout(self._build_header())

        content_layout = QHBoxLayout()
        content_layout.setSpacing(10)
        content_layout.addWidget(self._build_camera_card(), stretch=9)
        content_layout.addWidget(self._build_status_card(), stretch=11)
        root_layout.addLayout(content_layout, stretch=1)

        action_bar = QHBoxLayout()
        action_bar.setSpacing(10)
        checkin_pill = _create_action_pill(
            "BtnCheckInGuide",
            "O",
            "idle.checkin",
            COLOR_DARK,
            COLOR_ON_DARK,
            COLOR_LIME,
            COLOR_LIME_INK,
            self,
        )
        checkout_pill = _create_action_pill(
            "BtnCheckOutGuide",
            "X",
            "idle.checkout",
            COLOR_TAKE_SOLID,
            COLOR_ON_TAKE,
            COLOR_SURFACE,
            COLOR_TAKE_SOLID,
            self,
        )
        action_bar.addWidget(checkin_pill, stretch=1)
        action_bar.addWidget(checkout_pill, stretch=1)
        root_layout.addLayout(action_bar)

    def _build_header(self) -> QHBoxLayout:
        header = QHBoxLayout()
        header.setSpacing(6)

        brand_dot = QLabel("FW", self)
        brand_dot.setAlignment(Qt.AlignmentFlag.AlignCenter)
        brand_dot.setFixedSize(36, 36)
        brand_dot.setStyleSheet(
            f"background-color: {COLOR_LIME}; color: {COLOR_LIME_INK}; "
            "font-size: 16px; font-weight: bold; border-radius: 10px;"
        )

        title = QLabel("FoodWarden", self)
        title.setStyleSheet(f"font-size: 24px; font-weight: bold; color: {COLOR_INK};")

        self.pill_wifi = QLabel("Wi-Fi: --", self)
        self.pill_wifi.setStyleSheet(pill_style(COLOR_WAIT_BG, COLOR_WAIT_FG, font_px=PILL_PX))

        self.pill_node_f = QLabel("● Fridge: Wait", self)
        self.pill_node_f.setStyleSheet(pill_style(COLOR_WAIT_BG, COLOR_WAIT_FG, font_px=PILL_PX))
        self.pill_ble = self.pill_node_f

        self.pill_node_d = QLabel("● Door: Wait", self)
        self.pill_node_d.setStyleSheet(pill_style(COLOR_WAIT_BG, COLOR_WAIT_FG, font_px=PILL_PX))

        self.btn_settings = _create_header_button(t("idle.settings"), self, self._on_open_settings)
        bind_text(self.btn_settings, "idle.settings")

        header.addWidget(_fixed(brand_dot))
        header.addSpacing(4)
        header.addWidget(_fixed(title))
        header.addStretch(1)
        for pill in (self.pill_wifi, self.pill_node_f, self.pill_node_d):
            header.addWidget(_fixed(pill))
        header.addSpacing(4)
        header.addWidget(self.btn_settings)
        return header

    def _build_camera_card(self) -> QFrame:
        cam_card = QFrame(self)
        cam_card.setObjectName("CamCard")
        cam_card.setStyleSheet(
            card_style("CamCard", bg=COLOR_SURFACE, border=COLOR_RULE, radius=16)
        )
        cam_card_layout = QVBoxLayout(cam_card)
        cam_card_layout.setContentsMargins(10, 10, 10, 10)

        self.camera_frame = QFrame(cam_card)
        self.camera_frame.setObjectName("CameraFrame")
        self.camera_frame.setMinimumSize(300, 215)
        self.camera_frame.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self.camera_frame.setStyleSheet(
            f"#CameraFrame {{ background-color: {COLOR_DARK}; "
            f"border: 1.5px solid {COLOR_RULE}; border-radius: 12px; }}"
        )
        cam_inner = QVBoxLayout(self.camera_frame)
        cam_inner.setContentsMargins(4, 4, 4, 4)

        self.camera_label = QLabel(t("idle.waiting_camera"), self.camera_frame)
        self.camera_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.camera_label.setStyleSheet(
            f"color: {COLOR_ON_DARK_2}; font-size: 18px; font-weight: bold;"
        )
        cam_inner.addWidget(self.camera_label)
        cam_card_layout.addWidget(self.camera_frame)
        return cam_card

    def _build_status_card(self) -> QFrame:
        diag_card = QFrame(self)
        diag_card.setObjectName("DiagCard")
        diag_card.setStyleSheet(
            card_style("DiagCard", bg=COLOR_SURFACE, border=COLOR_RULE, radius=16)
        )
        col = QVBoxLayout(diag_card)
        col.setContentsMargins(10, 10, 10, 10)
        col.setSpacing(8)

        climate_row = QHBoxLayout()
        climate_row.setSpacing(8)
        self.temp_tile = _StatusTile(
            "TileTemp", "idle.temp", "--.- °C", 28, diag_card, pill_text=t("idle.waiting_data")
        )
        self.voc_tile = _StatusTile(
            "TileVoc", "idle.voc", "--", 28, diag_card, pill_text=t("idle.waiting_data")
        )
        climate_row.addWidget(self.temp_tile, stretch=1)
        climate_row.addWidget(self.voc_tile, stretch=1)
        col.addLayout(climate_row)

        # Door: value = light sensor in fridge (F), pill = actuator node (D) state.
        self.door_tile = _StatusTile(
            "TileDoor",
            "idle.door",
            t("idle.door_closed"),
            TILE_VALUE_PX,
            diag_card,
            pill_text="Door: Closed",
        )
        self.motion_tile = _StatusTile(
            "TileMotion",
            "idle.motion",
            t("idle.waiting_signal"),
            TILE_VALUE_PX,
            diag_card,
            pill_text="PIR: --",
        )
        self.person_tile = _StatusTile(
            "TilePerson",
            "idle.person",
            t("idle.no_person"),
            TILE_VALUE_PX,
            diag_card,
            pill_text="Clear",
        )
        for tile in (self.door_tile, self.motion_tile, self.person_tile):
            col.addWidget(tile)
        col.addStretch()

        # Public aliases kept stable for the orchestrator and tests.
        self.temp_label = self.temp_tile.value_label
        self.voc_label = self.voc_tile.value_label
        self.door_label = self.door_tile.value_label
        self.motion_label = self.motion_tile.value_label
        self.person_label = self.person_tile.value_label
        assert self.door_tile.pill and self.motion_tile.pill and self.person_tile.pill
        self.pill_door = self.door_tile.pill
        self.pill_motion = self.motion_tile.pill
        self.pill_person = self.person_tile.pill
        self.update_door_state(False)
        return diag_card

    def update_frame(self, frame_bgr: np.ndarray) -> None:
        """Updates live camera viewfinder from raw numpy BGR frame."""
        import cv2

        h, w, ch = frame_bgr.shape
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        qimg = QImage(
            rgb.data.tobytes(),
            int(w),
            int(h),
            int(ch * w),
            QImage.Format.Format_RGB888,
        )
        target_w = max(self.camera_frame.width() - 8, 280)
        target_h = max(self.camera_frame.height() - 8, 200)
        pixmap = QPixmap.fromImage(qimg).scaled(
            target_w,
            target_h,
            Qt.AspectRatioMode.KeepAspectRatioByExpanding,
            Qt.TransformationMode.SmoothTransformation,
        )
        self.camera_label.setText("")
        self.camera_label.setPixmap(pixmap)

    def update_telemetry(self, temp_c: float | None, voc: int | None, light: int | None) -> None:
        """Updates internal climate card values."""
        if temp_c is not None:
            self._last_temp = temp_c
        if voc is not None:
            self._last_voc = voc
        if light is not None:
            self._last_light = light
        if temp_c is not None:
            if temp_c <= 4.0:
                status, bg, fg, color = t("idle.temp_ok"), COLOR_FRESH, COLOR_ON_FRESH, COLOR_FRESH
            elif temp_c <= 8.0:
                status, bg, fg, color = (
                    t("idle.temp_warm"),
                    COLOR_SOON,
                    COLOR_ON_SOON,
                    COLOR_WARN_TEXT,
                )
            else:
                status, bg, fg, color = t("idle.temp_hot"), COLOR_BAD, COLOR_ON_BAD, COLOR_BAD
            self.temp_tile.set_value(f"{temp_c:.1f} °C", color)
            self.temp_tile.set_pill(status, bg, fg)

        if voc is not None:
            if voc <= 150:
                desc, bg, fg, color = t("idle.voc_clean"), COLOR_FRESH, COLOR_ON_FRESH, COLOR_FRESH
            elif voc <= 250:
                desc, bg, fg, color = (
                    t("idle.voc_smell"),
                    COLOR_SOON,
                    COLOR_ON_SOON,
                    COLOR_WARN_TEXT,
                )
            else:
                desc, bg, fg, color = t("idle.voc_strong"), COLOR_BAD, COLOR_ON_BAD, COLOR_BAD
            self.voc_tile.set_value(str(voc), color)
            self.voc_tile.set_pill(desc, bg, fg)

        if light is not None:
            if light >= 100:
                self.door_tile.set_value(t("idle.door_open"), COLOR_WARN_TEXT)
            else:
                self.door_tile.set_value(t("idle.door_closed"), COLOR_FRESH)

    def update_door_state(self, is_open: bool, ajar_duration_s: float = 0.0) -> None:
        """Updates the door actuator (Node D) pill on the door tile."""
        self._last_door = (is_open, ajar_duration_s)
        if is_open:
            is_overdue = ajar_duration_s >= 15.0
            bg = COLOR_BAD if is_overdue else COLOR_SOON
            fg = COLOR_ON_BAD if is_overdue else COLOR_ON_SOON
            self.door_tile.set_pill(f"Door: Open ({int(ajar_duration_s)}s)", bg, fg)
        else:
            self.door_tile.set_pill("Door: Closed", COLOR_FRESH, COLOR_ON_FRESH)

    def update_wifi_status(self, is_online: bool) -> None:
        """Updates top Wi-Fi connectivity badge."""
        self._last_wifi = is_online
        if is_online:
            self.pill_wifi.setText("Wi-Fi: OK")
            self.pill_wifi.setStyleSheet(pill_style(COLOR_FRESH, COLOR_ON_FRESH, font_px=PILL_PX))
        else:
            self.pill_wifi.setText("Wi-Fi: Offline")
            self.pill_wifi.setStyleSheet(pill_style(COLOR_BAD, COLOR_ON_BAD, font_px=PILL_PX))

    def update_node_status(
        self,
        node_id: str,
        age_s: float | None,
        is_connected: bool = False,
        is_offline: bool = False,
    ) -> None:
        """Updates Gray->Green->Amber->Red connection indicator for Node 'F' or 'D'."""
        self._last_nodes[node_id] = (age_s, is_connected, is_offline)
        pill_text, detail_text, bg_hex, fg_hex = format_node_badge(
            node_id,
            age_s,
            is_connected=is_connected,
            is_offline=is_offline,
        )
        badge_css = pill_style(bg_hex, fg_hex, font_px=PILL_PX)
        target = None
        if node_id.startswith("F"):
            target = self.pill_node_f
        elif node_id.startswith("D"):
            target = self.pill_node_d
        if target is not None:
            target.setText(pill_text)
            target.setStyleSheet(badge_css)
            target.setToolTip(detail_text)

    def update_motion_state(
        self,
        has_motion: bool,
        idle_duration_s: float = 0.0,
        hw_status: str = "",
    ) -> None:
        """Updates PIR motion sensor badge and concise status label."""
        self._last_motion = (has_motion, idle_duration_s, hw_status)
        # GPIO binding details ("GPIO 22: HW/Sim") are for developers, not users;
        # only surface the one state a user needs to know: the sensor is off.
        hw_suffix = t("idle.sensor_off") if hw_status == "PIR Disabled" else ""
        if has_motion:
            self.motion_tile.set_pill(f"DETECTED{hw_suffix}", COLOR_FRESH, COLOR_ON_FRESH)
            self.motion_tile.set_value(f"{t('idle.motion_seen')}{hw_suffix}", COLOR_FRESH)
            return

        secs = max(0, int(idle_duration_s))
        if secs < 60:
            pill_text = f"{t('idle.still_pill', s=secs)}{hw_suffix}"
            value = f"{t('idle.still_s', s=secs)}{hw_suffix}"
        else:
            mins, rem = divmod(secs, 60)
            pill_text = f"{mins}m {rem}s{hw_suffix}"
            value = f"{t('idle.still_ms', m=mins, s=rem)}{hw_suffix}"
        self.motion_tile.set_pill(pill_text, COLOR_WAIT_BG, COLOR_WAIT_FG)
        self.motion_tile.set_value(value, COLOR_INK)

    def update_person_state(
        self,
        is_person: bool,
        confidence: float = 0.0,
        person_count: int = 0,
    ) -> None:
        """Updates YOLO person detection badge and concise status label."""
        self._last_person = (is_person, confidence, person_count)
        if is_person:
            pct = round(max(0.0, min(1.0, confidence)) * 100)
            count = max(1, person_count)
            self.person_tile.set_pill(f"Person {pct}%", COLOR_SOON, COLOR_ON_SOON)
            self.person_tile.set_value(t("idle.person_seen", n=count, pct=pct), COLOR_WARN_TEXT)
            return

        self.person_tile.set_pill("Clear", COLOR_WAIT_BG, COLOR_WAIT_FG)
        self.person_tile.set_value(t("idle.no_person"), COLOR_INK)
