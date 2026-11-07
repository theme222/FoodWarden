"""Bilingual Alert Banner / Overlay for emergency door safety and offline warnings."""

from __future__ import annotations

from PyQt6.QtCore import QTimer
from PyQt6.QtWidgets import QFrame, QHBoxLayout, QLabel, QVBoxLayout, QWidget


class AlertBanner(QFrame):
    """Bilingual dismissible alert banner displayed at top of the LCD."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("AlertBanner")
        self.setFixedHeight(64)
        self.setStyleSheet(
            """
            #AlertBanner {
                background-color: #7F1D1D;
                border: 2px solid #EF4444;
                border-radius: 6px;
            }
            """
        )

        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 6, 12, 6)

        text_layout = QVBoxLayout()
        self.label_th = QLabel("แจ้งเตือนความปลอดภัย", self)
        self.label_th.setStyleSheet("font-size: 15px; font-weight: bold; color: #FFFFFF;")

        self.label_en = QLabel("Safety Alert", self)
        self.label_en.setStyleSheet("font-size: 11px; color: #FCA5A5;")

        text_layout.addWidget(self.label_th)
        text_layout.addWidget(self.label_en)
        layout.addLayout(text_layout)

        self.hide()
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self.hide)

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

        bg = "#7F1D1D" if is_critical else "#78350F"
        border = "#EF4444" if is_critical else "#F59E0B"
        self.setStyleSheet(
            f"""
            #AlertBanner {{
                background-color: {bg};
                border: 2px solid {border};
                border-radius: 6px;
            }}
            """
        )

        self.show()
        if duration_ms > 0:
            self._timer.start(duration_ms)

    def show_person_abort_alert(self) -> None:
        """Standard alert when person enters frame during door closure."""
        self.show_alert(
            message_th="ตรวจพบบุคคล! ยกเลิกการปิดประตูทันที",
            message_en="Person detected: Aborting door closure immediately",
            is_critical=True,
            duration_ms=6000,
        )

    def show_offline_warning(self) -> None:
        """Standard warning when internet/cloud connection is lost."""
        self.show_alert(
            message_th="ไม่มีสัญญาณอินเทอร์เน็ต (ใช้งานโหมดออฟไลน์)",
            message_en="Wi-Fi Not Connected (Operating in Offline Mode)",
            is_critical=False,
            duration_ms=5000,
        )

