"""Check-Out (FEFO Removal) Screen for FoodWarden 5-inch LCD (800x480).

Displays matching inventory candidate items sorted by FEFO (First Expired, First Out),
allowing item selection via Up/Down buttons and 5-second auto-confirmation per GOAL.md §2.
"""

from __future__ import annotations

from collections.abc import Callable

from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtGui import QImage, QPixmap
from PyQt6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QVBoxLayout,
    QWidget,
)

from foodwarden_camera.models.cloud_cbs import CheckOutCandidate


class CheckOutScreen(QWidget):
    """Bilingual Check-Out workflow screen with FEFO candidate selection."""

    def __init__(
        self,
        on_confirm_callback: Callable[[CheckOutCandidate], None],
        on_cancel_callback: Callable[[], None],
        autocomplete_timeout_s: int = 5,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.on_confirm = on_confirm_callback
        self.on_cancel = on_cancel_callback
        self.autocomplete_timeout_s = max(1, autocomplete_timeout_s)

        self._candidates: list[CheckOutCandidate] = []
        self._is_loading: bool = False
        self._countdown_seconds = self.autocomplete_timeout_s

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
        title_th = QLabel("นำอาหารออกจากตู้ (Check-Out)", self)
        title_th.setStyleSheet("font-size: 18px; font-weight: bold; color: #FFFFFF;")
        title_en = QLabel("FEFO Removal Selection", self)
        title_en.setStyleSheet("font-size: 11px; color: #9CA3AF;")
        header_title.addWidget(title_th)
        header_title.addWidget(title_en)
        header.addLayout(header_title)

        header.addStretch()

        self.countdown_label = QLabel(
            f"ยืนยันอัตโนมัติใน: {self.autocomplete_timeout_s} วินาที (Auto: {self.autocomplete_timeout_s}s)",
            self,
        )
        self.countdown_label.setStyleSheet(
            "font-size: 13px; font-weight: bold; color: #F59E0B; background-color: #2D2310; padding: 4px 10px; border-radius: 4px; border: 1px solid #78350F;"
        )
        header.addWidget(self.countdown_label)
        main_layout.addLayout(header)

        # 2. Content: Captured Photo on Left + Candidate Selection List on Right
        content_layout = QHBoxLayout()
        content_layout.setSpacing(12)

        self.img_frame = QFrame(self)
        self.img_frame.setStyleSheet(
            "background-color: #000000; border: 1px solid #333333; border-radius: 6px;"
        )
        self.img_frame.setFixedSize(220, 240)
        img_inner = QVBoxLayout(self.img_frame)
        img_inner.setContentsMargins(0, 0, 0, 0)
        self.image_label = QLabel("กำลังเตรียมภาพ...", self.img_frame)
        self.image_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.image_label.setStyleSheet("color: #6B7280; font-size: 12px;")
        img_inner.addWidget(self.image_label)
        content_layout.addWidget(self.img_frame)

        list_container = QFrame(self)
        list_container.setStyleSheet(
            "background-color: #1E1E1E; border: 1px solid #2D2D2D; border-radius: 6px;"
        )
        list_layout = QVBoxLayout(list_container)
        list_layout.setContentsMargins(12, 10, 12, 10)
        list_layout.setSpacing(6)

        self.hint_label = QLabel("เลือกรายการที่ต้องการนำออก (เรียงตามวันหมดอายุ FEFO):", list_container)
        self.hint_label.setStyleSheet("font-size: 13px; font-weight: bold; color: #9CA3AF;")
        list_layout.addWidget(self.hint_label)

        self.list_widget = QListWidget(list_container)
        self.list_widget.setWordWrap(True)
        self.list_widget.setFixedHeight(210)
        list_layout.addWidget(self.list_widget)

        content_layout.addWidget(list_container, stretch=1)
        main_layout.addLayout(content_layout)

        # 3. Bottom Action Hints
        action_layout = QHBoxLayout()
        action_layout.setSpacing(12)

        pill_o = QLabel("[O] ยืนยันนำออก (Confirm Removal)", self)
        pill_o.setStyleSheet(
            "background-color: #059669; color: white; font-weight: bold; font-size: 13px; padding: 6px 12px; border-radius: 6px;"
        )
        action_layout.addWidget(pill_o)

        pill_arrows = QLabel("[▲/▼] เลือกรายการ (Select Item)", self)
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
    # State & Candidate List Management
    # ==========================================================================

    def set_autocomplete_timeout(self, seconds: int) -> None:
        """Updates the inactivity auto-confirm duration in seconds."""
        self.autocomplete_timeout_s = max(1, seconds)

    def _reset_countdown_display(self) -> None:
        self._countdown_seconds = self.autocomplete_timeout_s
        self.countdown_label.setText(
            f"ยืนยันอัตโนมัติใน: {self._countdown_seconds} วินาที (Auto: {self._countdown_seconds}s)"
        )

    def _set_preview_image(self, image_bytes: bytes) -> None:
        if not image_bytes:
            self.image_label.clear()
            self.image_label.setText("ภาพสินค้า\nItem Snapshot")
            return
        qimg = QImage.fromData(image_bytes)
        if not qimg.isNull():
            pixmap = QPixmap.fromImage(qimg).scaled(
                self.img_frame.width(),
                self.img_frame.height(),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            self.image_label.setText("")
            self.image_label.setPixmap(pixmap)

    def load_loading(self, image_bytes: bytes = b"") -> None:
        """Immediately shows captured photo while AI identifies FEFO candidates."""
        self._countdown_timer.stop()
        self._is_loading = True
        self._candidates = []
        self._set_preview_image(image_bytes)

        self.countdown_label.setText("กำลังรอผลจาก AI... (Loading)")
        self.hint_label.setText("กำลังวิเคราะห์สินค้าและค้นหาในตู้เย็น (Loading FEFO)...")
        self.hint_label.setStyleSheet("font-size: 13px; font-weight: bold; color: #F59E0B;")

        self.list_widget.clear()
        loading_item = QListWidgetItem(
            "กำลังส่งภาพให้ AI วิเคราะห์รายการในตู้เย็น...\n"
            "Analyzing item with Gemini — please wait or press [X] to cancel"
        )
        loading_item.setFlags(Qt.ItemFlag.NoItemFlags)
        self.list_widget.addItem(loading_item)

    def load_candidates(
        self, candidates: list[CheckOutCandidate], image_bytes: bytes = b""
    ) -> None:
        """Populates candidates sorted by FEFO and initiates countdown."""
        self._is_loading = False
        self._candidates = candidates
        if image_bytes:
            self._set_preview_image(image_bytes)
        self.hint_label.setText("เลือกรายการที่ต้องการนำออก (เรียงตามวันหมดอายุ FEFO):")
        self.hint_label.setStyleSheet("font-size: 13px; font-weight: bold; color: #9CA3AF;")
        self.list_widget.clear()

        if not candidates:
            item = QListWidgetItem("ไม่พบรายการอาหารที่ตรงกันในตู้เย็น / No matching inventory items")
            item.setFlags(Qt.ItemFlag.NoItemFlags)
            self.list_widget.addItem(item)
            self._countdown_timer.stop()
            return

        for idx, cand in enumerate(candidates):
            fefo_badge = " [หมดอายุก่อน / FEFO Priority]" if idx == 0 else ""
            line1 = f"{cand.name_th} / {cand.name_en}{fefo_badge}"
            line2 = f"หมวดหมู่: {cand.category_th} | วันหมดอายุ: {cand.expiry_date} | รหัส: {cand.item_id[:8]}"
            item_text = f"{line1}\n{line2}"

            list_item = QListWidgetItem(item_text)
            self.list_widget.addItem(list_item)

        # Select top FEFO item by default
        self.list_widget.setCurrentRow(0)

        # Start configured countdown
        self._reset_countdown_display()
        self._countdown_timer.start(1000)

    def handle_up(self) -> None:
        """Selects previous candidate item in list."""
        if self._is_loading:
            return
        current_row = self.list_widget.currentRow()
        if current_row > 0:
            self.list_widget.setCurrentRow(current_row - 1)
            self._reset_countdown_display()  # Reset countdown on user navigation

    def handle_down(self) -> None:
        """Selects next candidate item in list."""
        if self._is_loading:
            return
        current_row = self.list_widget.currentRow()
        if current_row < self.list_widget.count() - 1:
            self.list_widget.setCurrentRow(current_row + 1)
            self._reset_countdown_display()

    def handle_select(self) -> None:
        """Confirms removal of currently highlighted item."""
        if self._is_loading:
            return
        self._commit()

    def handle_cancel(self) -> None:
        """Cancels checkout without committing."""
        self._is_loading = False
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
        row = self.list_widget.currentRow()
        if 0 <= row < len(self._candidates):
            selected_cand = self._candidates[row]
            self.on_confirm(selected_cand)
        else:
            self.on_cancel()
