"""Full-screen outcome card shown after a Check-In / Check-Out is submitted.

States:
    saving  - request sent, waiting for the server (no auto-return except a
              safety timeout, so the user sees the real outcome)
    success - "นำเข้าแล้ว" / "นำออกแล้ว"
    queued  - server unreachable; saved locally and will sync automatically
    failed  - not saved; tells the user why

Final states return to the Idle screen automatically; any button returns
immediately.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtWidgets import QFrame, QLabel, QVBoxLayout, QWidget

from foodwarden_camera.ui.styles import (
    COLOR_BAD,
    COLOR_FRESH,
    COLOR_INK,
    COLOR_MUTED,
    COLOR_ON_BAD,
    COLOR_ON_FRESH,
    COLOR_ON_SOON,
    COLOR_SOON,
    COLOR_WAIT_BG,
    COLOR_WAIT_FG,
    COLOR_WARN_TEXT,
    FS_BODY,
    FS_HERO,
    FS_LABEL,
    card_style,
)
from foodwarden_camera.ui.widgets import FitLabel

ResultKind = Literal["checkin", "checkout"]
ResultStatus = Literal["saving", "success", "queued", "failed"]

SUCCESS_RETURN_MS = 3000
FAILED_RETURN_MS = 6000
SAVING_SAFETY_MS = 30000  # cloud client timeout is 20 s


class ResultScreen(QWidget):
    """Big icon + headline + item name, e.g. "✓ นำเข้าแล้ว — นมสด"."""

    def __init__(self, on_done: Callable[[], None], parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._on_done = on_done
        self.kind: ResultKind = "checkin"
        self.status: ResultStatus = "saving"
        self.item_name = ""

        self._return_timer = QTimer(self)
        self._return_timer.setSingleShot(True)
        self._return_timer.timeout.connect(self._finish)

        self._init_ui()

    def _init_ui(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(14, 14, 14, 14)

        self.card = QFrame(self)
        self.card.setObjectName("ResultCard")
        col = QVBoxLayout(self.card)
        col.setContentsMargins(30, 20, 30, 20)
        col.setSpacing(10)

        self.icon_label = QLabel("", self.card)
        self.icon_label.setFixedSize(110, 110)
        self.icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.headline_label = QLabel("", self.card)
        self.headline_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.name_label = FitLabel("", self.card, min_px=22)
        self.name_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.name_label.setStyleSheet(
            f"font-size: {FS_HERO}px; font-weight: bold; color: {COLOR_INK};"
        )

        self.message_label = QLabel("", self.card)
        self.message_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.message_label.setWordWrap(True)
        self.message_label.setStyleSheet(
            f"font-size: {FS_BODY}px; font-weight: bold; color: {COLOR_MUTED};"
        )

        self.hint_label = QLabel("กดปุ่มใดก็ได้เพื่อกลับหน้าหลัก", self.card)
        self.hint_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.hint_label.setStyleSheet(f"font-size: {FS_LABEL}px; color: {COLOR_MUTED};")

        col.addStretch()
        col.addWidget(self.icon_label, alignment=Qt.AlignmentFlag.AlignCenter)
        col.addWidget(self.headline_label)
        col.addWidget(self.name_label)
        col.addWidget(self.message_label)
        col.addStretch()
        col.addWidget(self.hint_label)

        root.addWidget(self.card)

    # ------------------------------------------------------------------

    def show_saving(self, kind: ResultKind, item_name: str) -> None:
        """Shown immediately after the user (or auto-confirm) submits."""
        self.kind = kind
        self.item_name = item_name
        self._apply(
            "saving",
            "…",
            "กำลังบันทึก...",
            "รอการตอบกลับจากระบบ",
            COLOR_WAIT_BG,
            COLOR_WAIT_FG,
        )
        self._return_timer.start(SAVING_SAFETY_MS)

    def show_outcome(self, status: ResultStatus, message: str = "") -> None:
        """Updates the card with the server's answer and schedules return to Idle."""
        is_in = self.kind == "checkin"
        if status == "success":
            headline = "นำเข้าแล้ว" if is_in else "นำออกแล้ว"
            default = "บันทึกเข้าตู้เย็นเรียบร้อย" if is_in else "ลบออกจากรายการในตู้เย็นแล้ว"
            self._apply(status, "✓", headline, message or default, COLOR_FRESH, COLOR_ON_FRESH)
            self._return_timer.start(SUCCESS_RETURN_MS)
        elif status == "queued":
            default = "ตอนนี้ออฟไลน์ ระบบจะส่งข้อมูลให้อัตโนมัติเมื่อกลับมาออนไลน์"
            self._apply(
                status, "!", "บันทึกไว้ในเครื่องแล้ว", message or default, COLOR_SOON, COLOR_ON_SOON
            )
            self._return_timer.start(FAILED_RETURN_MS)
        elif status == "failed":
            default = "กรุณาลองใหม่อีกครั้ง"
            self._apply(status, "✕", "บันทึกไม่สำเร็จ", message or default, COLOR_BAD, COLOR_ON_BAD)
            self._return_timer.start(FAILED_RETURN_MS)

    def _apply(
        self,
        status: ResultStatus,
        icon: str,
        headline: str,
        message: str,
        accent: str,
        on_accent: str,
    ) -> None:
        self.status = status
        self.card.setStyleSheet(card_style("ResultCard", border=accent, radius=20))
        self.icon_label.setText(icon)
        self.icon_label.setStyleSheet(
            f"background-color: {accent}; color: {on_accent}; font-size: 64px; "
            "font-weight: bold; border-radius: 55px;"
        )
        self.headline_label.setText(headline)
        headline_color = COLOR_INK if status == "saving" else accent
        if status == "queued":
            headline_color = COLOR_WARN_TEXT  # amber text readable on white
        self.headline_label.setStyleSheet(
            f"font-size: {FS_HERO + 4}px; font-weight: bold; color: {headline_color};"
        )
        self.name_label.setText(self.item_name)
        self.message_label.setText(message)

    def _finish(self) -> None:
        self._return_timer.stop()
        self._on_done()

    def handle_any_button(self) -> None:
        """Any Pi-top button dismisses the card back to Idle."""
        self._finish()
