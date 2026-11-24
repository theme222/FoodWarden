"""USB Webcam Capture Manager with resilient error recovery.

Manages frame acquisition from the Logitech C270 HD webcam (or simulated camera)
via OpenCV, providing non-blocking frame retrieval and automatic reconnection on drops.
"""

from __future__ import annotations

import logging
import os
import threading
import time

import cv2
import numpy as np

logger = logging.getLogger(__name__)


class WebcamCapture:
    """Threaded OpenCV video capture manager with disconnect recovery."""

    def __init__(
        self,
        device_index: int = 0,
        width: int = 1280,
        height: int = 720,
        fps: int = 30,
        max_reconnect_attempts: int = 5,
    ) -> None:
        self.device_index = device_index
        self.width = width
        self.height = height
        self.fps = fps
        self.max_reconnect_attempts = max_reconnect_attempts

        self._cap: cv2.VideoCapture | None = None
        self._thread: threading.Thread | None = None
        self._running: bool = False
        self._lock = threading.Lock()

        self._latest_frame: np.ndarray | None = None
        self._has_error: bool = False
        self._last_error_msg: str = ""
        self._consecutive_failures: int = 0
        self._last_successful_frame_time: float = 0.0

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def has_error(self) -> bool:
        return self._has_error

    @property
    def last_error_message(self) -> str:
        return self._last_error_msg

    def start(self) -> bool:
        """Opens camera and starts background frame grabber thread."""
        if self._running:
            return True

        if not self._open_camera():
            logger.warning(
                "Could not initially open camera index %d; starting background recovery",
                self.device_index,
            )
            self._has_error = True
            self._last_error_msg = f"Camera index {self.device_index} not accessible"

        self._running = True
        self._thread = threading.Thread(
            target=self._capture_loop, daemon=True, name="WebcamGrabber"
        )
        self._thread.start()
        logger.info("Webcam grabber thread started for device %d", self.device_index)
        return True

    def _open_camera(self) -> bool:
        """Attempts to open OpenCV VideoCapture with configured resolution."""
        if self._cap is not None:
            self._cap.release()

        # Try opening with DirectShow on Windows or default V4L2 on Linux
        backend = cv2.CAP_DSHOW if os.name == "nt" else cv2.CAP_ANY
        self._cap = cv2.VideoCapture(self.device_index, backend)
        if not self._cap.isOpened():
            # Fallback to default backend if DSHOW fails
            self._cap = cv2.VideoCapture(self.device_index)

        if not self._cap.isOpened():
            return False

        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        self._cap.set(cv2.CAP_PROP_FPS, self.fps)
        return True

    def _capture_loop(self) -> None:
        """Continuous background thread fetching latest frames."""
        while self._running:
            if self._cap is None or not self._cap.isOpened():
                self._attempt_reconnect()
                time.sleep(1.0)
                continue

            ret, frame = self._cap.read()
            if not ret or frame is None:
                self._consecutive_failures += 1
                if self._consecutive_failures >= 10:
                    self._has_error = True
                    self._last_error_msg = "Frame grab failed: Camera disconnected or stream frozen"
                    logger.warning(self._last_error_msg)
                    self._attempt_reconnect()
                time.sleep(0.05)
                continue

            # Frame read succeeded
            with self._lock:
                self._latest_frame = frame
                self._last_successful_frame_time = time.time()
                self._consecutive_failures = 0
                if self._has_error:
                    logger.info("Webcam recovered successfully on index %d", self.device_index)
                    self._has_error = False
                    self._last_error_msg = ""

            # Cap frame rate to ~30 FPS
            time.sleep(1.0 / self.fps)

    def _attempt_reconnect(self) -> None:
        """Re-initializes camera device on disconnect."""
        logger.info("Attempting to reconnect to webcam on index %d...", self.device_index)
        if self._open_camera():
            logger.info("Camera re-opened successfully on index %d", self.device_index)
            self._consecutive_failures = 0
            self._has_error = False
            self._last_error_msg = ""
        else:
            self._has_error = True
            self._last_error_msg = f"Failed to reconnect camera {self.device_index}"

    def get_latest_frame(self) -> tuple[bool, np.ndarray | None]:
        """Retrieves most recent frame without blocking.

        Returns:
            (has_frame, frame_bgr)
        """
        with self._lock:
            if self._latest_frame is None:
                return False, None
            return True, self._latest_frame.copy()

    def stop(self) -> None:
        """Terminates capture loop and releases camera resource."""
        self._running = False
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        self._latest_frame = None
        logger.info("Webcam capture stopped")
