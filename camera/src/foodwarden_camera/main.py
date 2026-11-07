"""Main entrypoint for FoodWarden Edge Gateway & Camera Logger (Node 'C')."""

from __future__ import annotations

import logging
import os
import sys

from PyQt6.QtWidgets import QApplication

from foodwarden_camera.config import settings
from foodwarden_camera.orchestrator import GatewayOrchestrator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] (%(name)s) %(message)s",
)
logger = logging.getLogger("foodwarden_camera")


def main() -> int:
    """Initializes and runs the FoodWarden Gateway application."""
    logger.info("Initializing FoodWarden Camera Logger (Node 'C')...")

    # Prevent opencv-python from overriding PyQt6's platform plugin path on Linux
    os.environ.pop("QT_QPA_PLATFORM_PLUGIN_PATH", None)
    if sys.platform.startswith("linux") and not os.getenv("QT_QPA_PLATFORM"):
        os.environ["QT_QPA_PLATFORM"] = "xcb"

    # On headless/Linux without X11 or when specified, allow offscreen
    if os.getenv("QT_QPA_PLATFORM"):
        logger.info("Running with QT_QPA_PLATFORM=%s", os.getenv("QT_QPA_PLATFORM"))

    app = QApplication.instance()
    if app is None:
        app = QApplication(sys.argv)

    orchestrator = GatewayOrchestrator(settings)

    # Display full screen on Pi-top 5" LCD, or fixed window on PC
    if sys.platform.startswith("linux"):
        orchestrator.window.showFullScreen()
    else:
        orchestrator.window.show()

    orchestrator.start()

    try:
        ret = app.exec()
    finally:
        orchestrator.stop()

    return ret


if __name__ == "__main__":
    sys.exit(main())
