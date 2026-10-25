# FUC: Fridge ('F') → Camera ('C') Interface Contract

This document defines the unidirectional communication interface between the internal fridge sensor node (**Node `'F'`**, KidBright32 ESP32) and the edge gateway (**Node `'C'`**, Pi-top [4] Raspberry Pi 4).

* **Source (`'F'`):** Fridge Sensor Node (KidBright32 — C++/FreeRTOS)
* **Destination (`'C'`):** Edge Gateway (Pi-top [4] — Python)
* **Directionality:** Unidirectional (`U`)
* **Transport Protocol:** Bluetooth Low Energy (BLE) Beacon Mode (Manufacturer Specific Data / Extended Advertisement)
* **Security:** Application-layer **AES-128-GCM** authenticated encryption (required because BLE beacon broadcast lacks transport-layer encryption)

---

## 1. Secrets Reference

All cryptographic keys and sensitive tokens are strictly decoupled from source control:
* **C++ (Node `'F'`):** Provided via `#include "secrets.h"`
* **Python (Node `'C'`):** Provided via environment variable in `.env`
* **Shared Identifier:** `AES_KEY` (128-bit / 16-byte pre-shared symmetric key)

---

## 2. Packet Architecture & Memory Layout

Sensor samples are packed into a compact binary structure to optimize BLE transmission time and minimize radio power consumption.

### A. C++ Data Structures (Node `'F'`)

```c
#include <stdint.h>

struct __attribute__((packed)) SensorSample {
  int16_t  temp_cdeg; // Temperature in centi-degrees Celsius (e.g. 3.42°C stored as 342)
  uint16_t voc_index; // SGP40 raw VOC index (0 - 500)
  uint16_t light_ldr; // Raw ADC light reading (0 - 4095)
};

struct __attribute__((packed)) SensorPacket {
  uint16_t     counter;       // Monotonically increasing packet sequence counter
  uint64_t     timestamp_s;   // Timestamp in seconds (second precision, uint64_t)
  uint8_t      sample_count;  // Number of samples included in this packet (1 to 6)
  SensorSample samples[6];    // Up to 6 batched readings (6 * 6 = 36 bytes max)
};
```

### B. Python Data Models (Node `'C'`)

```python
from dataclasses import dataclass
from typing import List

@dataclass
class SensorSample:
    temp_celsius: float  # Decoded temperature in °C (temp_cdeg / 100.0)
    voc_index: int       # SGP40 raw VOC index (0 - 500)
    light_ldr: int       # ADC reading (0 - 4095)

@dataclass
class SensorPacket:
    counter: int
    timestamp_s: int     # Second-accurate timestamp (uint64)
    samples: List[SensorSample]
```

### C. Binary Layout

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          counter (16)         |      timestamp_s (Bytes 0-1)  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    timestamp_s (Bytes 2-5)                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|      timestamp_s (Bytes 6-7)  |  sample_count |  temp_cdeg[0] |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  temp_cdeg[0] |          voc_index[0]         |  light_ldr[0] |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  light_ldr[0] |   ... remaining samples (6 bytes each) ...    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| Field | Type | Offset (Bytes) | Size (Bytes) | Description |
|---|---|---|---|---|
| `counter` | `uint16_t` (Little-Endian) | 0 | 2 | Sequence counter to detect packet drops and prevent replay attacks. |
| `timestamp_s` | `uint64_t` (Little-Endian) | 2 | 8 | Second-accurate timestamp (Unix epoch in seconds). |
| `sample_count` | `uint8_t` | 10 | 1 | Number of samples in buffer (`N` where `1 ≤ N ≤ 6`). |
| `samples` | `SensorSample[N]` | 11 | `N × 6` | Batched sensor readings (6 to 36 bytes). |

**Total Plaintext Size:** `11 + (N × 6)` bytes (Minimum: 17 bytes for 1 sample; Maximum: 47 bytes for 6 samples).

---

## 3. Cryptographic Envelope (AES-128-GCM)

```
+-----------------------------------------------------------------------+
| BLE Advertisement Payload                                             |
|                                                                       |
|  [ Company ID / Header ] (2 bytes)                                    |
|  [ Nonce / IV ]          (12 bytes)                                   |
|  [ Ciphertext ]          (17 to 47 bytes, matches plaintext size)     |
|  [ Authentication Tag ]  (16 bytes)                                   |
+-----------------------------------------------------------------------+
```

* **Key:** `AES_KEY` (128-bit key imported from `secrets.h` or `.env`).
* **IV / Nonce (12 bytes):** Unique value per packet (e.g. 4 bytes counter + 8 bytes device salt). Must never repeat.
* **Authentication Tag (16 bytes):** Authenticates data integrity.
