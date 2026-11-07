"""BLE GATT Telemetry and Time Synchronization models (Node 'F' -> Node 'C').

Mirrors the interface contract defined in interface/FUC.md.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# Explicit hardware error sentinels (FUC.md §3.A)
SENSOR_TEMP_ERROR: int = -32768  # 0x8000
SENSOR_VOC_ERROR: int = 0xFFFF  # 65535
SENSOR_LIGHT_ERROR: int = 0xFFFF  # 65535

# Binary struct formats (Little-Endian)
HEADER_STRUCT_FORMAT = "<B2s8sI"  # 15 bytes: version, node_id, session_salt, counter
SAMPLE_STRUCT_FORMAT = "<QhHH"  # 14 bytes: timestamp_s, temp_cdeg, voc_index, light_ldr
HEADER_SIZE = 15
SAMPLE_SIZE = 14
TAG_SIZE = 16


@dataclass(frozen=True)
class SensorSample:
    """Individual sensor reading from Node 'F'."""

    timestamp_s: int
    temp_celsius: float | None
    voc_index: int | None
    light_ldr: int | None

    @classmethod
    def from_raw(
        cls,
        timestamp_s: int,
        temp_cdeg: int,
        voc_index_raw: int,
        light_ldr_raw: int,
    ) -> SensorSample:
        """Construct from raw sensor values, converting sentinels to None."""
        temp = None if temp_cdeg == SENSOR_TEMP_ERROR else round(temp_cdeg / 100.0, 2)
        voc = None if voc_index_raw == SENSOR_VOC_ERROR else voc_index_raw
        light = None if light_ldr_raw == SENSOR_LIGHT_ERROR else light_ldr_raw

        return cls(
            timestamp_s=timestamp_s,
            temp_celsius=temp,
            voc_index=voc,
            light_ldr=light,
        )

    def to_raw_bytes(self) -> bytes:
        """Serializes sample into 14-byte binary representation."""
        temp_raw = (
            SENSOR_TEMP_ERROR if self.temp_celsius is None else round(self.temp_celsius * 100)
        )
        voc_raw = SENSOR_VOC_ERROR if self.voc_index is None else self.voc_index
        light_raw = SENSOR_LIGHT_ERROR if self.light_ldr is None else self.light_ldr
        return struct.pack(SAMPLE_STRUCT_FORMAT, self.timestamp_s, temp_raw, voc_raw, light_raw)


@dataclass(frozen=True)
class TelemetryHeader:
    """Plaintext AAD Header (15 bytes)."""

    version: int
    node_id: str
    session_salt: bytes
    counter: int

    def to_bytes(self) -> bytes:
        return struct.pack(
            HEADER_STRUCT_FORMAT,
            self.version,
            self.node_id.encode("ascii"),
            self.session_salt,
            self.counter,
        )

    @classmethod
    def from_bytes(cls, data: bytes) -> TelemetryHeader:
        if len(data) < HEADER_SIZE:
            raise ValueError(f"Header data too short: {len(data)} < {HEADER_SIZE}")
        version, node_id_bytes, session_salt, counter = struct.unpack(
            HEADER_STRUCT_FORMAT, data[:HEADER_SIZE]
        )
        return cls(
            version=version,
            node_id=node_id_bytes.decode("ascii", errors="replace"),
            session_salt=session_salt,
            counter=counter,
        )


@dataclass(frozen=True)
class SensorPacket:
    """Decoded telemetry packet containing header and batched samples."""

    header: TelemetryHeader
    samples: list[SensorSample]

    @classmethod
    def decrypt_and_unpack(cls, raw_payload: bytes, aes_key: bytes) -> SensorPacket:
        """Decrypts and unpacks a raw characteristic value according to FUC.md §4.

        Raises:
            ValueError: If packet length is invalid or header format is unsupported.
            cryptography.exceptions.InvalidTag: If decryption/authentication fails.
        """
        min_size = HEADER_SIZE + 1 + SAMPLE_SIZE + TAG_SIZE  # 15 + 1 + 14 + 16 = 46 bytes
        if len(raw_payload) < min_size:
            raise ValueError(
                f"Payload size {len(raw_payload)} is smaller than minimum expected {min_size} bytes"
            )

        header_bytes = raw_payload[:HEADER_SIZE]
        header = TelemetryHeader.from_bytes(header_bytes)

        if header.version != 1:
            raise ValueError(f"Unsupported packet protocol version: {header.version}")

        # Construct 12-byte Nonce: session_salt (8 bytes) + counter (4 bytes Little-Endian)
        nonce = header.session_salt + struct.pack("<I", header.counter)

        # In AESGCM.decrypt, data_to_decrypt is ciphertext + 16-byte auth tag
        encrypted_data = raw_payload[HEADER_SIZE:]

        aesgcm = AESGCM(aes_key)
        plaintext = aesgcm.decrypt(nonce=nonce, data=encrypted_data, associated_data=header_bytes)

        if len(plaintext) < 1:
            raise ValueError("Decrypted plaintext is empty")

        sample_count = plaintext[0]
        expected_len = 1 + (sample_count * SAMPLE_SIZE)
        if len(plaintext) < expected_len:
            raise ValueError(
                f"Decrypted plaintext length {len(plaintext)} does not match sample count {sample_count}"
            )

        samples: list[SensorSample] = []
        offset = 1
        for _ in range(sample_count):
            ts, temp_cdeg, voc, light = struct.unpack(
                SAMPLE_STRUCT_FORMAT, plaintext[offset : offset + SAMPLE_SIZE]
            )
            samples.append(SensorSample.from_raw(ts, temp_cdeg, voc, light))
            offset += SAMPLE_SIZE

        return cls(header=header, samples=samples)

    @classmethod
    def pack_and_encrypt(
        cls,
        header: TelemetryHeader,
        samples: list[SensorSample],
        aes_key: bytes,
    ) -> bytes:
        """Packs and encrypts a SensorPacket (useful for tests and mocks)."""
        header_bytes = header.to_bytes()
        nonce = header.session_salt + struct.pack("<I", header.counter)

        # Build plaintext: sample_count (1 byte) + N * 14-byte samples
        plaintext = bytearray()
        plaintext.append(len(samples))
        for sample in samples:
            plaintext.extend(sample.to_raw_bytes())

        aesgcm = AESGCM(aes_key)
        ciphertext_and_tag = aesgcm.encrypt(
            nonce=nonce, data=bytes(plaintext), associated_data=header_bytes
        )

        return bytes(header_bytes + ciphertext_and_tag)


class AntiReplayValidator:
    """Validates anti-replay sequence counters and session salts per FUC.md §5."""

    def __init__(self) -> None:
        self._last_sessions: dict[str, bytes] = {}
        self._last_counters: dict[str, int] = {}
        self._last_timestamps: dict[str, int] = {}

    def is_valid_and_update(
        self, header: TelemetryHeader, newest_sample_ts: int
    ) -> tuple[bool, str]:
        """Validates packet sequence and updates state.

        Returns:
            (is_valid, reason_if_invalid)
        """
        node_id = header.node_id
        last_salt = self._last_sessions.get(node_id)
        last_cnt = self._last_counters.get(node_id)
        last_ts = self._last_timestamps.get(node_id, 0)

        if last_salt is None or last_salt != header.session_salt:
            # New boot / session salt change
            self._last_sessions[node_id] = header.session_salt
            self._last_counters[node_id] = header.counter
            self._last_timestamps[node_id] = newest_sample_ts
            return True, "new_session"

        # Existing session: counter must strictly increase
        if last_cnt is not None and header.counter <= last_cnt:
            return False, f"Replay detected: counter {header.counter} <= last_counter {last_cnt}"

        # Timestamp check
        if newest_sample_ts < last_ts:
            return False, f"Time anomaly: sample timestamp {newest_sample_ts} < last {last_ts}"

        self._last_counters[node_id] = header.counter
        self._last_timestamps[node_id] = newest_sample_ts
        return True, "ok"
