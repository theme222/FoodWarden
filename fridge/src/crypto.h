#ifndef CRYPTO_H_
#define CRYPTO_H_

#include <stddef.h>
#include <stdint.h>

#include "telemetry_types.h"

// GATT Telemetry Characteristic value: 15 (header) + 1 + N*14 (ciphertext) + 16 (tag)
#define TELEMETRY_MAX_SAMPLES 6
#define TELEMETRY_TAG_LEN 16
#define TELEMETRY_IV_LEN 12
#define TELEMETRY_MAX_PACKET_LEN \
  (sizeof(TelemetryHeader) + sizeof(SensorPacketPayload) + TELEMETRY_TAG_LEN) // 116

#define TELEMETRY_PROTOCOL_VERSION 0x01

// Total encoded size for `count` samples: 32 + count * 14 (0 if count is invalid).
size_t telemetryPacketLen(uint8_t count);

// Builds the encrypted GATT value described in interface/FUC.md §4:
//   header (AAD, plaintext) | AES-128-GCM ciphertext of SensorPacketPayload | tag
// IV = session_salt (8 bytes) + counter (4 bytes, little-endian). The caller
// must never reuse a (session_salt, counter) pair with the same key.
// Returns the number of bytes written to `out`, or 0 on invalid arguments
// (count outside 1..6, small buffer) or an encryption failure.
size_t buildEncryptedPacket(const uint8_t key[16], const char node_id[2],
                            const uint8_t session_salt[8], uint32_t counter,
                            const SensorSample *samples, uint8_t count,
                            uint8_t *out, size_t out_cap);

#endif // CRYPTO_H_
