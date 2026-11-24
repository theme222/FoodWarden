"""Unit tests for BLE GATT Receiver and PDR Tracker."""

import asyncio
import os
import struct
from typing import Any, Self
from unittest.mock import MagicMock, patch

import pytest

import foodwarden_camera.ble.receiver as receiver_module
from foodwarden_camera.ble.receiver import (
    TELEMETRY_CHAR_UUID,
    TIME_SYNC_CHAR_UUID,
    BLEReceiver,
    PDRTracker,
)
from foodwarden_camera.models.ble_fuc import (
    SensorPacket,
    SensorSample,
    TelemetryHeader,
)


def test_pdr_tracker_normal_sequence() -> None:
    tracker = PDRTracker()
    # Initial session: counter 1, 2, 3
    tracker.record_received("F0", 1, is_new_session=True)
    tracker.record_received("F0", 2, is_new_session=False)
    tracker.record_received("F0", 3, is_new_session=False)

    assert tracker.received_count == 3
    assert tracker.missed_count == 0
    assert tracker.packet_delivery_rate == 1.0


def test_pdr_tracker_with_gaps() -> None:
    tracker = PDRTracker()
    tracker.record_received("F0", 1, is_new_session=True)
    # Jump from 1 to 4 -> missed 2 packets (2 and 3)
    tracker.record_received("F0", 4, is_new_session=False)

    assert tracker.received_count == 2
    assert tracker.missed_count == 2
    # Total expected: 4, received: 2 -> 50%
    assert tracker.packet_delivery_rate == 0.5

    # New boot session should not count as missed
    tracker.record_received("F0", 1, is_new_session=True)
    assert tracker.received_count == 3
    assert tracker.missed_count == 2


def test_ble_receiver_telemetry_flow() -> None:
    key = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
    salt = os.urandom(8)
    received_packets: list[SensorPacket] = []

    def on_telem(packet: SensorPacket) -> None:
        received_packets.append(packet)

    receiver = BLEReceiver(aes_key=key, on_telemetry_callback=on_telem)

    # 1. Valid packet
    h1 = TelemetryHeader(version=1, node_id="F0", session_salt=salt, counter=1)
    s1 = [SensorSample.from_raw(1729930000, 350, 120, 20)]
    valid_raw = SensorPacket.pack_and_encrypt(h1, s1, key)

    result = receiver.handle_raw_telemetry(valid_raw)
    assert result is not None
    assert len(received_packets) == 1
    assert received_packets[0].samples[0].temp_celsius == 3.5
    assert receiver.pdr_tracker.received_count == 1

    # 2. Replay packet (same counter in same session)
    replay_result = receiver.handle_raw_telemetry(valid_raw)
    assert replay_result is None
    assert len(received_packets) == 1
    assert receiver.pdr_tracker.replay_dropped_count == 1

    # 3. Corrupted packet
    corrupted_raw = bytearray(valid_raw)
    corrupted_raw[25] ^= 0xFF
    corrupt_result = receiver.handle_raw_telemetry(bytes(corrupted_raw))
    assert corrupt_result is None
    assert receiver.pdr_tracker.corrupted_count == 1


def test_time_sync_byte_format() -> None:
    # Verifies the 64-bit Little-Endian packaging required by FUC.md
    now_s = 1729930000
    packed = struct.pack("<Q", now_s)
    assert len(packed) == 8
    (unpacked,) = struct.unpack("<Q", packed)
    assert unpacked == now_s


def test_ble_connect_and_listen_notify_avoids_duplicate_replay(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key = bytes.fromhex("bf067af927bc016b2947c25fe9544b45")
    salt = os.urandom(8)
    raw_pkt = SensorPacket.pack_and_encrypt(
        TelemetryHeader(version=1, node_id="F0", session_salt=salt, counter=1),
        [SensorSample.from_raw(1729930000, 340, 115, 25)],
        key,
    )
    received: list[SensorPacket] = []
    receiver = BLEReceiver(aes_key=key, on_telemetry_callback=lambda p: received.append(p))

    fake_device = MagicMock()
    fake_device.address = "AA:BB:CC:DD:EE:FF"
    fake_device.name = "FoodWarden-Fridge"

    async def fake_find_by_filter(filterfunc: Any, **kwargs: Any) -> Any:
        adv = MagicMock()
        adv.local_name = "FoodWarden-Fridge"
        adv.service_uuids = ["0000fff0-0000-1000-8000-00805f9b34fb"]
        adv.rssi = -52
        assert filterfunc(fake_device, adv) is True
        return fake_device

    class FakeBleakClient:
        def __init__(self, device: Any, **kwargs: Any) -> None:
            self.device = device
            self.is_connected = True
            self.time_synced = False
            self.read_called = False

        async def __aenter__(self) -> Self:
            return self

        async def __aexit__(self, *args: object) -> None:
            self.is_connected = False

        async def start_notify(self, uuid: str, cb: Any) -> None:
            assert uuid == TELEMETRY_CHAR_UUID
            assert self.time_synced is True
            cb(None, bytearray(raw_pkt))

        async def write_gatt_char(self, uuid: str, data: bytes, response: bool = True) -> None:
            assert uuid == TIME_SYNC_CHAR_UUID
            assert len(data) == 8
            self.time_synced = True

        async def read_gatt_char(self, uuid: str) -> bytearray:
            self.read_called = True
            return bytearray(raw_pkt)

    fake_client = FakeBleakClient(fake_device)
    monkeypatch.setattr(receiver_module.BleakScanner, "find_device_by_filter", fake_find_by_filter)
    with patch.object(receiver_module, "BleakClient", return_value=fake_client):
        asyncio.run(receiver.connect_and_listen(timeout_s=2.0))

    assert len(received) == 1
    assert received[0].samples[0].temp_celsius == 3.4
    assert fake_client.read_called is False
    assert receiver.pdr_tracker.received_count == 1
    assert receiver.pdr_tracker.replay_dropped_count == 0
