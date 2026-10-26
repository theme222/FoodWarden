# Node 'F' (Fridge Internal Sensor) — Hardware & Software Architecture

This document specifies the hardware pinouts, sensor bus interfaces, power architecture, and firmware stack for **Node `'F'`** (`fridge/`), the battery-powered internal environmental sensor node installed inside the refrigerator compartment.

* **Related Documents:**
  * [`README.md`](README.md) — Setup, build, flash, and test commands
  * [`GOAL.md`](GOAL.md) — Feature and edge-case checklist
  * [`SUMMARY.md`](../SUMMARY.md) — System-wide architecture
  * **Interfaces:** [`FUC.md`](../interface/FUC.md) (BLE GATT Telemetry & Time Sync)

---

## 1. Hardware Architecture & Exact Pin Numbers

### A. Microcontroller & Power
* **Board:** **KidBright32** (powered by **ESP32-WROOM-32**, Dual-Core Xtensa 32-bit LX6 @ 240 MHz, 520 KB SRAM, 4 MB Flash).
* **Enclosure:** Moisture-sealed IP65 plastic enclosure containing **silica gel desiccant packets** mounted inside the fridge near the door gasket.
* **Battery Power:**
  * **18650 Battery Pack with BMS Protection:** Wemos 18650 Battery Shield (with **DW01A** overcharge/over-discharge protection IC) supplying `5V` via Micro-USB, or `3.2V` LiFePO4 pack with 1S BMS connected directly to the `3V3` and `GND` pins.

### B. Sensor & Peripheral Pinout Table

| Component | Part Number / IC | Interface / Bus | KidBright32 / ESP32 Exact Pin(s) | I2C Address / Range | Purpose |
|---|---|---|---|---|---|
| **Light Sensor** | Onboard LDR Phototransistor | Analog ADC (`ADC1_CH0`) | **`GPIO 36`** (`SENSOR_VP` / `SVP`) | 12-bit ADC (`0–4095`) | Detects internal fridge light to determine whether the fridge door is open or closed. |
| **Temperature Sensor** | **Texas Instruments LM73** (`LM73CIMK-0`) | Onboard **`I2C0`** (`Wire`) | • `SDA` = **`GPIO 4`**<br>• `SCL` = **`GPIO 5`** | **`0x4D`** | Measures internal refrigerator compartment temperature with `±0.5°C` accuracy (`centi-degrees C`). |
| **VOC Gas Sensor** | **Sensirion SGP40** Module | External **KB Chain `I2C1`** (`Wire1`) | • `SDA` = **`GPIO 21`**<br>• `SCL` = **`GPIO 22`**<br>• `VCC` = **`3V3`**<br>• `GND` = **`GND`** | **`0x59`** | Measures Volatile Organic Compounds (`VOC Index: 0–500`) emitted by spoiling food. |
| **LED Dot Matrix** | Onboard **16×8 Red LED Matrix** (`HT16K33` driver) | Onboard **`I2C0`** (`Wire`) | • `SDA` = **`GPIO 4`**<br>• `SCL` = **`GPIO 5`** | **`0x70`** | Displays boot calibration status, manual diagnostic readouts, and battery warnings (disabled during deep sleep). |
| **Button 1 (`S1`)** | Onboard Pushbutton `S1` | Digital Input (Active-LOW, Pull-up) | **`GPIO 16`** (`RTC_GPIO17`) | Digital (`LOW` when pressed) | Hardware interrupt / wake trigger to display live sensor readings on the LED dot matrix. |
| **Button 2 (`S2`)** | Onboard Pushbutton `S2` | Digital Input (Active-LOW, Pull-up) | **`GPIO 14`** (`RTC_GPIO16`) | Digital (`LOW` when pressed) | Hardware interrupt / wake trigger to force an immediate BLE GATT connection and RTC time recalibration ([`FUC.md`](../interface/FUC.md)). |
| **Status Indicators** | Onboard LEDs & Buzzer | Digital Output | • Wi-Fi LED = **`GPIO 2`**<br>• IoT LED = **`GPIO 12`**<br>• Buzzer = **`GPIO 13`** | Digital Output | Diagnostic feedback during initial bootup and BLE connection events. |

```text
+-------------------------------------------------------------------------------+
|                  KidBright32 — Node 'F' (ESP32-WROOM-32)                      |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  |                 ESP32 Dual-Core MCU + ULP / RTC Memory                  |  |
|  +-------------------------------------------------------------------------+  |
|         |                     |                     |               |         |
|         v                     v                     v               v         |
|  [Internal I2C0]       [KB Chain I2C1]         [ADC1_CH0]      [GPIO ISRs]    |
|   SDA: GPIO 4           SDA: GPIO 21            GPIO 36         S1: GPIO 16   |
|   SCL: GPIO 5           SCL: GPIO 22                            S2: GPIO 14   |
|         |                     |                     |               |         |
+---------|---------------------|---------------------|---------------|---------+
          |                     |                     |               |
          +--> LM73 Temp        +--> SGP40 VOC        +--> LDR Light  +--> Buttons
          |    (Addr: 0x4D)          (Addr: 0x59)          Sensor          (S1 / S2)
          |
          +--> 16x8 LED Matrix
               (HT16K33: 0x70)
```

---

## 2. Software & Firmware Stack Architecture

| Layer | Specific Technology / Library | Details & Role |
|---|---|---|
| **Language** | **C++ (`C++17` / `gnu++17`)** | Compiled via `xtensa-esp32-elf-g++` toolchain with strict struct packing (`__attribute__((packed))`). |
| **Build System** | **PlatformIO (`pio`)** | Configured in [`platformio.ini`](platformio.ini) (`platform = espressif32`, `board = esp32dev`, `framework = arduino`). |
| **RTOS & Power Management** | **FreeRTOS (ESP-IDF)** + **ESP32 Deep Sleep (`esp_sleep.h`)** | Coordinates discrete FreeRTOS tasks (`vSensorTask`, `vBleGattTask`, `vDisplayTask`) via queues/semaphores, and enters cyclic deep sleep (`esp_deep_sleep_start()`) storing state in `RTC_DATA_ATTR` SRAM (E1, E3). |
| **BLE GATT Server** | **ESP32 BLE (`NimBLE-Arduino` / `BLEDevice.h`)** | Hosts GATT Telemetry Service `0000FFF0...`, allowing Gateway `'C'` to write Unix timestamps to Characteristic `0000FFF2...` and read/notify encrypted sensor telemetry on `0000FFF1...` ([`FUC.md`](../interface/FUC.md)). |
| **Application Cryptography** | **mbedTLS (`mbedtls/gcm.h`, `esp_random()`)** | Hardware-accelerated **AES-128-GCM** authenticated encryption using `AES_KEY` from `secrets.h`, generating a unique 12-byte IV and 16-byte authentication tag per packet with AAD header verification (E5). |
| **Sensor Drivers** | • **`Wire` (`TwoWire`)**<br>• **`Sensirion I2C SGP40`** & **`Sensirion Gas Index Algorithm`**<br>• **LM73 I2C Driver**<br>• **HT16K33 LED Matrix Driver** | Dual I2C controller configuration (`Wire.begin(4, 5)` for LM73 + LED Matrix; `Wire1.begin(21, 22)` for SGP40) with bus timeout protection to prevent I2C lockups if a sensor is unplugged. |
