#ifndef TELEMETRY_TYPES_H_
#define TELEMETRY_TYPES_H_

#include <stdint.h>

// Local mirror of interface/FUC.md §3.A. Keep in sync with the contract; do not
// include files from interface/ directly.

// Explicit error sentinels (interface/README.md §2.D)
#define SENSOR_TEMP_ERROR  ((int16_t)-32768)  // 0x8000 (sensor disconnected / I2C fault)
#define SENSOR_VOC_ERROR   ((uint16_t)0xFFFF) // 65535 (sensor disconnected / I2C fault)
#define SENSOR_LIGHT_ERROR ((uint16_t)0xFFFF) // 65535 (ADC fault)

// VOC value reported while the VOC reading is deliberately withheld (door open
// or in the post-door cooldown window). Same wire value as SENSOR_VOC_ERROR;
// Node 'C' parses 0xFFFF as null.
#define VOC_NULL_SENTINEL ((uint16_t)0xFFFF)

// Plaintext AAD Header (15 bytes, unencrypted, authenticated via GCM AAD)
struct __attribute__((packed)) TelemetryHeader {
  uint8_t version;         // Protocol format version (0x01)
  char node_id[2];         // 2-byte ASCII node identifier (e.g. "F0")
  uint8_t session_salt[8]; // Random 64-bit session salt generated on cold boot
  uint32_t counter;        // Monotonic sequence counter per session (Little-Endian)
};

// Individual Sensor Reading with dedicated timestamp (14 bytes)
struct __attribute__((packed)) SensorSample {
  uint64_t timestamp_s; // Second-accurate Unix timestamp (Little-Endian)
  int16_t temp_cdeg;    // Centi-degrees Celsius; 0x8000 = Error
  uint16_t voc_index;   // Gas Index 1-500; 0 = warming up; 0xFFFF = Error / withheld
  uint16_t light_ldr;   // Raw ADC 0-4095; 0xFFFF = Error
};

// Encrypted Payload Structure (1 + N * 14 bytes)
struct __attribute__((packed)) SensorPacketPayload {
  uint8_t sample_count;    // Number of batched samples (1 to 6)
  SensorSample samples[6]; // Batched readings (up to 84 bytes)
};

static_assert(sizeof(TelemetryHeader) == 15, "TelemetryHeader must be 15 bytes");
static_assert(sizeof(SensorSample) == 14, "SensorSample must be 14 bytes");
static_assert(sizeof(SensorPacketPayload) == 85, "SensorPacketPayload must be 85 bytes");

#endif // TELEMETRY_TYPES_H_
