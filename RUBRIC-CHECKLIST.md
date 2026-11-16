# FoodWarden — Master Rubric & Multi-Branch Verification Checklist

Audited against [RUBRIC.md](RUBRIC.md), [SUMMARY.md](SUMMARY.md), and [AGENTS.md](AGENTS.md) across all Git branches and deployed production state on **2026-11-16**.

> [!NOTE]
> **Checkboxes reflect verified code/artifact reality, not planned design docs.** Items marked `[x]` are implemented in code or verified by tests on the named branch; items marked `[ ]` are missing, stubbed, unintegrated across branches, or require physical hardware/field verification.

---

## 1. Branch Audit Snapshot (All Branches)

| Subsystem / Scope              | Branch Checked             | Tip Commit       | Implementation Status                                                                                                                                                                                                                                                                                                                                                  | Key Gaps / Blockers                                                                                                                                               |
| ------------------------------ | -------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Root / Specs / Resources**   | `origin/main`              | `9e40d9c`        | Docs, BOM, proposal, wiring diagrams, `CBD/CBS/FUC/SBG` contracts, PR #4 & PR #5 merged (`interface/SUL.md` & `interface/CBS.md` completed on `feat/server`, PR pending)                                                                                                                                                                                               | Merge `feat/server`, `feature/C-camera`, `fridge-fixes`, and `feature/door-node` into `main` before final submission                                              |
| **Server `'S'` & Dashboard**   | `feat/server`              | `b195d62` + docs | Cloudflare Worker live at `https://foodwarden.newisnooby.workers.dev`, D1 migrations `0001`–`0004` applied remotely, R2, Durable Objects, Google OAuth, Gemini, LINE pairing/alerts, hidden `/sim` Gateway Simulator; **93 automated tests pass** (`72` Worker + `15` UI + `6` model), `tsc`/`oxlint`/`knip`/`secrets` pass, React Doctor `79/100` (0 security issues) | Pending physical hardware end-to-end traffic (`F -> C -> S`) and open PR merge into `main`                                                                        |
| **Server `'S'` (LINE branch)** | `origin/feat/server-line`  | `d5c00bd`        | Pre-Cloudflare scaffold + empty `test` commit only                                                                                                                                                                                                                                                                                                                     | Superseded by `feat/server` (already implements LINE routes/outboxes/pairing/disambiguation and `SUL.md`)                                                         |
| **Gateway `'C'`**              | `origin/feature/C-camera`  | `a7b7b02`        | Python 3.11 app: PyQt6 5" LCD UI, Pi-top buttons, PIR (`GPIO 22`), YOLO (`yolo26n.pt`), BLE GATT AES-GCM receiver, Mosquitto TLS, SQLite offline queue, `CBS.md` `/api/telemetry` + `/api/door_events` + `/api/status` 60s heartbeat + persistent UUID v4 `Idempotency-Key`s + `workers.dev` default URL (`63` pytest pass)                                            | Live Raspberry Pi + webcam + BLE hardware test against production `https://foodwarden.newisnooby.workers.dev/api` pending                                         |
| **Fridge Sensor `'F'`**        | `origin/fridge-fixes`      | `dc81386`        | ESP32 FreeRTOS firmware: 3 tasks, `S1/S2` ISRs, 5s deep sleep, RTC 6-sample batching, SHT31 + SGP40 + 12-packet door VOC filter + LDR + HT16K33, AES-128-GCM BLE GATT + host test suite                                                                                                                                                                                | Pending physical KidBright32 hardware test, live BLE exchange with `'C'`, `LDR_DOOR_OPEN_THRESHOLD` calibration, and real power measurements in `fridge/POWER.md` |
| **Door Closer `'D'`**          | `origin/feature/door-node` | `c5d4b7e`        | Architecture, pinout, and `GOAL.md` documentation only                                                                                                                                                                                                                                                                                                                 | **`door/src/main.cpp` is still a `Hello, world!` stub** — no motor control, INA219, IR, limit switch ISR, or MQTTS firmware implemented                           |

---

## 2. Minimum Requirements ([RUBRIC.md](RUBRIC.md) §4.1 — Pass/Fail, -2 pts each if missing)

- [ ] **M1 — >= 5 different sensor types total (>= 2 on sensor node, >= 2 on gateway):**
  - [x] **Node `'F'` (3 types, `origin/fridge-fixes`):** SHT31 (temp + RH), SGP40 (VOC), onboard LDR (light) implemented in `fridge/src/sensors.cpp`.
  - [ ] **Node `'C'` Gateway (>= 2 types, `origin/feature/C-camera`):** Digital PIR (`GPIO 22`) + Logitech USB Webcam implemented; confirm with TA/instructor whether USB Webcam counts as a wired gateway sensor type under §2.3 or add a second wired sensor on Pi-top.
  - [ ] **Node `'D'` Actuator (`origin/feature/door-node`):** INA219 current sensor, TCRT5000 IR optical sensor, and KW11-3Z limit switch documented in `door/ARCHITECTURE.md`, not yet implemented in firmware.
- [ ] **M2 — >= 1 actuator (§2.3):** JGY-370 12V worm gear motor + TB6612FNG driver documented on `origin/feature/door-node`; firmware control not yet implemented.
- [ ] **M3 — Sensor node -> Gateway data transmission:** AES-128-GCM over BLE GATT implemented on both `origin/fridge-fixes` (`ble_gatt.cpp`) and `origin/feature/C-camera` (`ble/receiver.py`), verified on host/unit tests; physical ESP32 <-> Pi-top BLE link not yet verified end-to-end.
- [ ] **M4 — Closed-loop AI component:**
  - [x] Edge YOLO (`yolo26n.pt` in `origin/feature/C-camera`) for food cropping and human-presence abort.
  - [x] Cloud Gemini 3.5 Flash Lite (`feat/server`) for check-in metadata and FEFO check-out matching.
  - [ ] Closed-loop actuation + cloud check-in/out integration blocked on `door/` firmware and `camera/` <-> `server/` `CBS.md` payload alignment.
- [ ] **M5 — Raw data uploaded to cloud storage + dashboard:**
  - [x] `feat/server` deployed live at `https://foodwarden.newisnooby.workers.dev` (Cloudflare D1 `0001`–`0004` + R2 + Durable Objects + React dashboard; 72 Worker + 21 UI/model tests pass; zero `tsc` errors) and `origin/feature/C-camera` (`a7b7b02`) aligned with `CBS.md` + `Idempotency-Key`.
  - [ ] End-to-end live hardware capture from Pi-top `'C'` and KidBright32 `'F'` to production dashboard pending field test.
- [ ] **M6 — Notification system:**
  - [x] LINE Messaging API alerts, cooldowns, pairing, personal digests, durable outboxes, and [interface/SUL.md](interface/SUL.md) implemented and verified (`72` Worker tests + live production deployment).
  - [ ] End-to-end hardware-triggered LINE alert demo with real fridge + gateway traffic pending field verification.
- [ ] **M7 — Safety rules (§4.3):**
  - [x] Safety architecture documented (limit switch ISR, INA219 1200 mA stall cutoff, 8s–30s motion timeout, MQTTS `ABORT`, 18650 BMS + silica desiccant sealed box, isolated 12V buck rail).
  - [ ] Physical enclosure, wiring, limit-switch hardware stop, and TA/instructor safety inspection pending.
- [ ] **M8 — Public Git repository with commits from every member:**
  - [x] All 5 team members have verified commits across repository branches.
  - [ ] Confirm repository public visibility, merge active feature branches into `main` before submission, and keep secrets out of Git history.

---

## 3. Milestones & Deliverables ([RUBRIC.md](RUBRIC.md) §4.4–4.6)

- [x] **2026-10-24:** Group and topic registration.
- [x] **2026-10-30:** Proposal submitted ([Embedded_Systems_Project.md](resources/Embedded_Systems_Project.md) / PDF).
- [ ] **2026-11-20 (Due in 5 days):** **Checkpoint progress video (<= 2 min)** showing live end-to-end data flow (`Node 'F' -> Gateway 'C' -> Server 'S' -> Dashboard`).
- [ ] **2026-12-08:** Live 10-minute presentation & demo (bring mobile hotspot for ESP32).
- [ ] **2026-12-08:** Presentation slides.
- [ ] **2026-12-08:** Final report PDF (<= 10 pages, including §4.6 AI tool declaration, member roles, Git link).
- [ ] **2026-12-08:** Final demo video (3–5 minutes, uploaded with link).
- [ ] **2026-12-08:** Source code archive + public Git URL + individual peer evaluations.

---

## 4. Marking Guide Checklist (70 Points — [RUBRIC.md](RUBRIC.md) §5)

### I. Problem Definition (5 pts)

- [x] **Relevance & Impact (3 pts):** Household food waste, spoilage detection, and door-ajar prevention defined in [Embedded_Systems_Project.md](resources/Embedded_Systems_Project.md) and [SUMMARY.md](SUMMARY.md).
- [ ] **Evidence & Detail (2 pts):** Initial UX/family feedback captured in [DASHBOARD-DESIGN-LOG.md](server/review/DASHBOARD-DESIGN-LOG.md); add quantitative background citations/household observations for the final report.

### II. System Architecture & Scalability (5 pts)

- [x] **Architecture & Data Flow (2 pts):**
  - [x] System diagrams and contracts documented in [SUMMARY.md](SUMMARY.md), [interface/](interface/README.md) (`CBD.md`, `CBS.md`, `FUC.md`, `SBG.md`, `SUL.md`), and [server/diagrams/](server/diagrams/), with `CBS.md` and `camera/` reconciled to Cloudflare `server/`.
- [ ] **Scalability (3 pts):**
  - [x] _1 pt level (in code):_ `node_id` present across `FUC.md`, `CBS.md`, `server/` D1 schema (`(fridge_id, node_id, timestamp_s)`), `PR #5` `/api/status`, and `camera/` `PDRTracker`.
  - [ ] _2–3 pt level (live demo):_ Run **>= 2 physical sensor nodes** OR **1 physical + >= 2 simulated sensor nodes** simultaneously (using distinct `node_id`s such as `F0`, `F1`, `F2`), all displayed distinctly on Gateway `'C'` and Dashboard `'S'`.

### II′. Embedded Engineering Depth (10 pts — Planned: E1, E2, E3, E5, E7)

- [ ] **E1 — RTOS Multitasking (2 pts):**
  - [x] `origin/fridge-fixes`: 3 FreeRTOS tasks (`vSensorTask`, `vBleGattTask`, `vDisplayTask`) communicating via `EventGroup`, `Queue`, and task notifications.
  - [ ] `origin/feature/door-node`: Implement FreeRTOS tasks (`vCurrentMonitorTask`, `vMotorControlTask`, `vMqttCommTask`) in `door/src/`.
- [ ] **E2 — Interrupt-Driven I/O (2 pts):**
  - [x] `origin/fridge-fixes`: `IRAM_ATTR` ISRs on `S1` (`GPIO 16`) and `S2` (`GPIO 14`) with `xTaskNotifyFromISR`, plus `S2` `ext0` deep-sleep wake.
  - [ ] `origin/feature/door-node`: Implement `IRAM_ATTR` hardware ISRs for Home Limit Switch (`GPIO 33`) and Emergency Stop (`GPIO 16`).
- [ ] **E3 — Low Power (2 pts):**
  - [x] `origin/fridge-fixes`: 5s `esp_deep_sleep_start()` cycle with `RTC_DATA_ATTR` state retention and 6-sample BLE batching.
  - [ ] Measure real sleep, sample-wake, and BLE current draw + battery life on KidBright32 and replace `_TBD_` estimates in `fridge/POWER.md`.
- [ ] **E5 — Security (2 pts):**
  - [x] `fridge/` + `camera/`: AES-128-GCM with AAD + replay-counter protection; Mosquitto TLS configs in `camera/deploy/`.
  - [x] `server/`: HTTPS + SHA-256 hashed Bearer `GATEWAY_TOKEN`, Better Auth Google OAuth, private R2 photos, secret-check scripts (`scripts/check-secrets.ts`, `.gitleaks.toml`).
  - [ ] `door/`: Implement MQTTS (port `8883` with `MQTT_TLS_CA_CERT` validation); verify zero secrets in final Git history.
- [ ] **E7 — On-Device AI (2 pts):**
  - [x] `origin/feature/C-camera`: Edge YOLO (`yolo26n.pt`) running locally on Pi-top [4] (noted in [AGENTS.md](AGENTS.md) as TA-confirmed for E7; double-check final rubric phrasing vs MCU-only AI and keep `E4` store-and-forward offline queue in `camera/` + `line_outbox` in `server/` ready as documented depth).

### III. Implementation (20 pts)

- [ ] **Functionality (8 pts):** `server/` core + LINE + AI + `/sim` deployed live (`93` tests pass); `camera/` updated and aligned with `CBS.md` (`63` pytest pass, needs Pi hardware run); `fridge/` firmware written (untested on hardware); `door/` firmware not yet started.
- [ ] **Field Testing (3 pts):** Run continuous **>= 24-hour** test on a real refrigerator with real household/user operation and logged telemetry.
- [ ] **Robustness (3 pts):** Verify auto-recovery after Wi-Fi loss (SQLite store-and-forward), BLE timeouts, broker restarts, power loss (Node `'D'` boot homing + Pi-top kiosk autostart), and unplugged sensor sentinels.
- [ ] **Build Quality (3 pts):** Complete moisture-sealed container + silica desiccant for Node `'F'`, 3D-printed/mounted actuator arm & neat enclosure/wiring for Node `'D'`, and portable Pi-top + 5" LCD + PIR assembly.
- [ ] **User Experience (3 pts):**
  - [x] Mobile-first bilingual React dashboard designed from user feedback ([DASHBOARD-DESIGN-LOG.md](server/review/DASHBOARD-DESIGN-LOG.md)) + bilingual PyQt6 5" LCD UI on `camera/`.
  - [ ] Run end-to-end usability test with target/non-technical users on the live system.

### IV. Testing & Analysis (10 pts)

- [ ] **Test Plan & Procedure (3 pts):**
  - [x] Automated unit/integration suites exist in `server/` (72 Worker + 21 UI/model tests pass), `camera/tests/` (63 pytest pass), and `fridge/test/` + `tools/host_test/`.
  - [ ] Document formal normal-use, edge-case, and failure-condition (Wi-Fi loss, sensor unplugged, power loss, door obstruction) test procedures with observed hardware results.
- [ ] **Quantitative Metrics (4 pts — need >= 3 measured with real data + mean/min/max variation):**
  - [ ] **End-to-end latency:** Door open / human approach -> `'C'` -> `'D'` actuation & `'F'` -> `'S'` dashboard.
  - [ ] **BLE Packet Delivery Rate (PDR):** Collect real runs via `PDRTracker` in `camera/ble/receiver.py`.
  - [ ] **Sensor accuracy:** Compare SHT31 & SGP40 against a reference thermometer/instrument inside the fridge.
  - [ ] **Power consumption / battery life:** Real multimeter/profiler measurements for `fridge/POWER.md`.
  - [ ] **Edge YOLO / Cloud AI latency & accuracy:** Real Pi-top 4 benchmarks via `detector.benchmark_latency()` and confusion/accuracy stats on real test groceries.
  - [ ] **24-hour uptime:** Continuous 24h operation log without fatal crashes.
- [ ] **Analysis & Comparison (3 pts):** Compare measured metrics against FoodWarden targets and existing commercial/academic smart-fridge systems.

### V. Presentation & VI. Video / Documentation (20 pts)

- [ ] Slides, live demo script + backup video, Q&A readiness across all 5 members.
- [ ] 3–5 min final video (team IDs, university, overview, live working demo, component explanation).
- [ ] <= 10-page Final Report PDF covering all 6 rubric sections + [DASHBOARD-DESIGN-LOG.md](server/review/DASHBOARD-DESIGN-LOG.md) evidence + AI tool declaration.

---

## 5. Immediate Action Queue (Prioritized for 2026-11-20 Checkpoint)

1. [x] **Fix `server/` TypeScript errors & deploy/verify:** Resolved `tsc` errors, applied `0001`–`0004` remote D1 migrations, configured production secrets, deployed live Worker at `https://foodwarden.newisnooby.workers.dev`, and added hidden `/sim` Gateway Data Simulator (`93` automated tests pass).
2. [x] **Align `origin/feature/C-camera` with `CBS.md` & `server/`:** Updated `cloud/client.py`, `sync_manager.py`, `offline_queue.py`, `orchestrator.py`, and `models/cloud_cbs.py` (`a7b7b02`) for Cloudflare `/api/telemetry`, `/api/door_events`, `/api/status` (60s heartbeat), persistent UUID v4 `Idempotency-Key` headers, and `workers.dev` base URL (`63` pytest pass).
3. [ ] **Verify `origin/fridge-fixes` on physical KidBright32 + BLE link to `'C'`:** Flash Node `'F'`, verify SHT31/SGP40/LDR + `secrets.h` AES-GCM decryption on Pi-top, calibrate `LDR_DOOR_OPEN_THRESHOLD`, and record checkpoint video (`F -> C -> S -> Dashboard`) by **2026-11-20**.
4. [ ] **Implement `door/src/` firmware (`origin/feature/door-node`) & merge all subsystem PRs into `main`:** Build FreeRTOS tasks (E1), limit switch + E-stop ISRs (E2), INA219 stall cutoff, IR closure sensor, TB6612FNG control, and MQTTS client (E5), and merge remaining branches alongside `feat/server`.
