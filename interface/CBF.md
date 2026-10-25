# CBF: Camera ('C') ↔ Fridge ('F') Interface Contract

This document defines the bidirectional communication interface between the edge gateway (**Node `'C'`**, Pi-top [4] Raspberry Pi 4) and the internal fridge sensor node (**Node `'F'`**, KidBright32 ESP32) for initial bootup time synchronization and RTC recalibration.

* **Endpoints:** Edge Gateway (**Node `'C'`**) ↔ Fridge Sensor Node (**Node `'F'`**)
* **Directionality:** Bidirectional (`B`)
* **Transport Protocol:** MQTT over TLS (`MQTTS`, Default Port: `8883`)
* **Security:** Transport-layer TLS 1.2/1.3 with server certificate validation (`MQTT_TLS_CA_CERT`)

> [!NOTE]
> **Ephemeral Connection Profile:**
> Node `'F'` is an ultra-low-power, battery-powered node that normally operates in deep sleep and broadcasts encrypted telemetry via BLE beacons ([`FUC.md`](FUC.md)). Node `'F'` connects to the local MQTT broker *only* during initial cold boot or RTC invalidation to acquire a second-accurate 64-bit Unix timestamp, then terminates Wi-Fi/MQTT immediately to preserve battery life.

---

## 1. Secrets & Connection Reference

All cryptographic credentials and network configurations are strictly decoupled from source control:
* **C++ (Node `'F'`):** Provided via `#include "secrets.h"`
* **Python (Node `'C'`):** Provided via environment variables in `.env`
* **Shared Identifiers:**
  * `MQTT_BROKER_HOST` — Gateway hostname or local IP (e.g. `192.168.4.1`)
  * `MQTT_BROKER_PORT` — Secure MQTT port (`8883`)
  * `MQTT_USERNAME` — MQTT client username
  * `MQTT_PASSWORD` — MQTT client password
  * `MQTT_TLS_CA_CERT` — Root Certificate Authority PEM certificate to authenticate the Mosquitto broker

---

## 2. MQTT Topics & Message Flow

### A. Topic Architecture

| Topic | Publisher | Subscriber | QoS | Retain | Payload Format | Description |
|---|---|---|---|---|---|---|
| `fridge/node_f/time/req` | Node `'F'` (Fridge) | Node `'C'` (Gateway) | 1 | False | Empty (`0 bytes`) | Request triggering time synchronization on initial boot. |
| `fridge/node_f/time/res` | Node `'C'` (Gateway) | Node `'F'` (Fridge) | 1 | False | Binary (`8 bytes`, `<Q`) | Response containing current 64-bit Unix timestamp. |

### B. Bootup Synchronization Sequence

```text
  Node 'F' (Fridge Sensor)                          Node 'C' (Edge Gateway Broker)
  [KidBright32 ESP32]                               [Pi-top [4] Mosquitto MQTTS]
           |                                                      |
           | === 1. Connect Wi-Fi & MQTT over TLS (Port 8883) ==> |
           |                                                      |
           | === 2. Subscribe to fridge/node_f/time/res ========> |
           |                                                      |
           | --- 3. Publish to fridge/node_f/time/req ----------> |
           |        Payload: [Empty / 0 bytes]                    |
           |                                                      |
           |                                          [Capture Unix Epoch time(NULL)]
           |                                          [Pack uint64_t Little-Endian]
           |                                                      |
           | <--- 4. Publish to fridge/node_f/time/res ---------- |
           |         Payload: [Raw 8-byte uint64_t Little-Endian] |
           |                                                      |
  [Verify payload length == 8 bytes]                              |
  [Read uint64_t Little-Endian]                                   |
  [Set hardware RTC to timestamp_s]                               |
           |                                                      |
           | === 5. Unsubscribe & Disconnect MQTT ==============> |
           |                                                      |
  [Shut down Wi-Fi radio & TCP stack]                             |
  [Enter cyclic deep sleep BLE beacon mode]                       |
```

---

## 3. Data Schemas & Binary Layout

In accordance with system specifications ([`README.md`](README.md)), all binary values use **Little-Endian byte order**.

### A. Time Request (`fridge/node_f/time/req`)

Published by Node `'F'` upon connection to trigger time recalibration.

* **Payload Size:** `0 bytes` (Empty message body).
* **Semantics:** Publishing to this topic with an empty payload signals Node `'C'` to respond immediately with the current time.

### B. Time Response (`fridge/node_f/time/res`)

Published by Node `'C'` providing the current second-accurate 64-bit Unix timestamp as a raw binary integer.

* **Payload Size:** `8 bytes` (`sizeof(uint64_t)`).
* **Endianness:** **Little-Endian** (`<Q` in Python `struct`).

#### Binary Memory Layout

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    timestamp_s (Bytes 0-3)                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    timestamp_s (Bytes 4-7)                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| Field | Type | Offset (Bytes) | Size (Bytes) | Endianness | Description |
|---|---|---|---|---|---|
| `timestamp_s` | `uint64_t` | 0 | 8 | Little-Endian | Seconds elapsed since Unix Epoch (1970-01-01T00:00:00Z). |

### C. C++ Data Structures (Node `'F'`)

```c
#include <stdint.h>

// Raw 8-byte binary response payload received on fridge/node_f/time/res
struct __attribute__((packed)) TimeResponsePayload {
  uint64_t timestamp_s; // 64-bit Unix timestamp in seconds (Little-Endian)
};
```

### D. Python Data Models (Node `'C'`)

```python
from dataclasses import dataclass

@dataclass
class TimeResponsePayload:
    timestamp_s: int  # 64-bit Unix timestamp in seconds (packed as '<Q')
```

---

## 4. Operational Invariants & Safety

1. **Little-Endian 8-Byte Binary Standard:** The response payload is strictly 8 bytes long (`sizeof(uint64_t)`). Node `'F'` must reject any response where `payload_length != 8` to avoid reading corrupted or truncated timestamps.
2. **Zero-Payload Request:** Node `'F'` transmits 0 bytes (`payload_length == 0`) on `fridge/node_f/time/req`, eliminating serialization overhead and minimizing Wi-Fi transmit energy.
3. **Second Precision Standard:** The timestamp represents seconds elapsed since Unix epoch (`time(NULL)`). Millisecond resolution is explicitly disallowed.
4. **Timeout & Fallback:** If Node `'F'` does not receive an 8-byte response on `fridge/node_f/time/res` within 5 seconds of publishing its request, it must retry up to 3 times before timing out, shutting down Wi-Fi, and falling back to its internal monotonic counter or last saved RTC value to prevent battery exhaustion.
5. **Pure Schema Standard:** This document defines data models, topics, and binary layouts only. Network retries, TLS handshakes, and hardware RTC register updates are implemented locally within subproject firmware.
