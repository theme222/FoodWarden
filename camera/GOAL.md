# Node 'C' (Camera & Edge Gateway) — Completion Checklist (`GOAL.md`)

> [!IMPORTANT]
> **Incremental Development Guideline:**
> This file is a master checklist of features, use cases, tests, and edge-case handlers strictly required before the **Camera & Edge Gateway (`camera/`)** subsystem is considered finished.
> **This checklist does NOT need to be completed in a single prompt.** Developers and AI agents are expected to implement and verify these components incrementally across multiple steps.

* **Related Documents:** [`README.md`](README.md) | [`ARCHITECTURE.md`](ARCHITECTURE.md)

---

## 1. Core Features
- [ ] **Direct User Interface (PyQt 5-inch LCD):** Build full-screen user-facing interface rendered on the 5-inch LCD (`800×480`) mounted on the fridge, controlled directly via the 4 physical Pi-top case buttons (`Up`, `Down`, `O`, `X`).
- [ ] **Bilingual Display System (Thai Default + English Translation):** Every on-screen instruction, workflow step, button action hint, food review card, and system alert must be displayed in **Thai by default with an English translation** (e.g. `"กรุณาวางอาหารหน้ากล้อง / Place grocery in front of camera"`, `"กด O เพื่อยืนยัน / Press O to confirm"`).
- [ ] **Local Mosquitto TLS Broker:** Configure and run Mosquitto on port `8883` with server TLS certificates (`MQTT_TLS_CA_CERT`, `MQTT_TLS_SERVER_CERT`, `MQTT_TLS_SERVER_KEY`).
- [ ] **BLE Beacon Receiver & Decryptor ([`FUC.md`](../interface/FUC.md)):** Passively scan BLE advertisements from Node `'F'`, authenticate/decrypt `AES-128-GCM` payloads, and unpack `SensorPacket` structs.
- [ ] **Node `'F'` Boot Time Responder ([`CBF.md`](../interface/CBF.md)):** Subscribe to `fridge/node_f/time/req` and publish current 64-bit Unix timestamp (`timestamp_s`) to `fridge/node_f/time/res`.
- [ ] **YOLOv8 Nano Inference Engine:** Run local `yolov8n.pt` object detection on USB webcam frames for grocery bounding-box cropping and real-time `person` detection.
- [ ] **Door Safety Controller ([`CBD.md`](../interface/CBD.md)):** Trigger `CLOSE_DOOR` over MQTTS when the fridge door is left open with no human present, and immediately send `ABORT` if a human enters the camera frame.
- [ ] **Firebase HTTPS Client ([`CBS.md`](../interface/CBS.md)):** Sync sensor telemetry, door events, and check-in/check-out images with Server `'S'`.

---

## 2. User Flows & Use Cases
- [ ] **One-Button Grocery Check-In (Bilingual Display):** User presses check-in button → LCD shows bilingual guidance (`"กรุณาวางอาหารหน้ากล้อง / Place grocery in front of camera"`) → webcam captures frame → YOLOv8 crops item → uploads to Server `'S'` via `POST /api/inventory/checkin` → displays returned Thai and English names (`name_th` / `name_en`), category, and expiry on LCD for review (`O` to confirm, `Up`/`Down` to adjust expiry).
- [ ] **FEFO Grocery Check-Out (Bilingual Display):** User presses check-out button → LCD shows bilingual guidance (`"แสดงอาหารที่นำออก / Present removed item"`) → webcam captures item → queries Server `'S'` via `POST /api/inventory/checkout` → single match auto-removes; multiple matches display candidate items with bilingual labels (`name_th` / `name_en`) sorted by First Expired, First Out (FEFO) for selection.
- [ ] **Automatic Decision & Countdown Prompts:** During check-in and check-out, display a bilingual countdown timer (`"กำลังยืนยันอัตโนมัติใน 5 วินาที / Auto-confirming in 5s"`). If no button is pressed after 5 seconds of inactivity, proceed automatically with defaults.
- [ ] **Automated Door Closure & Reflexive Human Abort:** Door light trips → countdown timer runs while checking webcam for humans → issues `CLOSE_DOOR` → aborts immediately if a person walks into frame, displaying bilingual alert on LCD (`"ตรวจพบบุคคล หยุดปิดประตูทันที / Person detected: Aborting door closure"`).

---

## 3. Edge Cases & Failure Mode Handlers
- [ ] **Internet / Cloud Disconnection (E4 Store-and-Forward):** Buffer incoming BLE sensor telemetry and door events in a local SQLite queue when offline and flush with exponential backoff once connectivity returns.
- [ ] **USB Webcam Disconnect / Dropped Frames:** Catch OpenCV frame grab failures gracefully without crashing the UI or blocking the safety loop; display a camera warning indicator on the LCD.
- [ ] **Corrupted / Replay BLE Packets:** Reject tampered `AES-128-GCM` tags and ignore duplicate or out-of-order `counter` values from Node `'F'`.
- [ ] **MQTT Broker Restart:** Automatically reconnect the local `paho-mqtt` client and re-subscribe to all topics (`fridge/node_f/time/req`, door status topics) on connection drop.
- [ ] **Power Loss:** Restart the PyQT interface along with every internal system after a powerloss and successful boot. Ensure the system re enters the UI without needing to go through the login screen.
- [ ] **IR Light Mismatch:** Reports from `'D'` are based on its own IR Sensor. If the light sensor from `'F'` reports that the internal light is still on while the door thinks it is closed, alert this as an error upstream to `'S'`

---

## 4. Tests & Quantitative Metrics
- [ ] **Unit Tests:** Verify `SensorPacket` binary unpacking (`<HQB` and `<hHH`), `AES-128-GCM` decryption, and SQLite offline queue persistence (`uv run pytest`).
- [ ] **Packet Delivery Rate (PDR) Logging:** Record received vs. missed sequence counters from Node `'F'` BLE beacons.
- [ ] **AI Inference Latency Benchmark:** Log YOLOv8n bounding-box inference latency (`ms` per frame) on the Raspberry Pi 4 CPU.
- [ ] **End-to-End Safety Latency:** Measure timestamp delta from door-open detection / human-entry detection to MQTTS `CLOSE_DOOR` / `ABORT` dispatch.
