#!/usr/bin/env python3
"""Decrypt and validate a Node 'F' telemetry packet (interface/FUC.md section 4).

Usage:
  decrypt_packet.py HEX [--key-hex 32HEXCHARS]
  decrypt_packet.py --selftest

HEX is the GATT telemetry characteristic value: 15-byte header | ciphertext | 16-byte tag.
Build the firmware with -DFRIDGE_LOG_PACKETS to have it print "packet=<hex>" on serial.
The default key is the example AES_KEY from secrets.h.example; pass --key-hex for yours.
Requires: pip install cryptography
"""
import argparse
import struct
import sys

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

EXAMPLE_KEY = bytes(range(16))
SENTINEL_TEMP = -32768
SENTINEL_U16 = 0xFFFF


def decode(blob: bytes, key: bytes) -> dict:
    if len(blob) < 15 + 1 + 14 + 16:
        raise ValueError(f"packet too short: {len(blob)} bytes")
    n_expected = (len(blob) - 32) // 14
    if len(blob) != 32 + 14 * n_expected or not 1 <= n_expected <= 6:
        raise ValueError(f"length {len(blob)} is not 32 + N*14 for N in 1..6")

    header = blob[:15]
    version, node_id, salt, counter = struct.unpack("<B2s8sI", header)
    iv = salt + struct.pack("<I", counter)
    try:
        payload = AESGCM(key).decrypt(iv, blob[15:], header)  # tag is the last 16 bytes
    except InvalidTag as exc:
        raise ValueError("authentication failed (wrong key, or header/ciphertext altered)") from exc

    count = payload[0]
    if count != n_expected or len(payload) != 1 + 14 * count:
        raise ValueError(f"sample_count {count} does not match packet length")

    samples = []
    for i in range(count):
        ts, temp, voc, light = struct.unpack_from("<QhHH", payload, 1 + 14 * i)
        samples.append({
            "timestamp_s": ts,
            "temp_celsius": None if temp == SENTINEL_TEMP else temp / 100.0,
            "voc_index": None if voc == SENTINEL_U16 else voc,
            "light_ldr": None if light == SENTINEL_U16 else light,
        })
    return {"version": version, "node_id": node_id.decode("ascii", "replace"),
            "session_salt": salt.hex(), "counter": counter, "samples": samples}


def encode_for_selftest(key: bytes) -> bytes:
    salt = bytes([1, 2, 3, 4, 5, 6, 7, 8])
    header = struct.pack("<B2s8sI", 1, b"F0", salt, 7)
    payload = bytes([2]) + struct.pack("<QhHH", 1767225600, 342, 100, 512) \
        + struct.pack("<QhHH", 1767225605, SENTINEL_TEMP, SENTINEL_U16, 10)
    return header + AESGCM(key).encrypt(salt + struct.pack("<I", 7), payload, header)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("hex", nargs="?", help="packet as hex")
    ap.add_argument("--key-hex", default=EXAMPLE_KEY.hex())
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    key = bytes.fromhex(args.key_hex)
    if len(key) != 16:
        ap.error("--key-hex must be 32 hex characters (128-bit key)")

    if args.selftest:
        result = decode(encode_for_selftest(key), key)
        ok = (result["counter"] == 7 and result["samples"][0]["temp_celsius"] == 3.42
              and result["samples"][1]["temp_celsius"] is None
              and result["samples"][1]["voc_index"] is None)
        bad = bytearray(encode_for_selftest(key)); bad[3] ^= 1
        try:
            decode(bytes(bad), key); ok = False
        except ValueError:
            pass
        print("SELFTEST", "PASSED" if ok else "FAILED")
        return 0 if ok else 1

    if not args.hex:
        ap.error("give the packet hex, or --selftest")
    try:
        result = decode(bytes.fromhex(args.hex.strip().removeprefix("packet=")), key)
    except ValueError as exc:
        print(f"INVALID: {exc}")
        return 1
    print(f"node={result['node_id']} version={result['version']} salt={result['session_salt']} "
          f"counter={result['counter']}")
    for s in result["samples"]:
        print(f"  ts={s['timestamp_s']} temp={s['temp_celsius']} voc={s['voc_index']} "
              f"light={s['light_ldr']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
