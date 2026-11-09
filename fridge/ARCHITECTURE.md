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
| **Temperature & Humidity Sensor** | **Sensirion SHT31** Module (replaces the onboard LM73) | External **KB Chain `I2C1`** (`Wire1`) | • `SDA` = **`GPIO 4`**<br>• `SCL` = **`GPIO 5`**<br>• `VCC` = **`3V3`**<br>• `GND` = **`GND`** | **`0x44`** | Measures internal refrigerator compartment temperature (`centi-degrees C`, transmitted) and relative humidity (used only to compensate the SGP40, not transmitted). |
| **VOC Gas Sensor** | **Sensirion SGP40** Module | External **KB Chain `I2C1`** (`Wire1`) | • `SDA` = **`GPIO 4`**<br>• `SCL` = **`GPIO 5`**<br>• `VCC` = **`3V3`**<br>• `GND` = **`GND`** | **`0x59`** | Measures Volatile Organic Compounds (`VOC Index: 0–500`) emitted by spoiling food. Shares `I2C1` with the SHT31. |
| **LED Dot Matrix** | Onboard **16×8 Red LED Matrix** (`HT16K33` driver) | Onboard **`I2C0`** (`Wire`) | • `SDA` = **`GPIO 21`**<br>• `SCL` = **`GPIO 22`** | **`0x70`** | Displays boot calibration status, manual diagnostic readouts, and battery warnings (disabled during deep sleep). |
| **Button 1 (`S1`)** | Onboard Pushbutton `S1` | Digital Input (Active-LOW, Pull-up) | **`GPIO 16`** (not an RTC GPIO, see §6) | Digital (`LOW` when pressed) | Hardware interrupt (while awake) and once-per-wake poll to display live sensor readings on the LED dot matrix. Cannot wake the chip from deep sleep. |
| **Button 2 (`S2`)** | Onboard Pushbutton `S2` | Digital Input (Active-LOW, Pull-up) | **`GPIO 14`** (`RTC_GPIO16`) | Digital (`LOW` when pressed) | Hardware interrupt / wake trigger to force an immediate BLE GATT connection and RTC time recalibration ([`FUC.md`](../interface/FUC.md)). |
| **Status Indicators** | Onboard LEDs & Buzzer | Digital Output | • Wi-Fi LED = **`GPIO 2`**<br>• IoT LED = **`GPIO 12`**<br>• Buzzer = **`GPIO 13`** | Digital Output | Reserved for diagnostic feedback during bootup and BLE connection events. **Not driven by the current firmware.** GPIO 12 is a boot strapping pin (flash voltage) and must not be held high during reset. |

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
|   SDA: GPIO 21          SDA: GPIO 4             GPIO 36         S1: GPIO 16   |
|   SCL: GPIO 22          SCL: GPIO 5                             S2: GPIO 14   |
|         |                     |                     |               |         |
+---------|---------------------|---------------------|---------------|---------+
          |                     |                     |               |
          |                     +--> SHT31 Temp/RH    +--> LDR Light  +--> Buttons
          |                     |    (Addr: 0x44)          Sensor          (S1 / S2)
          |                     +--> SGP40 VOC
          |                          (Addr: 0x59)
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
| **Sensor Drivers** | • **`Wire` (`TwoWire`)**<br>• **`Sensirion I2C SGP40`** & **`Sensirion Gas Index Algorithm`**<br>• **`Sensirion I2C SHT3x`**<br>• **HT16K33 LED Matrix Driver** | Dual I2C controller configuration (`Wire.begin(21, 22)` for the LED Matrix; `Wire1.begin(4, 5)` for SHT31 + SGP40) with bus timeout protection to prevent I2C lockups if a sensor is unplugged. |

---

## 3. VOC Sampling & Door-Open Masking

Opening the fridge door pushes warm, humid room air over the SGP40, which causes artificial VOC Index spikes. Implemented in [`src/sensors.cpp`](src/sensors.cpp) and [`src/door_voc_filter.h`](src/door_voc_filter.h):

* **Uninterrupted polling:** every 5-second cycle the SGP40 raw signal is read and fed to the Gas Index Algorithm (configured with a 5 s sampling interval), regardless of door state, so its baseline never breaks. The SHT31 temperature and humidity are passed to the SGP40 for compensation.
* **Door detection:** LDR reading (`GPIO 36`) above `LDR_DOOR_OPEN_THRESHOLD` (placeholder `1500`, to be calibrated) means the door is open.
* **Masking:** while the door is open the transmitted `voc_index` is `VOC_NULL_SENTINEL` (`0xFFFF`) and a cooldown counter is set to 12. After the door closes the counter decrements once per sample (12 × 5 s = 60 s), still transmitting `0xFFFF`, then the real index resumes.
* **Deep sleep:** the cooldown counter and the complete Gas Index Algorithm state (`GasIndexAlgorithmParams`, about 200 bytes, see [`src/voc_algorithm.h`](src/voc_algorithm.h)) live in `RTC_DATA_ATTR` memory. Each wake is a fresh boot that processes one sample, so restoring only the baseline (`set_states()`, two floats) is not enough: it does not restore the uptime counter, every wake would restart the 45 s initial blackout, and the index would read 0 forever. The host simulation checks that one-sample-per-boot output equals a never-sleeping algorithm exactly.
* **Unit tests:** [`test/test_door_voc_filter`](test/test_door_voc_filter/test_main.cpp) (run on the board with `pio test`).

---

## 4. Source File Map & Runtime Flow

| File | Role | Host-testable |
|---|---|---|
| [`src/main.cpp`](src/main.cpp) | Cold-boot init (session salt), starts the tasks; `NodeState` lives in `RTC_DATA_ATTR` | No |
| [`src/tasks.cpp`](src/tasks.cpp) | `vSensorTask` (prio 3), `vBleGattTask` (prio 4), `vDisplayTask` (prio 2); event group + queue; button ISRs; deep-sleep entry | No |
| [`src/sensors.cpp`](src/sensors.cpp) | SHT31, SGP40 + Gas Index Algorithm, LDR; failures return sentinels | No |
| [`src/voc_algorithm.h`](src/voc_algorithm.h) | Gas Index Algorithm with its full state kept in RTC memory across deep sleep | Yes (VOC simulation) |
| [`src/door_voc_filter.h`](src/door_voc_filter.h) | Door-open detection and 12-packet VOC cooldown | Yes |
| [`src/node_state.h`](src/node_state.h) | RTC state, 6-sample buffer, counter, send / retry rules | Yes |
| [`src/telemetry_types.h`](src/telemetry_types.h) | Local mirror of the `FUC.md` structs and sentinels (sizes `static_assert`ed) | Yes |
| [`src/crypto.cpp`](src/crypto.cpp) | Packet building, AES-128-GCM with the 15-byte header as AAD | Yes (with a host AES-GCM stand-in) |
| [`src/ble_gatt.cpp`](src/ble_gatt.cpp) | NimBLE GATT server, time sync, notify/read delivery | No |
| [`src/matrix.cpp`](src/matrix.cpp), [`src/matrix_text.h`](src/matrix_text.h) | HT16K33 driver; text/font rendering and readout formatting | Text part: yes |
| [`tools/decrypt_packet.py`](tools/decrypt_packet.py) | Gateway-side decrypt and validation of a captured packet | n/a |
| [`tools/host_test/`](tools/host_test/run_host_tests.sh) | PC test runner: Unity suites, VOC simulation, packet check | n/a |

One wake cycle:

```text
timer / S2 wake -> boot -> vSensorTask: read sensors, feed VOC algorithm, apply door mask,
                   append sample to RTC buffer
                -> send? (batch of 6 ready, door just opened, or S2 held)
                     yes -> vBleGattTask: advertise <= 5 s, Gateway connects, writes time,
                            node encrypts + notifies/serves packet, Gateway disconnects
                            (node forces it after 1.5 s)
                -> wait for vDisplayTask to be idle (S1 readout finished)
                -> esp_deep_sleep_start() for the rest of the 5 s cycle
```

---

## 5. Design Decisions Not Fixed by `interface/`

These are firmware behaviours the interface documents leave open. They are internal and do not change the wire format.

* **Transport:** the `FUC.md` design (connectable GATT server, batches of 1 to 6 samples) is used. A "22-byte advertisement every 5 seconds" description appeared in a separate issue text and is **not** implemented.
* **Time sync:** when the Gateway writes a new time to `0000FFF2...`, buffered sample timestamps are shifted by the same delta, so samples taken before the first sync end up with correct Unix times. Before any sync, timestamps count from 1970.
* **Counter:** `counter` is consumed only when a connected session builds a packet, starting at 1 for each session salt.
* **No-connection retry:** if the Gateway does not connect within 5 s, the batch is kept and the next attempt waits for a whole new batch of 6 samples (oldest overwritten). A door-open event or `S2` still sends immediately. If a connection was made but the exchange failed, the batch is discarded.
* **Door-open send:** triggered by the closed-to-open edge only, not on every wake while the door stays open.
* **LDR fault:** an invalid LDR reading counts as "door closed" (no new cooldown), so a dead LDR cannot hide VOC forever.
* **`0xFFFF` for VOC** means both "sensor error" and "withheld during door-open/cooldown"; the Gateway cannot tell them apart.
* **BLE device name** is `FoodWarden-Fridge`; the documents only define the service UUID.
* **Delivery:** the packet is notified only if the Gateway subscribed **and** the negotiated MTU fits the whole packet (NimBLE would silently truncate a notification to MTU − 3 bytes); otherwise the Gateway must read `0000FFF1...` (long reads work). A read that happens before the packet is in place does not count as delivery. After delivery the node waits up to 1.5 s for the Gateway to disconnect, so a queued notification is not cut off, then disconnects itself.

---

## 6. Known Hardware Notes & Risks

* **S1 (`GPIO 16`) cannot wake the ESP32 from deep sleep.** Only RTC-capable GPIOs can (`0, 2, 4, 12-15, 25-27, 32-39`); `GPIO 16` is not one of them, so the `RTC_GPIO17` label that used to be in the pin table was incorrect. S2 (`GPIO 14`) wakes via `ext0`. S1 is handled by its interrupt while awake and polled once per wake, so a press is seen within one 5-second cycle only if it is still held.
* **LED matrix RAM mapping is unverified.** The KidBright32 wiring of the 16x8 matrix to the HT16K33 is not documented here. The default maps column `x` to RAM byte `x`; if the S1 readout looks scrambled, build with `-DMATRIX_RAM_LAYOUT=2` (see [`src/matrix.h`](src/matrix.h)).
* **SGP40 power:** the SGP40 stays in measurement mode between wakes and its heater is expected to draw milliamps continuously, far above the 15 µA deep-sleep target. Check the datasheet and measure; see [`POWER.md`](POWER.md). Building with `-DFRIDGE_SGP40_HEATER_OFF` turns the heater off after each reading (idle mode); compare power and VOC accuracy with and without it before choosing. The Gas Index Algorithm is configured for a 5 s interval and its full state is restored after each sleep (see §3).
* **LDR threshold:** `1500` is a placeholder; calibrate it inside the fridge from the `light=` serial log. Set it with `-DFRIDGE_LDR_THRESHOLD=<value>`, and add `-DFRIDGE_LDR_OPEN_IS_LOW=1` if the reading drops when the door opens (see [`src/door_voc_filter.h`](src/door_voc_filter.h)).
* **AES key:** on a cold boot the node prints a warning if `secrets.h` is missing or still holds the example key `00 01 ... 0F`.
* **Not yet verified on hardware:** I2C addresses `0x44` / `0x59`, sensor reads, BLE exchange with Gateway `'C'`, ESP32 clock continuity across deep sleep, and all power numbers.
