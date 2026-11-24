"""Shared building blocks for the Check-In / Check-Out flow screens."""

from __future__ import annotations

from datetime import date

from PyQt6.QtCore import QSize, Qt
from PyQt6.QtGui import QFont, QFontMetrics, QPainter, QPaintEvent
from PyQt6.QtWidgets import QFrame, QHBoxLayout, QLabel, QSizePolicy, QWidget

from foodwarden_camera.ui.i18n import bind_text, t
from foodwarden_camera.ui.smooth import SmoothFrame, SmoothLabel
from foodwarden_camera.ui.styles import (
    COLOR_BAD,
    COLOR_INK,
    COLOR_LIME_INK,
    COLOR_LIME_SOFT,
    COLOR_ON_BAD,
    COLOR_ON_SOON,
    COLOR_SOON,
    FS_LABEL,
    FS_TITLE,
    card_style,
    pill_style,
    smooth_css,
)

KEY_GUIDE_HEIGHT = 58


def create_key_guide(
    object_name: str,
    key_text: str,
    label_key: str,
    bg_color: str,
    fg_color: str,
    parent: QWidget,
    *,
    border_color: str | None = None,
) -> QFrame:
    """Builds a bottom button-guide pill: [key badge] label, matching the Idle CTAs.

    ``label_key`` is an i18n key; the label follows language switches.
    """
    pill = SmoothFrame(parent)
    pill.setObjectName(object_name)
    pill.setFixedHeight(KEY_GUIDE_HEIGHT)
    pill.setStyleSheet(
        card_style(object_name, bg=bg_color, border=border_color or bg_color, radius=14)
    )
    row = QHBoxLayout(pill)
    row.setContentsMargins(10, 6, 12, 6)
    row.setSpacing(10)

    badge = SmoothLabel(key_text, pill)
    badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
    badge.setFixedSize(40, 40)
    badge.setStyleSheet(
        f"color: {bg_color}; font-size: {FS_LABEL + 2}px; font-weight: bold; "
        f"{smooth_css(fg_color, radius=11)}"
    )

    lbl = SmoothLabel(pill)
    lbl.setObjectName(f"{object_name}Label")
    bind_text(lbl, label_key)
    lbl.setStyleSheet(f"font-size: {FS_LABEL + 2}px; font-weight: bold; color: {fg_color};")

    row.addWidget(badge)
    row.addWidget(lbl, stretch=1)
    return pill


def create_screen_header(title_key: str, parent: QWidget) -> tuple[QHBoxLayout, QLabel]:
    """Builds the flow-screen header row (title left, countdown pill right).

    Returns the layout and the countdown label so the screen can update it.
    """
    header = QHBoxLayout()
    header.setSpacing(10)

    title = bind_text(SmoothLabel(parent), title_key)
    title.setStyleSheet(f"font-size: {FS_TITLE}px; font-weight: bold; color: {COLOR_INK};")

    countdown = SmoothLabel("", parent)
    countdown.setStyleSheet(countdown_style())

    header.addWidget(title)
    header.addStretch()
    header.addWidget(countdown)
    return header, countdown


def countdown_style(bg: str = COLOR_LIME_SOFT, fg: str = COLOR_LIME_INK) -> str:
    """Stylesheet for the header auto-confirm countdown pill."""
    return pill_style(bg, fg, font_px=FS_LABEL + 1, pad_v=8, pad_h=16, radius=16)


def days_left_badge(expiry: date, today: date | None = None) -> tuple[str, str, str]:
    """Returns (text, bg, fg) for a human-readable 'days until expiry' badge."""
    days_left = (expiry - (today or date.today())).days
    if days_left < 0:
        return t("days.overdue", n=-days_left), COLOR_BAD, COLOR_ON_BAD
    if days_left == 0:
        return t("days.today"), COLOR_BAD, COLOR_ON_BAD
    if days_left <= 3:
        return t("days.left", n=days_left), COLOR_SOON, COLOR_ON_SOON
    return t("days.left", n=days_left), COLOR_LIME_SOFT, COLOR_LIME_INK


class FitLabel(QLabel):
    """Single-line label that never clips mid-glyph.

    Thai has no spaces, so Qt word-wrap can't break long names and the text
    gets cut off at the card edge. This label instead shrinks its font one
    pixel at a time (down to ``min_px``) until the text fits, then elides
    with "…" as a last resort. ``text()`` always returns the full string and
    the full text is shown as a tooltip when it had to be shortened.
    """

    def __init__(self, text: str, parent: QWidget | None = None, *, min_px: int = 14) -> None:
        super().__init__(text, parent)
        self.min_px = min_px
        self.setWordWrap(False)
        self.setSizePolicy(QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Preferred)

    def minimumSizeHint(self) -> QSize:
        return QSize(0, super().minimumSizeHint().height())

    def paintEvent(self, event: QPaintEvent | None) -> None:
        self.ensurePolished()
        rect = self.contentsRect()
        text = self.text()
        font = QFont(self.font())
        base_px = font.pixelSize() if font.pixelSize() > 0 else round(font.pointSizeF() * 4 / 3)
        px = base_px
        while px > self.min_px and QFontMetrics(font).horizontalAdvance(text) > rect.width():
            px -= 1
            font.setPixelSize(px)
        metrics = QFontMetrics(font)
        shown = metrics.elidedText(text, Qt.TextElideMode.ElideRight, rect.width())
        self.setToolTip(text if shown != text or px != base_px else "")

        painter = QPainter(self)
        painter.setFont(font)
        painter.setPen(self.palette().color(self.foregroundRole()))
        painter.drawText(rect, int(self.alignment() | Qt.AlignmentFlag.AlignVCenter), shown)
        painter.end()


# --- Flow countdowns (seconds) -------------------------------------------------
# Initial countdown is user-configurable (Settings → AUTOCOMPLETE_TIMEOUT_S).
DEFAULT_AUTOCOMPLETE_S = 10
# After the user starts editing/scrolling: restarts on every button press.
EDIT_TIMEOUT_S = 30
# On the explicit confirm step.
CONFIRM_TIMEOUT_S = 7
