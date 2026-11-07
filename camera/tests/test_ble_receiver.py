"""Unit tests for BLE GATT Receiver and PDR Tracker."""

import os
import struct

from foodwarden_camera.ble.receiver import (
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
