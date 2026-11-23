"""Idle Home Screen displaying live camera preview and fridge/node telemetry."""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QImage, QPixmap
from PyQt6.QtWidgets import (
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

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
    card_style,
    pill_style,
)

PILL_PX = 14  # Header status pills: largest size that fits 4 pills + controls in 800px

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


def format_node_badge(
    node_id: str,
    age_s: float | None,
    *,
    is_connected: bool = False,
    is_offline: bool = False,
) -> tuple[str, str, str, str]:
    """Returns (pill_text, detail_text, bg_hex, fg_hex) matching Web Prototype colors."""
    green_max_s, yellow_max_s = _NODE_BADGE_THRESHOLDS.get(node_id, (45.0, 120.0))

    if age_s is None and not is_connected:
        return (
            f"● {node_id}: Wait",
            f"{node_id}: รอเชื่อมต่อ",
            COLOR_WAIT_BG,
            COLOR_WAIT_FG,
        )

    elapsed = _format_elapsed_short(0.0 if age_s is None else age_s)

    if is_offline:
        return (
            f"● {node_id}: Off {elapsed}",
            f"{node_id}: หลุด ({elapsed})",
            COLOR_BAD,
            COLOR_ON_BAD,
        )

    if is_connected or (age_s is not None and age_s <= green_max_s):
        state_txt = "LIVE" if is_connected and (age_s is None or age_s < 2.0) else elapsed
        return (
            f"● {node_id}: {state_txt}",
            f"{node_id}: {state_txt}",
            COLOR_FRESH,
            COLOR_ON_FRESH,
        )

    if age_s is not None and age_s <= yellow_max_s:
        return (
            f"● {node_id}: {elapsed}",
            f"{node_id}: ช้า ({elapsed})",
            COLOR_SOON,
            COLOR_ON_SOON,
        )

    return (
        f"● {node_id}: {elapsed}!",
        f"{node_id}: ขาด ({elapsed})",
        COLOR_BAD,
        COLOR_ON_BAD,
    )


def _create_header_button(
    text: str,
    bg_color: str,
    hover_color: str,
    fg_color: str,
    border_color: str,
    parent: QWidget,
    callback: Callable[[], None] | None,
    *,
    min_width: int = 38,
) -> QPushButton:
    """Builds a touch-friendly header control button matching Web Prototype style."""
    btn = QPushButton(text, parent)
    btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)
    btn.setMinimumSize(min_width, 40)
    btn.setStyleSheet(
        f"""
        QPushButton {{
            background-color: {bg_color};
            color: {fg_color};
            border: 1.5px solid {border_color};
            border-radius: 10px;
            font-size: 17px;
            font-weight: bold;
            padding: 4px 10px;
        }}
        QPushButton:hover {{ background-color: {hover_color}; }}
        """
    )
    if callback is not None:
        btn.clicked.connect(callback)
    return btn


def _create_metric_tile(
    object_name: str,
    title: str,
    initial_value: str,
    value_px: int,
    parent: QWidget,
) -> tuple[QFrame, QLabel]:
    """Builds a #F2F7E3 metric tile card matching Web Prototype `.mini` tiles."""
    tile = QFrame(parent)
    tile.setObjectName(object_name)
    tile.setStyleSheet(card_style(object_name, bg=COLOR_SURFACE_2, border=COLOR_RULE, radius=12))
    layout = QVBoxLayout(tile)
    layout.setContentsMargins(12, 6, 12, 8)
    layout.setSpacing(0)

    title_lbl = QLabel(title, tile)
    title_lbl.setStyleSheet(f"font-size: 15px; font-weight: bold; color: {COLOR_MUTED};")

    val_lbl = QLabel(initial_value, tile)
    val_lbl.setWordWrap(True)
    val_lbl.setStyleSheet(f"font-size: {value_px}px; font-weight: bold; color: {COLOR_INK};")

    layout.addWidget(title_lbl)
    layout.addWidget(val_lbl)
    return tile, val_lbl


def _create_action_pill(
    object_name: str,
    key_text: str,
    title_text: str,
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
    row.setContentsMargins(12, 6, 14, 6)
    row.setSpacing(10)

    badge = QLabel(key_text, frame)
    badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
    badge.setFixedSize(42, 42)
    badge.setStyleSheet(
        f"background-color: {badge_bg}; color: {badge_fg}; "
        "font-size: 22px; font-weight: bold; border-radius: 10px;"
    )

    label = QLabel(title_text, frame)
    label.setStyleSheet(f"font-size: 22px; font-weight: bold; color: {fg_color};")

    row.addWidget(badge)
    row.addWidget(label)
    row.addStretch()
    return frame


class IdleScreen(QWidget):
    """Home screen providing high-contrast telemetry, camera feed, and CTA triggers."""

    def __init__(
        self,
        parent: QWidget | None = None,
        on_open_settings: Callable[[], None] | None = None,
        on_minimize: Callable[[], None] | None = None,
        on_toggle_fullscreen: Callable[[], None] | None = None,
        on_quit: Callable[[], None] | None = None,
    ) -> None:
        super().__init__(parent)
        self._on_open_settings = on_open_settings
        self._on_minimize = on_minimize
        self._on_toggle_fullscreen = on_toggle_fullscreen
        self._on_quit = on_quit
        self._f_status_text = "F: รอเชื่อมต่อ"
        self._d_status_text = "D: รอเชื่อมต่อ"
        self._init_ui()

    def _init_ui(self) -> None:
        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(12, 10, 12, 10)
        root_layout.setSpacing(8)

        # 1. Top Header Bar (Brand + Connectivity Pills + Window Controls)
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

        self.pill_node_f = QLabel("● F: Wait", self)
        self.pill_node_f.setStyleSheet(pill_style(COLOR_WAIT_BG, COLOR_WAIT_FG, font_px=PILL_PX))
        self.pill_ble = self.pill_node_f

        self.pill_node_d = QLabel("● D: Wait", self)
        self.pill_node_d.setStyleSheet(pill_style(COLOR_WAIT_BG, COLOR_WAIT_FG, font_px=PILL_PX))

        self.pill_door = QLabel("Door: Closed", self)
        self.pill_door.setStyleSheet(pill_style(COLOR_FRESH, COLOR_ON_FRESH, font_px=PILL_PX))

        self.btn_settings = _create_header_button(
            "ตั้งค่า",
            COLOR_SURFACE,
            COLOR_SURFACE_2,
            COLOR_INK,
            COLOR_RULE,
            self,
            self._on_open_settings,
            min_width=64,
        )
        self.btn_minimize = _create_header_button(
            "_", COLOR_SURFACE, COLOR_SURFACE_2, COLOR_INK, COLOR_RULE, self, self._on_minimize
        )
        self.btn_fullscreen = _create_header_button(
            "□",
            COLOR_SURFACE,
            COLOR_SURFACE_2,
            COLOR_INK,
            COLOR_RULE,
            self,
            self._on_toggle_fullscreen,
        )
        self.btn_quit = _create_header_button(
            "✕", COLOR_BAD, "#B91C1C", COLOR_ON_BAD, COLOR_BAD, self, self._on_quit
        )

        header.addWidget(brand_dot)
        header.addWidget(title)
        header.addStretch()
        header.addWidget(self.pill_wifi)
        header.addWidget(self.pill_node_f)
        header.addWidget(self.pill_node_d)
        header.addWidget(self.pill_door)
        header.addWidget(self.btn_settings)
        header.addWidget(self.btn_minimize)
        header.addWidget(self.btn_fullscreen)
        header.addWidget(self.btn_quit)
        root_layout.addLayout(header)

        # 2. Main Split Content: Left Camera Card | Right Status Card
        content_layout = QHBoxLayout()
        content_layout.setSpacing(10)

        cam_card = QFrame(self)
        cam_card.setObjectName("CamCard")
        cam_card.setStyleSheet(
            card_style("CamCard", bg=COLOR_SURFACE, border=COLOR_RULE, radius=16)
        )
        cam_card_layout = QVBoxLayout(cam_card)
        cam_card_layout.setContentsMargins(10, 10, 10, 10)
        cam_card_layout.setSpacing(6)

        self.camera_frame = QFrame(cam_card)
        self.camera_frame.setObjectName("CameraFrame")
        self.camera_frame.setMinimumSize(340, 215)
        self.camera_frame.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self.camera_frame.setStyleSheet(
            f"#CameraFrame {{ background-color: {COLOR_DARK}; "
            f"border: 1.5px solid {COLOR_RULE}; border-radius: 12px; }}"
        )
        cam_inner = QVBoxLayout(self.camera_frame)
        cam_inner.setContentsMargins(4, 4, 4, 4)

        self.camera_label = QLabel("รอสัญญาณกล้อง...", self.camera_frame)
        self.camera_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.camera_label.setStyleSheet(
            f"color: {COLOR_ON_DARK_2}; font-size: 16px; font-weight: bold;"
        )
        cam_inner.addWidget(self.camera_label)
        cam_card_layout.addWidget(self.camera_frame)

        # Right Status Card
        diag_card = QFrame(self)
        diag_card.setObjectName("DiagCard")
        diag_card.setStyleSheet(
            card_style("DiagCard", bg=COLOR_SURFACE, border=COLOR_RULE, radius=16)
        )
        diag_layout = QVBoxLayout(diag_card)
        diag_layout.setContentsMargins(10, 10, 10, 10)
        diag_layout.setSpacing(8)

        grid = QGridLayout()
        grid.setSpacing(8)

        temp_tile, self.temp_label = _create_metric_tile(
            "TileTemp", "อุณหภูมิ", "--.- °C", 28, diag_card
        )
        voc_tile, self.voc_label = _create_metric_tile(
            "TileVoc", "อากาศ (VOC)", "--", 26, diag_card
        )
        door_tile, self.door_label = _create_metric_tile("TileDoor", "ประตู", "ปิดสนิท", 21, diag_card)
        nodes_tile, self.nodes_label = _create_metric_tile(
            "TileNodes", "โหนด F / D", "F: รอ\nD: รอ", 16, diag_card
        )

        grid.addWidget(temp_tile, 0, 0)
        grid.addWidget(voc_tile, 0, 1)
        grid.addWidget(door_tile, 1, 0)
        grid.addWidget(nodes_tile, 1, 1)
        diag_layout.addLayout(grid)

        # PIR Motion Status Row
        motion_tile = QFrame(diag_card)
        motion_tile.setObjectName("TileMotion")
        motion_tile.setStyleSheet(
            card_style("TileMotion", bg=COLOR_SURFACE_2, border=COLOR_RULE, radius=12)
        )
        motion_col = QVBoxLayout(motion_tile)
        motion_col.setContentsMargins(12, 6, 12, 8)
        motion_col.setSpacing(0)

        motion_top = QHBoxLayout()
        motion_title = QLabel("PIR", motion_tile)
        motion_title.setStyleSheet(f"font-size: 15px; font-weight: bold; color: {COLOR_MUTED};")
        self.pill_motion = QLabel("PIR: --", motion_tile)
        self.pill_motion.setStyleSheet(pill_style(COLOR_WAIT_BG, COLOR_WAIT_FG, font_px=PILL_PX))
        motion_top.addWidget(motion_title)
        motion_top.addStretch()
        motion_top.addWidget(self.pill_motion)

        self.motion_label = QLabel("รอสัญญาณ PIR", motion_tile)
        self.motion_label.setStyleSheet(f"font-size: 19px; font-weight: bold; color: {COLOR_INK};")
        motion_col.addLayout(motion_top)
        motion_col.addWidget(self.motion_label)
        diag_layout.addWidget(motion_tile)

        # YOLO Person Detection Row
        person_tile = QFrame(diag_card)
        person_tile.setObjectName("TilePerson")
        person_tile.setStyleSheet(
            card_style("TilePerson", bg=COLOR_SURFACE_2, border=COLOR_RULE, radius=12)
        )
        person_col = QVBoxLayout(person_tile)
        person_col.setContentsMargins(12, 6, 12, 8)
        person_col.setSpacing(0)

        person_top = QHBoxLayout()
        person_title = QLabel("YOLO", person_tile)
        person_title.setStyleSheet(f"font-size: 15px; font-weight: bold; color: {COLOR_MUTED};")
        self.pill_person = QLabel("Clear", person_tile)
        self.pill_person.setStyleSheet(pill_style(COLOR_WAIT_BG, COLOR_WAIT_FG, font_px=PILL_PX))
        person_top.addWidget(person_title)
        person_top.addStretch()
        person_top.addWidget(self.pill_person)

        self.person_label = QLabel("ไม่พบคน", person_tile)
        self.person_label.setStyleSheet(f"font-size: 19px; font-weight: bold; color: {COLOR_INK};")
        person_col.addLayout(person_top)
        person_col.addWidget(self.person_label)
        diag_layout.addWidget(person_tile)

        diag_layout.addStretch()

        content_layout.addWidget(cam_card, stretch=10)
        content_layout.addWidget(diag_card, stretch=11)
        root_layout.addLayout(content_layout, stretch=1)

        # 3. Bottom Action CTA Bar
        action_bar = QHBoxLayout()
        action_bar.setSpacing(10)

        checkin_pill = _create_action_pill(
            "BtnCheckInGuide",
            "O",
            "นำเข้าอาหาร (Check-In)",
            COLOR_DARK,
            COLOR_ON_DARK,
            COLOR_LIME,
            COLOR_LIME_INK,
            self,
        )
        checkout_pill = _create_action_pill(
            "BtnCheckOutGuide",
            "X",
            "นำออกอาหาร (Check-Out)",
            COLOR_TAKE_SOLID,
            COLOR_ON_TAKE,
            COLOR_SURFACE,
            COLOR_TAKE_SOLID,
            self,
        )
        action_bar.addWidget(checkin_pill, stretch=1)
        action_bar.addWidget(checkout_pill, stretch=1)
        root_layout.addLayout(action_bar)

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
        target_w = max(self.camera_frame.width() - 8, 320)
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
            status = "ปกติ" if temp_c <= 4.0 else ("อุ่น" if temp_c <= 8.0 else "ร้อน!")
            color = COLOR_FRESH if temp_c <= 4.0 else ("#B45309" if temp_c <= 8.0 else COLOR_BAD)
            self.temp_label.setText(f"{temp_c:.1f} °C · {status}")
            self.temp_label.setStyleSheet(f"font-size: 28px; font-weight: bold; color: {color};")

        if voc is not None:
            voc_desc = "สะอาด" if voc <= 150 else ("มีกลิ่น" if voc <= 250 else "กลิ่นแรง")
            voc_color = COLOR_FRESH if voc <= 150 else ("#B45309" if voc <= 250 else COLOR_BAD)
            self.voc_label.setText(f"{voc} · {voc_desc}")
            self.voc_label.setStyleSheet(f"font-size: 26px; font-weight: bold; color: {voc_color};")

        if light is not None:
            if light >= 100:
                self.door_label.setText("เปิด (Open)")
                self.door_label.setStyleSheet("font-size: 21px; font-weight: bold; color: #B45309;")
            else:
                self.door_label.setText("ปิดสนิท")
                self.door_label.setStyleSheet(
                    f"font-size: 21px; font-weight: bold; color: {COLOR_FRESH};"
                )

    def update_door_state(self, is_open: bool, ajar_duration_s: float = 0.0) -> None:
        """Updates top door pill badge."""
        if is_open:
            is_overdue = ajar_duration_s >= 15.0
            bg = COLOR_BAD if is_overdue else COLOR_SOON
            fg = COLOR_ON_BAD if is_overdue else COLOR_ON_SOON
            self.pill_door.setText(f"Door: Open ({int(ajar_duration_s)}s)")
            self.pill_door.setStyleSheet(pill_style(bg, fg, font_px=PILL_PX))
        else:
            self.pill_door.setText("Door: Closed")
            self.pill_door.setStyleSheet(pill_style(COLOR_FRESH, COLOR_ON_FRESH, font_px=PILL_PX))

    def update_wifi_status(self, is_online: bool) -> None:
        """Updates top Wi-Fi connectivity badge."""
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
        pill_text, detail_text, bg_hex, fg_hex = format_node_badge(
            node_id,
            age_s,
            is_connected=is_connected,
            is_offline=is_offline,
        )
        badge_css = pill_style(bg_hex, fg_hex, font_px=PILL_PX)
        if node_id.startswith("F"):
            self.pill_node_f.setText(pill_text)
            self.pill_node_f.setStyleSheet(badge_css)
            self._f_status_text = detail_text
        elif node_id.startswith("D"):
            self.pill_node_d.setText(pill_text)
            self.pill_node_d.setStyleSheet(badge_css)
            self._d_status_text = detail_text
        self.nodes_label.setText(f"{self._f_status_text}\n{self._d_status_text}")

    def update_motion_state(
        self,
        has_motion: bool,
        idle_duration_s: float = 0.0,
        hw_status: str = "",
    ) -> None:
        """Updates PIR motion sensor badge and concise status label."""
        hw_suffix = f" ({hw_status})" if hw_status else ""
        if has_motion:
            self.pill_motion.setText(f"DETECTED{hw_suffix}")
            self.pill_motion.setStyleSheet(pill_style(COLOR_FRESH, COLOR_ON_FRESH, font_px=PILL_PX))
            self.motion_label.setText(f"พบการเคลื่อนไหว{hw_suffix}")
            self.motion_label.setStyleSheet(
                f"font-size: 19px; font-weight: bold; color: {COLOR_FRESH};"
            )
            return

        secs = max(0, int(idle_duration_s))
        if secs < 60:
            self.pill_motion.setText(f"นิ่ง {secs}s{hw_suffix}")
            self.motion_label.setText(f"นิ่ง {secs} วินาที{hw_suffix}")
        else:
            mins, rem = divmod(secs, 60)
            self.pill_motion.setText(f"{mins}m {rem}s{hw_suffix}")
            self.motion_label.setText(f"นิ่ง {mins} นาที {rem} วินาที{hw_suffix}")
        self.pill_motion.setStyleSheet(pill_style(COLOR_WAIT_BG, COLOR_WAIT_FG, font_px=PILL_PX))
        self.motion_label.setStyleSheet(f"font-size: 19px; font-weight: bold; color: {COLOR_INK};")

    def update_person_state(
        self,
        is_person: bool,
        confidence: float = 0.0,
        person_count: int = 0,
    ) -> None:
        """Updates YOLO person detection badge and concise status label."""
        if is_person:
            pct = round(max(0.0, min(1.0, confidence)) * 100)
            count = max(1, person_count)
            self.pill_person.setText(f"Person {pct}%")
            self.pill_person.setStyleSheet(pill_style(COLOR_SOON, COLOR_ON_SOON, font_px=PILL_PX))
            self.person_label.setText(f"พบคน {count} คน ({pct}%)")
            self.person_label.setStyleSheet("font-size: 19px; font-weight: bold; color: #B45309;")
            return

        self.pill_person.setText("Clear")
        self.pill_person.setStyleSheet(pill_style(COLOR_WAIT_BG, COLOR_WAIT_FG, font_px=PILL_PX))
        self.person_label.setText("ไม่พบคน")
        self.person_label.setStyleSheet(f"font-size: 19px; font-weight: bold; color: {COLOR_INK};")
