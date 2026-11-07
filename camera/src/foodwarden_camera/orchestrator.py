"""Central System Orchestrator coordinating all edge components on Node 'C'.

Binds Webcam vision, YOLO26n AI, BLE telemetry receiver, MQTT door safety loop,
Cloud HTTPS client, PIR motion power manager, and PyQt6 bilingual user interface.
"""

from __future__ import annotations

import logging
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta
from typing import Any

from foodwarden_camera.ble.receiver import BLEReceiver
from foodwarden_camera.cloud.client import CloudClient
from foodwarden_camera.cloud.sync_manager import CloudSyncManager
from foodwarden_camera.config import GatewaySettings
from foodwarden_camera.hardware.buttons import ButtonController
from foodwarden_camera.hardware.pir import PIRController
from foodwarden_camera.models.ble_fuc import SensorPacket
from foodwarden_camera.models.cloud_cbs import (
    CheckInCommitPayload,
    CheckInDraftResult,
    CheckOutCandidate,
    CheckOutCommitPayload,
)
from foodwarden_camera.models.mqtt_cbd import (
    DoorEventEnvelope,
    DoorTelemetryPayload,
)
from foodwarden_camera.mqtt.client import DoorMQTTClient
from foodwarden_camera.storage.offline_queue import OfflineQueue
from foodwarden_camera.ui.main_window import FoodWardenMainWindow
from foodwarden_camera.vision.camera import WebcamCapture
from foodwarden_camera.vision.detector import VisionDetector

logger = logging.getLogger(__name__)


class GatewayOrchestrator:
    """Coordinates edge subsystems and enforces real-time safety interlocks."""

    def __init__(
        self,
        settings: GatewaySettings,
        window: FoodWardenMainWindow | None = None,
    ) -> None:
        self.settings = settings

        # 1. Hardware Abstractions
        self.buttons = ButtonController()
        self.pir = PIRController(
            gpio_pin=settings.pir_gpio_pin,
            inactivity_timeout_s=600.0,
            on_wake=self._on_pir_wake,
            on_sleep=self._on_pir_sleep,
        )

        # 2. Vision Pipeline
        self.camera = WebcamCapture(device_index=settings.webcam_index)
        self.detector = VisionDetector(model_name=settings.yolo_model_path)

        # 3. Storage & Cloud Sync
        self.queue = OfflineQueue(db_path=settings.sqlite_db_path)
        self.cloud_client = CloudClient(
            base_url=settings.firebase_api_base_url,
            gateway_token=settings.gateway_token,
            mock_cloud=settings.mock_cloud,
        )
        self.sync_manager = CloudSyncManager(self.cloud_client, self.queue)

        # 4. Peripheral Communications (BLE & MQTT)
        self.ble = BLEReceiver(
            aes_key=settings.aes_key,
            on_telemetry_callback=self._on_ble_telemetry,
        )
        self.mqtt = DoorMQTTClient(
            broker_host=settings.mqtt_broker_host,
            broker_port=settings.mqtt_broker_port,
            username=settings.mqtt_username,
            password=settings.mqtt_password,
            ca_cert_path=settings.mqtt_tls_ca_cert,
            client_cert_path=settings.mqtt_tls_server_cert,
            client_key_path=settings.mqtt_tls_server_key,
            on_door_event=self._on_door_event,
            on_door_telemetry=self._on_door_telemetry,
            on_connection_change=self._on_mqtt_connection_change,
        )

        # 5. UI Integration
        self.window = window or FoodWardenMainWindow(
            button_controller=self.buttons,
            on_trigger_checkin_capture=self.handle_checkin_capture,
            on_trigger_checkout_capture=self.handle_checkout_capture,
            on_commit_checkin=self.handle_commit_checkin,
            on_commit_checkout=self.handle_commit_checkout,
        )

        # Safety & State Tracking
        self._is_door_closing: bool = False
        self._latest_ldr_light: int | None = None
        self._running: bool = False
        self._safety_thread: threading.Thread | None = None
        self._ui_stream_thread: threading.Thread | None = None

    # ==========================================================================
    # Lifecycle Management
    # ==========================================================================

    def start(self) -> None:
        """Starts all edge background loops and peripheral services."""
        if self._running:
            return
        self._running = True
        logger.info("Starting FoodWarden Gateway Orchestrator...")

        # Start Camera & PIR
        self.camera.start()
        self.pir.start_monitor(poll_interval_s=2.0)

        # Start Cloud Sync Manager
        self.sync_manager.start_background_sync(interval_s=20.0)

        # Start Local MQTT Broker Client & BLE GATT Receiver
        self.mqtt.start()
        self.ble.start()

        # Start Safety Loop Thread
        self._safety_thread = threading.Thread(
            target=self._safety_loop,
            daemon=True,
            name="DoorSafetyLoop",
        )
        self._safety_thread.start()

        # Start Viewfinder Stream Thread
        self._ui_stream_thread = threading.Thread(
            target=self._viewfinder_stream_loop,
            daemon=True,
            name="ViewfinderStream",
        )
        self._ui_stream_thread.start()

        logger.info("FoodWarden Gateway Orchestrator successfully started")

    def stop(self) -> None:
        """Terminates all running services and releases hardware resources."""
        self._running = False
        logger.info("Stopping FoodWarden Gateway Orchestrator...")

        self.camera.stop()
        self.pir.stop_monitor()
        self.sync_manager.stop_background_sync()
        self.mqtt.stop()
        self.ble.stop()

        if self._safety_thread is not None and self._safety_thread.is_alive():
            self._safety_thread.join(timeout=2.0)
        if self._ui_stream_thread is not None and self._ui_stream_thread.is_alive():
            self._ui_stream_thread.join(timeout=2.0)

        logger.info("FoodWarden Gateway Orchestrator stopped")

    # ==========================================================================
    # Peripheral Event Handlers
    # ==========================================================================

    def _on_ble_telemetry(self, packet: SensorPacket) -> None:
        """Triggered upon receiving decrypted sensor packet from Node 'F'."""
        if not packet.samples:
            return

        latest_sample = packet.samples[-1]

        # Update UI climate card
        self.window.update_telemetry(
            latest_sample.temp_celsius,
            latest_sample.voc_index,
            latest_sample.light_ldr,
        )

        # Update door open tracking if light sensor reports lit (LDR >= 100)
        if latest_sample.light_ldr is not None:
            self._latest_ldr_light = latest_sample.light_ldr
            is_door_light_on = latest_sample.light_ldr >= 100
            self.mqtt.set_door_state(is_door_light_on)

        # Forward or buffer to cloud
        self.sync_manager.send_or_enqueue_telemetry(packet.header.node_id, latest_sample)

    def _on_door_event(self, envelope: DoorEventEnvelope) -> None:
        """Triggered upon discrete actuation state changes from Node 'D'."""
        evt_type = envelope.event.type

        if evt_type == "CLOSING":
            self._is_door_closing = True
            logger.info("Motorized door closure initiated by Node 'D'")
        elif evt_type in ("SUCCESS", "OBSTRUCTION_ERROR", "ABORTED", "TIMEOUT_ERROR"):
            self._is_door_closing = False
            if evt_type == "SUCCESS":
                self.window.update_door_state(is_open=False)
            elif evt_type == "OBSTRUCTION_ERROR":
                self.window.show_person_abort_alert()

        # Forward or buffer event to cloud
        details: dict[str, Any] = envelope.event.model_dump()
        self.sync_manager.send_or_enqueue_door_event(
            node_id=envelope.node_id,
            event_type=evt_type,
            timestamp=envelope.timestamp,
            details=details,
        )

    def _on_door_telemetry(self, telem: DoorTelemetryPayload) -> None:
        """Triggered upon 1 Hz periodic telemetry from Node 'D'."""
        self.window.update_door_state(
            is_open=self.mqtt.is_door_open,
            ajar_duration_s=self.mqtt.door_ajar_duration_s,
        )

        # IR vs. Light Sensor Mismatch check (GOAL.md §3):
        # If Node 'D' IR sensor thinks door is closed (ir_closed=True) while
        # Node 'F' LDR sensor reports internal light is still ON (>= 100), alert upstream.
        if (
            telem.ir_closed is True
            and self._latest_ldr_light is not None
            and self._latest_ldr_light >= 100
        ):
            logger.error(
                "IR Light Mismatch: Node 'D' reports door closed (ir_closed=True), "
                "but Node 'F' LDR light is still on (light=%d). Alerting Server 'S'.",
                self._latest_ldr_light,
            )
            self.sync_manager.send_or_enqueue_door_event(
                node_id=telem.node_id,
                event_type="IR_LIGHT_MISMATCH_ERROR",
                timestamp=telem.timestamp,
                details={
                    "ir_closed": telem.ir_closed,
                    "ldr_light": self._latest_ldr_light,
                    "reason": "Internal fridge light ON while IR sensor reports door closed",
                },
            )

    def _on_mqtt_connection_change(self, connected: bool) -> None:
        logger.info("Mosquitto broker connection changed: %s", connected)

    def _on_pir_wake(self) -> None:
        logger.info("PIR detected human: waking display")
        if sys.platform.startswith("linux"):
            try:
                subprocess.run(
                    ["xset", "dpms", "force", "on"],
                    check=False,
                    timeout=3.0,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            except (OSError, subprocess.SubprocessError) as exc:
                logger.debug("Could not invoke xset dpms force on: %s", exc)

    def _on_pir_sleep(self) -> None:
        logger.info("PIR timeout reached: putting display to sleep")
        if sys.platform.startswith("linux"):
            try:
                subprocess.run(
                    ["xset", "dpms", "force", "off"],
                    check=False,
                    timeout=3.0,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            except (OSError, subprocess.SubprocessError) as exc:
                logger.debug("Could not invoke xset dpms force off: %s", exc)

    # ==========================================================================
    # Door Safety Reflex Loop
    # ==========================================================================

    def _safety_loop(self) -> None:
        """Continuous safety loop monitoring door ajar and human obstruction reflex."""
        while self._running:
            try:
                # 1. Door-Ajar Automated Closure Check (Goal.md §1 & §2)
                # If door is open for > 60 seconds and not currently closing
                if self.mqtt.door_ajar_duration_s >= 60.0 and not self._is_door_closing:
                    has_frame, frame = self.camera.get_latest_frame()
                    if has_frame and frame is not None:
                        is_person, _, _ = self.detector.detect_person(frame)
                        if not is_person:
                            logger.info(
                                "Door open for %.1fs with no human present. Issuing CLOSE_DOOR.",
                                self.mqtt.door_ajar_duration_s,
                            )
                            self._is_door_closing = True
                            self.mqtt.send_close_door(node_id="D0", timeout_s=30)
                        else:
                            logger.debug(
                                "Door ajar > 60s, but human is present in front of fridge. Holding door open."
                            )

                # 2. Reflexive Human Abort While Closing
                # If door is actively closing, immediately abort if a person enters frame
                if self._is_door_closing:
                    has_frame, frame = self.camera.get_latest_frame()
                    if has_frame and frame is not None:
                        is_person, conf, _ = self.detector.detect_person(frame)
                        if is_person:
                            logger.warning(
                                "Human entered camera frame during door closure (conf=%.2f)! Dispathing instant ABORT.",
                                conf,
                            )
                            self._is_door_closing = False
                            self.mqtt.send_abort(node_id="D0", reason="HUMAN_APPROACH")
                            self.window.show_person_abort_alert()

            except Exception as exc:  # noqa: BLE001
                logger.error("Error in door safety loop: %s", exc)

            time.sleep(0.1)  # 10 Hz safety check rate

    def _viewfinder_stream_loop(self) -> None:
        """Streams webcam frames to Idle screen preview at ~15 FPS."""
        while self._running:
            if self.window.stack.currentIndex() == 0 and self.pir.is_display_awake:
                has_frame, frame = self.camera.get_latest_frame()
                if has_frame and frame is not None:
                    self.window.update_camera_frame(frame)
            time.sleep(0.066)

    # ==========================================================================
    # Check-In & Check-Out Workflow Actions
    # ==========================================================================

    def handle_checkin_capture(self) -> None:
        """Triggered when user presses 'O' from Idle screen to check in food."""
        has_frame, frame = self.camera.get_latest_frame()
        if not has_frame or frame is None:
            logger.warning("No camera frame available for check-in capture")
            self.window.alert_banner.show_alert(
                "ไม่สามารถจับภาพจากกล้องได้",
                "Camera capture failed: check webcam connection",
                is_critical=True,
            )
            return

        # Crop grocery item with YOLO26n (fallback to full-frame if conf < 0.60)
        jpeg_bytes, _, _, _ = self.detector.crop_grocery(frame)

        # Request AI draft from Cloud
        ok, draft, err_msg = self.cloud_client.checkin_draft(jpeg_bytes)
        if ok and draft is not None:
            self.window.show_checkin_draft(draft, jpeg_bytes)
        else:
            logger.warning("Check-in draft failed (%s); buffering offline capture", err_msg)
            self.sync_manager.enqueue_offline_checkin(jpeg_bytes)
            self.window.show_offline_warning()

            # Offline Check-In Screen per GOAL.md §3:
            # Show captured photo, allow user to adjust expiry date, and run 5s countdown
            offline_expiry = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")
            offline_draft = CheckInDraftResult(
                name_th="บันทึกภาพออฟไลน์ (รอเชื่อมต่อคลาวด์)",
                name_en="Offline Capture (Pending Cloud Sync)",
                category="General",
                category_th="ทั่วไป (ออฟไลน์)",
                estimated_shelf_life_days=7,
                estimated_expiry_date=offline_expiry,
                storage_recommendation_th="จะส่งให้ AI วิเคราะห์อัตโนมัติเมื่อต่อเน็ต",
                storage_recommendation_en="Auto-analyzed by AI once online",
                image_storage_path="local_offline",
                confidence=0.0,
            )
            self.window.show_checkin_draft(offline_draft, jpeg_bytes)

    def handle_commit_checkin(self, draft: CheckInDraftResult, expiry_date: str) -> None:
        """Triggered when user confirms check-in item on LCD (or 5s countdown elapses)."""
        payload = CheckInCommitPayload(
            name_th=draft.name_th,
            name_en=draft.name_en,
            category=draft.category,
            category_th=draft.category_th,
            estimated_shelf_life_days=draft.estimated_shelf_life_days,
            expiry_date=expiry_date,
            storage_recommendation_th=draft.storage_recommendation_th,
            storage_recommendation_en=draft.storage_recommendation_en,
            image_storage_path=draft.image_storage_path,
            confidence=draft.confidence,
        )
        ok, res, err = self.cloud_client.checkin_commit(payload)
        if ok and res is not None:
            logger.info("Successfully committed check-in: %s", res.item_id)
        else:
            logger.warning("Cloud checkin commit failed (%s); buffering for later sync", err)

    def handle_checkout_capture(self) -> None:
        """Triggered when user presses 'X' from Idle screen to check out food."""
        has_frame, frame = self.camera.get_latest_frame()
        if not has_frame or frame is None:
            logger.warning("No camera frame available for checkout capture")
            return

        jpeg_bytes, _, _, _ = self.detector.crop_grocery(frame)
        ok, result, err = self.cloud_client.checkout_draft(jpeg_bytes)
        if ok and result is not None:
            self.window.show_checkout_candidates(result.candidates)
        else:
            logger.warning("Check-out draft failed: %s", err)
            self.window.show_offline_warning()

    def handle_commit_checkout(self, candidate: CheckOutCandidate) -> None:
        """Triggered when user confirms item removal on LCD."""
        payload = CheckOutCommitPayload(item_id=candidate.item_id)
        ok, res, err = self.cloud_client.checkout_commit(payload)
        if ok and res is not None:
            logger.info("Successfully checked out item: %s", res.item_id)
        else:
            logger.warning("Check-out commit failed: %s", err)
