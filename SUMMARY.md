# SmarterFridge — System Architecture & Summary

## 1. Project Overview
The **SmarterFridge** transforms a standard refrigerator into an intelligent, connected appliance without altering internal fridge circuitry or voiding warranties. It addresses food waste, inventory visibility, and energy efficiency through three core pillars:
1. **AI Food Logging & Expiry Tracking:** Identifies groceries entering and leaving the fridge using edge vision (YOLO) and cloud multimodal AI (Gemini 3.5 Flash Lite orchestrated via Firebase with real-time inventory context).
2. **Internal Environment & Spoilage Monitoring:** Continuously tracks temperature, door light status, and Volatile Organic Compounds (VOCs) to detect food spoilage early.
3. **Automated Door Closing with Reflexive Safety:** Automatically shuts the fridge door if left ajar while no human is nearby, backed by multi-layered hardware and software obstruction aborts.

---

## 2. Inter-System Communication Architecture

The system coordinates edge devices, local actuators, and cloud intelligence across dedicated, isolated communication boundaries:

```
+--------------------------------------------------------------------+
|                                                                    |
|  Node F: Fridge Sensor (Internal)                                  |
|  [Battery Powered | Ultra-Low Power Deep Sleep]                    |
|      |                                                             |
|      |  Bluetooth BLE (Beacon Mode, Encrypted with AES-128-GCM)    |
|      v                                                             |
|  Node C: Edge Gateway & Broker                                     |
|  [Pi-top [4] (Python) | Local Mosquitto TLS Broker]                |
|      |                                      ^                      |
|      | MQTT over TLS (MQTTS)                | MQTT over TLS        |
|      v (Door Actuation Commands)            | (Door Status/Aborts) |
|  Node D: Door Closer (External Actuator)    |                      |
|  [12V Powered Actuator Node] ---------------+                      |
|      |                                                             |
|      | HTTPS / REST                                                |
|      v                                                             |
|  Server S: Firebase Cloud Backend                                  |
|  [Firestore / TypeScript Cloud Functions]                          |
|      |                                                             |
|      | HTTPS (Context-Enriched Prompts)                            |
|      v                                                             |
|  Entity G: Gemini 3.5 Flash Lite (VLM)                             |
|                                                                    |
|  Entity L: LINE Notification Service (Alerts via Server S)         |
|                                                                    |
+--------------------------------------------------------------------+
```

### Communication Contracts & Protocols:

1. **Node 'F' (Fridge Sensor) → Node 'C' (Gateway) [BLE Beacon Mode / FUC.md]:**
   * **Protocol:** Unidirectional Bluetooth Low Energy (BLE) broadcast in **beacon mode**.
   * **Application-Layer Security:** Telemetry payloads are encrypted with **AES-128-GCM** on Node `'F'` and decrypted by the Gateway `'C'`.
   * **Architectural Rationale:** Node `'F'` is battery-powered inside a cold, shielded compartment. Beacon broadcasting eliminates pairing handshakes and Wi-Fi energy penalties, allowing the microcontroller to wake up, broadcast encrypted telemetry, and return to deep sleep instantly.
   * **Bootup Time Synchronization ([CBF.md](file:///home/sirat/Code/SmarterFridge/interface/CBF.md)):** On cold boot, Node `'F'` briefly connects to Gateway `'C'` via MQTT over TLS (`MQTTS`) to synchronize its hardware RTC with a 64-bit Unix timestamp before entering cyclic BLE sleep.

2. **Node 'C' (Gateway) ↔ Node 'D' (Door Closer) [MQTT over TLS]:**
   * **Protocol:** Bidirectional MQTT secured with TLS (`MQTTS`).
   * **Broker:** Hosted locally on Node `'C'` (Mosquitto).
   * **Architectural Rationale:** High-reliability, low-latency control loop for mechanical safety. Critical safety commands (`CLOSE_DOOR`, `ABORT`) operate locally without dependence on external internet connectivity.

3. **Node 'C' (Gateway) ↔ Server 'S' (Firebase) [HTTPS / CBS.md]:**
   * **Protocol:** HTTPS via Firebase Admin / Client SDKs.
   * **Payload:** Sensor telemetry streams, door state events, cropped grocery images, and checkout verification requests.

4. **Server 'S' (Firebase) ↔ Entity 'G' (Gemini 3.5 Flash Lite) [HTTPS / SBG.md]:**
   * **Protocol:** HTTPS via Google Gen AI SDK within Firebase Cloud Functions (TypeScript).
   * **Context-Aware Prompting:** Node `'C'` never contacts Gemini directly. Instead, Server `'S'` queries the current fridge inventory and enriches the Gemini prompt with live candidate items during check-out, ensuring precise identification and disambiguation of items leaving the fridge.

5. **Server 'S' (Firebase) → Entity 'L' (LINE Notification) [HTTPS / SUL.md]:**
   * **Protocol:** Outbound HTTPS POST alerts via LINE Messaging API / LINE Notify.
   * **Payload:** Instant notifications triggered for critical events (food spoilage warnings, prolonged door open, mechanical stall/obstruction).

---

## 3. High-Level User & Control Flows

### A. Grocery Check-In (Adding Items)
1. **Capture:** The user places groceries in front of Gateway `'C'` and triggers check-in. The camera captures the item.
2. **Pre-processing:** Local YOLO segments and crops the food item.
3. **Cloud Analysis:** The cropped image is sent to Firebase via HTTPS, which invokes Gemini 3.5 Flash Lite to determine item name, category, and shelf-life estimate.
4. **Confirmation:** Item data is saved to Firestore and returned to the Gateway's local display for user review/adjustment.

### B. Grocery Check-Out (Removing Items)
1. **Capture:** The user presents removed groceries to Gateway `'C'` and triggers check-out.
2. **Context-Aware Matching:** Gateway sends the cropped image to Firebase. Firebase pulls current active fridge inventory into the Gemini prompt, matching the specific item exiting the fridge.
3. **Resolution:**
   * **Single match:** Item is immediately marked consumed/removed.
   * **Multiple matches:** Gateway presents matches sorted by First Expired, First Out (FEFO) on the local display.
   * **No match:** Flags manual override prompt on the display.

### C. Automated Door Closure & Safety Reflexes
1. **Door-Ajar Trigger:** Node `'F'` detects fridge light on and broadcasts open status via encrypted BLE beacon to Gateway `'C'`.
2. **Vision Human Check:** Gateway checks webcam feed using YOLO human detection. If door remains open and no person is detected for the timeout period, Gateway issues `CLOSE_DOOR` via MQTT over TLS.
3. **Reflexive Aborts:** Node `'D'` activates the motorized door arm, aborting immediately and retracting to home position if:
   * **Door fully shut:** Confirmed by close-range IR sensor.
   * **Physical obstruction:** Current sensor spikes indicating resistance.
   * **Human approaches:** Gateway detects a person entering frame and transmits instant software `ABORT` over MQTT.

---

## 4. System Nodes & Responsibilities

*(Note: Detailed pinouts, circuit schematics, and low-level firmware build instructions are maintained inside each subproject directory.)*

### Node `ID:'C'`: Edge Gateway (Pi-top [4] / Raspberry Pi)
* **Tech Stack:** Python (native application to eliminate web-runtime overhead on edge hardware).
* **Responsibilities:**
  * Hosts local Mosquitto MQTT broker with TLS.
  * Listens to and decrypts AES-128-GCM BLE beacon broadcasts from Node `'F'`.
  * Runs edge YOLO inference for grocery segmentation and real-time human detection.
  * Drives local user interface and hardware navigation buttons on the display.
  * Synchronizes telemetry, check-in, and check-out events with Firebase.

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
  * Broadcasts telemetry unidirectionally via BLE beacon without Wi-Fi overhead.

### Server `ID:'S'`: Cloud Backend (Firebase)
* **Tech Stack:** TypeScript (strict type definitions enforced across functions, database models, and API interfaces).
* **Responsibilities:**
  * Hosts Cloud Firestore database for inventory and telemetry time-series.
  * Orchestrates Gemini 3.5 Flash Lite (`'G'`) API calls with inventory context.
  * Dispatches LINE (`'L'`) notifications for spoilage or safety incidents.

---

## 5. Architectural Principles & Values

1. **Local-First Safety Invariants:** Mechanical safety routines (obstruction detection, abort commands) must never rely on cloud availability. Gateway-to-actuator control remains strictly on local TLS-encrypted MQTT.
2. **Non-Invasive Fridge Retrofit:** No internal wiring or permanent modifications to the refrigerator. Internal sensor is completely wireless and sealed; external actuator is externally mounted.
3. **Power Efficiency at the Edge:** Minimize radio wake time inside the cold enclosure by adopting unidirectional encrypted BLE beacons instead of persistent connections.
4. **Context-Aware Multimodal Intelligence:** Leverage cloud VLMs (Gemini 3.5 Flash Lite) where contextual reasoning is needed (matching exiting food against existing inventory), while keeping latency-critical perception (human detection, bounding) local on the edge.
5. **Strict Type Safety & Explicit Contracts:** All inter-service communications, telemetry packets, and database schemas must adhere to strict, typed data contracts shared across subprojects.
