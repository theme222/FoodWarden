# F0 internal fridge sensor

[Hardware diagram](../diagrams/fridge-sensor.mmd) · [BLE contract](../../interface/FUC.md)

## Hardware

| Part | What it measures or does | Connection to verify |
| --- | --- | --- |
| KidBright32 / ESP32 | FreeRTOS tasks, RTC memory and deep sleep | Battery powered, no Wi-Fi in the sensor telemetry path |
| 18650 cell and BMS | Portable power | Protected pack inside a moisture-sealed enclosure with silica desiccant |
| SHT31 | Temperature and relative humidity for SGP40 compensation | I2C address `0x44`. The drawing says GPIO 21/22. The fridge fixes branch uses external `Wire1` on GPIO 4/5. |
| SGP40 | Raw gas signal feeding Sensirion's VOC index | I2C address `0x59` on the same external bus. The drawing shows MOSFET heater gating on GPIO 18. The branch includes an optional software heater-off build flag. |
| Onboard LDR | Interior light for the door observation | GPIO 36, raw ADC 0–4095 |
| HT16K33 matrix | Local readout | GPIO 21/22 and address `0x70` in the fridge fixes branch |
| S1 / S2 | On-device controls | GPIO 16 and GPIO 14. S2 can wake the ESP32. |

The draw.io photo places F0 inside the fridge door. The enclosure and bus details are design evidence. Battery runtime remains a measured-hardware requirement. The fridge branch power budget contains estimates and a measurement procedure.

## Sampling and transport

The firmware branch keeps its sampling and BLE tasks separate. When the door opens, the SGP40 algorithm keeps processing while the published VOC value is suppressed. The 12-sample cooldown is retained across deep sleep. The raw light threshold is configurable and must match the installation. [Issue #1](https://github.com/theme222/FoodWarden/issues/1) describes the false-spike scenario and sentinel.

FUC defines an authenticated 15-byte header, AES-128-GCM ciphertext, and 16-byte tag. Its 12-byte nonce is the session salt followed by the counter. The gateway verifies the tag and rejects replayed counters before decoding temperature, VOC and light. The Firebase payload uses seconds, Celsius and explicit nulls for unavailable values. The dashboard keeps missing VOC values as gaps and uses a longer freshness window for F0 because it sleeps between contacts.

[Fridge implementation architecture](https://github.com/theme222/FoodWarden/blob/dc81386/fridge/ARCHITECTURE.md) · [Power measurement plan](https://github.com/theme222/FoodWarden/blob/dc81386/fridge/POWER.md)
