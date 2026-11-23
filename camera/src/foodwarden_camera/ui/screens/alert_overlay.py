"""Bilingual Alert Banner aligned with Web Prototype status styling."""

from __future__ import annotations

from PyQt6.QtCore import QTimer
from PyQt6.QtWidgets import QFrame, QHBoxLayout, QLabel, QVBoxLayout, QWidget

from foodwarden_camera.ui.styles import (
    COLOR_BAD,
    COLOR_FRESH,
    COLOR_ON_BAD,
    COLOR_ON_FRESH,
    COLOR_ON_SOON,
    COLOR_SOON,
    card_style,
)


class AlertBanner(QFrame):
    """Concise, high-contrast dismissible alert banner at top of the LCD."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("AlertBanner")
        self.setFixedHeight(84)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(16, 8, 16, 8)

        text_layout = QVBoxLayout()
        text_layout.setSpacing(1)
        self.label_th = QLabel("แจ้งเตือนความปลอดภัย", self)
        self.label_en = QLabel("Safety Alert", self)
        text_layout.addWidget(self.label_th)
        text_layout.addWidget(self.label_en)
        layout.addLayout(text_layout)

        self._apply_severity_style(is_critical=True)
        self.hide()
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self.hide)

    def _apply_severity_style(self, *, is_critical: bool, is_success: bool = False) -> None:
        if is_success:
            bg, fg = COLOR_FRESH, COLOR_ON_FRESH
        else:
            bg = COLOR_BAD if is_critical else COLOR_SOON
            fg = COLOR_ON_BAD if is_critical else COLOR_ON_SOON
        self.setStyleSheet(card_style("AlertBanner", bg=bg, border=bg, radius=14))
        self.label_th.setStyleSheet(f"font-size: 24px; font-weight: bold; color: {fg};")
        self.label_en.setStyleSheet(f"font-size: 17px; font-weight: bold; color: {fg};")

    def show_alert(
        self,
        message_th: str,
        message_en: str,
        is_critical: bool = True,
        duration_ms: int = 5000,
    ) -> None:
        """Shows bilingual alert with auto-hide timer."""
        self.label_th.setText(message_th)
        self.label_en.setText(message_en)
        self._apply_severity_style(is_critical=is_critical)

        self.show()
        if duration_ms > 0:
            self._timer.start(duration_ms)

    def show_person_abort_alert(self) -> None:
        """Standard alert when person enters frame during door closure."""
        self.show_alert(
            message_th="ตรวจพบบุคคล! ยกเลิกปิดประตู",
            message_en="Person detected — Door close aborted",
            is_critical=True,
            duration_ms=6000,
        )

    def show_door_closing_alert(self) -> None:
        """Informational alert when automatic door closure command is issued."""
        self.show_alert(
            message_th="ประตูเปิดค้าง — กำลังปิดอัตโนมัติ",
            message_en="Door open — Sending CLOSE_DOOR",
            is_critical=False,
            duration_ms=4000,
        )

    def show_offline_warning(self) -> None:
        """Standard warning when internet/cloud connection is lost."""
        self.show_alert(
            message_th="ไม่มีสัญญาณอินเทอร์เน็ต (ออฟไลน์)",
            message_en="Offline — No Internet",
            is_critical=False,
            duration_ms=5000,
        )

    def show_success(self, message_th: str, message_en: str, duration_ms: int = 4000) -> None:
        """Green confirmation banner (e.g. a save that finished after leaving the result card)."""
        self.label_th.setText(message_th)
        self.label_en.setText(message_en)
        self._apply_severity_style(is_critical=False, is_success=True)
        self.show()
        if duration_ms > 0:
            self._timer.start(duration_ms)
