"""Check-Out Flow Screen with Web Prototype styling and FEFO priority selection."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime

from PyQt6.QtCore import QSize, Qt, QTimer
from PyQt6.QtGui import QImage, QPixmap
from PyQt6.QtWidgets import (
    QAbstractItemView,
    QFrame,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QVBoxLayout,
    QWidget,
)

from foodwarden_camera.models.cloud_cbs import CheckOutCandidate
from foodwarden_camera.ui.styles import (
    COLOR_DARK,
    COLOR_INK,
    COLOR_LIME,
    COLOR_MUTED,
    COLOR_ON_DARK,
    COLOR_ON_DARK_2,
    COLOR_ON_TAKE,
    COLOR_RULE,
    COLOR_SURFACE,
    COLOR_SURFACE_2,
    COLOR_TAKE_SOLID,
    COLOR_WARN_TEXT,
    FS_BODY,
    FS_LABEL,
    card_style,
    pill_style,
)
from foodwarden_camera.ui.widgets import (
    create_key_guide,
    create_screen_header,
    days_left_badge,
)

_ROW_HEIGHT = 78


class _CandidateRow(QFrame):
    """One selectable FEFO candidate: Thai name, expiry date and days-left badge."""

    def __init__(self, cand: CheckOutCandidate, is_fefo: bool, parent: QWidget) -> None:
        super().__init__(parent)
        self.setObjectName("CandidateRow")
        layout = QHBoxLayout(self)
        layout.setContentsMargins(14, 6, 12, 6)
        layout.setSpacing(10)

        text_col = QVBoxLayout()
        text_col.setSpacing(0)
        self.name_label = QLabel(cand.name_th, self)
        self.detail_label = QLabel(self._detail_text(cand), self)
        text_col.addWidget(self.name_label)
        text_col.addWidget(self.detail_label)

        badge_col = QVBoxLayout()
        badge_col.setSpacing(4)
        badge_col.addStretch()
        self.fefo_label: QLabel | None = None
        if is_fefo:
            self.fefo_label = QLabel("หมดก่อน", self)
            self.fefo_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.fefo_label.setStyleSheet(
                pill_style(COLOR_TAKE_SOLID, COLOR_ON_TAKE, font_px=FS_LABEL - 3, pad_v=2, pad_h=8)
            )
            badge_col.addWidget(self.fefo_label, alignment=Qt.AlignmentFlag.AlignRight)
        self.days_label = QLabel("", self)
        self.days_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        badge_col.addWidget(self.days_label, alignment=Qt.AlignmentFlag.AlignRight)
        badge_col.addStretch()

        try:
            expiry = datetime.strptime(cand.expiry_date, "%Y-%m-%d").date()
            text, bg, fg = days_left_badge(expiry)
            self.days_label.setText(text)
            self.days_label.setStyleSheet(
                pill_style(bg, fg, font_px=FS_LABEL - 2, pad_v=2, pad_h=8, radius=10)
            )
        except ValueError:
            self.days_label.hide()

        layout.addLayout(text_col, stretch=1)
        layout.addLayout(badge_col)
        self.set_selected(False)

    @staticmethod
    def _detail_text(cand: CheckOutCandidate) -> str:
        try:
            exp = datetime.strptime(cand.expiry_date, "%Y-%m-%d").strftime("%d/%m/%Y")
        except ValueError:
            exp = cand.expiry_date
        return f"หมดอายุ {exp}"

    def set_selected(self, selected: bool) -> None:
        if selected:
            bg, border, border_w = COLOR_DARK, COLOR_LIME, 3
            name_fg, detail_fg = COLOR_ON_DARK, COLOR_ON_DARK_2
        else:
            bg, border, border_w = COLOR_SURFACE_2, COLOR_RULE, 2
            name_fg, detail_fg = COLOR_INK, COLOR_MUTED
        self.setStyleSheet(
            f"#CandidateRow {{ background-color: {bg}; border: {border_w}px solid {border}; "
            "border-radius: 12px; }"
        )
        self.name_label.setStyleSheet(
            f"font-size: {FS_BODY + 1}px; font-weight: bold; color: {name_fg};"
        )
        self.detail_label.setStyleSheet(
            f"font-size: {FS_LABEL - 1}px; font-weight: bold; color: {detail_fg};"
        )


class CheckOutScreen(QWidget):
    """High-contrast Check-Out screen highlighting top FEFO candidates.

    Any change of selected row (Pi-top ↑/↓, keyboard, or touch) restarts the
    auto-confirm countdown so the user always has the full timeout to read
    the item they just moved to.
    """

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
        self._rows: list[_CandidateRow] = []
        self._is_loading = False
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

        header, self.countdown_label = create_screen_header("นำออกอาหาร", self)
        self.countdown_label.setText(f"ยืนยันอัตโนมัติ {self.autocomplete_timeout_s} วิ")
        root_layout.addLayout(header)

        body = QHBoxLayout()
        body.setSpacing(12)

        photo_card = QFrame(self)
        photo_card.setObjectName("CheckOutPhotoCard")
        photo_card.setFixedWidth(210)
        photo_card.setStyleSheet(card_style("CheckOutPhotoCard", radius=16))
        photo_layout = QVBoxLayout(photo_card)
        photo_layout.setContentsMargins(8, 8, 8, 8)

        self.img_frame = QFrame(photo_card)
        self.img_frame.setObjectName("CheckOutImgFrame")
        self.img_frame.setStyleSheet(
            f"#CheckOutImgFrame {{ background-color: {COLOR_DARK}; "
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

        list_card = QFrame(self)
        list_card.setObjectName("CheckOutListCard")
        list_card.setStyleSheet(card_style("CheckOutListCard", radius=16))
        list_layout = QVBoxLayout(list_card)
        list_layout.setContentsMargins(10, 8, 10, 10)
        list_layout.setSpacing(6)

        hint_row = QHBoxLayout()
        self.hint_label = QLabel("เลือกรายการที่จะนำออก", list_card)
        self.position_label = QLabel("", list_card)
        self.position_label.setStyleSheet(
            f"font-size: {FS_LABEL}px; font-weight: bold; color: {COLOR_MUTED};"
        )
        hint_row.addWidget(self.hint_label)
        hint_row.addStretch()
        hint_row.addWidget(self.position_label)
        self._set_hint_style(COLOR_INK)

        self.list_widget = QListWidget(list_card)
        # The window-level key handler owns ↑/↓; a focused list would swallow them.
        self.list_widget.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.list_widget.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.list_widget.setVerticalScrollMode(QAbstractItemView.ScrollMode.ScrollPerPixel)
        self.list_widget.setSpacing(3)
        # Scrollbar would cover the badges; the "n / total" counter shows position.
        self.list_widget.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.list_widget.setStyleSheet(
            "QListWidget { background: transparent; border: none; padding: 0; }"
            "QListWidget::item, QListWidget::item:selected "
            "{ background: transparent; border: none; margin: 0; padding: 0; }"
        )
        self.list_widget.currentRowChanged.connect(self._on_row_changed)

        list_layout.addLayout(hint_row)
        list_layout.addWidget(self.list_widget, stretch=1)

        body.addWidget(photo_card)
        body.addWidget(list_card, stretch=1)
        root_layout.addLayout(body, stretch=1)

        nav_bar = QHBoxLayout()
        nav_bar.setSpacing(10)
        pill_o = create_key_guide(
            "CheckOutPillO", "O", "นำออก", COLOR_TAKE_SOLID, COLOR_ON_TAKE, self
        )
        pill_arrows = create_key_guide(
            "CheckOutPillArrows",
            "↑↓",
            "เลือกรายการ",
            COLOR_SURFACE,
            COLOR_INK,
            self,
            border_color=COLOR_RULE,
        )
        pill_x = create_key_guide("CheckOutPillX", "X", "ยกเลิก", COLOR_DARK, COLOR_ON_DARK, self)
        nav_bar.addWidget(pill_o, stretch=1)
        nav_bar.addWidget(pill_arrows, stretch=1)
        nav_bar.addWidget(pill_x, stretch=1)
        root_layout.addLayout(nav_bar)

    def _set_hint_style(self, color: str) -> None:
        self.hint_label.setStyleSheet(
            f"font-size: {FS_LABEL + 1}px; font-weight: bold; color: {color};"
        )

    def _add_message_row(self, text: str, color: str = COLOR_MUTED) -> None:
        """Adds a non-selectable informational row (loading / empty)."""
        item = QListWidgetItem(self.list_widget)
        item.setFlags(Qt.ItemFlag.NoItemFlags)
        label = QLabel(text, self.list_widget)
        label.setWordWrap(True)
        label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        label.setStyleSheet(
            f"font-size: {FS_BODY}px; font-weight: bold; color: {color}; padding: 18px;"
        )
        item.setSizeHint(QSize(0, 120))
        self.list_widget.setItemWidget(item, label)

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
                max(self.img_frame.width() - 8, 178),
                max(self.img_frame.height() - 8, 178),
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
        self._rows = []
        self._set_preview_image(image_bytes)

        self.countdown_label.setText("กำลังรอ AI... (Loading)")
        self.hint_label.setText("กำลังค้นหาในตู้เย็น...")
        self._set_hint_style(COLOR_WARN_TEXT)
        self.position_label.setText("")

        self.list_widget.clear()
        self._add_message_row("กำลังวิเคราะห์สินค้า...\nกด X เพื่อยกเลิก", COLOR_WARN_TEXT)

    def load_candidates(
        self, candidates: list[CheckOutCandidate], image_bytes: bytes = b""
    ) -> None:
        """Populates FEFO candidates and initiates countdown."""
        self._countdown_timer.stop()
        self._candidates = candidates
        self._rows = []
        if image_bytes:
            self._set_preview_image(image_bytes)

        self.hint_label.setText("เลือกรายการที่จะนำออก")
        self._set_hint_style(COLOR_INK)

        # Block signals while rebuilding so clear()/setCurrentRow don't fire
        # _on_row_changed against a half-built row list.
        self.list_widget.blockSignals(True)
        self.list_widget.clear()

        if not candidates:
            self.list_widget.blockSignals(False)
            self._is_loading = False
            self.position_label.setText("")
            self._add_message_row("ไม่พบรายการนี้ในตู้เย็น\nกด X เพื่อกลับ")
            self.countdown_label.setText("ไม่พบรายการ")
            return

        for idx, cand in enumerate(candidates):
            item = QListWidgetItem(self.list_widget)
            item.setSizeHint(QSize(0, _ROW_HEIGHT))
            row = _CandidateRow(cand, is_fefo=idx == 0, parent=self.list_widget)
            self.list_widget.setItemWidget(item, row)
            self._rows.append(row)

        self.list_widget.setCurrentRow(0)
        self.list_widget.blockSignals(False)
        self._is_loading = False
        self._apply_selection(0)

        self._countdown_timer.start(1000)
        self._reset_countdown_display()

    # ------------------------------------------------------------------
    # Selection
    # ------------------------------------------------------------------

    def _apply_selection(self, row: int) -> None:
        for idx, row_widget in enumerate(self._rows):
            row_widget.set_selected(idx == row)
        if 0 <= row < len(self._rows):
            self.position_label.setText(f"{row + 1} / {len(self._rows)}")
            item = self.list_widget.item(row)
            if item is not None:
                self.list_widget.scrollToItem(item)

    def _on_row_changed(self, row: int) -> None:
        if self._is_loading or not self._rows:
            return
        self._apply_selection(row)
        self._reset_countdown_display()

    def handle_up(self) -> None:
        """Selects previous candidate item."""
        if self._is_loading or not self._candidates:
            return
        current_row = self.list_widget.currentRow()
        if current_row > 0:
            self.list_widget.setCurrentRow(current_row - 1)  # resets via _on_row_changed
        else:
            self._reset_countdown_display()  # still interacting at the top edge

    def handle_down(self) -> None:
        """Selects next candidate item."""
        if self._is_loading or not self._candidates:
            return
        current_row = self.list_widget.currentRow()
        if current_row < self.list_widget.count() - 1:
            self.list_widget.setCurrentRow(current_row + 1)  # resets via _on_row_changed
        else:
            self._reset_countdown_display()  # still interacting at the bottom edge

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

    def _commit(self) -> None:
        self._countdown_timer.stop()
        row = self.list_widget.currentRow()
        if 0 <= row < len(self._candidates):
            self.on_confirm(self._candidates[row])
        else:
            self.on_cancel()
