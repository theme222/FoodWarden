# Node 'F' (Fridge Internal Sensor) — Completion Checklist (`GOAL.md`)

> [!IMPORTANT]
> **Incremental Development Guideline:**
> This file is a master checklist of features, use cases, tests, and edge-case handlers strictly required before the **Fridge Internal Sensor (`fridge/`)** subsystem is considered finished.
> **This checklist does NOT need to be completed in a single prompt.** Developers and AI agents are expected to implement and verify these components incrementally across multiple steps.

* **Related Documents:** [`README.md`](README.md) | [`ARCHITECTURE.md`](ARCHITECTURE.md)

## Status (read this first)

**All code for the features below is written and compiles (`pio run`, `pio check` clean). No box is ticked because nothing has been verified on real hardware yet.** Verified on a PC with `tools/host_test/run_host_tests.sh`: the door/VOC filter, the buffer and send rules, and the display text logic (26 Unity tests), a simulation of the Sensirion VOC algorithm, and the packet built by `src/crypto.cpp` (size, header, AAD, IV, every sample field, tamper rejection), decrypted by an independent AES-GCM implementation. **Not verified:** the same packet produced by the ESP32's own mbedtls, every sensor read, the BLE exchange with Gateway `'C'`, the LED matrix, sleep current, and sensor accuracy. Deviations from this checklist are listed in [`ARCHITECTURE.md`](ARCHITECTURE.md) §5 and §6 (notably: `S1` cannot wake the chip from deep sleep).

---

## 1. Core Features
- [ ] **BLE GATT Telemetry & Time Synchronization ([`FUC.md`](../interface/FUC.md)):** Act as GATT Server advertising Telemetry Service `0000FFF0...`, receive 64-bit Unix timestamp write to `0000FFF2...` from Gateway `'C'` to calibrate ESP32 RTC, and notify encrypted sensor payload on `0000FFF1...` with zero Wi-Fi required. *(Implemented in `src/ble_gatt.cpp`; untested on hardware.)*
- [ ] **Internal Sensor Sampling:** Read temperature (and humidity, for SGP40 compensation) from external SHT31 (`I2C1`: `GPIO 4/5`, `0x44`), VOC index from external SGP40 (`I2C1`: `GPIO 4/5`, `0x59`), and ambient light from onboard LDR (`GPIO 36`). *(Stage 1 implemented in `src/sensors.cpp`; hardware verification pending.)*
- [ ] **Door-Open VOC Masking:** Feed the SGP40 Gas Index Algorithm on every cycle; transmit `VOC_NULL_SENTINEL` (`0xFFFF`) while the door is open and for 12 packets (60 s) after it closes. Cooldown counter kept in `RTC_DATA_ATTR`. *(Logic implemented in `src/door_voc_filter.h` with unit tests; `LDR_DOOR_OPEN_THRESHOLD` needs calibration.)*
- [ ] **AES-128-GCM BLE GATT Encryption ([`FUC.md`](../interface/FUC.md)):** Pack `SensorPacketPayload` structs, encrypt with `mbedtls_gcm` using `AES_KEY` from `secrets.h` and AAD header, and transfer via GATT Characteristic. *(Implemented in `src/crypto.cpp`; layout, AAD and IV verified on a PC by `tools/host_test/`; on-board check with `tools/decrypt_packet.py` pending.)*
- [ ] **FreeRTOS Multitasking & Deep Sleep (E1, E3):** Coordinate sampling, encryption/BLE transmission, and UI tasks via FreeRTOS primitives, then enter ESP32 deep sleep while preserving `counter` and batched samples in `RTC_DATA_ATTR` memory. *(Implemented, untested on hardware: 5 s deep-sleep cycle, RTC sample buffer, session salt and counter in `src/node_state.h`; three FreeRTOS tasks `vSensorTask` / `vBleGattTask` / `vDisplayTask` in `src/tasks.cpp`; BLE GATT server in `src/ble_gatt.cpp`.)*
- [ ] **Onboard LED Matrix & Button ISRs (E2):** Handle `S1` (`GPIO 16`) and `S2` (`GPIO 14`) hardware interrupts to display live diagnostics on the 16×8 HT16K33 LED dot matrix or trigger manual time recalibration. *(Implemented in `src/matrix.cpp` and `src/tasks.cpp`; RAM layout and S1 wake limitation noted in `ARCHITECTURE.md` §4. Untested on hardware.)*

---

## 2. Use Cases
- [ ] **Cyclic Low-Power Telemetry:** Wake from deep sleep every 5 seconds → sample Light, VOC, Temp. Store all data into a local buffer (size 6) and go back to sleep.
- [ ] **Periodic Telemetry Broadcast:** After accumulating 6 samples in the RTC buffer (6 wakes × 5 s = 30 seconds), connect via BLE GATT and transfer the batched payload to Gateway `'C'`.
- [ ] **Door-Open Immediate Wake/Alert:** During telemetry, if the light sensor signals that the fridge door is opened, broadcast an immediate update to Gateway `'C'` with the current buffer.
- [ ] **Manual Diagnostic Inspection:** User presses and holds `S1` (`GPIO 16`, polled once per 5-second wake because it cannot wake the chip) → LED matrix scrolls current temperature (`°C`), light level and VOC index, then powers down the display to conserve battery.

---

## 3. Edge Cases & Failure Mode Handlers
- [ ] **BLE Connection Timeout:** If Gateway `'C'` does not connect within 5 seconds of advertising, return to deep sleep and retain batched readings until next cycle so battery is not drained by endless advertising.
- [ ] **Unplugged / Faulty I2C Sensors:** Handle `I2C1` (SHT31 or SGP40) read timeouts gracefully without locking up the ESP32 I2C bus or crashing FreeRTOS tasks; encode sentinel error values if a sensor fails.
- [ ] **Unique IV / Nonce Guarantee:** Combine hardware RNG (`esp_random()`) with the monotonic `RTC_DATA_ATTR` packet counter so the 12-byte AES-GCM IV never repeats across sleep cycles.
- [ ] **Failure to send BLE:** If the broadcast fails, try again the next cycle. All values inside of the current buffer can be discarded.

---

## 4. Tests & Quantitative Metrics
- [ ] **Binary Layout & Encryption Verification:** Confirm packed `SensorPacketEnvelope` size matches [`FUC.md`](../interface/FUC.md) (`32 + (N × 14)` bytes, or 116 bytes for N=6) and decrypts cleanly with AAD validation on Gateway `'C'`. *(Struct sizes are `static_assert`ed; decrypt tool in `tools/decrypt_packet.py`; Gateway-side check pending.)*
- [ ] **Power Consumption Profile (E3):** Measure active vs. deep-sleep current draw (`mA` / `µA`) and document estimated 18650 battery runtime inside the `4°C` fridge compartment. *(Estimate and procedure in [`POWER.md`](POWER.md); measurements pending.)*
- [ ] **Sensor Accuracy Calibration:** Log SHT31 temperature and SGP40 VOC readings against a reference thermometer inside the refrigerator.
