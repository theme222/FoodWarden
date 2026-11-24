"""Bundled UI fonts: Lexend (Latin) + K2D (Thai).

The fonts ship inside the package (``assets/fonts``, SIL OFL 1.1) and are
registered with Qt at start-up, so the Pi-top renders exactly like a dev
machine without installing anything system-wide.

The family stack lists Lexend first: Qt draws Latin glyphs with Lexend and,
because Lexend has no Thai glyphs, falls back per-glyph to K2D for Thai.
"""

from __future__ import annotations

import logging
from pathlib import Path

from PyQt6.QtGui import QFontDatabase

logger = logging.getLogger(__name__)

FONTS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
LATIN_FAMILY = "Lexend"
THAI_FAMILY = "K2D"

_FONT_FILES = ("Lexend-Regular.ttf", "Lexend-Bold.ttf", "K2D-Regular.ttf", "K2D-Bold.ttf")
_loaded_families: set[str] = set()


def load_bundled_fonts() -> set[str]:
    """Registers the bundled fonts with Qt (idempotent). Needs a QGuiApplication.

    Returns the font families that were successfully registered. Missing or
    corrupt files are logged and skipped; Qt then falls back to the next
    family in the stylesheet stack, so the UI still renders.
    """
    if _loaded_families:
        return set(_loaded_families)
    for name in _FONT_FILES:
        path = FONTS_DIR / name
        if not path.is_file():
            logger.warning("Bundled font missing: %s", path)
            continue
        font_id = QFontDatabase.addApplicationFont(str(path))
        if font_id < 0:
            logger.warning("Qt could not load bundled font: %s", path)
            continue
        _loaded_families.update(QFontDatabase.applicationFontFamilies(font_id))
    logger.info("Loaded bundled UI fonts: %s", ", ".join(sorted(_loaded_families)) or "none")
    return set(_loaded_families)
