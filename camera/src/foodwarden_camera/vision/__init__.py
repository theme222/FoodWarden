"""Vision pipeline package (Webcam Capture & YOLO11n AI detection)."""

from foodwarden_camera.vision.camera import WebcamCapture
from foodwarden_camera.vision.detector import VisionDetector

__all__ = ["VisionDetector", "WebcamCapture"]
