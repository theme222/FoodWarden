"""Explicit "Are you sure?" step shown after the user manually edits a Check-In/Out.

There is deliberately no countdown here: the user has already shown they want
to review the item, so the record is only saved on an explicit O press.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QPixmap
from PyQt6.QtWidgets import QFrame, QHBoxLayout, QLabel, QVBoxLayout, QWidget

from foodwarden_camera.ui.styles import (
    COLOR_DARK,
    COLOR_FRESH,
    COLOR_INK,
    COLOR_MUTED,
    COLOR_ON_BAD,
    COLOR_ON_DARK,
    COLOR_ON_TAKE,
    COLOR_TAKE_SOLID,
    COLOR_WAIT_BG,
    COLOR_WAIT_FG,
    FS_BODY,
    FS_HERO,
    FS_LABEL,
    FS_TITLE,
    card_style,
    pill_style,
)
from foodwarden_camera.ui.widgets import FitLabel, create_key_guide

ConfirmKind = Literal["checkin", "checkout"]

_IMG_SIZE = 200


class ConfirmScreen(QWidget):
    """Summary card + [O ยืนยัน] / [X กลับไปแก้ไข]."""

    def __init__(
        self,
        on_confirm: Callable[[], None],
        on_back: Callable[[], None],
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._on_confirm = on_confirm
        self._on_back = on_back
        self.kind: ConfirmKind = "checkin"
        self._init_ui()

    def _init_ui(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(14, 10, 14, 12)
        root.setSpacing(10)

        header = QHBoxLayout()
        self.title_label = QLabel("ยืนยันรายการ", self)
        self.title_label.setStyleSheet(
            f"font-size: {FS_TITLE}px; font-weight: bold; color: {COLOR_INK};"
        )
        hint = QLabel("ยังไม่ได้บันทึก", self)
        hint.setStyleSheet(
            pill_style(
                COLOR_WAIT_BG, COLOR_WAIT_FG, font_px=FS_LABEL + 1, pad_v=8, pad_h=16, radius=16
            )
        )
        header.addWidget(self.title_label)
        header.addStretch()
        header.addWidget(hint)
        root.addLayout(header)

        card = QFrame(self)
        card.setObjectName("ConfirmCard")
        card.setStyleSheet(card_style("ConfirmCard", radius=16))
        body = QHBoxLayout(card)
        body.setContentsMargins(16, 16, 16, 16)
        body.setSpacing(18)

        self.image_label = QLabel(card)
        self.image_label.setFixedSize(_IMG_SIZE, _IMG_SIZE)
        self.image_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.image_label.setStyleSheet(
            f"background-color: {COLOR_DARK}; border-radius: 12px; color: {COLOR_ON_DARK}; "
            f"font-size: {FS_LABEL}px; font-weight: bold;"
        )

        text_col = QVBoxLayout()
        text_col.setSpacing(8)
        self.question_label = QLabel("", card)
        self.question_label.setStyleSheet(
            f"font-size: {FS_BODY}px; font-weight: bold; color: {COLOR_MUTED};"
        )
        self.name_label = FitLabel("", card, min_px=22)
        self.name_label.setStyleSheet(
            f"font-size: {FS_HERO}px; font-weight: bold; color: {COLOR_INK};"
        )
        self.detail_label = FitLabel("", card, min_px=16)
        self.detail_label.setStyleSheet(
            f"font-size: {FS_BODY}px; font-weight: bold; color: {COLOR_INK};"
        )
        self.badge_label = QLabel("", card)

        text_col.addStretch()
        text_col.addWidget(self.question_label)
        text_col.addWidget(self.name_label)
        text_col.addWidget(self.detail_label)
        text_col.addWidget(self.badge_label, alignment=Qt.AlignmentFlag.AlignLeft)
        text_col.addStretch()

        body.addWidget(self.image_label, alignment=Qt.AlignmentFlag.AlignVCenter)
        body.addLayout(text_col, stretch=1)
        root.addWidget(card, stretch=1)

        # Two O guides (green for check-in, orange for check-out); only one is visible.
        nav = QHBoxLayout()
        nav.setSpacing(10)
        self.pill_o_in = create_key_guide(
            "ConfirmPillOIn", "O", "ยืนยันนำเข้า", COLOR_FRESH, COLOR_ON_BAD, self
        )
        self.pill_o_out = create_key_guide(
            "ConfirmPillOOut", "O", "ยืนยันนำออก", COLOR_TAKE_SOLID, COLOR_ON_TAKE, self
        )
        pill_x = create_key_guide("ConfirmPillX", "X", "กลับไปแก้ไข", COLOR_DARK, COLOR_ON_DARK, self)
        nav.addWidget(self.pill_o_in, stretch=1)
        nav.addWidget(self.pill_o_out, stretch=1)
        nav.addWidget(pill_x, stretch=1)
        root.addLayout(nav)

    def show_confirm(
        self,
        kind: ConfirmKind,
        name_th: str,
        detail: str,
        badge: tuple[str, str, str] | None = None,
        pixmap: QPixmap | None = None,
    ) -> None:
        """Fills the summary card for the item about to be saved."""
        self.kind = kind
        is_in = kind == "checkin"
        self.title_label.setText("ยืนยันนำเข้า" if is_in else "ยืนยันนำออก")
        self.question_label.setText(
            "ต้องการนำรายการนี้เข้าตู้เย็นใช่ไหม?" if is_in else "ต้องการนำรายการนี้ออกใช่ไหม?"
        )
        self.name_label.setText(name_th)
        self.detail_label.setText(detail)
        self.pill_o_in.setVisible(is_in)
        self.pill_o_out.setVisible(not is_in)

        if badge is not None:
            text, bg, fg = badge
            self.badge_label.setText(text)
            self.badge_label.setStyleSheet(
                pill_style(bg, fg, font_px=FS_LABEL, pad_v=4, pad_h=12, radius=12)
            )
            self.badge_label.show()
        else:
            self.badge_label.hide()

        if pixmap is not None and not pixmap.isNull():
            self.image_label.setPixmap(
                pixmap.scaled(
                    _IMG_SIZE - 8,
                    _IMG_SIZE - 8,
                    Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation,
                )
            )
        else:
            self.image_label.clear()
            self.image_label.setText("ไม่มีภาพ")

    def handle_select(self) -> None:
        """O: save the item."""
        self._on_confirm()

    def handle_cancel(self) -> None:
        """X: go back to the edit screen without saving."""
        self._on_back()
