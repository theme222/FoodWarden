# Node 'C' (Camera & Edge Gateway) — Completion Checklist (`GOAL.md`)

> [!IMPORTANT]
> **Incremental Development Guideline:**
> This file is a master checklist of features, use cases, tests, and edge-case handlers strictly required before the **Camera & Edge Gateway (`camera/`)** subsystem is considered finished.
> **This checklist does NOT need to be completed in a single prompt.** Developers and AI agents are expected to implement and verify these components incrementally across multiple steps.

* **Related Documents:** [`README.md`](README.md) | [`ARCHITECTURE.md`](ARCHITECTURE.md)

---

## 1. Core Features
- [ ] **Direct User Interface (PyQt6 5-inch LCD):** Build full-screen user-facing interface rendered on the 5-inch LCD (`800×480`) mounted on the fridge, controlled directly via the 4 physical Pi-top case buttons (`Up`, `Down`, `O`, `X`).
- [ ] **Bilingual Display System (Thai Default + English Translation):** Every on-screen instruction, workflow step, button action hint, food review card, and system alert must be displayed in **Thai by default with an English translation** (e.g. `"กรุณาวางอาหารหน้ากล้อง / Place grocery in front of camera"`, `"กด O เพื่อยืนยัน / Press O to confirm"`).
- [ ] **Local Mosquitto TLS Broker:** Configure and run Mosquitto on port `8883` with server TLS certificates (`MQTT_TLS_CA_CERT`, `MQTT_TLS_SERVER_CERT`, `MQTT_TLS_SERVER_KEY`).
- [ ] **BLE GATT Receiver, Decryptor & Time Synchronizer ([`FUC.md`](../interface/FUC.md)):** Connect to Node `'F'` as Central Client, write current 64-bit Unix timestamp to Time Characteristic `0000FFF2...`, read/decrypt `AES-128-GCM` telemetry payloads from `0000FFF1...` with AAD verification, and unpack `SensorPacket` structs.
- [ ] **YOLO11n Inference & JPEG Image Compression:** Run local YOLO11 Nano object detection (`yolo11n.pt`) on USB webcam frames for grocery bounding-box cropping (falling back to the full webcam frame if no bounding box is detected) and real-time `person` detection for door safety. Compress all cropped or full-frame grocery images into JPEG (`image/jpeg`) format before uploading to Server `'S'`.
- [ ] **PIR Motion Sensor & Screen Sleep Controller (Rubric M1):** Wire Digital PIR sensor (HC-SR501 / AM312) to Pi-top GPIO 22 to detect approaching users; automatically wake the 5-inch LCD and camera stream upon motion detection, and blank the display / sleep the camera after 10 minutes of continuous inactivity.
- [ ] **Door Safety Controller ([`CBD.md`](../interface/CBD.md)):** Trigger `CLOSE_DOOR` over MQTTS when the fridge door has remained open for > 60 seconds with no human present, and immediately send `ABORT` if a human enters the camera frame.
- [ ] **Firebase HTTPS Client ([`CBS.md`](../interface/CBS.md)):** Sync sensor telemetry, door events, and compressed JPEG check-in/check-out images with Server `'S'`.

---

## 2. User Flows & Use Cases
- [ ] **Grocery Check-In Workflow (Trigger: 'O'):** From Idle screen, user presses 'O' → LCD shows guidance (`"กรุณาวางอาหารหน้ากล้อง / Place grocery in front of camera"`) → webcam captures frame → YOLO11n crops item (or falls back to full frame) and compresses into JPEG → requests draft from Server `'S'` via `POST /api/inventory/checkin/draft` → displays returned bilingual metadata with expiry date highlighted in `DD/MM/YYYY`. User adjusts highlighted date segment via `Up`/`Down` and advances with `O`. Final press of `O` (or 5-second countdown expiry) commits item (including `image_storage_path`) via `POST /api/inventory/checkin`. Pressing 'X' at any time cancels without committing and returns to Idle.
- [ ] **FEFO Grocery Check-Out Workflow (Trigger: 'X'):** From Idle screen, user presses 'X' → LCD shows guidance (`"แสดงอาหารที่นำออก / Present removed item"`) → webcam captures item → YOLO11n crops and compresses into JPEG → requests candidate matches from Server `'S'` via `POST /api/inventory/checkout/draft` → displays candidate items with bilingual labels (`name_th` / `name_en`) sorted by FEFO with their unique `item_id`s. User navigates list with `Up`/`Down` and confirms removal with `O` (or 5-second countdown auto-selects FEFO default), committing via `POST /api/inventory/checkout`. Pressing 'X' at any time cancels and returns to Idle.
- [ ] **Automatic Decision & Countdown Prompts:** During check-in and check-out, display a bilingual countdown timer (`"กำลังยืนยันอัตโนมัติใน 5 วินาที / Auto-confirming in 5s"`). If no button is pressed after 5 seconds of inactivity, proceed automatically with defaults.
- [ ] **Automated Door Closure & Reflexive Human Abort:** Door light trips → countdown timer runs while checking webcam for humans → issues `CLOSE_DOOR` → aborts immediately if a person walks into frame, displaying bilingual alert on LCD (`"ตรวจพบบุคคล หยุดปิดประตูทันที / Person detected: Aborting door closure"`).

---

## 3. Edge Cases & Failure Mode Handlers
- [ ] **Internet / Cloud Disconnection (E4 Store-and-Forward):**
  - **Telemetry & Door Events:** Buffer incoming BLE sensor telemetry and door events in a local SQLite queue when offline and flush with exponential backoff once connectivity returns.
  - **Offline Grocery Check-In:** If internet is down during check-in, display a bilingual offline indicator on the LCD (`"ไม่มีสัญญาณอินเทอร์เน็ต / Wi-Fi Not Connected"`), store the captured item image locally, and run the 5-second UI countdown timer. When internet connectivity is restored: if the 5-second UI countdown has already elapsed, immediately call `POST /api/inventory/checkin/draft` and directly follow with `POST /api/inventory/checkin` using the default AI-suggested values.
- [ ] **USB Webcam Disconnect / Dropped Frames:** Catch OpenCV frame grab failures gracefully without crashing the UI or blocking the safety loop; display a camera warning indicator on the LCD.
- [ ] **Corrupted / Replay BLE Packets:** Reject tampered `AES-128-GCM` tags and ignore duplicate or out-of-order `counter` values from Node `'F'`.
- [ ] **MQTT Broker Restart:** Automatically reconnect the local `paho-mqtt` client and re-subscribe to all topics (`fridge/door/time/req`, door status topics) on connection drop.
- [ ] **Power Loss & Unattended Auto-Recovery:** The Raspberry Pi OS must auto-boot directly into the PyQt graphical UI upon power restoration without any OS or desktop login prompt. There is no app login screen; the Bearer token is configured once by the fridge owner via `.env` on device. All internal services (Mosquitto, BLE scanner, door controller) restart automatically.
- [ ] **IR Light Mismatch:** Reports from `'D'` are based on its own IR Sensor. If the light sensor from `'F'` reports that the internal light is still on while the door thinks it is closed, alert this as an error upstream to `'S'`

---

## 4. Tests & Quantitative Metrics
- [ ] **Unit Tests:** Verify `SensorPacket` binary unpacking (`<B2s8sI` header and `<QhHH` samples), `AES-128-GCM` decryption, and SQLite offline queue persistence (`uv run pytest`).
- [ ] **Packet Delivery Rate (PDR) Logging:** Record received vs. missed sequence counters from Node `'F'` BLE GATT connections.
- [ ] **AI Inference Latency Benchmark:** Log YOLO11n (`yolo11n.pt`) bounding-box inference latency (`ms` per frame) on the Raspberry Pi 4 CPU.
- [ ] **End-to-End Safety Latency:** Measure timestamp delta from door-open detection / human-entry detection to MQTTS `CLOSE_DOOR` / `ABORT` dispatch.
