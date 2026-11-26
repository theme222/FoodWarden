"""Main entrypoint for FoodWarden Edge Gateway & Camera Logger (Node 'C')."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path

from PyQt6.QtGui import QIcon
from PyQt6.QtWidgets import QApplication

from foodwarden_camera.config import settings
from foodwarden_camera.orchestrator import GatewayOrchestrator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] (%(name)s) %(message)s",
)
_timing_log_file = os.getenv("TIMING_LOG_FILE", "").strip()
if _timing_log_file:
    _log_path = Path(_timing_log_file)
    _log_path.parent.mkdir(parents=True, exist_ok=True)
    _file_handler = logging.FileHandler(_log_path, encoding="utf-8")
    _file_handler.setLevel(logging.INFO)
    _file_handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] (%(name)s) %(message)s")
    )
    logging.getLogger().addHandler(_file_handler)
logger = logging.getLogger("foodwarden_camera")


def _camera_root_dir() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def ensure_desktop_shortcut() -> None:
    """Creates a Desktop launcher (.desktop) on Linux when ~/Desktop exists."""
    if not sys.platform.startswith("linux"):
        return

    camera_dir = _camera_root_dir()
    icon_path = camera_dir / "deploy" / "foodwarden-icon.svg"
    uv_bin = shutil.which("uv") or str(Path.home() / ".local" / "bin" / "uv")

    desktop_entry = (
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=FoodWarden Camera Gateway\n"
        "Comment=Launch FoodWarden Smart Fridge Camera UI (Node C)\n"
        f'Exec=/bin/bash -c "export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH && '
        f"cd '{camera_dir}' && '{uv_bin}' run --no-sync foodwarden-camera\"\n"
        f"Path={camera_dir}\n"
        f"Icon={icon_path}\n"
        "Terminal=false\n"
        "Categories=Utility;Application;\n"
        "StartupNotify=true\n"
    )

    targets: list[Path] = []
    desktop_dir = Path.home() / "Desktop"
    if desktop_dir.is_dir():
        targets.append(desktop_dir / "foodwarden-camera.desktop")

    apps_dir = Path.home() / ".local" / "share" / "applications"
    apps_dir.mkdir(parents=True, exist_ok=True)
    targets.append(apps_dir / "foodwarden-camera.desktop")

    for target in targets:
        try:
            target.write_text(desktop_entry, encoding="utf-8", newline="\n")
            target.chmod(0o755)
            if target.parent == desktop_dir and shutil.which("gio"):
                subprocess.run(
                    ["gio", "set", str(target), "metadata::trusted", "true"],
                    check=False,
                    timeout=2.0,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
        except OSError as exc:
            logger.debug("Could not write desktop shortcut %s: %s", target, exc)


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

    ensure_desktop_shortcut()

    app = QApplication.instance()
    if app is None:
        app = QApplication(sys.argv)

    icon_path = _camera_root_dir() / "deploy" / "foodwarden-icon.svg"
    if icon_path.exists():
        app_icon = QIcon(str(icon_path))
        if isinstance(app, QApplication):
            app.setWindowIcon(app_icon)

    orchestrator = GatewayOrchestrator(settings)
    if icon_path.exists():
        orchestrator.window.setWindowIcon(QIcon(str(icon_path)))

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
