"""YOLO26 Nano object detection, grocery cropping, and human presence detection.

Implements real-time person detection for door safety reflex and grocery item
bounding-box cropping with full-frame fallback and JPEG compression per SUMMARY.md.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import cv2
import numpy as np
from ultralytics import YOLO  # type: ignore[attr-defined]

logger = logging.getLogger(__name__)

# COCO food and grocery class indices
# 39: bottle, 40: wine glass, 41: cup, 42: fork, 43: knife, 44: spoon, 45: bowl
# 46: banana, 47: apple, 48: sandwich, 49: orange, 50: broccoli, 51: carrot
# 52: hot dog, 53: pizza, 54: donut, 55: cake
COCO_FOOD_CLASSES = {39, 40, 41, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55}
PERSON_CLASS_ID = 0


class VisionDetector:
    """Manages YOLO26n inference for grocery cropping and human safety checks."""

    def __init__(
        self,
        model_name: str = "yolo26n.pt",
        food_conf_threshold: float = 0.60,
        person_conf_threshold: float = 0.50,
        jpeg_quality: int = 85,
    ) -> None:
        self.model_name = model_name
        self.food_conf_threshold = food_conf_threshold
        self.person_conf_threshold = person_conf_threshold
        self.jpeg_quality = jpeg_quality

        self._model: YOLO | None = None
        self._last_inference_time_ms: float = 0.0

    @property
    def last_inference_time_ms(self) -> float:
        """Returns elapsed time in ms of the most recent YOLO inference."""
        return self._last_inference_time_ms

    def load_model(self) -> YOLO:
        """Loads or returns cached YOLO model weights."""
        if self._model is None:
            logger.info("Loading YOLO model: %s...", self.model_name)
            t0 = time.time()
            self._model = YOLO(self.model_name)
            load_ms = (time.time() - t0) * 1000
            logger.info("YOLO model loaded in %.1f ms", load_ms)
        return self._model

    def compress_frame_to_jpeg(self, frame: np.ndarray, quality: int | None = None) -> bytes:
        """Encodes BGR numpy image to JPEG byte buffer."""
        q = self.jpeg_quality if quality is None else quality
        encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), q]
        success, encoded_img = cv2.imencode(".jpg", frame, encode_params)
        if not success:
            raise RuntimeError("Failed to encode frame to JPEG format")
        return bytes(encoded_img.tobytes())

    def detect_person(
        self, frame: np.ndarray
    ) -> tuple[bool, float, list[tuple[int, int, int, int]]]:
        """Detects whether a human is present in front of the refrigerator.

        Returns:
            (is_person_detected, highest_confidence, list_of_bounding_boxes)
        """
        model = self.load_model()
        t0 = time.time()

        # Run inference filtering for person class only (class 0)
        raw_results = model.predict(
            source=frame,
            classes=[PERSON_CLASS_ID],
            conf=self.person_conf_threshold,
            verbose=False,
        )
        self._last_inference_time_ms = (time.time() - t0) * 1000

        boxes: list[tuple[int, int, int, int]] = []
        max_conf = 0.0

        results_list = list(raw_results) if raw_results is not None else []
        if results_list and hasattr(results_list[0], "boxes") and results_list[0].boxes is not None:
            boxes_obj: Any = results_list[0].boxes
            for box in boxes_obj:
                conf = float(box.conf[0])
                if conf >= self.person_conf_threshold:
                    xyxy = box.xyxy[0].cpu().numpy().astype(int)
                    boxes.append((int(xyxy[0]), int(xyxy[1]), int(xyxy[2]), int(xyxy[3])))
                    max_conf = max(max_conf, conf)

        is_present = len(boxes) > 0
        if is_present:
            logger.info(
                "Human detected in camera frame (conf=%.2f, latency=%.1f ms)",
                max_conf,
                self._last_inference_time_ms,
            )
        return is_present, max_conf, boxes

    def crop_grocery(
        self, frame: np.ndarray
    ) -> tuple[bytes, bool, float, tuple[int, int, int, int] | None]:
        """Detects and crops grocery item via bounding box, with full-frame fallback.

        Per SUMMARY.md §5:
        - Confidence >= 0.60: Reliable bounding box crop
        - Confidence < 0.60 or no object: Falls back to full-frame upload

        Returns:
            (jpeg_bytes, is_cropped, confidence, bounding_box_xyxy_or_none)
        """
        model = self.load_model()
        t0 = time.time()

        # Run general object detection
        raw_results = model.predict(
            source=frame,
            conf=0.25,  # Low initial threshold to inspect candidates
            verbose=False,
        )
        self._last_inference_time_ms = (time.time() - t0) * 1000

        best_bbox: tuple[int, int, int, int] | None = None
        best_conf = 0.0

        results_list = list(raw_results) if raw_results is not None else []
        if results_list and hasattr(results_list[0], "boxes") and results_list[0].boxes is not None:
            boxes_obj: Any = results_list[0].boxes
            for box in boxes_obj:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])

                # Prioritize food classes or prominent non-person objects
                if cls_id != PERSON_CLASS_ID:
                    # Give preference to identified food classes
                    weight = 1.2 if cls_id in COCO_FOOD_CLASSES else 1.0
                    effective_conf = min(conf * weight, 1.0)

                    if effective_conf > best_conf and conf >= self.food_conf_threshold:
                        best_conf = conf
                        xyxy = box.xyxy[0].cpu().numpy().astype(int)
                        best_bbox = (int(xyxy[0]), int(xyxy[1]), int(xyxy[2]), int(xyxy[3]))

        # Crop if reliable bounding box detected
        if best_bbox is not None and best_conf >= self.food_conf_threshold:
            x1, y1, x2, y2 = best_bbox
            h, w = frame.shape[:2]

            # Add 5% padding around bounding box for context
            pad_x = int((x2 - x1) * 0.05)
            pad_y = int((y2 - y1) * 0.05)
            crop_x1 = max(0, x1 - pad_x)
            crop_y1 = max(0, y1 - pad_y)
            crop_x2 = min(w, x2 + pad_x)
            crop_y2 = min(h, y2 + pad_y)

            cropped_frame = frame[crop_y1:crop_y2, crop_x1:crop_x2]
            jpeg_bytes = self.compress_frame_to_jpeg(cropped_frame)
            logger.info(
                "Cropped grocery item bbox=(%d,%d,%d,%d) conf=%.2f in %.1f ms",
                x1,
                y1,
                x2,
                y2,
                best_conf,
                self._last_inference_time_ms,
            )
            return jpeg_bytes, True, best_conf, (x1, y1, x2, y2)

        # Fallback to full-frame upload
        logger.info(
            "No high-confidence food bbox (max_conf=%.2f < %.2f); falling back to full frame",
            best_conf,
            self.food_conf_threshold,
        )
        jpeg_bytes = self.compress_frame_to_jpeg(frame)
        return jpeg_bytes, False, best_conf, None

    def benchmark_latency(self, sample_frames: int = 5) -> dict[str, Any]:
        """Runs benchmark on synthetic frames to measure CPU inference latency (Rubric 5)."""
        model = self.load_model()
        dummy_frame: np.ndarray = np.zeros((720, 1280, 3), dtype=np.uint8)
        latencies_ms: list[float] = []

        # Warmup
        model.predict(source=dummy_frame, verbose=False)

        for _ in range(sample_frames):
            t0 = time.time()
            model.predict(source=dummy_frame, verbose=False)
            latencies_ms.append((time.time() - t0) * 1000)

        avg_latency = float(np.mean(latencies_ms))
        min_latency = float(np.min(latencies_ms))
        max_latency = float(np.max(latencies_ms))

        logger.info(
            "YOLO26n Latency Benchmark (%d runs): avg=%.1f ms, min=%.1f ms, max=%.1f ms",
            sample_frames,
            avg_latency,
            min_latency,
            max_latency,
        )
        return {
            "runs": sample_frames,
            "avg_ms": round(avg_latency, 2),
            "min_ms": round(min_latency, 2),
            "max_ms": round(max_latency, 2),
        }
