"""Check-In Flow Screen with Web Prototype styling and high-legibility typography."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta

from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtGui import QImage, QPixmap
from PyQt6.QtWidgets import QFrame, QHBoxLayout, QLabel, QVBoxLayout, QWidget

from foodwarden_camera.models.cloud_cbs import CheckInDraftResult
from foodwarden_camera.ui.styles import (
    COLOR_BAD,
    COLOR_DARK,
    COLOR_FRESH,
    COLOR_INK,
    COLOR_LIME,
    COLOR_LIME_INK,
    COLOR_LIME_SOFT,
    COLOR_MUTED,
    COLOR_ON_BAD,
    COLOR_ON_DARK,
    COLOR_RULE,
    COLOR_SURFACE,
    COLOR_SURFACE_2,
    COLOR_WAIT_BG,
    COLOR_WAIT_FG,
    card_style,
    pill_style,
)


def _create_key_guide(
    object_name: str,
    key_text: str,
    label_text: str,
    bg_color: str,
    fg_color: str,
    parent: QWidget,
) -> QFrame:
    """Builds a concise bottom button-guide pill."""
    pill = QFrame(parent)
    pill.setObjectName(object_name)
    pill.setFixedHeight(44)
    pill.setStyleSheet(card_style(object_name, bg=bg_color, border=bg_color, radius=12))
    row = QHBoxLayout(pill)
    row.setContentsMargins(12, 4, 14, 4)
    row.setSpacing(8)
    lbl = QLabel(f"[{key_text}] {label_text}", pill)
    lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
    lbl.setStyleSheet(f"font-size: 15px; font-weight: bold; color: {fg_color};")
    row.addWidget(lbl)
    return pill


class CheckInScreen(QWidget):
    """High-contrast Check-In confirmation screen with date adjustment."""

    def __init__(
        self,
        on_confirm_callback: Callable[[CheckInDraftResult, str], None],
        on_cancel_callback: Callable[[], None],
        autocomplete_timeout_s: int = 5,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.on_confirm = on_confirm_callback
        self.on_cancel = on_cancel_callback
        self.autocomplete_timeout_s = max(1, autocomplete_timeout_s)
        self._draft: CheckInDraftResult | None = None
        self._is_loading = False
        self._current_date = datetime.now() + timedelta(days=7)
        self._selected_segment = 0  # 0=Day, 1=Month, 2=Year
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
        title = QLabel("นำเข้าอาหาร", self)
        title.setStyleSheet(f"font-size: 24px; font-weight: bold; color: {COLOR_INK};")

        self.countdown_label = QLabel(f"ยืนยันอัตโนมัติ {self.autocomplete_timeout_s} วิ", self)
        self.countdown_label.setStyleSheet(
            pill_style(COLOR_LIME_SOFT, COLOR_LIME_INK, font_px=15, pad_v=6, pad_h=14)
        )

        header.addWidget(title)
        header.addStretch()
        header.addWidget(self.countdown_label)
        root_layout.addLayout(header)

        # Main Split: Photo Card | Metadata & Date Card
        body = QHBoxLayout()
        body.setSpacing(12)

        photo_card = QFrame(self)
        photo_card.setObjectName("CheckInPhotoCard")
        photo_card.setFixedWidth(290)
        photo_card.setStyleSheet(
            card_style("CheckInPhotoCard", bg=COLOR_SURFACE, border=COLOR_RULE, radius=16)
        )
        photo_layout = QVBoxLayout(photo_card)
        photo_layout.setContentsMargins(10, 10, 10, 10)

        self.img_frame = QFrame(photo_card)
        self.img_frame.setObjectName("CheckInImgFrame")
        self.img_frame.setMinimumSize(266, 240)
        self.img_frame.setStyleSheet(
            f"#CheckInImgFrame {{ background-color: {COLOR_DARK}; "
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

        self.card = QFrame(self)
        self.card.setObjectName("CheckInCard")
        self.card.setStyleSheet(
            card_style("CheckInCard", bg=COLOR_SURFACE, border=COLOR_RULE, radius=16)
        )
        card_layout = QVBoxLayout(self.card)
        card_layout.setContentsMargins(16, 14, 16, 14)
        card_layout.setSpacing(6)

        self.name_th = QLabel("กำลังวิเคราะห์...", self.card)
        self.name_th.setWordWrap(True)
        self.name_th.setStyleSheet("font-size: 26px; font-weight: bold; color: #B45309;")

        self.name_en = QLabel("Gemini AI", self.card)
        self.name_en.setStyleSheet(f"font-size: 16px; font-weight: bold; color: {COLOR_MUTED};")

        self.category_label = QLabel("หมวดหมู่: -", self.card)
        self.category_label.setStyleSheet(
            f"font-size: 16px; font-weight: bold; color: {COLOR_INK};"
        )

        self.storage_label = QLabel("เก็บ: -", self.card)
        self.storage_label.setWordWrap(True)
        self.storage_label.setStyleSheet(f"font-size: 15px; color: {COLOR_MUTED};")

        # Expiry Date Tile (#F2F7E3)
        date_tile = QFrame(self.card)
        date_tile.setObjectName("ExpiryTile")
        date_tile.setStyleSheet(
            card_style("ExpiryTile", bg=COLOR_SURFACE_2, border=COLOR_RULE, radius=12)
        )
        date_col = QVBoxLayout(date_tile)
        date_col.setContentsMargins(12, 8, 12, 10)
        date_col.setSpacing(6)

        exp_title = QLabel("วันหมดอายุ (วัน / เดือน / ปี)", date_tile)
        exp_title.setStyleSheet(f"font-size: 14px; font-weight: bold; color: {COLOR_MUTED};")

        date_box = QHBoxLayout()
        date_box.setSpacing(8)

        self.day_label = QLabel("01", date_tile)
        self.day_label.setFixedSize(72, 44)
        self.day_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        sep1 = QLabel("/", date_tile)
        sep1.setStyleSheet(f"font-size: 20px; font-weight: bold; color: {COLOR_MUTED};")

        self.month_label = QLabel("01", date_tile)
        self.month_label.setFixedSize(72, 44)
        self.month_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        sep2 = QLabel("/", date_tile)
        sep2.setStyleSheet(f"font-size: 20px; font-weight: bold; color: {COLOR_MUTED};")

        self.year_label = QLabel("2026", date_tile)
        self.year_label.setFixedSize(96, 44)
        self.year_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        date_box.addWidget(self.day_label)
        date_box.addWidget(sep1)
        date_box.addWidget(self.month_label)
        date_box.addWidget(sep2)
        date_box.addWidget(self.year_label)
        date_box.addStretch()

        date_col.addWidget(exp_title)
        date_col.addLayout(date_box)

        card_layout.addWidget(self.name_th)
        card_layout.addWidget(self.name_en)
        card_layout.addWidget(self.category_label)
        card_layout.addWidget(self.storage_label)
        card_layout.addStretch()
        card_layout.addWidget(date_tile)

        body.addWidget(photo_card)
        body.addWidget(self.card, stretch=1)
        root_layout.addLayout(body, stretch=1)

        # Bottom Button Guide Bar
        nav_bar = QHBoxLayout()
        nav_bar.setSpacing(10)
        pill_o = _create_key_guide(
            "CheckInPillO", "O", "ยืนยัน / ถัดไป", COLOR_FRESH, COLOR_ON_BAD, self
        )
        pill_arrows = _create_key_guide(
            "CheckInPillArrows", "↑↓", "ปรับวันที่", COLOR_SURFACE, COLOR_INK, self
        )
        pill_x = _create_key_guide("CheckInPillX", "X", "ยกเลิก", COLOR_BAD, COLOR_ON_BAD, self)
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
                max(self.img_frame.width() - 8, 258),
                max(self.img_frame.height() - 8, 228),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            self.image_label.setText("")
            self.image_label.setPixmap(pixmap)

    def load_loading(self, image_bytes: bytes) -> None:
        """Shows captured photo immediately while Gemini analysis completes."""
        self._countdown_timer.stop()
        self._is_loading = True
        self._draft = None
        self._set_preview_image(image_bytes)

        self.countdown_label.setText("กำลังรอ AI... (Loading)")
        self.name_th.setText("กำลังวิเคราะห์...")
        self.name_th.setStyleSheet("font-size: 26px; font-weight: bold; color: #B45309;")
        self.name_en.setText("กำลังตรวจสอบกับ Gemini AI")
        self.category_label.setText("หมวดหมู่: กำลังโหลด...")
        self.storage_label.setText("เก็บ: กำลังโหลด...")

        muted_style = (
            f"font-size: 22px; font-weight: bold; color: {COLOR_WAIT_FG}; "
            f"background-color: {COLOR_WAIT_BG}; border: 1.5px solid {COLOR_RULE}; border-radius: 10px;"
        )
        self.day_label.setText("--")
        self.month_label.setText("--")
        self.year_label.setText("----")
        self.day_label.setStyleSheet(muted_style)
        self.month_label.setStyleSheet(muted_style)
        self.year_label.setStyleSheet(muted_style)

    def load_draft(self, draft: CheckInDraftResult, image_bytes: bytes) -> None:
        """Populates AI result and starts auto-confirm countdown."""
        self._is_loading = False
        self._draft = draft
        if image_bytes:
            self._set_preview_image(image_bytes)

        self.name_th.setText(draft.name_th)
        self.name_th.setStyleSheet(f"font-size: 26px; font-weight: bold; color: {COLOR_FRESH};")
        self.name_en.setText(f"{draft.name_en} ({draft.confidence * 100:.0f}%)")
        self.category_label.setText(f"หมวดหมู่: {draft.category_th}")
        self.storage_label.setText(f"เก็บ: {draft.storage_recommendation_th}")

        try:
            self._current_date = datetime.strptime(draft.estimated_expiry_date, "%Y-%m-%d")
        except ValueError:
            self._current_date = datetime.now() + timedelta(days=draft.estimated_shelf_life_days)

        self._selected_segment = 0
        self._refresh_date_display()
        self._reset_countdown_display()
        self._countdown_timer.start(1000)

    def _refresh_date_display(self) -> None:
        """Renders day/month/year segments highlighting the active field."""
        self.day_label.setText(f"{self._current_date.day:02d}")
        self.month_label.setText(f"{self._current_date.month:02d}")
        self.year_label.setText(f"{self._current_date.year:04d}")

        active_style = (
            f"font-size: 22px; font-weight: bold; color: {COLOR_ON_DARK}; "
            f"background-color: {COLOR_DARK}; border: 2px solid {COLOR_LIME}; border-radius: 10px;"
        )
        inactive_style = (
            f"font-size: 22px; font-weight: bold; color: {COLOR_INK}; "
            f"background-color: {COLOR_SURFACE}; border: 1.5px solid {COLOR_RULE}; border-radius: 10px;"
        )

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
        if self._is_loading:
            return
        self._reset_countdown_display()
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
        if self._is_loading:
            return
        self._reset_countdown_display()
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
        if self._is_loading:
            return
        if self._selected_segment < 2:
            self._selected_segment += 1
            self._reset_countdown_display()
            self._refresh_date_display()
        else:
            self._commit()

    def handle_cancel(self) -> None:
        """Cancels check-in without committing."""
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
        if self._draft is not None:
            formatted_date = self._current_date.strftime("%Y-%m-%d")
            self.on_confirm(self._draft, formatted_date)
