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
import uuid
from datetime import datetime, timedelta
from typing import Any

from foodwarden_camera.ble.receiver import BLEReceiver
from foodwarden_camera.cloud.client import CloudClient, CloudErrorKind, classify_cloud_error
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
            inactivity_timeout_s=float(settings.sleep_timeout_s),
            on_wake=self._on_pir_wake,
            on_sleep=self._on_pir_sleep,
            on_motion_change=self._on_pir_motion_change,
        )
        # Any physical button press also wakes display & resets inactivity timer
        for btn in self.buttons._callbacks:
            self.buttons.register_callback(btn, self.pir.wake)

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
            on_door_event=self._on_door_event,
            on_door_telemetry=self._on_door_telemetry,
            on_connection_change=self._on_mqtt_connection_change,
            on_node_seen=self.sync_manager.record_node_seen,
        )

        # 5. UI Integration
        self.window = window or FoodWardenMainWindow(
            button_controller=self.buttons,
            on_trigger_checkin_capture=self.handle_checkin_capture,
            on_trigger_checkout_capture=self.handle_checkout_capture,
            on_commit_checkin=self.handle_commit_checkin,
            on_commit_checkout=self.handle_commit_checkout,
            on_save_settings=self.apply_settings,
            on_save_pir_pin=self.apply_pir_pin,
            on_save_door_close_timeout=self.apply_door_close_timeout,
            on_wake_requested=self.pir.wake,
            initial_token=settings.gateway_token,
            autocomplete_timeout_s=settings.autocomplete_timeout_s,
            sleep_timeout_s=settings.sleep_timeout_s,
            initial_pir_gpio_pin=settings.pir_gpio_pin,
            initial_door_close_timeout_s=settings.door_close_timeout_s,
        )

        # Safety & State Tracking
        self._is_door_closing: bool = False
        self._last_abort_at: float | None = None
        self._last_person_seen_at: float | None = None
        self._latest_ldr_light: int | None = None
        self._last_person_detected: bool = False
        self._last_person_conf: float = 0.0
        self._last_person_boxes: list[tuple[int, int, int, int]] = []
        self._last_person_checked_at: float = -1000.0
        self._person_state_lock = threading.Lock()
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
        self._configure_x11_keep_display_signal()

        # Start Camera & PIR (0.25s poll keeps quick SEN0018 motion pulses responsive)
        self.camera.start()
        self.pir.start_monitor(poll_interval_s=0.25)

        # Start Cloud Sync Manager
        self.sync_manager.start_background_sync(interval_s=20.0)

        # Start Local MQTT Broker Client & BLE GATT Receiver
        self.mqtt.start()
        self.ble.start()
        self.refresh_connection_indicators()

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
        self.sync_manager.record_node_seen(packet.header.node_id, latest_sample.timestamp_s)

        # Update UI climate card
        self.window.update_telemetry(
            latest_sample.temp_celsius,
            latest_sample.voc_index,
            latest_sample.light_ldr,
        )

        # Update door open tracking if light sensor reports lit (LDR >= 100), without
        # clearing an active Node 'D' IR-open timer when 'F' stays inside a dark box.
        if latest_sample.light_ldr is not None:
            self._latest_ldr_light = latest_sample.light_ldr
            is_door_light_on = latest_sample.light_ldr >= 100
            last_d_seen = self._safe_contact_time(self.mqtt, "D0")
            d_recently_active = last_d_seen is not None and (time.time() - last_d_seen) <= 10.0
            if is_door_light_on or not d_recently_active:
                self.mqtt.set_door_state(is_door_light_on)

        self.refresh_connection_indicators()

        # Forward all packet samples or single sample (preserving single-sample test hook)
        if len(packet.samples) > 1:
            self.sync_manager.send_or_enqueue_telemetry_batch(packet.header.node_id, packet.samples)
        else:
            self.sync_manager.send_or_enqueue_telemetry(packet.header.node_id, latest_sample)

    def _on_door_event(self, envelope: DoorEventEnvelope) -> None:
        """Triggered upon discrete actuation state changes from Node 'D'."""
        evt_type = envelope.event.type
        self.sync_manager.record_node_seen(envelope.node_id, envelope.timestamp)

        if evt_type == "CLOSING":
            self._is_door_closing = True
            logger.info("Motorized door closure initiated by Node 'D'")
        elif evt_type in (
            "SUCCESS",
            "OBSTRUCTION_ERROR",
            "ABORTED",
            "TIMEOUT_ERROR",
            "FAULT_LOCKOUT",
        ):
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
        self.refresh_connection_indicators()

    def _on_door_telemetry(self, telem: DoorTelemetryPayload) -> None:
        """Triggered upon 1 Hz periodic telemetry from Node 'D'."""
        self.sync_manager.record_node_seen(telem.node_id, telem.timestamp)
        self.window.update_door_state(
            is_open=self.mqtt.is_door_open,
            ajar_duration_s=self.mqtt.door_ajar_duration_s,
        )
        self.refresh_connection_indicators()

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

    def _run_x11_commands(self, commands: list[list[str]]) -> None:
        """Runs best-effort X11 display utility commands on Linux without raising."""
        if not sys.platform.startswith("linux"):
            return
        for cmd in commands:
            try:
                subprocess.run(
                    cmd,
                    check=False,
                    timeout=3.0,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            except (OSError, subprocess.SubprocessError) as exc:
                logger.debug("Could not invoke %s: %s", " ".join(cmd), exc)

    def _configure_x11_keep_display_signal(self) -> None:
        """Prevents OS X11 DPMS/screensaver from cutting HDMI signal to a No-Signal screen."""
        self._run_x11_commands(
            [
                ["xset", "s", "off"],
                ["xset", "-dpms"],
                ["xset", "s", "noblank"],
                ["xset", "dpms", "force", "on"],
                ["xset", "s", "reset"],
            ]
        )

    def _on_pir_wake(self) -> None:
        logger.info("PIR detected human: waking display and starting camera")
        self.window.set_display_sleep(False)
        self.camera.start()
        self._run_x11_commands(
            [
                ["xset", "s", "reset"],
                ["xset", "dpms", "force", "on"],
            ]
        )

    def _on_pir_sleep(self) -> None:
        logger.info("PIR timeout reached: blanking display via UI sleep cover and stopping camera")
        self.camera.stop()
        # Blank via pure-black PyQt overlay rather than `xset dpms force off`, which causes the
        # Pi-top LCD to drop video sync into a blue "No Signal" screen that ignores wake calls.
        self.window.set_display_sleep(True)

    @staticmethod
    def _safe_contact_time(source: Any, node_id: str | None = None) -> float | None:
        if node_id is None:
            val = getattr(source, "last_contact_time", None)
        else:
            mapping = getattr(source, "last_contact_time", None)
            val = mapping.get(node_id) if isinstance(mapping, dict) else None
            if not isinstance(val, (int, float)):
                fallback = getattr(source, "last_seen_by_node", None)
                val = fallback.get(node_id) if isinstance(fallback, dict) else None
        return float(val) if isinstance(val, (int, float)) else None

    def refresh_connection_indicators(self) -> None:
        """Updates UI badges for Wi-Fi/Cloud, Node 'F' (F0), Node 'D' (D0), and door timer."""
        now = time.time()

        last_f = self._safe_contact_time(self.ble)
        age_f = max(0.0, now - last_f) if last_f is not None else None
        ble_connected = getattr(self.ble, "is_connected", False) is True
        self.window.update_node_status("F0", age_f, is_connected=ble_connected)

        last_d = self._safe_contact_time(self.mqtt, "D0")
        age_d = max(0.0, now - last_d) if last_d is not None else None
        online_map = getattr(self.mqtt, "node_online", None)
        d_explicit_state = online_map.get("D0") if isinstance(online_map, dict) else None
        d_is_offline = d_explicit_state is False
        d_is_connected = d_explicit_state is True and age_d is not None and age_d <= 5.0
        self.window.update_node_status(
            "D0",
            age_d,
            is_connected=d_is_connected,
            is_offline=d_is_offline,
        )

        is_online = getattr(self.sync_manager, "is_online", True)
        if isinstance(is_online, bool):
            self.window.update_wifi_status(is_online)

        is_door_open = getattr(self.mqtt, "is_door_open", False)
        ajar_s = getattr(self.mqtt, "door_ajar_duration_s", 0.0)
        if isinstance(is_door_open, bool) and isinstance(ajar_s, (int, float)):
            self.window.update_door_state(is_door_open, float(ajar_s))

    def _on_pir_motion_change(self, has_motion: bool, idle_duration_s: float) -> None:
        self.window.update_motion_state(
            has_motion,
            idle_duration_s,
            self.pir.hardware_status_text,
        )

    def apply_settings(
        self,
        gateway_token: str,
        autocomplete_timeout_s: int,
        sleep_timeout_s: int,
    ) -> None:
        """Persists runtime configuration changes and applies them immediately."""
        self.settings.save_runtime_settings(
            gateway_token=gateway_token,
            autocomplete_timeout_s=autocomplete_timeout_s,
            sleep_timeout_s=sleep_timeout_s,
        )
        self.cloud_client.gateway_token = gateway_token
        self.pir.inactivity_timeout_s = float(sleep_timeout_s)
        self.window.set_autocomplete_timeout(autocomplete_timeout_s)
        logger.info(
            "Applied runtime settings (autocomplete=%ds, sleep=%ds)",
            autocomplete_timeout_s,
            sleep_timeout_s,
        )

    def apply_pir_pin(self, pir_gpio_pin: int) -> None:
        """Re-binds PIR GPIO pin at runtime and persists PIR_GPIO_PIN to .env."""
        self.pir.reconfigure_pin(pir_gpio_pin)
        self.settings.save_runtime_settings(
            gateway_token=self.settings.gateway_token,
            autocomplete_timeout_s=self.settings.autocomplete_timeout_s,
            sleep_timeout_s=self.settings.sleep_timeout_s,
            pir_gpio_pin=pir_gpio_pin,
        )
        self.window.update_motion_state(
            self.pir.is_motion_detected,
            self.pir.idle_duration_s,
            self.pir.hardware_status_text,
        )
        logger.info("Applied PIR GPIO pin: %d (%s)", pir_gpio_pin, self.pir.hardware_status_text)

    def apply_door_close_timeout(self, door_close_timeout_s: int) -> None:
        """Updates automatic door closure delay at runtime and persists to .env."""
        clamped = max(3, min(600, int(door_close_timeout_s)))
        self.settings.save_runtime_settings(
            gateway_token=self.settings.gateway_token,
            autocomplete_timeout_s=self.settings.autocomplete_timeout_s,
            sleep_timeout_s=self.settings.sleep_timeout_s,
            door_close_timeout_s=clamped,
        )
        logger.info("Applied automatic door close delay: %ds", clamped)

    # ==========================================================================
    # Door Safety Reflex Loop
    # ==========================================================================

    def _run_person_safety_check(
        self, frame: Any
    ) -> tuple[bool, float, list[tuple[int, int, int, int]]]:
        """Runs YOLO person detection and updates Idle screen debug indicators."""
        is_person, conf, boxes = self.detector.detect_person(frame)
        with self._person_state_lock:
            self._last_person_detected = is_person
            self._last_person_conf = conf
            self._last_person_boxes = list(boxes)
            self._last_person_checked_at = time.monotonic()
        self.window.update_person_state(is_person, conf, len(boxes))
        return is_person, conf, boxes

    def _annotate_person_preview(self, frame: Any) -> Any:
        """Draws cached YOLO person bounding boxes on a preview copy for debugging."""
        with self._person_state_lock:
            is_person = self._last_person_detected
            conf = self._last_person_conf
            boxes = list(self._last_person_boxes)
            age_s = time.monotonic() - self._last_person_checked_at

        if not is_person or not boxes or age_s > 3.0:
            return frame

        import cv2

        annotated = frame.copy()
        pct = round(max(0.0, min(1.0, conf)) * 100)
        for x1, y1, x2, y2 in boxes:
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (36, 191, 251), 3)
            cv2.putText(
                annotated,
                f"Person {pct}%",
                (x1, max(24, y1 - 10)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (36, 191, 251),
                2,
            )
        return annotated

    def _evaluate_safety_step(self) -> None:
        """Executes one door-ajar and human-obstruction safety evaluation pass."""
        now_mono = time.monotonic()
        raw_ajar = getattr(self.mqtt, "door_ajar_duration_s", 0.0)
        ajar_s = float(raw_ajar) if isinstance(raw_ajar, (int, float)) else 0.0
        door_is_open = (getattr(self.mqtt, "is_door_open", False) is True) or ajar_s > 0.0

        if not door_is_open and not self._is_door_closing:
            self._last_person_seen_at = None

        close_timeout_s = max(3.0, float(self.settings.door_close_timeout_s))
        abort_cooldown_ok = self._last_abort_at is None or (now_mono - self._last_abort_at) >= 5.0
        person_clear_ok = (
            self._last_person_seen_at is None
            or (now_mono - self._last_person_seen_at) >= close_timeout_s
        )
        need_ajar_close_check = (
            ajar_s >= close_timeout_s
            and person_clear_ok
            and not self._is_door_closing
            and abort_cooldown_ok
        )
        need_closing_abort_check = self._is_door_closing
        need_open_door_person_check = (
            door_is_open and (now_mono - self._last_person_checked_at) >= 0.5
        )
        need_debug_check = (
            self.pir.is_display_awake
            and not self.window.isMinimized()
            and self.window.stack.currentIndex() == 0
            and (now_mono - self._last_person_checked_at >= 1.5)
        )

        if not (
            need_ajar_close_check
            or need_closing_abort_check
            or need_open_door_person_check
            or need_debug_check
        ):
            return

        has_frame, frame = self.camera.get_latest_frame()
        if not has_frame or frame is None:
            return

        is_person, conf, _ = self._run_person_safety_check(frame)

        # Reset the door-ajar close timer whenever a person is present while the door is open,
        # so a full unattended timeout must elapse after the person leaves frame.
        if is_person and (door_is_open or self._is_door_closing):
            self._last_person_seen_at = time.monotonic()
            reset_fn = getattr(self.mqtt, "reset_door_ajar_timer", None)
            if callable(reset_fn):
                reset_fn()
            self.window.update_door_state(is_open=True, ajar_duration_s=0.0)

        # 1. Door-Ajar Automated Closure Check (Goal.md §1 & §2)
        if need_ajar_close_check:
            if not is_person:
                logger.info(
                    "Door open for %.1fs (>= %.1fs) with no human present. Issuing CLOSE_DOOR.",
                    ajar_s,
                    close_timeout_s,
                )
                self._is_door_closing = True
                self.mqtt.send_close_door(node_id="D0", timeout_s=30)
                self.window.show_door_closing_alert()
            else:
                logger.debug(
                    "Door ajar >= %.1fs, but human is present in front of fridge. Timer reset.",
                    close_timeout_s,
                )

        # 2. Reflexive Human Abort While Closing
        if need_closing_abort_check and is_person:
            logger.warning(
                "Human entered camera frame during door closure (conf=%.2f)! Dispatching instant ABORT.",
                conf,
            )
            self._is_door_closing = False
            self._last_abort_at = time.monotonic()
            self.mqtt.send_abort(node_id="D0", reason="HUMAN_APPROACH")
            self.window.show_person_abort_alert()

    def _safety_loop(self) -> None:
        """Continuous safety loop monitoring door ajar and human obstruction reflex."""
        while self._running:
            try:
                self._evaluate_safety_step()
            except Exception as exc:  # noqa: BLE001
                logger.error("Error in door safety loop: %s", exc)

            time.sleep(0.1)  # 10 Hz safety check rate

    def _viewfinder_stream_loop(self) -> None:
        """Streams webcam frames to Idle screen preview at ~15 FPS."""
        last_status_refresh_at = 0.0
        while self._running:
            now_mono = time.monotonic()
            if self.window.stack.currentIndex() == 0 and self.pir.is_display_awake:
                if now_mono - last_status_refresh_at >= 1.0:
                    last_status_refresh_at = now_mono
                    self.window.update_motion_state(
                        self.pir.is_motion_detected,
                        self.pir.idle_duration_s,
                        self.pir.hardware_status_text,
                    )
                    self.refresh_connection_indicators()
                if not self.window.isMinimized():
                    has_frame, frame = self.camera.get_latest_frame()
                    if has_frame and frame is not None:
                        self.window.update_camera_frame(self._annotate_person_preview(frame))
            time.sleep(0.066)

    # ==========================================================================
    # Check-In & Check-Out Workflow Actions
    # ==========================================================================

    def _show_cloud_error_alert(
        self,
        err_kind: CloudErrorKind,
        *,
        action_th: str,
        action_en: str,
    ) -> None:
        """Displays a bilingual alert matching the failure kind instead of blaming Wi-Fi."""
        alerts: dict[CloudErrorKind, tuple[str, str, bool]] = {
            "unidentifiable": (
                f"ไม่พบอาหารขณะ{action_th} กรุณาถือให้ชัดแล้วลองใหม่",
                f"Food not identified during {action_en} — hold clearly and retry",
                False,
            ),
            "auth": (
                "Token เชื่อมต่อไม่ถูกต้อง กรุณาตรวจสอบ GATEWAY_TOKEN",
                "Invalid Gateway Token — check Settings",
                True,
            ),
            "rate_limited": (
                "ใช้งาน AI เกินโควตาชั่วคราว กรุณารอสักครู่",
                "AI rate limit reached — please wait a moment",
                False,
            ),
            "rejected": (
                f"ข้อมูล{action_th}ไม่ถูกต้อง กรุณาลองถ่ายใหม่",
                f"{action_en.capitalize()} request rejected — please retake photo",
                False,
            ),
        }
        if err_kind in alerts:
            msg_th, msg_en, critical = alerts[err_kind]
            self.window.alert_banner.show_alert(msg_th, msg_en, is_critical=critical)
        else:
            self.window.show_offline_warning()

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

        # Request AI draft from Cloud with persistent UUID v4 Idempotency-Key
        draft_key = str(uuid.uuid4())
        ok, draft, err_msg = self.cloud_client.checkin_draft(
            jpeg_bytes,
            idempotency_key=draft_key,
        )
        if ok and draft is not None:
            self.window.show_checkin_draft(draft, jpeg_bytes)
            return

        err_kind = classify_cloud_error(err_msg)
        if err_kind in ("unidentifiable", "auth", "rejected"):
            logger.warning("Check-in draft declined (%s): %s", err_kind, err_msg)
            self._show_cloud_error_alert(
                err_kind,
                action_th="ตรวจรับเข้า",
                action_en="check-in",
            )
            return

        logger.warning(
            "Check-in draft unavailable (%s: %s); buffering offline capture", err_kind, err_msg
        )
        self.sync_manager.enqueue_offline_checkin(
            jpeg_bytes,
            draft_idempotency_key=draft_key,
        )
        self._show_cloud_error_alert(
            err_kind,
            action_th="ตรวจรับเข้า",
            action_en="check-in",
        )

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
        if draft.image_storage_path == "local_offline":
            logger.info("Offline check-in already buffered for background draft/commit")
            return

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
        commit_key = str(uuid.uuid4())
        ok, res, err = self.cloud_client.checkin_commit(payload, idempotency_key=commit_key)
        if ok and res is not None:
            logger.info("Successfully committed check-in: %s", res.item_id)
        else:
            err_kind = classify_cloud_error(err)
            logger.warning("Cloud checkin commit failed (%s): %s", err_kind, err)
            if err_kind in ("offline", "rate_limited"):
                self.sync_manager.enqueue_pending_commit(payload, commit_key)
            self._show_cloud_error_alert(
                err_kind,
                action_th="ตรวจรับเข้า",
                action_en="check-in",
            )

    def handle_checkout_capture(self) -> None:
        """Triggered when user presses 'X' from Idle screen to check out food."""
        has_frame, frame = self.camera.get_latest_frame()
        if not has_frame or frame is None:
            logger.warning("No camera frame available for checkout capture")
            return

        jpeg_bytes, _, _, _ = self.detector.crop_grocery(frame)
        ok, result, err = self.cloud_client.checkout_draft(
            jpeg_bytes,
            idempotency_key=str(uuid.uuid4()),
        )
        if ok and result is not None:
            self.window.show_checkout_candidates(result.candidates)
        else:
            err_kind = classify_cloud_error(err)
            logger.warning("Check-out draft failed (%s): %s", err_kind, err)
            self._show_cloud_error_alert(
                err_kind,
                action_th="นำอาหารออก",
                action_en="check-out",
            )

    def handle_commit_checkout(self, candidate: CheckOutCandidate) -> None:
        """Triggered when user confirms item removal on LCD."""
        payload = CheckOutCommitPayload(item_id=candidate.item_id)
        ok, res, err = self.cloud_client.checkout_commit(payload)
        if ok and res is not None:
            logger.info("Successfully checked out item: %s", res.item_id)
        else:
            logger.warning("Check-out commit failed: %s", err)
