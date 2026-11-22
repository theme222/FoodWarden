"""FoodWarden Pi-top 5-inch (800x480) LCD theme matching the Web Prototype."""

from __future__ import annotations

MAIN_WINDOW_WIDTH = 800
MAIN_WINDOW_HEIGHT = 480

FONT_FAMILY = "'Lexend', 'K2D', 'Noto Sans Thai', 'Segoe UI', 'Tahoma', sans-serif"

# Web Prototype light pale-lime design tokens (FoodWarden-Web-Prototype)
COLOR_BG = "#E9F2D2"
COLOR_SURFACE = "#FFFFFF"
COLOR_SURFACE_2 = "#F2F7E3"
COLOR_INK = "#161A12"
COLOR_MUTED = "#59644E"
COLOR_RULE = "#D3E0B0"

COLOR_LIME = "#B4D44E"
COLOR_LIME_INK = "#1F2B08"
COLOR_LIME_SOFT = "#DCEBB0"
COLOR_LEAF = "#4E7A12"

COLOR_DARK = "#161A12"
COLOR_ON_DARK = "#F4F9E6"
COLOR_ON_DARK_2 = "#C9E07A"

COLOR_FRESH = "#2E6B1F"
COLOR_ON_FRESH = "#FFFFFF"
COLOR_SOON = "#F2A33A"
COLOR_ON_SOON = "#2B1A02"
COLOR_BAD = "#D6432C"
COLOR_ON_BAD = "#FFFFFF"
COLOR_TAKE_SOLID = "#E4581F"
COLOR_ON_TAKE = "#FFFFFF"

COLOR_WAIT_BG = "#D8E2C2"
COLOR_WAIT_FG = "#4B5542"


def pill_style(
    bg: str,
    fg: str,
    *,
    font_px: int = 13,
    pad_v: int = 4,
    pad_h: int = 10,
    radius: int = 12,
    border: str | None = None,
) -> str:
    """Returns QLabel pill stylesheet matching Web Prototype rounded badges."""
    border_css = f" border: 1px solid {border};" if border else ""
    return (
        f"background-color: {bg}; color: {fg}; font-size: {font_px}px; "
        f"font-weight: bold; padding: {pad_v}px {pad_h}px; "
        f"border-radius: {radius}px;{border_css}"
    )


def card_style(
    object_name: str,
    *,
    bg: str = COLOR_SURFACE,
    border: str = COLOR_RULE,
    radius: int = 16,
) -> str:
    """Returns QFrame card stylesheet with scoped selector."""
    return (
        f"#{object_name} {{ background-color: {bg}; "
        f"border: 1.5px solid {border}; border-radius: {radius}px; }}"
    )


THEME_STYLESHEET = f"""
QWidget {{
    background-color: {COLOR_BG};
    color: {COLOR_INK};
    font-family: {FONT_FAMILY};
}}

QLabel {{
    background-color: transparent;
}}

QPushButton {{
    background-color: {COLOR_SURFACE};
    color: {COLOR_INK};
    border: 1.5px solid {COLOR_RULE};
    border-radius: 12px;
    padding: 8px 14px;
    font-weight: bold;
    font-size: 14px;
}}

QPushButton:hover {{
    background-color: {COLOR_SURFACE_2};
    border-color: {COLOR_LEAF};
}}

QPushButton:pressed {{
    background-color: {COLOR_LIME_SOFT};
}}

QLineEdit, QSpinBox {{
    background-color: {COLOR_SURFACE_2};
    color: {COLOR_INK};
    border: 1.5px solid {COLOR_RULE};
    border-radius: 10px;
    padding: 6px 10px;
    font-size: 16px;
    font-weight: bold;
}}

QLineEdit:focus, QSpinBox:focus {{
    border: 2px solid {COLOR_LEAF};
    background-color: {COLOR_SURFACE};
}}

QListWidget {{
    background-color: {COLOR_SURFACE};
    color: {COLOR_INK};
    border: 1.5px solid {COLOR_RULE};
    border-radius: 14px;
    padding: 4px;
    outline: 0;
}}

QListWidget::item {{
    background-color: {COLOR_SURFACE_2};
    color: {COLOR_INK};
    padding: 10px 12px;
    margin: 3px 2px;
    border: 1.5px solid {COLOR_RULE};
    border-radius: 10px;
}}

QListWidget::item:selected {{
    background-color: {COLOR_DARK};
    border: 2px solid {COLOR_LIME};
    color: {COLOR_ON_DARK};
}}
"""

# Backward-compatible export expected by FoodWardenMainWindow
DARK_STYLESHEET = THEME_STYLESHEET
