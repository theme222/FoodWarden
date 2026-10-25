# Node 'F' (Fridge Internal Sensor) — Completion Checklist (`GOAL.md`)

> [!IMPORTANT]
> **Incremental Development Guideline:**
> This file is a master checklist of features, use cases, tests, and edge-case handlers strictly required before the **Fridge Internal Sensor (`fridge/`)** subsystem is considered finished.
> **This checklist does NOT need to be completed in a single prompt.** Developers and AI agents are expected to implement and verify these components incrementally across multiple steps.

* **Related Documents:** [`README.md`](README.md) | [`ARCHITECTURE.md`](ARCHITECTURE.md)

---

## 1. Core Features
- [ ] **Cold-Boot MQTTS Time Synchronization ([`CBF.md`](../interface/CBF.md)):** Connect to Wi-Fi and Gateway `'C'` MQTTS broker on initial boot, publish to `fridge/node_f/time/req`, receive 64-bit `timestamp_s` on `fridge/node_f/time/res`, calibrate ESP32 RTC, and shut down Wi-Fi.
- [ ] **Internal Sensor Sampling:** Read temperature from onboard LM73 (`I2C0`: `GPIO 4/5`, `0x4D`), VOC index from external SGP40 (`I2C1`: `GPIO 21/22`, `0x59`), and ambient light from onboard LDR (`GPIO 36`).
- [ ] **AES-128-GCM BLE Beacon Broadcast ([`FUC.md`](../interface/FUC.md)):** Pack `SensorPacket` structs, encrypt with `mbedtls_gcm` using `AES_KEY` from `secrets.h`, and broadcast via BLE advertisement.
- [ ] **FreeRTOS Multitasking & Deep Sleep (E1, E3):** Coordinate sampling, encryption/BLE transmission, and UI tasks via FreeRTOS primitives, then enter ESP32 deep sleep while preserving `counter` and batched samples in `RTC_DATA_ATTR` memory.
- [ ] **Onboard LED Matrix & Button ISRs (E2):** Handle `S1` (`GPIO 16`) and `S2` (`GPIO 14`) hardware interrupts to display live diagnostics on the 16×8 HT16K33 LED dot matrix or trigger manual time recalibration.

---

## 2. Use Cases
- [ ] **Cyclic Low-Power Telemetry:** Wake from deep sleep every 5 seconds → sample Light, VOC, Temp. Store all data into a local buffer (size 6) and go back to sleep.
- [ ] **Occasional Broadcast:** Every cycle: (6 wakes -> 30 seconds) broadcasts batched readings to Gateway `'C'`
- [ ] **Door-Open Immediate Wake/Alert:** During telemetry, if the light sensor signals that the fridge door is opened, broadcast immediate update to Gateway `'C'` with the current buffer.
- [ ] **Manual Diagnostic Inspection:** User presses `S1` (`GPIO 16`) → LED matrix scrolls current temperature (`°C`), light level and VOC index, then powers down the display to conserve battery.

---

## 3. Edge Cases & Failure Mode Handlers
- [ ] **MQTTS Time Sync Timeout on Boot:** Retry `fridge/node_f/time/req` up to 3 times (5-second timeout each); if Gateway `'C'` is unreachable, disable Wi-Fi and fall back to internal RTC monotonic time so battery is not drained by endless Wi-Fi scanning.
- [ ] **Unplugged / Faulty I2C Sensors:** Handle `I2C0` (LM73) or `I2C1` (SGP40) read timeouts gracefully without locking up the ESP32 I2C bus or crashing FreeRTOS tasks; encode sentinel error values if a sensor fails.
- [ ] **Unique IV / Nonce Guarantee:** Combine hardware RNG (`esp_random()`) with the monotonic `RTC_DATA_ATTR` packet counter so the 12-byte AES-GCM IV never repeats across sleep cycles.
- [ ] **Failure to send BLE:** If the broadcast fails, try again the next cycle. All values inside of the current buffer can be discarded.

---

## 4. Tests & Quantitative Metrics
- [ ] **Binary Layout & Encryption Verification:** Confirm packed `SensorPacket` size is exactly `11 + (N × 6)` bytes and decrypts cleanly on Gateway `'C'`.
- [ ] **Power Consumption Profile (E3):** Measure active vs. deep-sleep current draw (`mA` / `µA`) and document estimated 18650 battery runtime inside the `4°C` fridge compartment.
- [ ] **Sensor Accuracy Calibration:** Log LM73 temperature and SGP40 VOC readings against a reference thermometer inside the refrigerator.
