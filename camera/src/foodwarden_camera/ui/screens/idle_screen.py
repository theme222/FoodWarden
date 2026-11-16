"""Idle / Home Screen for FoodWarden 5-inch LCD (800x480).

Displays live system diagnostics, webcam preview, fridge temperature/VOC status,
and prominent bilingual action prompts for [O] Check-In and [X] Check-Out.
"""

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
    QVBoxLayout,
    QWidget,
)


def _create_header_button(
    text: str,
    bg_color: str,
    hover_color: str,
    parent: QWidget,
    callback: Callable[[], None] | None,
) -> QPushButton:
    """Builds a mouse-only header button that ignores keyboard/button focus."""
    btn = QPushButton(text, parent)
    btn.setFocusPolicy(Qt.FocusPolicy.NoFocus)
    btn.setCursor(Qt.CursorShape.PointingHandCursor)
    btn.setStyleSheet(
        f"""
        QPushButton {{
            background-color: {bg_color};
            color: #FFFFFF;
            font-size: 11px;
            font-weight: bold;
            padding: 5px 9px;
            border-radius: 5px;
            border: 1px solid #374151;
        }}
        QPushButton:hover {{
            background-color: {hover_color};
        }}
        """
    )
    if callback is not None:
        btn.clicked.connect(callback)
    return btn


class IdleScreen(QWidget):
    """Home screen providing continuous system status and workflow triggers."""

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
        self._init_ui()

    def _init_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(16, 10, 16, 10)
        main_layout.setSpacing(8)

        # 1. Header Bar with Title & Mouse Window/Settings Controls
        header_layout = QHBoxLayout()
        header_layout.setSpacing(6)
        title_box = QVBoxLayout()
        title_th = QLabel("FoodWarden — ตู้เย็นอัจฉริยะ", self)
        title_th.setStyleSheet("font-size: 18px; font-weight: bold; color: #FFFFFF;")
        title_en = QLabel("Smart Refrigerator System", self)
        title_en.setStyleSheet("font-size: 11px; color: #9CA3AF;")
        title_box.addWidget(title_th)
        title_box.addWidget(title_en)
        header_layout.addLayout(title_box)

        header_layout.addStretch()

        self.btn_settings = _create_header_button(
            "⚙ ตั้งค่า / Settings",
            "#1F2937",
            "#374151",
            self,
            self._on_open_settings,
        )
        self.btn_minimize = _create_header_button(
            "🗕 ย่อ / Min",
            "#1F2937",
            "#374151",
            self,
            self._on_minimize,
        )
        self.btn_fullscreen = _create_header_button(
            "❐ จอ / Win",
            "#1F2937",
            "#374151",
            self,
            self._on_toggle_fullscreen,
        )
        self.btn_quit = _create_header_button(
            "✕ ออก / Quit",
            "#7F1D1D",
            "#991B1B",
            self,
            self._on_quit,
        )

        header_layout.addWidget(self.btn_settings)
        header_layout.addWidget(self.btn_minimize)
        header_layout.addWidget(self.btn_fullscreen)
        header_layout.addWidget(self.btn_quit)
        main_layout.addLayout(header_layout)

        # 1b. System Status Pills Row
        status_layout = QHBoxLayout()
        status_layout.setSpacing(8)

        self.pill_wifi = QLabel("Wi-Fi: OK", self)
        self.pill_wifi.setStyleSheet(
            "background-color: #064E3B; color: #34D399; font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px;"
        )
        self.pill_ble = QLabel("Sensor: F0", self)
        self.pill_ble.setStyleSheet(
            "background-color: #064E3B; color: #34D399; font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px;"
        )
        self.pill_door = QLabel("Door: Closed", self)
        self.pill_door.setStyleSheet(
            "background-color: #1E3A8A; color: #60A5FA; font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px;"
        )
        self.pill_motion = QLabel("Motion: None (0s)", self)
        self.pill_motion.setStyleSheet(
            "background-color: #1F2937; color: #9CA3AF; font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px;"
        )
        self.pill_person = QLabel("YOLO: Wait", self)
        self.pill_person.setStyleSheet(
            "background-color: #1F2937; color: #9CA3AF; font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px;"
        )

        status_layout.addWidget(self.pill_wifi)
        status_layout.addWidget(self.pill_ble)
        status_layout.addWidget(self.pill_door)
        status_layout.addWidget(self.pill_motion)
        status_layout.addWidget(self.pill_person)
        status_layout.addStretch()
        main_layout.addLayout(status_layout)

        # 2. Middle Section (Webcam Viewfinder + Sensor Cards)
        mid_layout = QHBoxLayout()
        mid_layout.setSpacing(12)

        # Camera preview frame (400x240)
        self.camera_frame = QFrame(self)
        self.camera_frame.setStyleSheet(
            "background-color: #000000; border: 1px solid #333333; border-radius: 6px;"
        )
        self.camera_frame.setFixedSize(380, 240)
        cam_inner = QVBoxLayout(self.camera_frame)
        cam_inner.setContentsMargins(0, 0, 0, 0)

        self.camera_label = QLabel(self.camera_frame)
        self.camera_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.camera_label.setText("กำลังเชื่อมต่อกล้อง...\nConnecting camera...")
        self.camera_label.setStyleSheet("color: #6B7280; font-size: 13px;")
        cam_inner.addWidget(self.camera_label)
        mid_layout.addWidget(self.camera_frame)

        # Diagnostics Card (Right side)
        diag_card = QFrame(self)
        diag_card.setStyleSheet(
            "background-color: #1E1E1E; border: 1px solid #2D2D2D; border-radius: 6px;"
        )
        diag_layout = QVBoxLayout(diag_card)
        diag_layout.setContentsMargins(14, 12, 14, 12)
        diag_layout.setSpacing(8)

        # Temperature
        diag_title = QLabel("สภาวะภายในตู้เย็น / Internal Climate", diag_card)
        diag_title.setStyleSheet("font-size: 13px; font-weight: bold; color: #9CA3AF;")
        diag_layout.addWidget(diag_title)

        self.temp_label = QLabel("อุณหภูมิ: 3.4 °C (ปกติ)", diag_card)
        self.temp_label.setStyleSheet("font-size: 16px; font-weight: bold; color: #10B981;")
        diag_layout.addWidget(self.temp_label)

        # VOC Air Quality
        self.voc_label = QLabel("คุณภาพอากาศ: 105 VOC (สะอาด)", diag_card)
        self.voc_label.setStyleSheet("font-size: 14px; color: #E5E7EB;")
        diag_layout.addWidget(self.voc_label)

        # Door state
        self.door_label = QLabel("สถานะประตู: ปิดสนิท (Closed)", diag_card)
        self.door_label.setStyleSheet("font-size: 14px; color: #E5E7EB;")
        diag_layout.addWidget(self.door_label)

        # Motion Sensor (PIR) debug state
        self.motion_label = QLabel(
            "ตรวจจับการเคลื่อนไหว: นิ่งมาแล้ว 0 วินาที (No Motion: 0s)",
            diag_card,
        )
        self.motion_label.setWordWrap(True)
        self.motion_label.setStyleSheet("font-size: 13px; color: #9CA3AF;")
        diag_layout.addWidget(self.motion_label)

        # YOLO Person Detection debug state
        self.person_label = QLabel(
            "ตรวจจับบุคคล (YOLO): กำลังรอตรวจ... (Waiting)",
            diag_card,
        )
        self.person_label.setWordWrap(True)
        self.person_label.setStyleSheet("font-size: 13px; color: #9CA3AF;")
        diag_layout.addWidget(self.person_label)

        diag_layout.addStretch()
        mid_layout.addWidget(diag_card)
        main_layout.addLayout(mid_layout)

        # 3. Bottom Action Guidance Prompts
        action_bar = QHBoxLayout()
        action_bar.setSpacing(16)

        # [O] Check-In Button Pill
        checkin_box = QHBoxLayout()
        pill_o = QLabel("[O]", self)
        pill_o.setStyleSheet(
            "background-color: #059669; color: white; font-weight: bold; font-size: 16px; padding: 6px 12px; border-radius: 6px;"
        )
        prompt_o_layout = QVBoxLayout()
        prompt_o_th = QLabel("นำอาหารเข้าตู้ (เช็คอิน)", self)
        prompt_o_th.setStyleSheet("font-size: 14px; font-weight: bold; color: #FFFFFF;")
        prompt_o_en = QLabel("Check-In Grocery Item", self)
        prompt_o_en.setStyleSheet("font-size: 11px; color: #9CA3AF;")
        prompt_o_layout.addWidget(prompt_o_th)
        prompt_o_layout.addWidget(prompt_o_en)
        checkin_box.addWidget(pill_o)
        checkin_box.addLayout(prompt_o_layout)
        action_bar.addLayout(checkin_box)

        action_bar.addStretch()

        # [X] Check-Out Button Pill
        checkout_box = QHBoxLayout()
        pill_x = QLabel("[X]", self)
        pill_x.setStyleSheet(
            "background-color: #DC2626; color: white; font-weight: bold; font-size: 16px; padding: 6px 12px; border-radius: 6px;"
        )
        prompt_x_layout = QVBoxLayout()
        prompt_x_th = QLabel("นำอาหารออกจากตู้ (เช็คเอาต์)", self)
        prompt_x_th.setStyleSheet("font-size: 14px; font-weight: bold; color: #FFFFFF;")
        prompt_x_en = QLabel("Check-Out (FEFO Removal)", self)
        prompt_x_en.setStyleSheet("font-size: 11px; color: #9CA3AF;")
        prompt_x_layout.addWidget(prompt_x_th)
        prompt_x_layout.addWidget(prompt_x_en)
        checkout_box.addWidget(pill_x)
        checkout_box.addLayout(prompt_x_layout)
        action_bar.addLayout(checkout_box)

        main_layout.addLayout(action_bar)

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
        pixmap = QPixmap.fromImage(qimg).scaled(
            self.camera_frame.width(),
            self.camera_frame.height(),
            Qt.AspectRatioMode.KeepAspectRatioByExpanding,
            Qt.TransformationMode.SmoothTransformation,
        )
        self.camera_label.setPixmap(pixmap)

    def update_telemetry(self, temp_c: float | None, voc: int | None, light: int | None) -> None:
        """Updates climate card values."""
        if temp_c is not None:
            status = "ปกติ" if temp_c <= 4.0 else ("เฝ้าระวัง" if temp_c <= 8.0 else "เสี่ยงเน่าเสีย")
            color = "#10B981" if temp_c <= 4.0 else ("#F59E0B" if temp_c <= 8.0 else "#EF4444")
            self.temp_label.setText(f"อุณหภูมิ: {temp_c:.1f} °C ({status})")
            self.temp_label.setStyleSheet(f"font-size: 16px; font-weight: bold; color: {color};")

        if voc is not None:
            voc_desc = "สะอาด" if voc <= 150 else ("มีกลิ่น" if voc <= 250 else "กลิ่นเน่ารุนแรง")
            self.voc_label.setText(f"คุณภาพอากาศ: {voc} VOC ({voc_desc})")

        if light is not None:
            if light >= 100:
                self.door_label.setText("สถานะประตู: เปิดอยู่ (Open)")
                self.door_label.setStyleSheet("font-size: 14px; color: #F59E0B;")
            else:
                self.door_label.setText("สถานะประตู: ปิดสนิท (Closed)")
                self.door_label.setStyleSheet("font-size: 14px; color: #10B981;")

    def update_door_state(self, is_open: bool, ajar_duration_s: float = 0.0) -> None:
        """Updates door pill and diagnostics card."""
        if is_open:
            self.pill_door.setText(f"Door: Open ({int(ajar_duration_s)}s)")
            self.pill_door.setStyleSheet(
                "background-color: #78350F; color: #FBBF24; font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px;"
            )
        else:
            self.pill_door.setText("Door: Closed")
            self.pill_door.setStyleSheet(
                "background-color: #1E3A8A; color: #60A5FA; font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px;"
            )

    def update_wifi_status(self, is_online: bool) -> None:
        if is_online:
            self.pill_wifi.setText("Wi-Fi: OK")
            self.pill_wifi.setStyleSheet(
                "background-color: #064E3B; color: #34D399; font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px;"
            )
        else:
            self.pill_wifi.setText("Wi-Fi: Offline")
            self.pill_wifi.setStyleSheet(
                "background-color: #7F1D1D; color: #FCA5A5; font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px;"
            )

    def update_motion_state(
        self,
        has_motion: bool,
        idle_duration_s: float = 0.0,
        hw_status: str = "",
    ) -> None:
        """Updates PIR motion sensor badge and debug status card."""
        hw_suffix = f" [{hw_status}]" if hw_status else ""
        if has_motion:
            self.pill_motion.setText(f"Motion: DETECTED{hw_suffix}")
            self.pill_motion.setStyleSheet(
                "background-color: #064E3B; color: #34D399; font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px;"
            )
            self.motion_label.setText(
                f"ตรวจจับการเคลื่อนไหว: พบการเคลื่อนไหว! (Motion Detected){hw_suffix}"
            )
            self.motion_label.setStyleSheet("font-size: 13px; font-weight: bold; color: #10B981;")
            return

        secs = max(0, int(idle_duration_s))
        if secs < 60:
            self.pill_motion.setText(f"Motion: None ({secs}s){hw_suffix}")
            self.motion_label.setText(
                f"ตรวจจับการเคลื่อนไหว: นิ่งมาแล้ว {secs} วินาที (No Motion: {secs}s){hw_suffix}"
            )
        else:
            mins, rem_s = divmod(secs, 60)
            self.pill_motion.setText(f"Motion: None ({mins}m {rem_s:02d}s){hw_suffix}")
            self.motion_label.setText(
                f"ตรวจจับการเคลื่อนไหว: นิ่งมาแล้ว {mins} นาที {rem_s} วินาที (No Motion: {secs}s){hw_suffix}"
            )

        pill_bg = "#78350F" if "Disabled" in hw_status or "Sim" in hw_status else "#1F2937"
        pill_fg = "#FBBF24" if "Disabled" in hw_status or "Sim" in hw_status else "#9CA3AF"
        self.pill_motion.setStyleSheet(
            f"background-color: {pill_bg}; color: {pill_fg}; font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px;"
        )
        self.motion_label.setStyleSheet(f"font-size: 13px; color: {pill_fg};")

    def update_person_state(
        self,
        is_person: bool,
        confidence: float = 0.0,
        person_count: int = 0,
    ) -> None:
        """Updates YOLO person detection badge and debug status label."""
        if is_person:
            pct = round(max(0.0, min(1.0, confidence)) * 100)
            count = max(1, person_count)
            self.pill_person.setText(f"YOLO: Person ({pct}%)")
            self.pill_person.setStyleSheet(
                "background-color: #78350F; color: #FBBF24; font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px;"
            )
            self.person_label.setText(f"ตรวจจับบุคคล (YOLO): พบคน! {count} คน (Person {pct}%)")
            self.person_label.setStyleSheet("font-size: 13px; font-weight: bold; color: #FBBF24;")
            return

        self.pill_person.setText("YOLO: Clear")
        self.pill_person.setStyleSheet(
            "background-color: #1F2937; color: #9CA3AF; font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px;"
        )
        self.person_label.setText("ตรวจจับบุคคล (YOLO): ไม่พบคน (No Person)")
        self.person_label.setStyleSheet("font-size: 13px; color: #9CA3AF;")
