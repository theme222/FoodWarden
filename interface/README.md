# System Communication Interfaces (`interface/`)

This directory contains the central interface contracts defining all inter-device and inter-service communications across the SmarterFridge ecosystem.

Because the system spans multiple programming languages (**C++/FreeRTOS** on microcontrollers, **Python** on the edge gateway, and **TypeScript** on the cloud backend), each boundary contract is documented as a markdown specification (`.md`) providing exact memory layouts and schemas in the corresponding languages.

> [!IMPORTANT]
> **Reference Only — Do Not Cross-Link or Directly Import:**
> The interface files in this directory are canonical reference definitions. Subprojects (`camera/`, `fridge/`, `door/`, `server/`) must **NOT** directly import, include, or symlink across folder boundaries to this directory.
> Instead, each subproject must copy or mirror the required schemas and type definitions locally within its own directory (translating into Python `dataclasses`/`typing`, C++ structs/byte buffers, or local TypeScript modules as needed).

---

## 1. Naming Convention

Every interface file follows a 3-letter naming format:

`<Source ID>` + `<Directionality>` + `<Destination ID>` + `.md`

### System & Node IDs
* **`C`** — **Camera** Logger & Edge Gateway (Pi-top [4] / Raspberry Pi)
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
  * **C++ Microcontroller Firmware:** Defined in `secrets.h` (e.g. `extern const uint8_t AES_KEY[16];`).
  * **Python / TypeScript:** Defined in `.env` (e.g. `os.environ["AES_KEY"]` / `process.env.AES_KEY`).
* **Consistent Identifier Naming:** All shared secrets must use identical reference names across all nodes and languages (e.g. `AES_KEY`, `MQTT_TLS_CA_CERT`, `LINE_CHANNEL_ACCESS_TOKEN`).

### C. Second-Accurate Timestamps
 All timestamps across all interfaces must use **Second precision** and (if applicable) store them as uint64s.

---

## 3. Interface Contract Directory

| File | Endpoints | Direction | Transport & Security | Description |
|---|---|---|---|---|
| [`FUC.md`](file:///home/sirat/Code/SmarterFridge/interface/FUC.md) | Fridge → Camera | Unidirectional (`U`) | BLE Beacon (AES-128-GCM) | Encrypted telemetry: temperature (LM73), VOC index (SGP40), light reading (LDR), and packet counter. |
| [`CBF.md`](file:///home/sirat/Code/SmarterFridge/interface/CBF.md) | Camera ↔ Fridge | Bidirectional (`B`) | MQTT over TLS | Bootup time synchronization: 64-bit Unix timestamp calibration for Node `'F'` internal RTC. |
| [`CBD.md`](file:///home/sirat/Code/SmarterFridge/interface/CBD.md) | Camera ↔ Door | Bidirectional (`B`) | MQTT over TLS | Door actuation commands (`CLOSE_DOOR`, `ABORT`) and door status/safety events (`DOOR_OPEN`, `SUCCESS`, `OBSTRUCTION_ERROR`). |
| [`CBS.md`](file:///home/sirat/Code/SmarterFridge/interface/CBS.md) | Camera ↔ Server | Bidirectional / Client-Server (`B`) | HTTPS | Telemetry sync, check-in cropped images, check-out verification requests, and door event logs. |
| [`SBG.md`](file:///home/sirat/Code/SmarterFridge/interface/SBG.md) | Server ↔ Gemini | Bidirectional (`B`) | HTTPS (Gen AI SDK) | Context-enriched prompt calls to Gemini 3.5 Flash Lite and structured JSON responses (`name`, `category`, `estimated_expiry_date`). |
| [`SUL.md`](file:///home/sirat/Code/SmarterFridge/interface/SUL.md) | Server → LINE | Unidirectional (`U`) | HTTPS POST | Outbound user alerts for food expiration, spoilage VOC spikes, door ajar warnings, and obstruction aborts. |
