# AGENTS.md — AI Engineering & Development Guidelines

Welcome! This file is the primary context and operating manual for all AI coding assistants (Antigravity, Claude, Gemini, Copilot) working in this repository. Keep modifications concise and let linked specification files handle deep implementation details.

---

## 1. Project Reference & System Architecture

Before writing or modifying code, familiarize yourself with:
* **[SUMMARY.md](SUMMARY.md):** System architecture, inter-device communication protocols, data flows, and core values.
* **[RUBRIC.md](RUBRIC.md):** Academic grading criteria and requirements. (Engineering constraints are summarized below).

### System Entity & Node IDs
* **`'C'` — Camera & Gateway:** Pi-top [4] (Raspberry Pi 4) edge processor.
* **`'F'` — Fridge Sensor:** KidBright32 internal environmental sensor.
* **`'D'` — Door Closer:** KidBright32 external motorized door closer.
* **`'S'` — Server:** Firebase backend & Cloud Functions.
* **`'G'` — Gemini API:** Gemini 3.5 Flash Lite multimodal intelligence.
* **`'L'` — LINE:** Notification service (LINE Messaging API / LINE Notify).

### Repository Directory Structure
The repository is split into decoupled subprojects and shared interface definitions:
* **[`interface/`](interface/README.md):** Shared interface contracts defining payloads, packet formats, schemas, and bitwise structures across all system boundaries (`CBD.md`, `FUC.md`, `CBS.md`, `SBG.md`, `SUL.md`). **ASK FOR APPROVAL BEFORE MAKING ANY CHANGES TO FILES IN THIS DIRECTORY**
* **[`camera/`](camera/README.md) (Node `'C'` — Gateway):** Runs on Pi-top [4] (Raspberry Pi 4) in **Python**. Handles local YOLO vision, Mosquitto TLS broker, BLE beacon decoding/decryption, LCD display UI, and Firebase HTTPS client.
* **[`fridge/`](fridge/README.md) (Node `'F'` — Fridge Sensor):** Runs on KidBright32 (ESP32) in **C++/FreeRTOS**. Battery-powered internal sensor using deep sleep, sampling LM73 (temp), SGP40 (VOC), and LDR (door light), communicating via AES-128-GCM encrypted BLE GATT (calibrating RTC time directly over BLE with zero Wi-Fi required).
* **[`door/`](door/README.md) (Node `'D'` — Door Closer):** Runs on KidBright32 (ESP32) in **C++/FreeRTOS**. 12V mains-powered actuator driving worm gear motor via TB6612FNG driver, with INA219 current obstruction detection, limit switch ISR, optical IR closed sensor, and MQTT over TLS.
* **[`server/`](server/README.md) (Server `'S'` — Cloud Backend):** Runs on **Firebase** using **TypeScript**. Cloud Functions orchestrate Gemini 3.5 Flash Lite (`'G'`) with inventory context, manage Firestore database, enforce security rules, and send LINE (`'L'`) alerts.

*(Each directory will contain its own localized README, build configuration, and pinout/hardware diagrams.)*

Keep related changes scoped within a subsystem. Do not modify multiple systems at once without **explicit** permission.

---

## 2. Embedded Engineering Constraints (from RUBRIC.md)

All code developed for this project must satisfy these specific engineering standards:

### A. Mandatory Safety Rules
* **Moving Parts:** The motorized door arm must have multiple independent fail-safes: hardware limit switch ISR, software stall-current cutoff via INA219, motion timeout, and instantaneous software abort via MQTT.
* **Battery Safety:** Lithium battery packs on Node `'F'` must incorporate BMS protection boards (DW01A or LiFePO4 BMS); charging unattended is prohibited.
* **Physical Isolation:** 12V/high-power lines must have common ground with logic but isolated power rails; no exposed mains wiring; sensors inside the fridge must be moisture-sealed with silica desiccant.

### B. Engineering Depth Menu (E1 – E7 Focus; Exclude E8)
1. **E1 (RTOS Multitasking):** Microcontroller firmware on ESP32 must use FreeRTOS with at least 3 discrete tasks with defined priorities, communicating strictly via queues, semaphores, or event groups (no monolithic blocking loops).
2. **E2 (Interrupt-Driven I/O):** Time-critical inputs (e.g., limit switch hit, emergency abort, UI pushbuttons) must be handled by hardware ISRs with deferred task notification (no busy-waiting or polling loops).
3. **E3 (Low Power):** Node `'F'` must maximize battery life via ESP32 deep sleep cycles, waking only to sample and transmit encrypted BLE GATT telemetry before sleeping (operates with zero Wi-Fi overhead; time synchronization is performed directly over BLE). Power consumption and battery runtime must be documented.
4. **E4 (Reliable Communication):** Message acknowledgments and retries between nodes; the Gateway must implement store-and-forward telemetry buffering when Internet connectivity is down.
5. **E5 (Security):** 
   * MQTT connection between Gateway and Node `'D'` must use **MQTT over TLS** with mutual or server authentication.
   * Telemetry from Node `'F'` must be encrypted with **AES-128-GCM** at the application layer.
   * **Never commit secrets, tokens, Wi-Fi credentials, or private keys to Git.** Store secrets in `secrets.h` for C++ and `.env` for Python/TypeScript, with matching variable names across nodes.
6. **E6 (OTA Update):** Firmware over-the-air update support for microcontroller nodes.
7. **E7 (On-Device AI):** Local YOLO object detection (bounding box) and human detection running directly on the Gateway edge hardware (Pi-top [4]).

---

## 3. Core Software Principles for AI Agents

### A. Robustness & Failure Mode Defense
The AI must program defensively and account for all edge cases and failure modes:
* **Connection Drops:** Wi-Fi loss, MQTT broker restart, and Bluetooth packet loss must trigger automatic exponential backoff reconnection without crashing or blocking.
* **Sensor Failures:** Unplugged I2C sensors (LM73, SGP40, INA219) must be caught gracefully without locking up the I2C bus.
* **Power Interruptions:** Abrupt reboot must restore safe state (door motor retracts to limit switch home position on boot).
* **Camera Glitches:** Dropped frames or camera disconnects in OpenCV/YOLO must be handled safely without segmentation faults.

### B. User Experience (Target Audience: Non-Tech-Savvy)
* The UI and interaction model must be **completely intuitive and friction-free**:
  * One-button check-in and check-out workflows.
  * Clear visual prompts on the 5-inch LCD with minimal clutter.
  * Automatic selection of items based on First Expired, First Out (FEFO) default with simple confirmation.
  * Human-readable notifications dispatched via **LINE** (e.g., "Milk expires in 2 days", "Door was left open and safely closed", "Door obstruction detected").

### C. Strong Typing & Decoupled Reference Interfaces
* **Single Source of Truth:** All cross-system message contracts, schemas, and byte/bitwise structures must be maintained in [`interface/`](interface/README.md).
* **Reference Only — No Direct Linking:** Files in `interface/` serve strictly as canonical reference models. Subprojects (`camera/`, `fridge/`, `door/`, `server/`) must **NEVER** directly import or symlink across folders to `interface/`. Each subproject must copy and mirror its required schemas locally into its own directory (converting into Python dataclasses/typing, C++ structs/byte buffers, or local TypeScript modules).
* **TypeScript:** Strictly type all Firebase Cloud Functions, Firestore data documents, and API responses. Disallow `any`.
* **Python:** Use type hints (`typing`) and runtime data validation (e.g. `pydantic` or `dataclasses`) reflecting `interface/` schemas for Gateway data packets.
* **Microcontroller C++:** Define explicit struct/byte pack headers matching `interface/` specifications for BLE advertisement payloads and MQTT JSON messages.

### D. Documentation & Markdown Formatting Rules
* **Always Use Relative Links for File Linkage:** Never use absolute filesystem URIs (such as `file:///...`) inside repository markdown files. All links between markdown documents, schemas, or source files must strictly use relative paths (e.g. `[README.md](camera/README.md)`, `[SUMMARY.md](../SUMMARY.md)`, `[FUC.md](../interface/FUC.md)`) so they resolve correctly across all machines, clones, and on GitHub.
* **Never Use Inline or Block LaTeX in Markdown:** Do **not** use LaTeX formatting (e.g. `$...$` or `$$...$$`) anywhere in markdown files. Use standard text or clean Unicode symbols (such as `→`, `≥`, `≤`, `Ω`, `~`, `×`, `±`, `+`) instead.
* **Never Use Mermaid Diagrams in Markdown:** Do **not** use mermaid code blocks (e.g. ````mermaid ... ````) anywhere in repository markdown files. Always use clean, formatted plain text ASCII diagrams inside fenced code blocks (````text ... ````) instead.

---

## 4. Quantitative Metrics & Testing Rigor

All features must be measurable and verifiable. Keep testing hooks in code for:
1. **End-to-End Latency:** Timestamped logs from door sensor trip → Gateway detection → Actuator command.
2. **Packet Delivery Rate (PDR):** Success rate of AES-128-GCM BLE beacon receptions on Node `'C'`.
3. **Sensor Accuracy:** Calibration offsets and reference comparison data for temperature (LM73) and VOC (SGP40).
4. **Power Profile:** Documented sleep vs. active current measurements for Node `'F'`.
5. **AI Inference Metrics:** Latency and confidence thresholds for edge YOLO and cloud Gemini 3.5 Flash Lite calls.
6. **System Uptime:** Continuous error-free operation over a >24-hour test period.
