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

#define SENSOR_TEMP_ERROR  0x7FFF  // 32767 centi-degrees (sensor disconnected / I2C fault)
#define SENSOR_VOC_ERROR   0xFFFF  // 65535 VOC index (sensor disconnected / I2C fault)
#define SENSOR_LIGHT_ERROR 0xFFFF  // 65535 ADC reading (ADC fault)

struct __attribute__((packed)) SensorSample {
  int16_t  temp_cdeg; // Temperature in centi-degrees Celsius (e.g. 342 = 3.42°C; 0x7FFF = Error)
  uint16_t voc_index; // Sensirion Gas Index Algorithm output (1-500; 0 = warming up; 0xFFFF = Error)
  uint16_t light_ldr; // Raw ADC light reading (0-4095; 0xFFFF = Error)
};

struct __attribute__((packed)) SensorPacketPayload {
  uint8_t      node_id;       // Unique node ID (e.g. 1 for Node F1, 2 for Node F2)
  uint32_t     counter;       // Monotonically increasing sequence counter (32-bit)
  uint64_t     timestamp_s;   // Unix epoch timestamp in seconds of the latest sample
  uint8_t      sample_count;  // Number of samples in packet (1 to 6)
  SensorSample samples[6];    // Batched sensor readings (up to 36 bytes)
};
```

### B. Python Data Models (Node `'C'`)

```python
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class SensorSample:
    temp_celsius: Optional[float]  # None if sentinel SENSOR_TEMP_ERROR (0x7FFF)
    voc_index: Optional[int]       # None if sentinel SENSOR_VOC_ERROR (0xFFFF)
    light_ldr: Optional[int]       # None if sentinel SENSOR_LIGHT_ERROR (0xFFFF)

@dataclass
class SensorPacket:
    node_id: int
    counter: int
    timestamp_s: int               # Timestamp of the latest sample in seconds
    samples: List[SensorSample]
```

### C. Plaintext Binary Layout (`SensorPacketPayload`)

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|    node_id    |                   counter                     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|    counter    |              timestamp_s (Bytes 0-2)          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    timestamp_s (Bytes 3-6)                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| timestamp_s[7]|  sample_cnt   |         temp_cdeg[0]          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          voc_index[0]         |          light_ldr[0]         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   ... remaining samples (6 bytes each: temp, voc, light) ...  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| Field | Type | Offset (Bytes) | Size (Bytes) | Description |
|---|---|---|---|---|
| `node_id` | `uint8_t` | 0 | 1 | Identifies the physical/simulated sensor node (e.g. `1`). |
| `counter` | `uint32_t` (Little-Endian) | 1 | 4 | Monotonic sequence counter to prevent replay attacks and track packet drops. |
| `timestamp_s` | `uint64_t` (Little-Endian) | 5 | 8 | Second-accurate Unix timestamp of `samples[sample_count - 1]`. |
| `sample_count` | `uint8_t` | 13 | 1 | Number of samples in packet (`N`, where `1 ≤ N ≤ 6`). |
| `samples` | `SensorSample[N]` | 14 | `N × 6` | Batched sensor readings (6 to 36 bytes). |

**Total Plaintext Size:** `14 + (N × 6)` bytes (Minimum: 20 bytes for 1 sample; Maximum: 50 bytes for 6 samples).

* **Sample Timing:** `timestamp_s` represents the timestamp of the most recent reading (`samples[sample_count - 1]`). For previous readings (index `i < sample_count - 1`), their timestamp is calculated as `timestamp_s - (sample_count - 1 - i) * 5` seconds (assuming a standard 5-second sampling interval).

---

## 4. Cryptographic Envelope (AES-128-GCM)

All telemetry data transferred via the GATT Telemetry Characteristic is encrypted with **AES-128-GCM**.

```text
+-------------------------------------------------------------------------------+
| GATT Telemetry Characteristic Value (Read / Notify Payload)                   |
|                                                                               |
|  [ Plaintext AAD Header ]                                                     |
|    - node_id            (1 byte)                                              |
|    - iv / nonce         (12 bytes)                                            |
|                                                                               |
|  [ Encrypted Ciphertext ]                                                     |
|    - ciphertext         (20 to 50 bytes, matches plaintext size)              |
|                                                                               |
|  [ Authentication Tag ]                                                       |
|    - auth_tag           (16 bytes)                                            |
+-------------------------------------------------------------------------------+
```

* **Total Characteristic Value Size:** `1 + 12 + (14 + N * 6) + 16` = `43 + (N × 6)` bytes (49 bytes for 1 sample; 79 bytes for 6 samples).
* **Key:** `AES_KEY` (128-bit pre-shared symmetric key).
* **IV / Nonce (12 bytes):** Generated via hardware RNG (`esp_random()`) and combined with the 32-bit counter. Must never be reused with the same key.
* **Additional Authenticated Data (AAD):** The 13-byte unencrypted header (`node_id` [1 byte] + `iv` [12 bytes]) is provided to the GCM cipher as AAD so that the header cannot be tampered with in transit.
* **Authentication Tag (16 bytes):** Guarantees data integrity and authenticity. Packets with invalid tags are dropped immediately by Node `'C'`.

---

## 5. Connection & Exchange Flow

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
