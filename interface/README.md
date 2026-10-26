# System Communication Interfaces (`interface/`)

This directory contains the central interface contracts defining all inter-device and inter-service communications across the **SmarterFridge** ecosystem.

Because the system spans multiple programming languages (**C++/FreeRTOS** on microcontrollers, **Python 3.11** on the edge gateway, and **TypeScript** on the cloud backend), each boundary contract is documented as a markdown specification (`.md`) providing exact memory layouts and schemas in the corresponding languages.

> [!IMPORTANT]
> **Reference Only — Do Not Cross-Link or Directly Import:**
> The interface files in this directory are canonical reference definitions. Subprojects (`camera/`, `fridge/`, `door/`, `server/`) must **NOT** directly import, include, or symlink across folder boundaries to this directory.
> Instead, each subproject must copy or mirror the required schemas and type definitions locally within its own directory (translating into Python `dataclasses`/`typing`, C++ structs/byte buffers, or local TypeScript modules as needed).

---

## 1. Naming Convention

Every interface file follows a 3-letter naming format:

`<Source ID>` + `<Directionality>` + `<Destination ID>` + `.md`

### System & Node IDs
* **`C`** — **Camera** Logger & Edge Gateway (Pi-top [4] / Raspberry Pi 4)
* **`F`** — **Fridge** Internal Sensor Node (KidBright32)
* **`D`** — **Door** Closer Actuator Node (KidBright32)
* **`S`** — **Server** Cloud Backend (Firebase / Cloud Functions)
* **`G`** — **Gemini** 3.5 Flash Lite Multimodal API
* **`L`** — **LINE** Notification Service (Messaging API / Notify)

### Directionality
* **`U`** — **Unidirectional** (one-way broadcast, stream, or webhook alert)
* **`B`** — **Bidirectional** (two-way command/response, request/reply, or interactive session)

---

## 2. Standard Interface Rules

All interface specifications in this directory must adhere to the following rules:

### A. Pure Schemas & Memory Layouts (No Function Examples)
Interface contracts strictly define packet structures, data types, memory layouts, and cryptographic envelopes. Full function implementations (serialization, encryption routines, parsers) are omitted from interface contracts to prevent context pollution and redundant code. Subprojects implement their own serialization, encryption, and parsing logic locally based on these canonical schemas.

### B. Secrets & Key Storage
* **Decoupled Secrets:** Keys, passwords, and tokens are **never** hardcoded in interface files or committed to Git.
* **Storage Standard:**
  * **C++ Microcontroller Firmware:** Defined in `secrets.h` (template at [`../secrets.h.example`](../secrets.h.example)).
  * **Python / TypeScript:** Defined in `.env` (template at [`../.env.example`](../.env.example)).
* **Consistent Identifier Naming:** All shared secrets must use identical reference names across all nodes and languages (e.g. `AES_KEY`, `MQTT_TLS_CA_CERT`, `LINE_CHANNEL_ACCESS_TOKEN`).

### C. Second-Accurate Timestamps
All timestamps across all interfaces must use **Second precision** and (if applicable) store them as `uint64_t` / `uint64` values.

### D. Null & Error Representation Standards

* **Binary Communication (e.g. C++ Structs / BLE GATT):**
  Use explicit sentinel values:
  * **Unsigned Integers:** Reserved as the maximum possible value:
    * `uint8_t` → `0xFF` (`255`)
    * `uint16_t` → `0xFFFF` (`65535`)
    * `uint32_t` → `0xFFFFFFFF` (`4294967295`)
    * `uint64_t` → `0xFFFFFFFFFFFFFFFF`
  * **Signed Integers:** Reserved as the minimum possible value:
    * `int16_t` → `-32768` (`0x8000`)
    * `int32_t` → `-2147483648` (`0x80000000`)
* **JSON Communication (e.g. HTTPS REST APIs / MQTT Payloads):**
  * Missing, unmeasured, or error values must **always be represented as explicit JSON `null`**.
  * **Never use `undefined`** or omit key fields in JSON documents and payloads.

### E. Endianness Standard (Little-Endian)
All inter-process, inter-device, and over-the-wire binary communications across the system must **always use Little-Endian byte order** for multi-byte numeric primitives (`uint16_t`, `uint32_t`, `uint64_t`, `int16_t`, etc.). Both the ESP32 (Xtensa 32-bit LX6) and Raspberry Pi 4 (ARM Cortex-A72) are natively little-endian architectures; standardizing on little-endian eliminates byte-swapping overhead and guarantees direct struct compatibility. In Python serialization routines, multi-byte formats must explicitly specify little-endian (e.g. `<Q`, `<H`, `<h` via `struct`).

### F. Bilingual Data Contracts & Localization Policy
The SmarterFridge system features two primary user-facing interfaces: the local PyQt LCD on Node `'C'` and the mobile-responsive web dashboard on Server `'S'`. To support seamless bilingual user interaction:
* **Bilingual Food Metadata:** Inter-service interfaces communicating food items ([`CBS.md`](CBS.md), [`SBG.md`](SBG.md)) must explicitly provide both Thai and English fields (`name_th`, `name_en`, `storage_recommendation_th`, `storage_recommendation_en`).
* **Canonical Categories:** Categories are represented by canonical English keys (`Dairy`, `Produce`, `Meat`, etc.) across schemas and database storage, with bidirectional translation tables used by client applications.
* **Date & Time Localization:** All timestamps use second-precision UTC epochs (`timestamp_s`) and ISO 8601 strings (`YYYY-MM-DD`), localized at the presentation layer (Thai Buddhist Era `พ.ศ.` on Thai interfaces, Western Gregorian `CE` on English interfaces).

---

## 3. Interface Contract Directory

| File | Endpoints | Direction | Transport & Security | Description |
|---|---|---|---|---|
| [`FUC.md`](FUC.md) | Fridge ↔ Camera | Inbound Telemetry (`F → C`) | BLE GATT (AES-128-GCM) | Encrypted sensor telemetry and two-way BLE time synchronization: temperature (LM73), VOC index (SGP40), light (LDR), sequence counter, and RTC calibration. |
| [`CBD.md`](CBD.md) | Camera ↔ Door | Bidirectional (`B`) | MQTT over TLS | Door actuation commands (`CLOSE_DOOR`, `ABORT`), safety events (`CLOSING`, `SUCCESS`, `OBSTRUCTION_ERROR`, `ABORTED`, `TIMEOUT_ERROR`), and 1 Hz telemetry. |
| [`CBS.md`](CBS.md) | Camera ↔ Server | Bidirectional / Client-Server (`B`) | HTTPS (Bearer Token) | Telemetry sync, check-in cropped images returning bilingual metadata (`name_th`, `name_en`), check-out FEFO verification, and door event logs. |
| [`SBG.md`](SBG.md) | Server ↔ Gemini | Bidirectional (`B`) | HTTPS (Gen AI SDK) | Context-enriched prompt calls to Gemini 3.5 Flash Lite returning bilingual metadata (`name_th`, `name_en`, `category`, `estimated_expiry_date`). |
| [`SUL.md`](SUL.md) | Server → LINE | Unidirectional (`U`) | HTTPS POST | Outbound user alerts for food expiration, spoilage VOC spikes, door ajar warnings, and obstruction aborts. |

---

## 4. Subproject & System Documentation Index

* **Root Documentation:** [`SUMMARY.md`](../SUMMARY.md) | [`AGENTS.md`](../AGENTS.md) | [`RUBRIC.md`](../RUBRIC.md)
* **Node `'C'` (`camera/`):** [`README.md`](../camera/README.md) | [`ARCHITECTURE.md`](../camera/ARCHITECTURE.md) | [`GOAL.md`](../camera/GOAL.md)
* **Node `'F'` (`fridge/`):** [`README.md`](../fridge/README.md) | [`ARCHITECTURE.md`](../fridge/ARCHITECTURE.md) | [`GOAL.md`](../fridge/GOAL.md)
* **Node `'D'` (`door/`):** [`README.md`](../door/README.md) | [`ARCHITECTURE.md`](../door/ARCHITECTURE.md) | [`GOAL.md`](../door/GOAL.md)
* **Server `'S'` (`server/`):** [`README.md`](../server/README.md) | [`ARCHITECTURE.md`](../server/ARCHITECTURE.md) | [`GOAL.md`](../server/GOAL.md)
