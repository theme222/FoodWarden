"""Check-In Screen for FoodWarden 5-inch LCD (800x480).

Handles grocery item review, AI metadata presentation, date adjustment via
Up/Down buttons, and 5-second auto-confirmation countdown per GOAL.md §2.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta

from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtGui import QImage, QPixmap
from PyQt6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QVBoxLayout,
    QWidget,
)

from foodwarden_camera.models.cloud_cbs import CheckInDraftResult


class CheckInScreen(QWidget):
    """Bilingual Check-In workflow screen with interactive date editing."""

    def __init__(
        self,
        on_confirm_callback: Callable[[CheckInDraftResult, str], None],
        on_cancel_callback: Callable[[], None],
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.on_confirm = on_confirm_callback
        self.on_cancel = on_cancel_callback

        self._draft: CheckInDraftResult | None = None
        self._current_date = datetime.now() + timedelta(days=7)
        self._selected_segment = 0  # 0: Day, 1: Month, 2: Year
        self._countdown_seconds = 5

        self._countdown_timer = QTimer(self)
        self._countdown_timer.timeout.connect(self._tick_countdown)

        self._init_ui()

    def _init_ui(self) -> None:
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(16, 12, 16, 12)
        main_layout.setSpacing(10)

        # 1. Header Bar
        header = QHBoxLayout()
        header_title = QVBoxLayout()
        title_th = QLabel("ตรวจรับอาหารเข้าตู้ (Check-In)", self)
        title_th.setStyleSheet("font-size: 18px; font-weight: bold; color: #FFFFFF;")
        title_en = QLabel("Review Item & Expiry Date", self)
        title_en.setStyleSheet("font-size: 11px; color: #9CA3AF;")
        header_title.addWidget(title_th)
        header_title.addWidget(title_en)
        header.addLayout(header_title)

        header.addStretch()

        self.countdown_label = QLabel("ยืนยันอัตโนมัติใน: 5 วินาที (Auto: 5s)", self)
        self.countdown_label.setStyleSheet(
            "font-size: 13px; font-weight: bold; color: #F59E0B; background-color: #2D2310; padding: 4px 10px; border-radius: 4px; border: 1px solid #78350F;"
        )
        header.addWidget(self.countdown_label)
        main_layout.addLayout(header)

        # 2. Main Content (Captured Image on Left + Item Details on Right)
        content_layout = QHBoxLayout()
        content_layout.setSpacing(16)

        # Left: Captured / Cropped Image Frame
        self.img_frame = QFrame(self)
        self.img_frame.setStyleSheet(
            "background-color: #000000; border: 1px solid #333333; border-radius: 6px;"
        )
        self.img_frame.setFixedSize(300, 240)
        img_inner = QVBoxLayout(self.img_frame)
        img_inner.setContentsMargins(0, 0, 0, 0)
        self.image_label = QLabel(self.img_frame)
        self.image_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        img_inner.addWidget(self.image_label)
        content_layout.addWidget(self.img_frame)

        # Right: AI Metadata & Date Adjustment Card
        self.card = QFrame(self)
        self.card.setStyleSheet(
            "background-color: #1E1E1E; border: 1px solid #2D2D2D; border-radius: 6px;"
        )
        card_layout = QVBoxLayout(self.card)
        card_layout.setContentsMargins(16, 12, 16, 12)
        card_layout.setSpacing(6)

        self.name_th = QLabel("กำลังประมวลผลอาหาร...", self.card)
        self.name_th.setStyleSheet("font-size: 20px; font-weight: bold; color: #10B981;")
        self.name_en = QLabel("Analyzing grocery item...", self.card)
        self.name_en.setStyleSheet("font-size: 14px; color: #D1D5DB;")
        card_layout.addWidget(self.name_th)
        card_layout.addWidget(self.name_en)

        self.category_label = QLabel("หมวดหมู่: นมและผลิตภัณฑ์นม (Dairy)", self.card)
        self.category_label.setStyleSheet("font-size: 13px; color: #9CA3AF;")
        card_layout.addWidget(self.category_label)

        self.storage_label = QLabel("คำแนะนำ: เก็บในช่องแช่เย็นหลัก อุณหภูมิ 0-4°C", self.card)
        self.storage_label.setStyleSheet("font-size: 12px; color: #9CA3AF;")
        card_layout.addWidget(self.storage_label)

        card_layout.addSpacing(6)

        # Date Editor Segment
        date_title = QLabel("วันหมดอายุ (Expiry Date) — ปรับด้วย [▲/▼]:", self.card)
        date_title.setStyleSheet("font-size: 12px; font-weight: bold; color: #60A5FA;")
        card_layout.addWidget(date_title)

        date_editor_box = QHBoxLayout()
        date_editor_box.setSpacing(6)

        self.day_label = QLabel("01", self.card)
        self.month_label = QLabel("01", self.card)
        self.year_label = QLabel("2026", self.card)

        for lbl in (self.day_label, self.month_label, self.year_label):
            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            lbl.setFixedSize(64, 34)

        slash1 = QLabel("/", self.card)
        slash1.setStyleSheet("font-size: 18px; color: #6B7280;")
        slash2 = QLabel("/", self.card)
        slash2.setStyleSheet("font-size: 18px; color: #6B7280;")

        date_editor_box.addWidget(self.day_label)
        date_editor_box.addWidget(slash1)
        date_editor_box.addWidget(self.month_label)
        date_editor_box.addWidget(slash2)
        date_editor_box.addWidget(self.year_label)
        date_editor_box.addStretch()

        card_layout.addLayout(date_editor_box)
        card_layout.addStretch()
        content_layout.addWidget(self.card)

        main_layout.addLayout(content_layout)

        # 3. Bottom Action Hints
        action_layout = QHBoxLayout()
        action_layout.setSpacing(12)

        pill_o = QLabel("[O] ยืนยัน / เลื่อนวัน (Confirm / Next)", self)
        pill_o.setStyleSheet(
            "background-color: #059669; color: white; font-weight: bold; font-size: 13px; padding: 6px 12px; border-radius: 6px;"
        )
        action_layout.addWidget(pill_o)

        pill_arrows = QLabel("[▲/▼] ปรับวัน (Adjust Date)", self)
        pill_arrows.setStyleSheet(
            "background-color: #2563EB; color: white; font-weight: bold; font-size: 13px; padding: 6px 12px; border-radius: 6px;"
        )
        action_layout.addWidget(pill_arrows)

        action_layout.addStretch()

        pill_x = QLabel("[X] ยกเลิก (Cancel)", self)
        pill_x.setStyleSheet(
            "background-color: #DC2626; color: white; font-weight: bold; font-size: 13px; padding: 6px 12px; border-radius: 6px;"
        )
        action_layout.addWidget(pill_x)

        main_layout.addLayout(action_layout)

    # ==========================================================================
    # State & Workflow Controls
    # ==========================================================================

    def load_draft(self, draft: CheckInDraftResult, image_bytes: bytes) -> None:
        """Loads AI metadata and starts auto-confirm countdown."""
        self._draft = draft

        # Load image
        qimg = QImage.fromData(image_bytes)
        if not qimg.isNull():
            pixmap = QPixmap.fromImage(qimg).scaled(
                self.img_frame.width(),
                self.img_frame.height(),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            self.image_label.setPixmap(pixmap)

        # Populate labels
        self.name_th.setText(draft.name_th)
        self.name_en.setText(f"{draft.name_en} ({draft.confidence * 100:.0f}%)")
        self.category_label.setText(f"หมวดหมู่: {draft.category_th} ({draft.category})")
        self.storage_label.setText(f"คำแนะนำ: {draft.storage_recommendation_th}")

        # Parse suggested date YYYY-MM-DD
        try:
            self._current_date = datetime.strptime(draft.estimated_expiry_date, "%Y-%m-%d")
        except ValueError:
            self._current_date = datetime.now() + timedelta(days=draft.estimated_shelf_life_days)

        self._selected_segment = 0
        self._refresh_date_display()

        # Start 5s countdown
        self._countdown_seconds = 5
        self.countdown_label.setText("ยืนยันอัตโนมัติใน: 5 วินาที (Auto: 5s)")
        self._countdown_timer.start(1000)

    def _refresh_date_display(self) -> None:
        """Renders day/month/year segments with visual highlight on active segment."""
        self.day_label.setText(f"{self._current_date.day:02d}")
        self.month_label.setText(f"{self._current_date.month:02d}")
        self.year_label.setText(f"{self._current_date.year:04d}")

        active_style = "font-size: 18px; font-weight: bold; color: #FFFFFF; background-color: #1E3A8A; border: 2px solid #3B82F6; border-radius: 4px;"
        inactive_style = "font-size: 18px; font-weight: bold; color: #D1D5DB; background-color: #262626; border: 1px solid #3D3D3D; border-radius: 4px;"

        self.day_label.setStyleSheet(
            active_style if self._selected_segment == 0 else inactive_style
        )
        self.month_label.setStyleSheet(
            active_style if self._selected_segment == 1 else inactive_style
        )
        self.year_label.setStyleSheet(
            active_style if self._selected_segment == 2 else inactive_style
        )

    def handle_up(self) -> None:
        """Increments highlighted date segment."""
        self._countdown_seconds = 5  # Reset countdown on user adjustment
        if self._selected_segment == 0:
            self._current_date += timedelta(days=1)
        elif self._selected_segment == 1:
            month = 1 if self._current_date.month == 12 else self._current_date.month + 1
            year = (
                self._current_date.year + 1
                if self._current_date.month == 12
                else self._current_date.year
            )
            day = min(self._current_date.day, 28)
            self._current_date = self._current_date.replace(year=year, month=month, day=day)
        elif self._selected_segment == 2:
            self._current_date = self._current_date.replace(year=self._current_date.year + 1)
        self._refresh_date_display()

    def handle_down(self) -> None:
        """Decrements highlighted date segment."""
        self._countdown_seconds = 5
        if self._selected_segment == 0:
            self._current_date = max(datetime.now(), self._current_date - timedelta(days=1))
        elif self._selected_segment == 1:
            month = 12 if self._current_date.month == 1 else self._current_date.month - 1
            year = (
                self._current_date.year - 1
                if self._current_date.month == 1
                else self._current_date.year
            )
            day = min(self._current_date.day, 28)
            self._current_date = self._current_date.replace(year=year, month=month, day=day)
        elif self._selected_segment == 2:
            self._current_date = max(
                datetime.now(), self._current_date.replace(year=self._current_date.year - 1)
            )
        self._refresh_date_display()

    def handle_select(self) -> None:
        """Advances date segment or commits on final segment."""
        if self._selected_segment < 2:
            self._selected_segment += 1
            self._countdown_seconds = 5
            self._refresh_date_display()
        else:
            self._commit()

    def handle_cancel(self) -> None:
        """Cancels check-in without committing."""
        self._countdown_timer.stop()
        self.on_cancel()

    def _tick_countdown(self) -> None:
        self._countdown_seconds -= 1
        if self._countdown_seconds <= 0:
            self._countdown_timer.stop()
            self._commit()
        else:
            self.countdown_label.setText(
                f"ยืนยันอัตโนมัติใน: {self._countdown_seconds} วินาที (Auto: {self._countdown_seconds}s)"
            )

    def _commit(self) -> None:
        self._countdown_timer.stop()
        if self._draft is not None:
            formatted_date = self._current_date.strftime("%Y-%m-%d")
            self.on_confirm(self._draft, formatted_date)
