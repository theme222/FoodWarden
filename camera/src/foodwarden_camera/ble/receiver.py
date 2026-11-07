"""BLE GATT Central Client for Node 'F' (Internal Fridge Sensor).

Handles BLE connection, 64-bit Unix time synchronization, AES-128-GCM telemetry
decryption, anti-replay verification, and Packet Delivery Rate (PDR) tracking per FUC.md.
"""

from __future__ import annotations

import asyncio
import logging
import struct
import time
from collections.abc import Callable
from typing import Any

from bleak import BleakClient, BleakScanner
from bleak.backends.characteristic import BleakGATTCharacteristic
from bleak.exc import BleakError
from cryptography.exceptions import InvalidTag

from foodwarden_camera.models.ble_fuc import (
    AntiReplayValidator,
    SensorPacket,
)

logger = logging.getLogger(__name__)

# Canonical UUIDs from FUC.md §1
TELEMETRY_SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb"
TELEMETRY_CHAR_UUID = "0000fff1-0000-1000-8000-00805f9b34fb"
TIME_SYNC_CHAR_UUID = "0000fff2-0000-1000-8000-00805f9b34fb"


class PDRTracker:
    """Tracks Packet Delivery Rate (PDR) metrics for Rubric verification."""

    def __init__(self) -> None:
        self.received_count: int = 0
        self.missed_count: int = 0
        self.corrupted_count: int = 0
        self.replay_dropped_count: int = 0
        self._last_counter_per_node: dict[str, int] = {}

    def record_received(self, node_id: str, counter: int, is_new_session: bool) -> None:
        """Updates sequence tracking and records packet delivery."""
        self.received_count += 1
        if not is_new_session and node_id in self._last_counter_per_node:
            last_cnt = self._last_counter_per_node[node_id]
            if counter > last_cnt + 1:
                missed = counter - last_cnt - 1
                self.missed_count += missed
                logger.warning(
                    "Detected sequence gap on %s: missed %d packets (%d -> %d)",
                    node_id,
                    missed,
                    last_cnt,
                    counter,
                )
        self._last_counter_per_node[node_id] = counter

    def record_corrupted(self) -> None:
        self.corrupted_count += 1

    def record_replay_dropped(self) -> None:
        self.replay_dropped_count += 1

    @property
    def packet_delivery_rate(self) -> float:
        """Returns PDR as a fraction (0.0 to 1.0)."""
        total = self.received_count + self.missed_count
        if total == 0:
            return 1.0
        return self.received_count / total

    def summary(self) -> dict[str, Any]:
        return {
            "received": self.received_count,
            "missed": self.missed_count,
            "corrupted": self.corrupted_count,
            "replay_dropped": self.replay_dropped_count,
            "pdr_percentage": round(self.packet_delivery_rate * 100, 2),
        }


class BLEReceiver:
    """GATT Central Client managing communication with Node 'F'."""

    def __init__(
        self,
        aes_key: bytes,
        device_name_prefix: str = "FoodWarden-F",
        target_mac_address: str | None = None,
        on_telemetry_callback: Callable[[SensorPacket], None] | None = None,
    ) -> None:
        self.aes_key = aes_key
        self.device_name_prefix = device_name_prefix
        self.target_mac_address = target_mac_address
        self.on_telemetry_callback = on_telemetry_callback

        self.replay_validator = AntiReplayValidator()
        self.pdr_tracker = PDRTracker()

        self._client: BleakClient | None = None
        self._running: bool = False
        self._connected: bool = False

    @property
    def is_connected(self) -> bool:
        return self._connected and self._client is not None and self._client.is_connected

    def handle_raw_telemetry(self, raw_bytes: bytes) -> SensorPacket | None:
        """Decodes, decrypts, and validates raw characteristic payload.

        Returns decoded SensorPacket if valid, or None if corrupted / replayed.
        """
        try:
            packet = SensorPacket.decrypt_and_unpack(raw_bytes, self.aes_key)
        except (InvalidTag, ValueError) as exc:
            logger.warning("Failed to decrypt BLE telemetry packet: %s", exc)
            self.pdr_tracker.record_corrupted()
            return None

        newest_ts = packet.samples[-1].timestamp_s if packet.samples else int(time.time())
        is_valid, reason = self.replay_validator.is_valid_and_update(packet.header, newest_ts)

        if not is_valid:
            logger.warning(
                "Dropped BLE telemetry packet from %s: %s", packet.header.node_id, reason
            )
            self.pdr_tracker.record_replay_dropped()
            return None

        is_new_session = reason == "new_session"
        self.pdr_tracker.record_received(
            packet.header.node_id, packet.header.counter, is_new_session
        )

        logger.info(
            "Successfully decrypted %d samples from %s (counter=%d, session_salt=%s)",
            len(packet.samples),
            packet.header.node_id,
            packet.header.counter,
            packet.header.session_salt.hex()[:8],
        )

        if self.on_telemetry_callback:
            try:
                self.on_telemetry_callback(packet)
            except Exception:  # noqa: BLE001
                logger.exception("Error in telemetry callback")

        return packet

    def _notification_handler(
        self, characteristic: BleakGATTCharacteristic, data: bytearray
    ) -> None:
        """Callback invoked by Bleak when characteristic notification fires."""
        self.handle_raw_telemetry(bytes(data))

    async def sync_time(self, client: BleakClient) -> bool:
        """Writes current 64-bit Unix timestamp to Time Sync Characteristic 0000FFF2."""
        now_s = int(time.time())
        # Little-Endian uint64_t
        time_bytes = struct.pack("<Q", now_s)
        try:
            await client.write_gatt_char(TIME_SYNC_CHAR_UUID, time_bytes, response=True)
            logger.info("Successfully synchronized RTC time on Node 'F': %d", now_s)
            return True
        except (BleakError, OSError) as exc:
            logger.error("Failed to write RTC timestamp to Node 'F': %s", exc)
            return False

    async def connect_and_listen(self, timeout_s: float = 10.0) -> None:
        """Discovers Node 'F', synchronizes time, and subscribes to telemetry."""
        logger.info("Scanning for Node 'F' (Service UUID: %s)...", TELEMETRY_SERVICE_UUID)

        device = None
        if self.target_mac_address:
            device = await BleakScanner.find_device_by_address(
                self.target_mac_address, timeout=timeout_s
            )
        else:
            devices = await BleakScanner.discover(
                timeout=timeout_s, service_uuids=[TELEMETRY_SERVICE_UUID]
            )
            for d in devices:
                if d.name and self.device_name_prefix in d.name:
                    device = d
                    break

        if not device:
            logger.debug("Node 'F' not found during scan window (sensor may be in deep sleep)")
            return

        logger.info("Discovered Node 'F' at %s (%s). Connecting...", device.address, device.name)

        async with BleakClient(device) as client:
            self._client = client
            self._connected = True
            try:
                # 1. Synchronize time
                await self.sync_time(client)

                # 2. Subscribe to telemetry notifications
                await client.start_notify(TELEMETRY_CHAR_UUID, self._notification_handler)
                logger.info("Subscribed to BLE telemetry notifications on %s", TELEMETRY_CHAR_UUID)

                # 3. Read initial payload if available
                initial_bytes = await client.read_gatt_char(TELEMETRY_CHAR_UUID)
                if initial_bytes:
                    self.handle_raw_telemetry(bytes(initial_bytes))

                # Keep connected until peripheral disconnects or deep sleeps
                while self._running and client.is_connected:
                    await asyncio.sleep(1.0)

            except (BleakError, OSError, asyncio.CancelledError) as exc:
                logger.warning("BLE communication exception with Node 'F': %s", exc)
            finally:
                self._connected = False
                self._client = None
                logger.info("Disconnected from Node 'F'")

    async def run_loop(self) -> None:
        """Continuous background loop scanning and connecting with backoff."""
        self._running = True
        backoff_s = 2.0
        while self._running:
            try:
                await self.connect_and_listen()
                backoff_s = 2.0  # Reset backoff on successful connection
            except (BleakError, OSError) as exc:
                logger.warning("Error in BLE run loop: %s", exc)
                await asyncio.sleep(backoff_s)
                backoff_s = min(backoff_s * 1.5, 30.0)
            await asyncio.sleep(1.0)

    def stop(self) -> None:
        """Stops the BLE scanning loop."""
        self._running = False
