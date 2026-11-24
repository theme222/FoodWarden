"""Unit tests for FUC.md BLE GATT models, AES-128-GCM, and Anti-Replay Validator."""

import os

import pytest
from cryptography.exceptions import InvalidTag

from foodwarden_camera.models.ble_fuc import (
    SENSOR_LIGHT_ERROR,
    SENSOR_TEMP_ERROR,
    SENSOR_VOC_ERROR,
    AntiReplayValidator,
    SensorPacket,
    SensorSample,
    TelemetryHeader,
)


def test_sensor_sample_sentinels() -> None:
    # Test valid conversion
    sample = SensorSample.from_raw(
        timestamp_s=1729930000,
        temp_cdeg=342,  # 3.42 °C
        voc_index_raw=105,
        light_ldr_raw=45,
    )
    assert sample.temp_celsius == 3.42
    assert sample.voc_index == 105
    assert sample.light_ldr == 45

    # Test error sentinels
    error_sample = SensorSample.from_raw(
        timestamp_s=1729930000,
        temp_cdeg=SENSOR_TEMP_ERROR,
        voc_index_raw=SENSOR_VOC_ERROR,
        light_ldr_raw=SENSOR_LIGHT_ERROR,
    )
    assert error_sample.temp_celsius is None
    assert error_sample.voc_index is None
    assert error_sample.light_ldr is None

    # Roundtrip serialization
    raw_bytes = sample.to_raw_bytes()
    assert len(raw_bytes) == 14

    err_bytes = error_sample.to_raw_bytes()
    assert len(err_bytes) == 14


def test_telemetry_header_pack_unpack() -> None:
    salt = os.urandom(8)
    header = TelemetryHeader(
        version=1,
        node_id="F0",
        session_salt=salt,
        counter=42,
    )
    b = header.to_bytes()
    assert len(b) == 15

    unpacked = TelemetryHeader.from_bytes(b)
    assert unpacked.version == 1
    assert unpacked.node_id == "F0"
    assert unpacked.session_salt == salt
    assert unpacked.counter == 42


def test_packet_encryption_decryption_roundtrip() -> None:
    key = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
    salt = os.urandom(8)
    header = TelemetryHeader(version=1, node_id="F0", session_salt=salt, counter=1)

    samples = [
        SensorSample.from_raw(1729930000, 320, 100, 50),
        SensorSample.from_raw(1729930060, 325, 110, 55),
        SensorSample.from_raw(1729930120, 330, 105, 52),
    ]

    encrypted_payload = SensorPacket.pack_and_encrypt(header, samples, key)

    # Decrypt
    packet = SensorPacket.decrypt_and_unpack(encrypted_payload, key)
    assert packet.header.node_id == "F0"
    assert packet.header.counter == 1
    assert len(packet.samples) == 3
    assert packet.samples[0].temp_celsius == 3.20
    assert packet.samples[1].temp_celsius == 3.25
    assert packet.samples[2].temp_celsius == 3.30


def test_packet_tamper_detection() -> None:
    key = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
    salt = os.urandom(8)
    header = TelemetryHeader(version=1, node_id="F0", session_salt=salt, counter=1)
    samples = [SensorSample.from_raw(1729930000, 320, 100, 50)]

    encrypted_payload = bytearray(SensorPacket.pack_and_encrypt(header, samples, key))

    # Tamper with encrypted ciphertext
    encrypted_payload[20] ^= 0xFF

    with pytest.raises(InvalidTag):
        SensorPacket.decrypt_and_unpack(bytes(encrypted_payload), key)


def test_anti_replay_validator() -> None:
    validator = AntiReplayValidator()
    salt1 = os.urandom(8)
    salt2 = os.urandom(8)

    h1 = TelemetryHeader(version=1, node_id="F0", session_salt=salt1, counter=10)
    ok, reason = validator.is_valid_and_update(h1, 1000)
    assert ok
    assert reason == "new_session"

    # Monotonic increment in same session -> Valid
    h2 = TelemetryHeader(version=1, node_id="F0", session_salt=salt1, counter=11)
    ok, reason = validator.is_valid_and_update(h2, 1010)
    assert ok

    # Duplicate counter -> Replay rejected
    ok, reason = validator.is_valid_and_update(h2, 1020)
    assert not ok
    assert "Replay detected" in reason

    # Past counter -> Replay rejected
    h_old = TelemetryHeader(version=1, node_id="F0", session_salt=salt1, counter=5)
    ok, reason = validator.is_valid_and_update(h_old, 1030)
    assert not ok

    # New session salt (node rebooted) -> Valid even with lower counter
    h_reboot = TelemetryHeader(version=1, node_id="F0", session_salt=salt2, counter=1)
    ok, reason = validator.is_valid_and_update(h_reboot, 1040)
    assert ok
    assert reason == "new_session"
