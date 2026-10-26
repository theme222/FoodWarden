# SmarterFridge — System Architecture & Summary

## 1. Project Overview
The **SmarterFridge** transforms a standard refrigerator into an intelligent, connected appliance without altering internal fridge circuitry or voiding warranties. It addresses food waste, inventory visibility, and energy efficiency through three core pillars:
1. **AI Food Logging & Expiry Tracking:** Identifies groceries entering and leaving the fridge using edge vision (YOLO) and cloud multimodal AI (Gemini 3.5 Flash Lite orchestrated via Firebase with real-time inventory context).
2. **Internal Environment & Spoilage Monitoring:** Continuously tracks temperature, door light status, and Volatile Organic Compounds (VOCs) to detect food spoilage early.
3. **Automated Door Closing with Reflexive Safety:** Automatically shuts the fridge door if left ajar while no human is nearby, backed by multi-layered hardware and software obstruction aborts.

---

## 2. Inter-System Communication Architecture

The system coordinates edge devices, local actuators, and cloud intelligence across dedicated, isolated communication boundaries:

```text
+---------------------------------------------------------------------------------+
|                                                                                 |
|   Node F: Internal Fridge Sensor                                                |
|   [KidBright32 | Battery Powered | Deep Sleep]                                  |
|         ^                                                                       |
|         | BLE GATT (Telemetry + Time Sync | AES-128-GCM) [FUC.md]               |
|         v                                                                       |
|   Node C: Edge Gateway & Broker                                                 |
|   [Pi-top [4] (Python) | Local Mosquitto TLS Broker | 5" LCD UI]                |
|      |               ^                               |                          |
|      | MQTTS Commands| MQTTS Status/Abort            | HTTPS / REST             |
|      v [CBD.md]      | [CBD.md]                      | (Bearer Token) [CBS.md]  |
|   Node D: Door Closer Actuator                       v                          |
|   [KidBright32 | 12V Powered]                Server S: Firebase Cloud Backend   |
|                                              [Firestore & Cloud Functions]      |
|                                                 |                    |          |
|                                    HTTPS [SBG]  |        HTTPS [SUL] |          |
|                                                 v                    v          |
|                                           Entity G: Gemini      Entity L: LINE  |
|                                           3.5 Flash Lite        Messaging API   |
|                                           (Cloud VLM)                           |
|                                                                                 |
+---------------------------------------------------------------------------------+
```

### Communication Contracts & Protocols:

1. **Node 'F' (Fridge Sensor) ↔ Node 'C' (Gateway) [BLE GATT / FUC.md]:**
   * **Protocol:** Bluetooth Low Energy (BLE) GATT (Generic Attribute Profile).
   * **Application-Layer Security:** Telemetry payloads are encrypted with **AES-128-GCM** on Node `'F'` and decrypted by Gateway `'C'`.
   * **Architectural Rationale:** Node `'F'` is battery-powered inside a cold compartment. Operating over BLE GATT eliminates continuous Wi-Fi power draw while enabling Gateway `'C'` to calibrate Node `'F'`'s RTC timestamp over BLE without requiring Wi-Fi on the sensor node.

2. **Node 'C' (Gateway) ↔ Node 'D' (Door Closer) [MQTT over TLS]:**
   * **Protocol:** Bidirectional MQTT secured with TLS (`MQTTS`).
   * **Broker:** Hosted locally on Node `'C'` (Mosquitto).
   * **Architectural Rationale:** High-reliability, low-latency control loop for mechanical safety. Critical safety commands (`CLOSE_DOOR`, `ABORT`) operate locally without dependence on external internet connectivity.

3. **Node 'C' (Gateway) ↔ Server 'S' (Firebase) [HTTPS / CBS.md]:**
   * **Protocol:** HTTPS REST API authenticated via permanent Bearer token (`GATEWAY_TOKEN`).
   * **Payload:** Sensor telemetry streams with `node_id`, door state events, cropped grocery images, and checkout candidate verification.

4. **Server 'S' (Firebase) ↔ Entity 'G' (Gemini 3.5 Flash Lite) [HTTPS / SBG.md]:**
   * **Protocol:** HTTPS via Google Gen AI SDK within Firebase Cloud Functions (TypeScript).
   * **Context-Aware Prompting:** Node `'C'` never contacts Gemini directly. Instead, Server `'S'` queries the current fridge inventory and enriches the Gemini prompt with live candidate items during check-out, ensuring precise identification and disambiguation of items leaving the fridge.

5. **Server 'S' (Firebase) → Entity 'L' (LINE Notification) [HTTPS / SUL.md]:**
   * **Protocol:** Outbound HTTPS POST push alerts via LINE Messaging API.
   * **Payload:** Instant bilingual notifications triggered for critical events (food expiration digests, spoilage VOC spikes, prolonged door open, mechanical stall/obstruction).

---

## 3. High-Level User & Control Flows

### A. Grocery Check-In (Adding Items)
1. **Capture:** The user places groceries in front of Gateway `'C'` and triggers check-in (`O`). The camera captures the item.
2. **Pre-processing:** Local YOLO11n detects and crops the food item via bounding box (or falls back to the full frame) and compresses it into JPEG.
3. **Draft Analysis (`POST /api/inventory/checkin/draft`):** The compressed JPEG is sent to Firebase via HTTPS, which invokes Gemini 3.5 Flash Lite to determine bilingual item names, category, and shelf-life estimate, uploads the JPEG to Cloud Storage, and returns the draft metadata (plus `image_storage_path`) to the Gateway LCD with zero Firestore writes.
4. **Confirmation & Commit (`POST /api/inventory/checkin`):** The user reviews or adjusts the expiration date on the LCD (or waits for the 5-second auto-confirm countdown), and Gateway `'C'` commits the finalized item to Firestore.

### B. Grocery Check-Out (Removing Items)
1. **Capture:** The user presents removed groceries to Gateway `'C'` and triggers check-out (`X`).
2. **Context-Aware Draft (`POST /api/inventory/checkout/draft`):** Gateway sends the compressed JPEG to Firebase. Firebase pulls current active fridge inventory into the Gemini prompt, deterministically sorts matching candidates by First Expired, First Out (FEFO), and returns the candidate list with their `item_id`s to the Gateway LCD (with zero database mutations).
3. **Confirmation & Hard-Delete Commit (`POST /api/inventory/checkout`):**
   * The user confirms the selected item with `O` (or the 5-second countdown auto-selects the top FEFO candidate).
   * Gateway dispatches `POST /api/inventory/checkout`, which permanently hard-deletes the item document from Firestore and deletes its associated JPEG from Cloud Storage.

### C. Automated Door Closure & Safety Reflexes
1. **Door-Ajar Trigger:** Node `'F'` detects fridge light on and transmits open status via encrypted BLE GATT telemetry to Gateway `'C'`.
2. **Vision Human Check:** Gateway checks webcam feed using YOLO11n human detection. If door remains open (`> 60s`) and no person is detected, Gateway issues `CLOSE_DOOR` via MQTT over TLS.
3. **Closure Confirmation & Safety Reflexes:** Node `'D'` activates the motorized door arm, confirming completion or halting motion:
   * **Door fully shut (Success):** Confirmed by close-range IR sensor, stopping motor movement and retracting arm.
   * **Physical obstruction (Abort):** Current sensor spikes indicating resistance, immediately retracting arm.
   * **Human approaches (Abort):** Gateway detects a person entering frame and transmits instant software `ABORT` over MQTT.

---

## 4. System Nodes & Responsibilities

*(Note: Detailed pinouts, circuit schematics, and low-level firmware build instructions are maintained inside each subproject directory.)*

### Node `ID:'C'`: Edge Gateway (Pi-top [4] / Raspberry Pi)
* **Tech Stack:** Python (native application to eliminate web-runtime overhead on edge hardware).
* **Responsibilities:**
  * Hosts local Mosquitto MQTT broker with TLS.
  * Connects to and decrypts AES-128-GCM BLE telemetry from Node `'F'`.
  * Runs edge YOLO inference for grocery bounding-box detection/cropping (with full-frame fallback) and real-time human detection.
  * Monitors wired Digital PIR motion sensor (Rubric M1 Gateway sensor #2) to wake/sleep the display and camera feed.
  * Drives local user interface and hardware navigation buttons on the 5-inch LCD with **bilingual prompts displayed by default in Thai with an English translation**.
  * Synchronizes telemetry, check-in, and check-out events with Firebase via HTTPS REST.

### Node `ID:'D'`: Door Closer Actuator (KidBright32)
* **Power:** 12V mains-powered node.
* **Responsibilities:**
  * Connects to local broker via Wi-Fi using MQTT over TLS.
  * Controls motorized door arm via H-Bridge motor driver.
  * Monitors motor shunt current in real time for stall/obstruction safety limits.
  * Handles home position detection via limit switch and closed-door verification via optical IR sensor.

### Node `ID:'F'`: Internal Fridge Sensor (KidBright32)
* **Power:** Battery-powered, ultra-low power sealed internal node.
* **Responsibilities:**
  * Operates in cyclic deep-sleep cycles.
  * Samples internal ambient temperature, spoilage VOC index, and door-open light levels.
  * Packages and encrypts sensor telemetry using AES-128-GCM.
  * Transmits encrypted sensor telemetry via BLE GATT with zero Wi-Fi overhead (synchronizing RTC time over BLE during connection).

### Server `ID:'S'`: Cloud Backend & Web Dashboard (Firebase)
* **Tech Stack:** TypeScript (strict type definitions enforced across functions, database models, and API interfaces) and Vite + React frontend.
* **Responsibilities:**
  * Serves the mobile-responsive web application allowing users to monitor live metrics, inventory, and door safety on their phones or browsers.
  * Provides a dynamic language selection method between **Thai (`th`)** and **English (`en`)** in the web dashboard.
  * Hosts Cloud Firestore database storing food items bilingually (`name_th`, `name_en`, `storage_recommendation_th`, `storage_recommendation_en`) with category and date translation bridges.
  * Orchestrates Gemini 3.5 Flash Lite (`'G'`) API calls with inventory context.
  * Dispatches LINE (`'L'`) notifications for spoilage or safety incidents.

---

## 5. Centralized System Sensor Thresholds & Operational Bounds

This table serves as the canonical single source of truth for all sensor thresholds, operational bounds, alert trigger rules, and hardware fault sentinels across the entire SmarterFridge system:

| Node | Sensor Component | Parameter / Unit | Normal Operating Range | Warning Bound | Critical Alarm / Action Threshold | Sustained Condition & Reaction | Hardware Error Sentinel |
|---|---|---|---|---|---|---|---|
| **Node `'F'`** (Internal) | **LM73** (I2C) | Internal Temperature (`°C`) | **`0.0 °C ≤ T ≤ 4.0 °C`**<br>(Ideal safe refrigeration) | **`4.0 °C < T ≤ 8.0 °C`**<br>(Elevated cooling) | **`T > 8.0 °C`**<br>(Food danger zone; bacterial growth) | **Sustained for ≥ 15 minutes** (3 consecutive 5-min telemetry batches) while door confirmed closed → Dispatches LINE `TEMPERATURE_ANOMALY` alert | `SENSOR_TEMP_ERROR`<br>`-32768` (`0x8000`) |
| **Node `'F'`** (Internal) | **SGP40** (I2C) | VOC Spoilage Index (`1–500`) | **`1 ≤ VOC ≤ 150`**<br>(Clean baseline air; 100 = average) | **`151 ≤ VOC ≤ 250`**<br>(Mild food odors / unsealed containers) | **`VOC > 250`**<br>(High gas emissions; active food rot) | **Sustained for ≥ 15 minutes** (3 consecutive 5-min telemetry batches) → Dispatches LINE `VOC_SPOILAGE_WARNING` alert | `SENSOR_VOC_ERROR`<br>`65535` (`0xFFFF`)<br>*(0 = warmup)* |
| **Node `'F'`** (Internal) | **LDR** (Analog ADC) | Interior Light Level (`0–4095`) | **`< 100`**<br>(Dark compartment; door securely sealed) | **`≥ 100` for ≤ 60s**<br>(Door opened normally for grocery access) | **`≥ 100` for > 60s**<br>(Door left ajar / seal failure) | **Continuous > 60 seconds** → Gateway checks webcam for humans, issues `CLOSE_DOOR` if clear, dispatches LINE `DOOR_AJAR_WARNING` | `SENSOR_LIGHT_ERROR`<br>`65535` (`0xFFFF`) |
| **Node `'D'`** (Actuator) | **INA219** (I2C) | Motor Armature Current (`mA` at 12V) | **`250 mA ≤ I ≤ 650 mA`**<br>(Smooth closing motion;<br>idle: < 50 mA) | **`651 mA ≤ I < 1200 mA`**<br>(Mechanical friction) | **`I ≥ 1200 mA`**<br>(Obstruction stall / trapped hand or item) | **Immediate hardware/software trip (≤ 100 ms)** → Motor cut off, arm retracted to home, dispatches LINE `DOOR_OBSTRUCTION_ALERT` | `0xFFFF` / null |
| **Node `'D'`** (Actuator) | **IR Optical** (Digital) | Door Frame Proximity | **`LOW (0)`** when closed<br>(Reflection detected ≤ 5 mm) | N/A | **`HIGH (1)`**<br>(No reflection; door open / separated) | Confirms physical closure during closer stroke (`SUCCESS`). If closer reports closed but Node `'F'` LDR reports lit → `CONTRADICTION_ERROR` | N/A |
| **Node `'D'`** (Actuator) | **Limit Switch** (Digital ISR) | Arm Home Position | **`LOW (0)`** (Depressed)<br>(Arm fully retracted at home) | N/A | **`HIGH (1)`**<br>(Arm extended / in motion) | Handled via hardware GPIO ISR: immediately terminates motor reverse drive upon home contact | N/A |
| **Node `'C'`** (Gateway) | **Digital PIR** (GPIO) | Human Motion Detection | **`HIGH (1)`** on motion<br>(User approaching fridge) | N/A | **`LOW (0)` for > 10 min**<br>(Continuous inactivity) | **Continuous LOW for > 10 minutes** → Blanks 5" LCD and sleeps webcam stream to conserve energy and prevent display burn-in | N/A |
| **Node `'C'`** (Gateway) | **USB Webcam** (YOLO AI) | Bounding Box Confidence (`0.0–1.0`) | **`Confidence ≥ 0.60`**<br>(Reliable bounding box detection) | N/A | **`Confidence < 0.60`**<br>(Uncertain / generic item) | Grocery crop falls back to full-frame upload. Human presence check aborts active `CLOSE_DOOR` routine immediately if person enters frame | N/A |

---

## 6. Architectural Principles & Values

1. **Local-First Safety Invariants:** Mechanical safety routines (obstruction detection, abort commands) must never rely on cloud availability. Gateway-to-actuator control remains strictly on local TLS-encrypted MQTT.
2. **Non-Invasive Fridge Retrofit:** No internal wiring or permanent modifications to the refrigerator. Internal sensor is completely wireless and sealed; external actuator is externally mounted.
3. **Power Efficiency at the Edge:** Minimize radio wake time inside the cold enclosure by using cyclic ESP32 deep sleep and brief, zero-Wi-Fi encrypted BLE GATT bursts.
4. **Context-Aware Multimodal Intelligence:** Leverage cloud VLMs (Gemini 3.5 Flash Lite) where contextual reasoning is needed (matching exiting food against existing inventory), while keeping latency-critical perception (human detection, bounding) local on the edge.
5. **Strict Type Safety & Explicit Contracts:** All inter-service communications, telemetry packets, and database schemas must adhere to strict, typed data contracts shared across subprojects.
6. **Bilingual Accessibility & Dual User Interfaces:** Direct user interfaces provide complete bilingual accessibility: Node `'C'`'s physical 5-inch LCD displays every instruction by default in Thai with an English translation, while Server `'S'`'s mobile-responsive web dashboard enables users to monitor fridge metrics and inventory on their phone with an instantaneous Thai/English language switcher, backed by bilingual food data storage in Firestore.
