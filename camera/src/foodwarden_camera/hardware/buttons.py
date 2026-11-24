"""Pi-top [4] Built-in Case Button Controller with Dev/PC keyboard fallback.

Manages hardware interrupts for the 4 physical buttons (Up, Down, O, X)
interfaced via the Pi-top Hub MCU per ARCHITECTURE.md §1.B.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class ButtonType(str, Enum):
    """The 4 physical navigation buttons on the Pi-top [4] top chassis."""

    UP = "UP"  # ▲ - Increment date segment / scroll up
    DOWN = "DOWN"  # ▼ - Decrement date segment / scroll down
    SELECT = "SELECT"  # O - Check-In trigger / Advance / Confirm
    CANCEL = "CANCEL"  # X - Check-Out trigger / Cancel / Emergency Abort


class ButtonController:
    """Manages button press callbacks with hardware and mock fallback support."""

    def __init__(self) -> None:
        self._callbacks: dict[ButtonType, list[Callable[[], None]]] = {
            ButtonType.UP: [],
            ButtonType.DOWN: [],
            ButtonType.SELECT: [],
            ButtonType.CANCEL: [],
        }
        self.is_hardware_available: bool = False
        self._init_hardware()

    def _init_hardware(self) -> None:
        """Attempts to register interrupt callbacks via the pitop SDK."""
        try:
            # 1. Try real Pi-top [4] Miniscreen instance buttons or button classes
            try:
                from pitop.miniscreen import (  # type: ignore[import-not-found]
                    CancelButton,
                    DownButton,
                    SelectButton,
                    UpButton,
                )

                self._up_btn: Any = UpButton()
                self._down_btn: Any = DownButton()
                self._select_btn: Any = SelectButton()
                self._cancel_btn: Any = CancelButton()
            except ImportError:
                from pitop.miniscreen import Miniscreen

                self._miniscreen: Any = Miniscreen()
                self._up_btn = self._miniscreen.up_button
                self._down_btn = self._miniscreen.down_button
                self._select_btn = self._miniscreen.select_button
                self._cancel_btn = self._miniscreen.cancel_button

            self._up_btn.when_pressed = lambda: self.emit_button_press(ButtonType.UP)
            self._down_btn.when_pressed = lambda: self.emit_button_press(ButtonType.DOWN)
            self._select_btn.when_pressed = lambda: self.emit_button_press(ButtonType.SELECT)
            self._cancel_btn.when_pressed = lambda: self.emit_button_press(ButtonType.CANCEL)

            self.is_hardware_available = True
            logger.info("Successfully bound Pi-top [4] physical case buttons (Up, Down, O, X)")
        except (ImportError, RuntimeError, OSError, Exception) as exc:  # noqa: BLE001
            self.is_hardware_available = False
            logger.info(
                "Pi-top hardware SDK not available (%s). Running buttons in Dev/Emulation mode.",
                exc,
            )

    def register_callback(self, button: ButtonType, callback: Callable[[], None]) -> None:
        """Subscribes a callable to be triggered when the specified button is pressed."""
        self._callbacks[button].append(callback)

    def unregister_callback(self, button: ButtonType, callback: Callable[[], None]) -> None:
        """Removes a registered callback."""
        if callback in self._callbacks[button]:
            self._callbacks[button].remove(callback)

    def emit_button_press(self, button: ButtonType) -> None:
        """Emits a button press event, invoking all registered handlers."""
        logger.info("Button pressed: %s", button.value)
        handlers = list(self._callbacks.get(button, []))
        for handler in handlers:
            try:
                handler()
            except Exception:
                logger.exception("Error in callback for button %s", button.value)
