#include "crypto.h"

#include <string.h>

#include <mbedtls/gcm.h>

size_t telemetryPacketLen(uint8_t count) {
  if (count < 1 || count > TELEMETRY_MAX_SAMPLES) return 0;
  return sizeof(TelemetryHeader) + 1 + (size_t)count * sizeof(SensorSample) + TELEMETRY_TAG_LEN;
}

size_t buildEncryptedPacket(const uint8_t key[16], const char node_id[2],
                            const uint8_t session_salt[8], uint32_t counter,
                            const SensorSample *samples, uint8_t count,
                            uint8_t *out, size_t out_cap) {
  const size_t total = telemetryPacketLen(count);
  if (total == 0 || out == nullptr || out_cap < total || key == nullptr ||
      node_id == nullptr || session_salt == nullptr || samples == nullptr) {
    return 0;
  }

  // Plaintext AAD header, written directly into the output buffer.
  TelemetryHeader header;
  header.version = TELEMETRY_PROTOCOL_VERSION;
  memcpy(header.node_id, node_id, sizeof(header.node_id));
  memcpy(header.session_salt, session_salt, sizeof(header.session_salt));
  header.counter = counter; // ESP32 is little-endian, matching the <B2s8sI layout
  memcpy(out, &header, sizeof(header));

  // Plaintext payload: sample_count followed by only the used samples.
  const size_t payload_len = 1 + (size_t)count * sizeof(SensorSample);
  uint8_t payload[sizeof(SensorPacketPayload)];
  payload[0] = count;
  memcpy(payload + 1, samples, (size_t)count * sizeof(SensorSample));

  // IV = session_salt (8) + counter (4, little-endian)
  uint8_t iv[TELEMETRY_IV_LEN];
  memcpy(iv, session_salt, 8);
  memcpy(iv + 8, &header.counter, 4);

  uint8_t *ciphertext = out + sizeof(header);
  uint8_t *tag = ciphertext + payload_len;

  mbedtls_gcm_context ctx;
  mbedtls_gcm_init(&ctx);
  int rc = mbedtls_gcm_setkey(&ctx, MBEDTLS_CIPHER_ID_AES, key, 128);
  if (rc == 0) {
    rc = mbedtls_gcm_crypt_and_tag(&ctx, MBEDTLS_GCM_ENCRYPT, payload_len, iv, sizeof(iv),
                                   out, sizeof(header), payload, ciphertext,
                                   TELEMETRY_TAG_LEN, tag);
  }
  mbedtls_gcm_free(&ctx);

  return rc == 0 ? total : 0;
}
