"""Check-In Flow Screen with Web Prototype styling and high-legibility typography."""

from __future__ import annotations

import calendar
from collections.abc import Callable
from datetime import date, datetime, timedelta

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
    COLOR_MUTED,
    COLOR_ON_BAD,
    COLOR_ON_DARK,
    COLOR_RULE,
    COLOR_SURFACE,
    COLOR_SURFACE_2,
    COLOR_WAIT_BG,
    COLOR_WAIT_FG,
    COLOR_WARN_TEXT,
    FS_HERO,
    FS_LABEL,
    card_style,
    pill_style,
)
from foodwarden_camera.ui.widgets import (
    FitLabel,
    create_key_guide,
    create_screen_header,
    days_left_badge,
)

_DATE_SEG_FONT_PX = 34
_DATE_SEG_HEIGHT = 62


def _add_months(value: date, months: int) -> date:
    """Shifts a date by whole months, clamping the day to the target month's length."""
    total = value.year * 12 + (value.month - 1) + months
    year, month_idx = divmod(total, 12)
    month = month_idx + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _add_years(value: date, years: int) -> date:
    """Shifts a date by whole years (29 Feb → 28 Feb on non-leap years)."""
    year = value.year + years
    day = min(value.day, calendar.monthrange(year, value.month)[1])
    return date(year, value.month, day)


class CheckInScreen(QWidget):
    """High-contrast Check-In confirmation screen with date adjustment.

    The expiry date can never be set earlier than today: AI drafts with a past
    date are clamped on load, every ↓ press is clamped, and the value is
    clamped again at commit (covers the screen staying open past midnight).
    """

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
        self._current_date: date = date.today() + timedelta(days=7)
        self._selected_segment = 0  # 0=Day, 1=Month, 2=Year
        self._countdown_seconds = self.autocomplete_timeout_s

        self._countdown_timer = QTimer(self)
        self._countdown_timer.timeout.connect(self._tick_countdown)

        self._init_ui()

    # ------------------------------------------------------------------
    # Layout
    # ------------------------------------------------------------------

    def _init_ui(self) -> None:
        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(14, 10, 14, 12)
        root_layout.setSpacing(10)

        header, self.countdown_label = create_screen_header("นำเข้าอาหาร", self)
        self.countdown_label.setText(f"ยืนยันอัตโนมัติ {self.autocomplete_timeout_s} วิ")
        root_layout.addLayout(header)

        # Body: Photo | Item details + expiry date
        body = QHBoxLayout()
        body.setSpacing(12)

        photo_card = QFrame(self)
        photo_card.setObjectName("CheckInPhotoCard")
        photo_card.setFixedWidth(250)
        photo_card.setStyleSheet(card_style("CheckInPhotoCard", radius=16))
        photo_layout = QVBoxLayout(photo_card)
        photo_layout.setContentsMargins(8, 8, 8, 8)

        self.img_frame = QFrame(photo_card)
        self.img_frame.setObjectName("CheckInImgFrame")
        self.img_frame.setStyleSheet(
            f"#CheckInImgFrame {{ background-color: {COLOR_DARK}; "
            f"border: 1.5px solid {COLOR_RULE}; border-radius: 12px; }}"
        )
        img_layout = QVBoxLayout(self.img_frame)
        img_layout.setContentsMargins(4, 4, 4, 4)
        self.image_label = QLabel("เตรียมภาพ...", self.img_frame)
        self.image_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.image_label.setStyleSheet(
            f"color: {COLOR_ON_DARK}; font-size: {FS_LABEL}px; font-weight: bold;"
        )
        img_layout.addWidget(self.image_label)
        photo_layout.addWidget(self.img_frame)

        self.card = QFrame(self)
        self.card.setObjectName("CheckInCard")
        self.card.setStyleSheet(card_style("CheckInCard", radius=16))
        card_layout = QVBoxLayout(self.card)
        card_layout.setContentsMargins(16, 10, 16, 12)
        card_layout.setSpacing(4)

        self.name_th = FitLabel("กำลังวิเคราะห์...", self.card, min_px=24)

        self.name_en = FitLabel("Gemini AI", self.card, min_px=15)
        self.name_en.setStyleSheet(
            f"font-size: {FS_LABEL}px; font-weight: bold; color: {COLOR_MUTED};"
        )

        self.category_label = FitLabel("หมวดหมู่: -", self.card, min_px=15)
        self.category_label.setStyleSheet(
            f"font-size: {FS_LABEL}px; font-weight: bold; color: {COLOR_INK};"
        )

        self.storage_label = QLabel("วิธีเก็บ: -", self.card)
        self.storage_label.setWordWrap(True)
        self.storage_label.setStyleSheet(f"font-size: {FS_LABEL}px; color: {COLOR_MUTED};")

        card_layout.addWidget(self.name_th)
        card_layout.addWidget(self.name_en)
        card_layout.addSpacing(4)
        card_layout.addWidget(self.category_label)
        card_layout.addWidget(self.storage_label)
        card_layout.addStretch()
        card_layout.addWidget(self._build_date_tile(self.card))

        body.addWidget(photo_card)
        body.addWidget(self.card, stretch=1)
        root_layout.addLayout(body, stretch=1)

        # Bottom button guide
        nav_bar = QHBoxLayout()
        nav_bar.setSpacing(10)
        self.pill_o = create_key_guide("CheckInPillO", "O", "ถัดไป", COLOR_FRESH, COLOR_ON_BAD, self)
        pill_arrows = create_key_guide(
            "CheckInPillArrows",
            "↑↓",
            "ปรับวันที่",
            COLOR_SURFACE,
            COLOR_INK,
            self,
            border_color=COLOR_RULE,
        )
        pill_x = create_key_guide("CheckInPillX", "X", "ยกเลิก", COLOR_BAD, COLOR_ON_BAD, self)
        nav_bar.addWidget(self.pill_o, stretch=1)
        nav_bar.addWidget(pill_arrows, stretch=1)
        nav_bar.addWidget(pill_x, stretch=1)
        root_layout.addLayout(nav_bar)

        self._set_name_style(COLOR_WARN_TEXT)

    def _build_date_tile(self, parent: QWidget) -> QFrame:
        tile = QFrame(parent)
        tile.setObjectName("ExpiryTile")
        tile.setStyleSheet(card_style("ExpiryTile", bg=COLOR_SURFACE_2, radius=12))
        col = QVBoxLayout(tile)
        col.setContentsMargins(12, 8, 12, 10)
        col.setSpacing(6)

        title_row = QHBoxLayout()
        exp_title = QLabel("วันหมดอายุ  (วัน / เดือน / ปี)", tile)
        exp_title.setStyleSheet(
            f"font-size: {FS_LABEL}px; font-weight: bold; color: {COLOR_MUTED};"
        )
        self.days_left_label = QLabel("", tile)
        title_row.addWidget(exp_title)
        title_row.addStretch()
        title_row.addWidget(self.days_left_label)

        seg_row = QHBoxLayout()
        seg_row.setSpacing(8)

        def _seg(text: str, width: int) -> QLabel:
            lbl = QLabel(text, tile)
            lbl.setFixedSize(width, _DATE_SEG_HEIGHT)
            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            return lbl

        def _sep() -> QLabel:
            lbl = QLabel("/", tile)
            lbl.setStyleSheet(f"font-size: 28px; font-weight: bold; color: {COLOR_MUTED};")
            return lbl

        self.day_label = _seg("01", 88)
        self.month_label = _seg("01", 88)
        self.year_label = _seg("2026", 124)
        seg_row.addWidget(self.day_label)
        seg_row.addWidget(_sep())
        seg_row.addWidget(self.month_label)
        seg_row.addWidget(_sep())
        seg_row.addWidget(self.year_label)
        seg_row.addStretch()

        col.addLayout(title_row)
        col.addLayout(seg_row)
        return tile

    def _set_name_style(self, color: str) -> None:
        self.name_th.setStyleSheet(f"font-size: {FS_HERO}px; font-weight: bold; color: {color};")

    # ------------------------------------------------------------------
    # Countdown
    # ------------------------------------------------------------------

    def set_autocomplete_timeout(self, seconds: int) -> None:
        """Updates inactivity auto-confirm duration in seconds."""
        self.autocomplete_timeout_s = max(1, seconds)

    def _reset_countdown_display(self) -> None:
        """Restarts the auto-confirm countdown from the full timeout."""
        self._countdown_seconds = self.autocomplete_timeout_s
        self.countdown_label.setText(f"ยืนยันอัตโนมัติ {self._countdown_seconds} วิ")
        if self._countdown_timer.isActive():
            # Restart so the next tick is a full second away, not a partial one.
            self._countdown_timer.start(1000)

    def _tick_countdown(self) -> None:
        self._countdown_seconds -= 1
        if self._countdown_seconds <= 0:
            self._countdown_timer.stop()
            self._commit()
        else:
            self.countdown_label.setText(f"ยืนยันอัตโนมัติ {self._countdown_seconds} วิ")

    # ------------------------------------------------------------------
    # Data loading
    # ------------------------------------------------------------------

    def _set_preview_image(self, image_bytes: bytes) -> None:
        if not image_bytes:
            self.image_label.clear()
            self.image_label.setText("เตรียมภาพ...")
            return
        qimg = QImage.fromData(image_bytes)
        if not qimg.isNull():
            pixmap = QPixmap.fromImage(qimg).scaled(
                max(self.img_frame.width() - 8, 218),
                max(self.img_frame.height() - 8, 218),
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
        self._set_name_style(COLOR_WARN_TEXT)
        self.name_en.setText("กำลังตรวจสอบกับ Gemini AI")
        self.category_label.setText("หมวดหมู่: กำลังโหลด...")
        self.storage_label.setText("วิธีเก็บ: กำลังโหลด...")
        self.days_left_label.setText("")
        self.days_left_label.setStyleSheet("")

        muted_style = (
            f"font-size: {_DATE_SEG_FONT_PX}px; font-weight: bold; color: {COLOR_WAIT_FG}; "
            f"background-color: {COLOR_WAIT_BG}; border: 1.5px solid {COLOR_RULE}; "
            "border-radius: 12px;"
        )
        self.day_label.setText("--")
        self.month_label.setText("--")
        self.year_label.setText("----")
        for lbl in (self.day_label, self.month_label, self.year_label):
            lbl.setStyleSheet(muted_style)

    def load_draft(self, draft: CheckInDraftResult, image_bytes: bytes) -> None:
        """Populates AI result and starts auto-confirm countdown."""
        self._is_loading = False
        self._draft = draft
        if image_bytes:
            self._set_preview_image(image_bytes)

        self.name_th.setText(draft.name_th)
        self._set_name_style(COLOR_FRESH)
        self.name_en.setText(f"มั่นใจ {draft.confidence * 100:.0f}%  ·  {draft.name_en}")
        self.category_label.setText(f"หมวดหมู่: {draft.category_th}")
        self.storage_label.setText(f"วิธีเก็บ: {draft.storage_recommendation_th}")

        try:
            parsed = datetime.strptime(draft.estimated_expiry_date, "%Y-%m-%d").date()
        except ValueError:
            parsed = date.today() + timedelta(days=max(0, draft.estimated_shelf_life_days))
        self._current_date = self._clamp_to_today(parsed)

        self._selected_segment = 0
        self._refresh_date_display()
        self._reset_countdown_display()
        self._countdown_timer.start(1000)

    # ------------------------------------------------------------------
    # Date editing
    # ------------------------------------------------------------------

    @staticmethod
    def _clamp_to_today(value: date) -> date:
        """Expiry can never be before today."""
        return max(date.today(), value)

    def _refresh_date_display(self) -> None:
        """Renders day/month/year segments highlighting the active field."""
        self.day_label.setText(f"{self._current_date.day:02d}")
        self.month_label.setText(f"{self._current_date.month:02d}")
        self.year_label.setText(f"{self._current_date.year:04d}")

        active_style = (
            f"font-size: {_DATE_SEG_FONT_PX}px; font-weight: bold; color: {COLOR_ON_DARK}; "
            f"background-color: {COLOR_DARK}; border: 3px solid {COLOR_LIME}; "
            "border-radius: 12px;"
        )
        inactive_style = (
            f"font-size: {_DATE_SEG_FONT_PX}px; font-weight: bold; color: {COLOR_INK}; "
            f"background-color: {COLOR_SURFACE}; border: 1.5px solid {COLOR_RULE}; "
            "border-radius: 12px;"
        )
        segments = (self.day_label, self.month_label, self.year_label)
        for idx, lbl in enumerate(segments):
            lbl.setStyleSheet(active_style if idx == self._selected_segment else inactive_style)

        text, bg, fg = days_left_badge(self._current_date)
        if self._current_date <= date.today():
            text = f"{text} (ต่ำสุด)"
        self.days_left_label.setText(text)
        self.days_left_label.setStyleSheet(
            pill_style(bg, fg, font_px=FS_LABEL - 1, pad_v=3, pad_h=10, radius=10)
        )

        # O advances through Day → Month → Year, then saves.
        is_last = self._selected_segment >= 2
        self._set_select_hint("บันทึก" if is_last else "ถัดไป")

    def _set_select_hint(self, text: str) -> None:
        label = self.pill_o.findChild(QLabel, "CheckInPillOLabel")
        if label is not None:
            label.setText(text)

    def _shift_date(self, step: int) -> None:
        if self._selected_segment == 0:
            shifted = self._current_date + timedelta(days=step)
        elif self._selected_segment == 1:
            shifted = _add_months(self._current_date, step)
        else:
            shifted = _add_years(self._current_date, step)
        self._current_date = self._clamp_to_today(shifted)

    def handle_up(self) -> None:
        """Increments highlighted date segment."""
        if self._is_loading or self._draft is None:
            return
        self._reset_countdown_display()
        self._shift_date(+1)
        self._refresh_date_display()

    def handle_down(self) -> None:
        """Decrements highlighted date segment (never below today)."""
        if self._is_loading or self._draft is None:
            return
        self._reset_countdown_display()
        self._shift_date(-1)
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

    def _commit(self) -> None:
        self._countdown_timer.stop()
        if self._draft is not None:
            self._current_date = self._clamp_to_today(self._current_date)
            self.on_confirm(self._draft, self._current_date.strftime("%Y-%m-%d"))
