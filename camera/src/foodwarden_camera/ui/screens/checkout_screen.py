"""Check-Out Flow Screen with Web Prototype styling and FEFO priority selection."""

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
from foodwarden_camera.ui.screens.checkin_screen import _create_key_guide
from foodwarden_camera.ui.styles import (
    COLOR_DARK,
    COLOR_INK,
    COLOR_LIME_INK,
    COLOR_LIME_SOFT,
    COLOR_ON_DARK,
    COLOR_ON_TAKE,
    COLOR_RULE,
    COLOR_SURFACE,
    COLOR_TAKE_SOLID,
    card_style,
    pill_style,
)


class CheckOutScreen(QWidget):
    """High-contrast Check-Out screen highlighting top FEFO candidates."""

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
        self._is_loading = False
        self._countdown_seconds = self.autocomplete_timeout_s

        self._countdown_timer = QTimer(self)
        self._countdown_timer.timeout.connect(self._tick_countdown)

        self._init_ui()

    def _init_ui(self) -> None:
        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(14, 12, 14, 12)
        root_layout.setSpacing(10)

        # Header
        header = QHBoxLayout()
        title = QLabel("นำออกอาหาร", self)
        title.setStyleSheet(f"font-size: 24px; font-weight: bold; color: {COLOR_INK};")

        self.countdown_label = QLabel(f"ยืนยันอัตโนมัติ {self.autocomplete_timeout_s} วิ", self)
        self.countdown_label.setStyleSheet(
            pill_style(COLOR_LIME_SOFT, COLOR_LIME_INK, font_px=15, pad_v=6, pad_h=14)
        )

        header.addWidget(title)
        header.addStretch()
        header.addWidget(self.countdown_label)
        root_layout.addLayout(header)

        # Body Split: Snapshot Card | Candidate List Card
        body = QHBoxLayout()
        body.setSpacing(12)

        photo_card = QFrame(self)
        photo_card.setObjectName("CheckOutPhotoCard")
        photo_card.setFixedWidth(240)
        photo_card.setStyleSheet(
            card_style("CheckOutPhotoCard", bg=COLOR_SURFACE, border=COLOR_RULE, radius=16)
        )
        photo_layout = QVBoxLayout(photo_card)
        photo_layout.setContentsMargins(10, 10, 10, 10)

        self.img_frame = QFrame(photo_card)
        self.img_frame.setObjectName("CheckOutImgFrame")
        self.img_frame.setMinimumSize(216, 220)
        self.img_frame.setStyleSheet(
            f"#CheckOutImgFrame {{ background-color: {COLOR_DARK}; "
            f"border: 1.5px solid {COLOR_RULE}; border-radius: 12px; }}"
        )
        img_layout = QVBoxLayout(self.img_frame)
        img_layout.setContentsMargins(4, 4, 4, 4)
        self.image_label = QLabel("เตรียมภาพ...", self.img_frame)
        self.image_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.image_label.setStyleSheet(
            f"color: {COLOR_ON_DARK}; font-size: 16px; font-weight: bold;"
        )
        img_layout.addWidget(self.image_label)
        photo_layout.addWidget(self.img_frame)

        list_card = QFrame(self)
        list_card.setObjectName("CheckOutListCard")
        list_card.setStyleSheet(
            card_style("CheckOutListCard", bg=COLOR_SURFACE, border=COLOR_RULE, radius=16)
        )
        list_layout = QVBoxLayout(list_card)
        list_layout.setContentsMargins(12, 10, 12, 12)
        list_layout.setSpacing(8)

        self.hint_label = QLabel("เลือกรายการ (หมดอายุก่อนอยู่บนสุด)", list_card)
        self.hint_label.setStyleSheet(f"font-size: 16px; font-weight: bold; color: {COLOR_INK};")

        self.list_widget = QListWidget(list_card)
        self.list_widget.setMinimumHeight(210)
        self.list_widget.setStyleSheet("QListWidget { font-size: 16px; font-weight: bold; }")

        list_layout.addWidget(self.hint_label)
        list_layout.addWidget(self.list_widget, stretch=1)

        body.addWidget(photo_card)
        body.addWidget(list_card, stretch=1)
        root_layout.addLayout(body, stretch=1)

        # Bottom Guide Bar
        nav_bar = QHBoxLayout()
        nav_bar.setSpacing(10)
        pill_o = _create_key_guide(
            "CheckOutPillO", "O", "ยืนยันนำออก", COLOR_TAKE_SOLID, COLOR_ON_TAKE, self
        )
        pill_arrows = _create_key_guide(
            "CheckOutPillArrows", "↑↓", "เลือกรายการ", COLOR_SURFACE, COLOR_INK, self
        )
        pill_x = _create_key_guide("CheckOutPillX", "X", "ยกเลิก", COLOR_DARK, COLOR_ON_DARK, self)
        nav_bar.addWidget(pill_o, stretch=1)
        nav_bar.addWidget(pill_arrows, stretch=1)
        nav_bar.addWidget(pill_x, stretch=1)
        root_layout.addLayout(nav_bar)

    def set_autocomplete_timeout(self, seconds: int) -> None:
        """Updates inactivity auto-confirm duration in seconds."""
        self.autocomplete_timeout_s = max(1, seconds)

    def _reset_countdown_display(self) -> None:
        self._countdown_seconds = self.autocomplete_timeout_s
        self.countdown_label.setText(f"ยืนยันอัตโนมัติ {self._countdown_seconds} วิ")

    def _set_preview_image(self, image_bytes: bytes) -> None:
        if not image_bytes:
            self.image_label.clear()
            self.image_label.setText("เตรียมภาพ...")
            return
        qimg = QImage.fromData(image_bytes)
        if not qimg.isNull():
            pixmap = QPixmap.fromImage(qimg).scaled(
                max(self.img_frame.width() - 8, 208),
                max(self.img_frame.height() - 8, 208),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            self.image_label.setText("")
            self.image_label.setPixmap(pixmap)

    def load_loading(self, image_bytes: bytes = b"") -> None:
        """Displays snapshot immediately while inventory matching loads."""
        self._countdown_timer.stop()
        self._is_loading = True
        self._candidates = []
        self._set_preview_image(image_bytes)

        self.countdown_label.setText("กำลังรอ AI... (Loading)")
        self.hint_label.setText("กำลังค้นหารายการในตู้เย็น...")
        self.hint_label.setStyleSheet("font-size: 16px; font-weight: bold; color: #B45309;")

        self.list_widget.clear()
        loading_item = QListWidgetItem("กำลังวิเคราะห์สินค้า...\nกด [X] เพื่อยกเลิก")
        loading_item.setFlags(Qt.ItemFlag.NoItemFlags)
        self.list_widget.addItem(loading_item)

    def load_candidates(
        self, candidates: list[CheckOutCandidate], image_bytes: bytes = b""
    ) -> None:
        """Populates FEFO candidates and initiates countdown."""
        self._is_loading = False
        self._candidates = candidates
        if image_bytes:
            self._set_preview_image(image_bytes)

        self.hint_label.setText("เลือกรายการ (หมดอายุก่อน FEFO):")
        self.hint_label.setStyleSheet(f"font-size: 16px; font-weight: bold; color: {COLOR_INK};")
        self.list_widget.clear()

        if not candidates:
            item = QListWidgetItem("ไม่พบรายการที่ตรงกันในตู้เย็น")
            item.setFlags(Qt.ItemFlag.NoItemFlags)
            self.list_widget.addItem(item)
            self._countdown_timer.stop()
            return

        for idx, cand in enumerate(candidates):
            fefo_tag = " [FEFO]" if idx == 0 else ""
            line1 = f"{cand.name_th} ({cand.name_en}){fefo_tag}"
            line2 = f"หมดอายุ {cand.expiry_date} · {cand.category_th}"
            self.list_widget.addItem(QListWidgetItem(f"{line1}\n{line2}"))

        self.list_widget.setCurrentRow(0)
        self._reset_countdown_display()
        self._countdown_timer.start(1000)

    def handle_up(self) -> None:
        """Selects previous candidate item."""
        if self._is_loading:
            return
        current_row = self.list_widget.currentRow()
        if current_row > 0:
            self.list_widget.setCurrentRow(current_row - 1)
            self._reset_countdown_display()

    def handle_down(self) -> None:
        """Selects next candidate item."""
        if self._is_loading:
            return
        current_row = self.list_widget.currentRow()
        if current_row < self.list_widget.count() - 1:
            self.list_widget.setCurrentRow(current_row + 1)
            self._reset_countdown_display()

    def handle_select(self) -> None:
        """Confirms removal of currently selected candidate."""
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
            self.countdown_label.setText(f"ยืนยันอัตโนมัติ {self._countdown_seconds} วิ")

    def _commit(self) -> None:
        self._countdown_timer.stop()
        row = self.list_widget.currentRow()
        if 0 <= row < len(self._candidates):
            self.on_confirm(self._candidates[row])
        else:
            self.on_cancel()
