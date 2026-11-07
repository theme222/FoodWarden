"""Unit tests for Vision pipeline (WebcamCapture & VisionDetector)."""

from unittest.mock import MagicMock

import numpy as np
import pytest

from foodwarden_camera.vision.camera import WebcamCapture
from foodwarden_camera.vision.detector import VisionDetector


@pytest.fixture
def dummy_frame() -> np.ndarray:
    """Returns a synthetic 720p BGR image for testing."""
    return np.zeros((720, 1280, 3), dtype=np.uint8)


def test_jpeg_compression(dummy_frame: np.ndarray) -> None:
    detector = VisionDetector()
    jpeg_bytes = detector.compress_frame_to_jpeg(dummy_frame, quality=80)

    assert isinstance(jpeg_bytes, bytes)
    assert len(jpeg_bytes) > 0
    # JPEG magic bytes: 0xFF, 0xD8, 0xFF
    assert jpeg_bytes.startswith(b"\xff\xd8\xff")


def test_detect_person_on_blank_frame(dummy_frame: np.ndarray) -> None:
    detector = VisionDetector()
    is_present, max_conf, boxes = detector.detect_person(dummy_frame)

    assert is_present is False
    assert max_conf == 0.0
    assert len(boxes) == 0
    assert detector.last_inference_time_ms >= 0.0


def test_crop_grocery_fallback(dummy_frame: np.ndarray) -> None:
    detector = VisionDetector(food_conf_threshold=0.60)
    jpeg_bytes, is_cropped, conf, bbox = detector.crop_grocery(dummy_frame)

    assert isinstance(jpeg_bytes, bytes)
    assert jpeg_bytes.startswith(b"\xff\xd8\xff")
    # A blank black frame has no food items, so it must fall back to full-frame
    assert is_cropped is False
    assert bbox is None
    assert conf < 0.60


def test_benchmark_latency() -> None:
    detector = VisionDetector()
    metrics = detector.benchmark_latency(sample_frames=2)

    assert metrics["runs"] == 2
    assert "avg_ms" in metrics
    assert "min_ms" in metrics
    assert "max_ms" in metrics
    assert metrics["avg_ms"] > 0.0


def test_webcam_capture_lifecycle() -> None:
    # Use invalid camera index to test graceful error handling
    cam = WebcamCapture(device_index=999)
    # Mock VideoCapture to simulate a working device
    mock_cap = MagicMock()
    mock_cap.isOpened.return_value = True
    test_frame = np.ones((720, 1280, 3), dtype=np.uint8) * 128
    mock_cap.read.return_value = (True, test_frame)

    cam._cap = mock_cap
    cam._running = True

    # Manually feed one frame to test get_latest_frame
    with cam._lock:
        cam._latest_frame = test_frame

    has_frame, frame = cam.get_latest_frame()
    assert has_frame is True
    assert frame is not None
    assert frame.shape == (720, 1280, 3)

    cam.stop()
    assert cam.is_running is False
