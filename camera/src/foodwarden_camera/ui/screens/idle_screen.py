"""Idle / Home Screen for FoodWarden 5-inch LCD (800x480).

Displays live system diagnostics, webcam preview, fridge temperature/VOC status,
and prominent bilingual action prompts for [O] Check-In and [X] Check-Out.
"""

from __future__ import annotations

import numpy as np
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QImage, QPixmap
from PyQt6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QVBoxLayout,
    QWidget,
)


class IdleScreen(QWidget):
    """Home screen providing continuous system status and workflow triggers."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._init_ui()

    def _init_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(16, 12, 16, 12)
        main_layout.setSpacing(10)

        # 1. Header Bar with System Status Pills
        header_layout = QHBoxLayout()
        title_box = QVBoxLayout()
        title_th = QLabel("FoodWarden — ตู้เย็นอัจฉริยะ", self)
        title_th.setStyleSheet("font-size: 18px; font-weight: bold; color: #FFFFFF;")
        title_en = QLabel("Smart Refrigerator System", self)
        title_en.setStyleSheet("font-size: 11px; color: #9CA3AF;")
        title_box.addWidget(title_th)
        title_box.addWidget(title_en)
        header_layout.addLayout(title_box)

        header_layout.addStretch()

        # Status pills
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

        header_layout.addWidget(self.pill_wifi)
        header_layout.addWidget(self.pill_ble)
        header_layout.addWidget(self.pill_door)
        main_layout.addLayout(header_layout)

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
