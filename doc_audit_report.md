# SmarterFridge Documentation Audit

I reviewed 26 markdown files: root docs, `interface/`, and `camera/`, `door/`, `fridge/`, `server/`. `CLAUDE.md`, `GEMINI.md` and `.github/copilot-instructions.md` are symlinks to `AGENTS.md`. Where a doc refers to config files (`.env.example`, `secrets.h.example`, `platformio.ini`, `package.json`, `pyproject.toml`), I checked those too. **I did not modify any files.**

Severity: 🔴 Critical (blocks the build or a grading requirement) · 🟠 Major (contradiction or design gap) · 🟡 Minor (wording, typos, small inconsistencies)

---

## 1. Incomplete / Missing Files

| Sev | File | Issue |
|---|---|---|
| 🔴 | [SUL.md](interface/SUL.md) | **Empty (0 bytes).** This is the LINE contract that rubric item M6 depends on. Missing: message templates (TH/EN), alert types, thresholds, cooldowns, and how the target ID is resolved. |
| 🟠 | *(repo root)* | **No root `README.md`.** GitHub will show a bare file list. `HUMAN.md` is doing this job. |
| 🟠 | *(none)* | **No test plan, BOM, or roles doc.** Rubric §4.4 asks for a BOM and member roles in the proposal (due **Fri 30 Oct**). Rubric IV (3 pts) asks for documented test procedures. |
| 🟠 | All `GOAL.md` | **OTA (E6) appears in no subsystem plan.** It is listed in `AGENTS.md`, and `fridge/ARCHITECTURE.md` mentions LEDs "during OTA firmware updates", but no node GOAL/ARCH plans for it. |

---

## 2. Rubric Compliance Risks (`AGENTS.md` vs `RUBRIC.md`)

| Sev | Issue |
|---|---|
| 🔴 | **E7 is claimed wrongly.** `RUBRIC.md` E7 = "AI model running **on the MCU itself** (e.g. ESP32-S3 TinyML)". `AGENTS.md` claims E7 for YOLO on the Pi-top, which is the gateway, not an MCU, so it does not count. YOLO still satisfies M4. |
| 🔴 | **M1 gateway sensors.** The rubric needs **≥2 sensor types wired to the gateway**. Node C's docs list only the webcam; Pi-top buttons are unlikely to count. Sensors on Node D (INA219, IR, limit switch) count toward the total but **not** toward the gateway. Risk: −2 pts. |
| 🟠 | **Scalability (II, up to 3 pts).** The rubric asks for a "node ID in every message". There is none in the FUC packet or the CBS telemetry/door payloads, and CBF topics are hard-coded to `fridge/node_f/...`. |
| 🟡 | **E5 framing differs.** The rubric's E5 is "encrypted + authenticated connection **to the cloud**". `AGENTS.md` frames E5 mainly as local MQTT/TLS. CBS (HTTPS + Bearer) is the part that actually qualifies, so mention it explicitly. |
| 🟡 | **E-item tally.** Realistically E1, E2, E3 and E5 are solid, E4 is partial, E6 is unplanned and E7 is invalid. That is short of the 5 items needed for 10/10. |

---

## 3. Cross-Document Contradictions

### 3.1 Root / system level
| Sev | Contradiction | Where |
|---|---|---|
| 🟠 | **"LINE Notify"** appears in AGENTS, SUMMARY and interface/README. LINE Notify was **shut down on 31 Mar 2025**. Server docs correctly use the Messaging API only. | AGENTS L19, SUMMARY L67, interface/README L26 |
| 🟠 | **How Node C talks to Firebase.** SUMMARY says "Firebase Admin / Client SDKs", and `.env.example` gives the gateway `FIREBASE_SERVICE_ACCOUNT_KEY_PATH`. CBS says REST + Bearer token only. A service-account key on the Pi would also bypass all tenant isolation. | SUMMARY L59, .env.example vs CBS §1 |
| 🟡 | SUMMARY calls a successful closure an "abort" ("aborting immediately… if door fully shut"). | SUMMARY L91-L92 |

### 3.2 Secrets / setup
| Sev | Contradiction |
|---|---|
| 🟠 | **`GATEWAY_TOKEN` isn't in `.env.example`.** CBS §1 says it is defined in `camera/.env.example`. |
| 🟠 | **Where the Gemini key lives.** `.env.example` has `GEMINI_API_KEY`. SBG and the server docs keep a per-fridge `geminiApiKey` in Firestore. That also breaks interface/README §2.B ("keys … defined in `.env`"). |
| 🟠 | **Where the LINE target lives.** `.env.example` has `LINE_USER_ID`. Server ARCH keeps a per-fridge `lineTargetId` in Firestore. |
| 🟡 | `FIREBASE_PROJECT_ID` is defined twice in `.env.example`. There is no API base URL variable for the gateway to call CBS. |

### 3.4 CBS ↔ SBG ↔ Camera ↔ Server (inventory flow)
| Sev | Issue |
|---|---|
| 🔴 | **The checkout result can't say which item.** SBG returns `candidate_matches` as **item IDs**. CBS turns them into `CandidateItem` objects **without `item_id`**, and there is **no endpoint to confirm a selection**. So the camera's "select among FEFO candidates" / "manual override on NO_MATCH" can't be committed. |
| 🔴 | **Check-in review/cancel is impossible.** CBS persists the item **before** returning, but the camera UI offers `X` Cancel and `▲/▼` adjust expiry (SUMMARY: "user review/adjustment"). There is no update/delete endpoint, and `CheckInResult` has no `item_id`. |
| 🟠 | **AMBIGUOUS_MULTIPLE consumption.** SBG §5.4 says the server **defaults to the earliest-expiry item** (and the SBG diagram marks consumed unconditionally). CBS says items are marked consumed **only if EXACT_MATCH**. |
| 🟠 | **`fridgeId` in the request body.** SBG diagrams show "Cropped image + fridgeId" from C. CBS says the body has **no fridge_id** (the token identifies the fridge). |
| 🟠 | **Storage recommendations optional vs required.** Optional in the SBG Gemini schema and TS (`?`). **Required, non-null** in the CBS `CheckInResult` and Firestore schema. No fallback is defined. |
| 🟠 | **Telemetry deduplication.** server GOAL dedups on "`timestamp_s` and packet `counter`", but CBS telemetry has **no counter field** and no idempotency key. |
| 🟠 | **Low-confidence handling.** server GOAL says "return a structured fallback prompt for manual selection". CBS only returns a bare `422 UNIDENTIFIABLE`. |
| 🟡 | **`category_th` ownership.** CBS has the server return `category_th`, while SBG/interface README/server ARCH say *clients* translate categories. Redundant, not fatal. |
| 🟡 | `BilingualFoodItem` (camera ARCH) lacks `estimated_shelf_life_days`, but the UI "adjusts shelf-life days". |
| 🟡 | The dashboard category filter lists 5 of the 10 canonical categories. |

### 3.5 Server internal
| Sev | Issue |
|---|---|
| 🟠 | **Runtime.** The topology diagram says Cloud Functions run on "Bun Runtime". The tech table says Node.js 20. Cloud Functions can't run Bun. |
| 🟠 | **Members model.** The topology has a `/members` **subcollection**. The collection hierarchy has a `members` **document field**. Security rules use `members` **and** `memberEmails`, and `memberEmails` is defined nowhere. |
| 🟡 | TypeScript "5.x+" (ARCH) vs `"typescript": "^7"` in package.json. |
| 🟡 | "Permanent" Bearer token (CBS) vs "Generate / rotate" (server settings). |

---

## 4. Technical / Feasibility Issues

### 4.2 FUC / crypto
| Sev | Issue |
|---|---|
| 🔴 | **Nonce reuse risk.** FUC says "4-byte counter + 8-byte device salt", but `counter` is `uint16_t`. fridge GOAL says `esp_random()` + counter (not a fixed salt). The counter lives in `RTC_DATA_ATTR`, so it **resets on battery swap or brown-out**. With a fixed salt that **reuses GCM nonces, which breaks GCM**. |
| 🟠 | **Replay check vs counter reset/wrap.** The gateway rejects "duplicate or out-of-order counter". After an F reboot (counter → 0), or a 16-bit wrap (~22 days at 30 s), **every packet is rejected**. |
| 🟠 | **AAD undefined.** No AAD (is the header authenticated?), no version byte, no node ID, and no AD length/type bytes in the envelope diagram. |
| 🟠 | **Batch timing undefined.** One `timestamp_s` for 6 batched samples, with no definition of whether it is the first or last sample, or the sampling interval. |
| 🟠 | **No sensor-failure encoding in FUC.** fridge GOAL says "encode sentinel error values" and CBS uses JSON `null`, but the FUC binary layout defines no sentinel. |
| 🟡 | "SGP40 **raw** VOC index (0–500)" mixes two things: raw = SRAW ticks (0–65535), and the Index (1–500) comes from the Gas Index Algorithm. |
| 🟡 | No battery-voltage field, which E3 battery-life reporting will need. |

### 4.5 Hardware / pinout (verify against the KidBright32 schematic)
| Sev | Issue |
|---|---|
| 🟠 | **I2C buses look swapped.** Both fridge and door docs say onboard I2C0 (LM73, HT16K33) = GPIO 4/5 and KB-Chain I2C1 = GPIO 21/22. KidBright references show the reverse: onboard **GPIO 21/22**, KB Chain **GPIO 4/5**. |
| 🟡 | **LM73 part number vs address.** `LM73CIMK-0` with address `0x4D`: the LM73-0 variant uses 0x48–0x4A, and 0x4D belongs to the **LM73-1**. |
| 🟡 | **AIN2 on GPIO 25 ("USB_OUT").** On KidBright this pin drives the USB-port power switch. Confirm it is actually usable as a TB6612 logic input. |
| 🟠 | **E3 power path.** A Wemos 18650 shield boosts to 5V into the KidBright micro-USB, which keeps the regulator, USB-UART, LEDs and HT16K33 powered. Deep-sleep current will be **mA-level, not µA**, and some shields auto-shut-off at low load. The LiFePO4 option (3.6–3.65 V full charge straight onto 3V3) is at or above the ESP32's 3.6 V maximum. |
| 🟡 | **Sensor placement.** The onboard LDR inside an "IP65 enclosure" needs a translucent window. The LM73 inside a sealed box will lag the actual air temperature. |
| 🟡 | **TB6612FNG margins.** Rated 1.2 A continuous (3.2 A peak), VM max 13.5 V. Check against the JGY-370 stall current at 12 V. `STBY` is hard-tied high, so a GPIO-controlled STBY would add an independent cut-off. |
| 🟡 | **Limit switch "NO/NC" is ambiguous.** `FALLING` + pull-up implies NO, and NC would be the fail-safe choice (it detects a broken wire). |

### 4.6 Door safety logic
| Sev | Issue |
|---|---|
| 🟡 | **Task priorities.** `vCurrentMonitorTask` (priority 2) is a safety monitor but sits below `vMotorControlTask` (3). |

### 4.7 Camera / OS
| Sev | Issue |
|---|---|
| 🟠 | **"Bullseye + Python 3.11".** Bullseye ships Python **3.9**. The apt packages the docs rely on (`pitop`, `python3-pyqt5`) are built for system Python and can't be imported from a `uv` 3.11 venv. Verify which OS/Python the pi-top SDK actually supports. |
| 🟠 | **YOLOv8n on COCO** has very few grocery classes (no milk carton, packaged goods, etc.). "Crop grocery item" will often find nothing. No fallback (e.g. a full-frame upload) is specified. |
| 🟡 | **Button mapping.** "One-button check-in/out" doesn't say which of the 4 buttons starts check-in vs check-out from the idle screen. |
| 🟡 | camera GOAL mentions a "**login screen**" on the Pi. None exists anywhere in the design. |
| 🟡 | **CA cert vs client auth.** Mosquitto "authenticates Node D and F using `MQTT_TLS_CA_CERT`", but a CA cert authenticates the *broker*. Client auth is the shared username/password, which is the same credentials for D and F. |
| 🟡 | **Touchscreen.** The display is described as capacitive/touch, but the UI uses only buttons. |

### 4.8 Server / security
| Sev | Issue |
|---|---|
| 🔴 | **Firestore rules can't hide fields.** Reads are whole-document, so putting `geminiApiKey` and `gatewayTokenHash` on `/fridges/{id}` means **every member (including viewers) can read them**. Move them to an owner-only subdocument or use Secret Manager. |
| 🟠 | **Subcollection rules won't work.** `resource.data.members` refers to the subcollection document, not the parent fridge, so a `get()` on the parent is needed. |
| 🟠 | **Firestore write volume.** One doc per sample every 5 s is about **17k writes/day per fridge**, close to the 20k/day free quota. |
| 🟠 | **No LINE webhook.** Pushing to a user ID requires capturing it from a follow-event webhook, and none is defined. |
| 🟡 | **"Online status" has no source.** The fridge hub shows it, but there is no heartbeat endpoint (it could be inferred from the last telemetry). |
| 🟡 | **Manual check-in/out from the web** has no defined contract or required-field defaults (`image_storage_path`, `confidence`). |
| 🟡 | **Thresholds live only in server ARCH.** Temp > 8 °C and VOC > 250 aren't in GOAL/SUL ("sustained elevated" is undefined). |

### 4.9 SBG
| Sev | Issue |
|---|---|
| 🟠 | **Syntax error:** a stray extra `}` at [SBG.md L214](interface/SBG.md#L214). |
| 🟠 | **Schema dialect.** `"type": ["string","null"]` is JSON-Schema syntax, but the doc says "OpenAPI 3.0 schema via `responseSchema`", which uses `nullable: true`. |
| 🟡 | **Logic delegated to the LLM.** Gemini is asked to compute `estimated_expiry_date` and to sort by FEFO. Both are deterministic and should be computed server-side; they can also contradict `estimated_shelf_life_days`. |
| 🟡 | **Retry wording.** "Initial retry at 1s, doubling up to 3 attempts" is ambiguous. |
| 🟡 | **Model IDs.** Check that `gemini-3.5-flash-lite` / `gemini-2.5-flash-lite` are the exact current names. |

---

## 5. Minor / Editorial
- **Copilot symlink links break on GitHub:** `.github/copilot-instructions.md` is a symlink to `AGENTS.md`, so its relative links (`SUMMARY.md`, `camera/README.md`, …) resolve against `.github/` there.
- **HUMAN.md:** typos/grammar ("dudes who is running", "Ima", missing final newline). Its setup instruction conflicts with the READMEs (see §3.2).
- **RUBRIC.md:** the FAQ line carries an extraction-garbled note.
- **fridge GOAL:** "Occasional Broadcast: Every cycle: (6 wakes -> 30 seconds)" is awkward. The "Door-Open Immediate" broadcast has no matching "door closed" immediate broadcast, so `CONTRADICTION_ERROR` timing (CBS) is undefined.
- **Formatting rules:** no `file://` links, LaTeX or mermaid found in repo docs. All relative links resolve, apart from the copilot symlink case above.
