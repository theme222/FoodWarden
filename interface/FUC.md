# FUC: Fridge ('F') → Camera ('C') Interface Contract

This document defines the communication interface between the internal fridge sensor node (**Node `'F'`**, KidBright32 ESP32) and the edge gateway (**Node `'C'`**, Pi-top [4] Raspberry Pi 4).

* **Source (`'F'`):** Fridge Sensor Node (KidBright32 — C++/FreeRTOS)
* **Destination (`'C'`):** Edge Gateway (Pi-top [4] — Python)
* **Directionality:** Unidirectional Telemetry Flow (`F → C`) via GATT
* **Transport Protocol:** Bluetooth Low Energy (BLE) GATT (Generic Attribute Profile)
* **Security:** Application-layer **AES-128-GCM** authenticated encryption with Additional Authenticated Data (AAD)

---

## 1. BLE GATT Service & Characteristics

Node `'F'` operates as a **GATT Server (Peripheral)**. Node `'C'` operates as a **GATT Client (Central)**.

| Identifier | UUID | Description | Properties |
|---|---|---|---|
| **Telemetry Service** | `0000FFF0-0000-1000-8000-00805F9B34FB` | Primary service advertised by Node `'F'` | Broadcast / Connectable |
| **Telemetry Characteristic** | `0000FFF1-0000-1000-8000-00805F9B34FB` | Encrypted sensor telemetry envelope | Read, Notify |
| **Time Sync Characteristic** | `0000FFF2-0000-1000-8000-00805F9B34FB` | 8-byte Unix timestamp (`uint64_t`, Little-Endian) written by Gateway `'C'` | Write, Read |

* **MTU Negotiation:** Node `'C'` and Node `'F'` negotiate an ATT MTU of at least 128 bytes (BLE 4.2 supports up to 247 bytes MTU). The telemetry payload transfers in a single PDU.

---

## 2. Secrets Reference

All cryptographic keys and sensitive tokens are strictly decoupled from source control:
* **C++ (Node `'F'`):** Provided via `#include "secrets.h"` in `fridge/secrets.h`
* **Python (Node `'C'`):** Provided via environment variable in `camera/.env`
* **Shared Identifier:** `AES_KEY` (128-bit / 16-byte pre-shared symmetric key)

---

## 3. Data Structures & Memory Layout

### A. C++ Data Structures (Node `'F'`)

```c
#include <stdint.h>

// Explicit error sentinels matching interface/README.md §2.D
#define SENSOR_TEMP_ERROR  ((int16_t)-32768) // 0x8000 (sensor disconnected / I2C fault)
#define SENSOR_VOC_ERROR   ((uint16_t)0xFFFF) // 65535 VOC index (sensor disconnected / I2C fault)
#define SENSOR_LIGHT_ERROR ((uint16_t)0xFFFF) // 65535 ADC reading (ADC fault)

// Plaintext AAD Header (15 bytes, unencrypted, authenticated via GCM AAD)
struct __attribute__((packed)) TelemetryHeader {
  uint8_t  version;         // Protocol format version (0x01)
  char     node_id[2];      // 2-byte ASCII node identifier (e.g. {'F', '0'} for "F0")
  uint8_t  session_salt[8]; // Random 64-bit session salt generated via hardware TRNG on cold boot
  uint32_t counter;         // Monotonically increasing sequence counter per session (Little-Endian)
};

// Individual Sensor Reading with dedicated timestamp (14 bytes)
struct __attribute__((packed)) SensorSample {
  uint64_t timestamp_s; // Second-accurate Unix timestamp (Little-Endian)
  int16_t  temp_cdeg;   // Temperature in centi-degrees Celsius (e.g. 342 = 3.42°C; -32768 / 0x8000 = Error)
  uint16_t voc_index;   // Sensirion Gas Index Algorithm output (1-500; 0 = warming up; 0xFFFF = Error)
  uint16_t light_ldr;   // Raw ADC light reading (0-4095; 0xFFFF = Error)
};

// Encrypted Payload Structure (1 + N * 14 bytes)
struct __attribute__((packed)) SensorPacketPayload {
  uint8_t      sample_count; // Number of batched samples in packet (1 to 6)
  SensorSample samples[6];   // Batched readings (up to 84 bytes)
};
```

> [!NOTE]
> **Sensirion VOC Index vs. Raw Ticks:**
> Transmission across all interfaces strictly uses the processed **VOC Index (1–500)** produced by the Sensirion Gas Index Algorithm (where 100 represents baseline air, and values > 250 indicate high VOC emissions). Raw SRAW ticks are processed internally on Node `'F'` and are never transmitted over BLE.
>
> **Battery Power Profiling (Rubric E3):**
> Battery voltage is not transmitted in the telemetry payload. Rubric E3 compliance is evaluated via physical multi-meter / power profiler measurements of active current (~80–120 mA during BLE transmission) versus deep sleep current (< 15 µA), calculating total projected battery runtime against nominal cell capacity.

### B. Python Data Models (Node `'C'`)

```python
from dataclasses import dataclass
from typing import List, Optional

@dataclass(frozen=True)
class SensorSample:
    timestamp_s: int               # Second-accurate Unix timestamp
    temp_celsius: Optional[float]  # None if sentinel SENSOR_TEMP_ERROR (-32768)
    voc_index: Optional[int]       # None if sentinel SENSOR_VOC_ERROR (0xFFFF)
    light_ldr: Optional[int]       # None if sentinel SENSOR_LIGHT_ERROR (0xFFFF)

@dataclass(frozen=True)
class SensorPacket:
    version: int
    node_id: str                   # 2-character ASCII node identifier (e.g. "F0")
    session_salt: bytes            # 8-byte session salt
    counter: int                   # Monotonic 32-bit counter
    samples: List[SensorSample]
```

### C. Plaintext Binary Layout (`SensorPacketPayload`)

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  sample_cnt   |              timestamp_s[0] (Bytes 0-2)       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    timestamp_s[0] (Bytes 3-6)                 |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|timestamp_s[0]7|         temp_cdeg[0]          | voc_index[0]  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| voc_index[0]H |          light_ldr[0]         | timestamp[1]..|
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   ... remaining samples (14 bytes each: timestamp, temp, voc, light) ...  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| Field | Type | Offset (Bytes) | Size (Bytes) | Description |
|---|---|---|---|---|
| `sample_count` | `uint8_t` | 0 | 1 | Number of samples in packet (`N`, where `1 ≤ N ≤ 6`). |
| `samples` | `SensorSample[N]` | 1 | `N × 14` | Batched readings containing dedicated `timestamp_s`, `temp_cdeg`, `voc_index`, and `light_ldr`. |

**Total Plaintext Payload Size:** `1 + (N × 14)` bytes (15 bytes for 1 sample; 85 bytes for 6 samples).

---

## 4. Cryptographic Envelope (AES-128-GCM)

All telemetry data transferred via the GATT Telemetry Characteristic is encrypted with **AES-128-GCM** using an explicit Additional Authenticated Data (AAD) header.

```text
+-------------------------------------------------------------------------------+
| GATT Telemetry Characteristic Value (Read / Notify Payload)                   |
|                                                                               |
|  [ Plaintext AAD Header ] (15 bytes, struct format: <B2s8sI)                  |
|    - version            (1 byte,  offset 0)  = 0x01                           |
|    - node_id            (2 bytes, offset 1)  = "F0" (0x46, 0x30)              |
|    - session_salt       (8 bytes, offset 3)  = random 64-bit boot salt        |
|    - counter            (4 bytes, offset 11) = 32-bit monotonic counter       |
|                                                                               |
|  [ Encrypted Ciphertext ] (15 to 85 bytes, matches plaintext size)            |
|    - ciphertext         (encrypted SensorPacketPayload)                       |
|                                                                               |
|  [ Authentication Tag ] (16 bytes)                                            |
|    - auth_tag           (16 bytes)                                            |
+-------------------------------------------------------------------------------+
```

* **Total Characteristic Value Size:** `15 + (1 + N × 14) + 16` = `32 + (N × 14)` bytes (46 bytes for 1 sample; 116 bytes for 6 samples).
* **Key:** `AES_KEY` (128-bit pre-shared symmetric key).
* **IV / Nonce (12 bytes):** Formed by concatenating `session_salt` (8 bytes) + `counter` (4 bytes).
  * `session_salt` is generated via hardware TRNG (`esp_fill_random()`) once per cold-boot and stored in `RTC_DATA_ATTR`.
  * `counter` increments strictly monotonically for each wake/sleep transmission.
  * Because `session_salt` re-seeds on every battery replacement or brown-out reboot, **nonce reuse across boots is mathematically eliminated**.
  * Because `counter` is 32-bit, integer wrap requires > 4,000 years.
* **Additional Authenticated Data (AAD):** The entire 15-byte plaintext header (`version` + `node_id` + `session_salt` + `counter`) is fed to GCM as AAD. Any tampering with node ID, version, or nonce causes the authentication check to fail.
* **Authentication Tag (16 bytes):** Guarantees data integrity and ciphertext authenticity.

---

## 5. Anti-Replay Verification Procedure (Node `'C'`)

When Node `'C'` receives a telemetry payload:
1. **Header Parsing:** Slice off the 15-byte AAD header (`version`, `node_id`, `session_salt`, `counter` using `<B2s8sI`).
2. **Replay Validation:**
   * If `session_salt == last_session_salt[node_id]`:
     * Verify that incoming `counter > last_counter[node_id]`. If `counter <= last_counter`, drop the packet as a duplicate/replay.
   * If `session_salt != last_session_salt[node_id]` (Node `'F'` rebooted):
     * Accept the new session, updating `last_session_salt[node_id] = session_salt` and `last_counter[node_id] = counter`.
3. **Decryption & Auth:** Run AES-128-GCM decrypt with `AES_KEY`, `iv = session_salt + counter`, `aad = header`, and `tag = auth_tag`. If tag verification fails, discard immediately.
4. **Timestamp Sanity Check:** Verify that the decoded sample `timestamp_s >= last_timestamp_s[node_id]`.

---

## 6. Connection & Exchange Flow

```text
Node 'F' (GATT Server)                        Node 'C' (GATT Client)
         |                                              |
         |-- Wakes from deep sleep                      |
         |-- Samples LM73, SGP40, LDR                   |
         |-- Advertises Service (0000FFF0...) -------->| (Scans & detects Node 'F')
         |                                              |
         |<-- Connect Request --------------------------|
         |<-- Exchange MTU Request (>= 128 bytes) ------|
         |--- MTU Response (>= 128 bytes) ------------->|
         |                                              |
         |<-- Write Time Characteristic (0000FFF2...)---| (Sends current 64-bit Unix timestamp)
         |-- Calibrates ESP32 RTC                       |
         |                                              |
         |-- Encrypts payload with AES-128-GCM          |
         |-- Sends Telemetry (0000FFF1...) ------------>| (Reads / receives notification)
         |                                              |-- Decrypts & verifies tag
         |                                              |-- Buffers / forwards telemetry
         |<-- Disconnect -------------------------------|
         |                                              |
         |-- Enters Deep Sleep                          |
```
