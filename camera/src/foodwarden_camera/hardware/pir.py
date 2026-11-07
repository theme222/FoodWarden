"""Digital PIR Motion Sensor and Display Sleep Manager (Rubric M1 Gateway Sensor #2).

Monitors HC-SR501 / AM312 PIR sensor connected to Pi-top GPIO 22.
Wakes the 5-inch LCD display and webcam stream upon motion detection, and blanks
the display after 10 minutes (600s) of continuous inactivity per SUMMARY.md §5.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)


class PIRController:
    """Manages PIR human motion sensing and automatic screen power saving."""

    def __init__(
        self,
        gpio_pin: int = 22,
        inactivity_timeout_s: float = 600.0,  # 10 minutes
        on_wake: Callable[[], None] | None = None,
        on_sleep: Callable[[], None] | None = None,
    ) -> None:
        self.gpio_pin = gpio_pin
        self.inactivity_timeout_s = inactivity_timeout_s
        self.on_wake = on_wake
        self.on_sleep = on_sleep

        self._is_motion_detected: bool = False
        self._is_display_awake: bool = True
        self._last_motion_time: float = time.time()
        self.is_hardware_available: bool = False

        self._running: bool = False
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

        self._init_hardware()

    @property
    def is_motion_detected(self) -> bool:
        return self._is_motion_detected

    @property
    def is_display_awake(self) -> bool:
        return self._is_display_awake

    @property
    def last_motion_time(self) -> float:
        return self._last_motion_time

    @property
    def idle_duration_s(self) -> float:
        """Seconds elapsed since last detected human motion."""
        return max(0.0, time.time() - self._last_motion_time)

    def _init_hardware(self) -> None:
        """Attempts to bind to hardware GPIO pin on Raspberry Pi OS."""
        try:
            from gpiozero import DigitalInputDevice  # type: ignore[import-not-found]

            self._pir_device: Any = DigitalInputDevice(self.gpio_pin, pull_up=False)
            self._pir_device.when_activated = lambda: self.record_motion(True)
            self._pir_device.when_deactivated = lambda: self.record_motion(False)
            self.is_hardware_available = True
            logger.info("Bound PIR sensor to GPIO %d via gpiozero", self.gpio_pin)
        except (ImportError, RuntimeError, OSError) as exc:
            self.is_hardware_available = False
            logger.info(
                "GPIO hardware not available (%s). Running PIR in Dev/Simulation mode.",
                exc,
            )

    def record_motion(self, has_motion: bool) -> None:
        """Called upon sensor reading changes or simulation events."""
        with self._lock:
            self._is_motion_detected = has_motion
            if has_motion:
                self._last_motion_time = time.time()
                if not self._is_display_awake:
                    logger.info("Motion detected after sleep. Waking display and camera stream.")
                    self._is_display_awake = True
                    if self.on_wake:
                        try:
                            self.on_wake()
                        except Exception:
                            logger.exception("Error in PIR on_wake callback")

    def check_inactivity(self) -> bool:
        """Checks if idle duration exceeded timeout; puts display to sleep if so.

        Returns:
            True if display was put to sleep, False otherwise.
        """
        with self._lock:
            if not self._is_display_awake:
                return False

            if self.idle_duration_s >= self.inactivity_timeout_s:
                logger.info(
                    "No motion for %.1f s (>= %.1f s). Putting display to sleep to prevent burn-in.",
                    self.idle_duration_s,
                    self.inactivity_timeout_s,
                )
                self._is_display_awake = False
                if self.on_sleep:
                    try:
                        self.on_sleep()
                    except Exception:
                        logger.exception("Error in PIR on_sleep callback")
                return True

        return False

    def wake(self) -> None:
        """Manually forces display wake."""
        self.record_motion(True)

    def sleep(self) -> None:
        """Manually forces display sleep."""
        with self._lock:
            self._is_display_awake = False
            if self.on_sleep:
                try:
                    self.on_sleep()
                except Exception:
                    logger.exception("Error in PIR on_sleep callback")

    def start_monitor(self, poll_interval_s: float = 2.0) -> None:
        """Starts background inactivity monitoring loop."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._monitor_loop,
            args=(poll_interval_s,),
            daemon=True,
            name="PIRInactivityMonitor",
        )
        self._thread.start()
        logger.info("PIR inactivity monitor started (timeout=%.1fs)", self.inactivity_timeout_s)

    def _monitor_loop(self, poll_interval_s: float) -> None:
        while self._running:
            self.check_inactivity()
            time.sleep(poll_interval_s)

    def stop_monitor(self) -> None:
        """Stops background monitoring loop."""
        self._running = False
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        logger.info("PIR monitor stopped")
