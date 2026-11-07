"""MQTT over TLS Client for Node 'C' <-> Node 'D' actuation and safety.

Implements command dispatching (CLOSE_DOOR, ABORT), door event reception, 1 Hz telemetry
monitoring, RTC time synchronization response, and door-ajar duration tracking per CBD.md.
"""

from __future__ import annotations

import json
import logging
import os
import ssl
import time
from collections.abc import Callable
from typing import Any, Literal

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion

from foodwarden_camera.models.mqtt_cbd import (
    AbortCommand,
    CloseDoorCommand,
    DoorEventEnvelope,
    DoorTelemetryPayload,
    TimeSyncRequest,
    TimeSyncResponse,
)

logger = logging.getLogger(__name__)

# Topics from CBD.md §1.B
CMD_TOPIC = "fridge/door/cmd"
EVENT_TOPIC = "fridge/door/event"
TELEMETRY_TOPIC = "fridge/door/telemetry"
TIME_REQ_TOPIC = "fridge/door/time/req"
TIME_RES_TOPIC = "fridge/door/time/res"
STATUS_TOPIC = "fridge/door/status"


class DoorMQTTClient:
    """Manages the MQTT connection to Node 'D' over TLS."""

    def __init__(
        self,
        broker_host: str = "127.0.0.1",
        broker_port: int = 8883,
        username: str = "foodwarden_client",
        password: str = "",
        ca_cert_path: str = "/etc/mosquitto/certs/ca.crt",
        client_cert_path: str | None = None,
        client_key_path: str | None = None,
        on_door_event: Callable[[DoorEventEnvelope], None] | None = None,
        on_door_telemetry: Callable[[DoorTelemetryPayload], None] | None = None,
        on_connection_change: Callable[[bool], None] | None = None,
    ) -> None:
        self.broker_host = broker_host
        self.broker_port = broker_port
        self.username = username
        self.password = password
        self.ca_cert_path = ca_cert_path
        self.client_cert_path = client_cert_path
        self.client_key_path = client_key_path

        self.on_door_event = on_door_event
        self.on_door_telemetry = on_door_telemetry
        self.on_connection_change = on_connection_change

        self._connected: bool = False
        self._door_opened_at: float | None = None
        self._is_door_open: bool = False
        self._last_state: str = "UNKNOWN"

        # Initialize paho-mqtt client with Protocol version 5 / 3.1.1
        self._client = mqtt.Client(
            callback_api_version=CallbackAPIVersion.VERSION2,
            client_id="foodwarden-gateway-c",
        )
        self._configure_client()

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def is_door_open(self) -> bool:
        return self._is_door_open

    @property
    def door_ajar_duration_s(self) -> float:
        """Returns seconds door has been continuously open, or 0.0 if closed."""
        if not self._is_door_open or self._door_opened_at is None:
            return 0.0
        return max(0.0, time.time() - self._door_opened_at)

    def _configure_client(self) -> None:
        """Configures credentials, TLS, and callbacks."""
        if self.username:
            self._client.username_pw_set(self.username, self.password)

        # TLS configuration
        if os.path.exists(self.ca_cert_path) and os.access(self.ca_cert_path, os.R_OK):
            logger.info("Configuring MQTT TLS with CA: %s", self.ca_cert_path)
            certfile = (
                self.client_cert_path
                if self.client_cert_path
                and os.path.exists(self.client_cert_path)
                and os.access(self.client_cert_path, os.R_OK)
                else None
            )
            keyfile = (
                self.client_key_path
                if self.client_key_path
                and os.path.exists(self.client_key_path)
                and os.access(self.client_key_path, os.R_OK)
                else None
            )
            try:
                self._client.tls_set(
                    ca_certs=self.ca_cert_path,
                    certfile=certfile if keyfile else None,
                    keyfile=keyfile if certfile else None,
                    tls_version=ssl.PROTOCOL_TLS_CLIENT,
                )
                # Allow connecting to 127.0.0.1 when cert CN is LAN IP
                self._client.tls_insecure_set(True)
            except (PermissionError, ssl.SSLError, OSError) as exc:
                logger.warning("MQTT TLS cert load warning (%s); using CA-only TLS", exc)
                self._client.tls_set(
                    ca_certs=self.ca_cert_path,
                    tls_version=ssl.PROTOCOL_TLS_CLIENT,
                )
                self._client.tls_insecure_set(True)
        else:
            logger.warning(
                "MQTT CA certificate not found at %s. Running in unencrypted mode for dev/testing.",
                self.ca_cert_path,
            )

        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message

    def _on_connect(
        self, client: mqtt.Client, userdata: Any, flags: Any, rc: Any, properties: Any = None
    ) -> None:
        """Called upon successful MQTT broker connection."""
        if rc == 0 or (hasattr(rc, "is_failure") and not rc.is_failure):
            logger.info(
                "Connected to local Mosquitto MQTT broker at %s:%d",
                self.broker_host,
                self.broker_port,
            )
            self._connected = True

            # Subscribe to all required topics from CBD.md §1.B
            subscriptions = [
                (EVENT_TOPIC, 1),
                (TELEMETRY_TOPIC, 0),
                (TIME_REQ_TOPIC, 1),
                (STATUS_TOPIC, 1),
            ]
            for topic, qos in subscriptions:
                client.subscribe(topic, qos=qos)
                logger.debug("Subscribed to %s with QoS %d", topic, qos)

            if self.on_connection_change:
                self.on_connection_change(True)
        else:
            logger.error("Failed to connect to Mosquitto broker: rc=%s", rc)
            self._connected = False
            if self.on_connection_change:
                self.on_connection_change(False)

    def _on_disconnect(
        self, client: mqtt.Client, userdata: Any, flags: Any, rc: Any, properties: Any = None
    ) -> None:
        """Called when MQTT broker connection drops."""
        logger.warning("Disconnected from MQTT broker: rc=%s", rc)
        self._connected = False
        if self.on_connection_change:
            self.on_connection_change(False)

    def _on_message(self, client: mqtt.Client, userdata: Any, msg: mqtt.MQTTMessage) -> None:
        """Dispatches incoming MQTT messages to specific handlers."""
        topic = msg.topic
        payload_bytes = msg.payload

        try:
            payload_str = payload_bytes.decode("utf-8")
            data = json.loads(payload_str)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            logger.warning("Failed to decode JSON payload on topic %s: %s", topic, exc)
            return

        if topic == TIME_REQ_TOPIC:
            self._handle_time_req(data)
        elif topic == EVENT_TOPIC:
            self._handle_door_event(data)
        elif topic == TELEMETRY_TOPIC:
            self._handle_door_telemetry(data)
        elif topic == STATUS_TOPIC:
            self._handle_door_status(data)

    def _handle_time_req(self, data: dict[str, Any]) -> None:
        """Handles RTC time synchronization requests from Node 'D'."""
        try:
            req = TimeSyncRequest.model_validate(data)
            now_s = int(time.time())
            res = TimeSyncResponse(node_id=req.node_id, timestamp=now_s)
            self._client.publish(
                TIME_RES_TOPIC,
                res.model_dump_json(),
                qos=1,
            )
            logger.info(
                "Responded to time sync request from %s with timestamp %d", req.node_id, now_s
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Error processing time sync request: %s", exc)

    def _handle_door_event(self, data: dict[str, Any]) -> None:
        """Parses and handles discrete actuation events."""
        try:
            envelope = DoorEventEnvelope.model_validate(data)
            logger.info("Received door event from %s: %s", envelope.node_id, envelope.event.type)

            if envelope.event.type == "SUCCESS":
                self.set_door_state(is_open=False)
            elif envelope.event.type == "CLOSING":
                logger.info("Actuator is closing door...")

            if self.on_door_event:
                self.on_door_event(envelope)
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to parse door event envelope: %s", exc)

    def _handle_door_telemetry(self, data: dict[str, Any]) -> None:
        """Parses 1 Hz periodic telemetry from Node 'D'."""
        try:
            telem = DoorTelemetryPayload.model_validate(data)
            self._last_state = telem.state

            # If IR sensor says closed -> not open
            # If IR sensor says open (ir_closed == False) -> door is open
            self.set_door_state(is_open=not telem.ir_closed)

            if self.on_door_telemetry:
                self.on_door_telemetry(telem)
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to parse door telemetry: %s", exc)

    def _handle_door_status(self, data: dict[str, Any]) -> None:
        """Tracks online / offline status of Node 'D'."""
        status = data.get("status", "unknown")
        node_id = data.get("node_id", "D0")
        logger.info("Node '%s' status update: %s", node_id, status)

    def set_door_state(self, is_open: bool) -> None:
        """Updates internal door open/closed tracking."""
        if is_open and not self._is_door_open:
            self._is_door_open = True
            self._door_opened_at = time.time()
            logger.info("Door opened at %f", self._door_opened_at)
        elif not is_open and self._is_door_open:
            self._is_door_open = False
            duration = self.door_ajar_duration_s
            self._door_opened_at = None
            logger.info("Door closed after %.1f seconds", duration)

    def send_close_door(self, node_id: str = "D0", timeout_s: int = 30) -> CloseDoorCommand:
        """Publishes CLOSE_DOOR command (QoS 1) to fridge/door/cmd."""
        cmd = CloseDoorCommand(node_id=node_id, timeout_s=timeout_s)
        self._client.publish(CMD_TOPIC, cmd.model_dump_json(), qos=1)
        logger.info("Published CLOSE_DOOR command: cmd_id=%s, node_id=%s", cmd.cmd_id, node_id)
        return cmd

    def send_abort(
        self,
        node_id: str = "D0",
        reason: Literal["HUMAN_APPROACH", "USER_CANCEL"] = "HUMAN_APPROACH",
    ) -> AbortCommand:
        """Publishes ABORT command (QoS 1) immediately to fridge/door/cmd."""
        cmd = AbortCommand(node_id=node_id, reason=reason)
        self._client.publish(CMD_TOPIC, cmd.model_dump_json(), qos=1)
        logger.warning("Published ABORT command: cmd_id=%s, reason=%s", cmd.cmd_id, reason)
        return cmd

    def start(self) -> None:
        """Starts non-blocking background network loop."""
        try:
            self._client.connect_async(self.broker_host, self.broker_port, keepalive=60)
            self._client.loop_start()
            logger.info("MQTT network loop started for %s:%d", self.broker_host, self.broker_port)
        except (OSError, mqtt.WebsocketConnectionError) as exc:
            logger.error("Failed to start MQTT connection: %s", exc)

    def stop(self) -> None:
        """Disconnects and terminates network loop."""
        try:
            self._client.loop_stop()
            self._client.disconnect()
            self._connected = False
            logger.info("MQTT client stopped")
        except (OSError, mqtt.WebsocketConnectionError) as exc:
            logger.error("Error stopping MQTT client: %s", exc)
