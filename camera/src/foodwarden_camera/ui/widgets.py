"""Shared building blocks for the Check-In / Check-Out flow screens."""

from __future__ import annotations

from datetime import date

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import QFrame, QHBoxLayout, QLabel, QWidget

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
)

KEY_GUIDE_HEIGHT = 58


def create_key_guide(
    object_name: str,
    key_text: str,
    label_text: str,
    bg_color: str,
    fg_color: str,
    parent: QWidget,
    *,
    border_color: str | None = None,
) -> QFrame:
    """Builds a bottom button-guide pill: [key badge] label, matching the Idle CTAs."""
    pill = QFrame(parent)
    pill.setObjectName(object_name)
    pill.setFixedHeight(KEY_GUIDE_HEIGHT)
    pill.setStyleSheet(
        card_style(object_name, bg=bg_color, border=border_color or bg_color, radius=14)
    )
    row = QHBoxLayout(pill)
    row.setContentsMargins(10, 6, 12, 6)
    row.setSpacing(10)

    badge = QLabel(key_text, pill)
    badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
    badge.setFixedSize(40, 40)
    badge.setStyleSheet(
        f"background-color: {fg_color}; color: {bg_color}; "
        f"font-size: {FS_LABEL + 2}px; font-weight: bold; border-radius: 10px;"
    )

    lbl = QLabel(label_text, pill)
    lbl.setObjectName(f"{object_name}Label")
    lbl.setStyleSheet(f"font-size: {FS_LABEL + 2}px; font-weight: bold; color: {fg_color};")

    row.addWidget(badge)
    row.addWidget(lbl, stretch=1)
    return pill


def create_screen_header(title_text: str, parent: QWidget) -> tuple[QHBoxLayout, QLabel]:
    """Builds the flow-screen header row (title left, countdown pill right).

    Returns the layout and the countdown label so the screen can update it.
    """
    header = QHBoxLayout()
    header.setSpacing(10)

    title = QLabel(title_text, parent)
    title.setStyleSheet(f"font-size: {FS_TITLE}px; font-weight: bold; color: {COLOR_INK};")

    countdown = QLabel("", parent)
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
        return f"เลยมา {-days_left} วัน", COLOR_BAD, COLOR_ON_BAD
    if days_left == 0:
        return "หมดวันนี้", COLOR_BAD, COLOR_ON_BAD
    if days_left <= 3:
        return f"อีก {days_left} วัน", COLOR_SOON, COLOR_ON_SOON
    return f"อีก {days_left} วัน", COLOR_LIME_SOFT, COLOR_LIME_INK
