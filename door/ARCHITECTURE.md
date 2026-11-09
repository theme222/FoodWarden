# Node 'D' (Door Closer Actuator) — Hardware & Software Architecture

This document specifies the hardware pinouts, power isolation architecture, actuator control lines, and firmware stack for **Node `'D'`** (`door/`), the external motorized door-closing safety node mounted on top of the refrigerator.

* **Related Documents:**
  * [`README.md`](README.md) — Setup, build, flash, and test commands
  * [`GOAL.md`](GOAL.md) — Safety fail-safes, feature, and edge-case checklist
  * [`SUMMARY.md`](../SUMMARY.md) — System-wide architecture
  * **Interface:** [`CBD.md`](../interface/CBD.md) (Camera ↔ Door MQTT over TLS)

---

## 1. Hardware Architecture & Exact Pin Numbers

### A. Microcontroller & Dual-Rail Power Architecture
* **Board:** **KidBright32 V1.3** (powered by **ESP32-WROOM-32**, Dual-Core Xtensa 32-bit LX6 @ 240 MHz, 520 KB SRAM, 4 MB Flash).
* **12V DC Wall Power Input:**
  * `12V (+)` → **LM2596 Buck Converter `IN+`** **AND** **INA219 `VIN+`** *(22 AWG wire)*
  * `GND (-)` → **LM2596 Buck Converter `IN-`** *(Common Ground star point, 22 AWG wire)*
* **5V Regulated Microcontroller Power:**
  * **LM2596 `OUT+`** (tuned to `5.0V`) → Micro-USB cable **Red wire (`+5V`)** → KidBright32 Micro-USB port
  * **LM2596 `OUT-`** → Micro-USB cable **Black wire (`GND`)** → KidBright32 Micro-USB port & Breadboard **`GND` Rail**

### B. Actuator, Driver & Sensor Pinout Table

| Component | Part Number / Model | Interface / Bus | KidBright32 V1.3 / ESP32 Exact Pin(s) | Electrical Details | Role & Safety Function |
|---|---|---|---|---|---|
| **Current Reader** | **Texas Instruments INA219** Breakout | **Option A (JST-PH KB Chain `I2C1`):**<br>`SDA1 = IO4`, `SCL1 = IO5`<br>**Option B (Vertical Header `I2C0`):**<br>`SDA0 = IO21`, `SCL0 = IO22` | • **Option A (JST):** Pin 2 (`IO4` / `SDA1`), Pin 3 (`IO5` / `SCL1`)<br>• **Option B (Vertical):** Pin 4 (`IO21` / `SDA0`), Pin 3 (`IO22` / `SCL0`)<br>• `VCC` = Breadboard **`3.3V` Rail**<br>• `GND` = Breadboard **`GND` Rail** | • I2C Addr: **`0x40`**<br>• Shunt (`0.1 Ω`): `VIN+` to `12V (+)`, `VIN-` to `TB6612FNG VM` | High-side DC current monitor sampling motor draw at `≥ 50 Hz` to detect physical obstructions/stalls and trigger immediate retraction. |
| **Motor Driver** | **Toshiba TB6612FNG** Dual H-Bridge | Digital GPIO + Hardware `LEDC` PWM | • `PWMA` = **`IO26`** (Bottom Header Pin 7 / Screw Terminal `OUT2`)<br>• `AIN1` = **`IO27`** (Bottom Header Pin 6 / Screw Terminal `OUT1`)<br>• `AIN2` = **`IO18`** (Vertical Header Pin 5)<br>• `STBY` = Breadboard **`3.3V` Rail** (Pulled permanently `HIGH`) | • `VCC` = Breadboard **`3.3V` Rail**<br>• `GND` & `PGND` = Breadboard **`GND` Rail** *(22 AWG for `PGND`)*<br>• `VM` = **`12V`** (from `INA219 VIN-`, *22 AWG*)<br>• `AO1`, `AO2` = Motor tabs 1 & 2 *(22 AWG)* | Controls speed (`PWMA`) and direction (`AIN1`/`AIN2`):<br>• **Clockwise (CW)** = Closing action (forward push)<br>• **Counter-Clockwise (CCW)** = Retraction action<br>• Active short-brake on stop/abort. |
| **Worm Gear Motor** | **JGY-370 12V DC Worm Gear Motor** (`18 RPM`) | 2-Wire DC Motor Output (`AO1`, `AO2`) | Driven via **TB6612FNG** (`IO26`, `IO27`, `IO18`) | `12V DC` (*22 AWG* leads), high-torque self-locking worm gear | Drives the mechanical arm: **Clockwise (CW)** pushes refrigerator door shut; **Counter-Clockwise (CCW)** retracts arm to home position so users can open the door freely. |
| **Limit Switch** | Mechanical Roller Lever Microswitch (`NO`/`NC`) | Digital Input (`INPUT_PULLUP` + Hardware ISR) | **`IO33`** (Bottom Header Pin 2 / Screw Terminal `IN1`) | • `COM` = Breadboard **`GND` Rail**<br>• `NO` = **`IO33`** (`FALLING` edge trigger, internal `INPUT_PULLUP`) | Hardware fail-safe home stop: triggers an `IRAM_ATTR` ISR when the motorized arm is fully retracted. |
| **Close-Range IR Sensor** | **TCRT5000** Digital IR Obstacle Sensor | Digital Input | **`IO32`** (Bottom Header Pin 1 / Screw Terminal `IN2`) | • `VCC` = Breadboard **`3.3V` Rail**<br>• `GND` = Breadboard **`GND` Rail**<br>• `DO` = **`IO32`** | Detects when the refrigerator door has completely closed (`SUCCESS` state), immediately stopping forward motion and starting arm retraction. |
| **Onboard Peripherals** | • **16×8 LED Matrix (`HT16K33`)**<br>• **Temp Sensor (`LM73MK-1`)**<br>• **Buttons (`S1`, `S2`)**<br>• **Buzzer** | • `I2C0` (`IO21`/`IO22`): `HT16K33` (`0x70`)<br>• `I2C1` (`IO4`/`IO5`): `LM73` (`0x4D`)<br>• Digital GPIO | • `S1` = **`IO16`**<br>• `S2` = **`IO14`**<br>• Buzzer = **`IO13`**<br>• Status LEDs: `BT` (`IO17`), `WIFI` (`IO2`), `NTP` (`IO15`), `IOT` (`IO12`) | `3.3V` Onboard Logic | `S1` (`IO16`) acts as a manual hardware emergency abort ISR; buzzer (`IO13`) sounds an audible warning prior to and during door movement. |

### C. Detailed Connection & Wiring Reference

#### 1. Power Supply & Regulation Rails
* **12V DC Wall Power Input:**
  * `12V (+)` → LM2596 Buck Converter **`IN+`** **AND** INA219 **`VIN+`** *(22 AWG wire)*
  * `GND (-)` → LM2596 Buck Converter **`IN-`** *(Common Ground star point, 22 AWG wire)*
* **5V Regulated Microcontroller Power:**
  * LM2596 **`OUT+`** (tuned to `5.0V`) → Micro-USB cable **Red wire (`+5V`)** → KidBright32 Micro-USB port
  * LM2596 **`OUT-`** → Micro-USB cable **Black wire (`GND`)** → KidBright32 Micro-USB port & Breadboard **`GND` Rail**

#### 2. Motor Driver & Actuator (TB6612FNG + JGY-370 Motor)
* **High-Power Drive (`12V`):**
  * `VM` → INA219 **`VIN-`** *(Current-monitored 12V rail, 22 AWG wire)*
  * `PGND` → Breadboard **`GND` Rail** *(22 AWG wire)*
  * `AO1` → JGY-370 Motor tab 1 *(22 AWG wire)*
  * `AO2` → JGY-370 Motor tab 2 *(22 AWG wire)*
* **Logic & Control Signals (`3.3V`):**
  * `VCC` → Breadboard **`3.3V` Rail**
  * `GND` → Breadboard **`GND` Rail**
  * `STBY` → Breadboard **`3.3V` Rail** *(Pulled permanently `HIGH` to enable driver)*
  * `PWMA` → KidBright **`IO26`** *(Bottom 7-pin header pin 7 / Screw terminal `OUT2`)*
  * `AIN1` → KidBright **`IO27`** *(Bottom 7-pin header pin 6 / Screw terminal `OUT1`)*
  * `AIN2` → KidBright **`IO18`** *(Vertical 8-pin header pin 5)*
* **Rotational Direction & Actuation Semantics:**
  * **Clockwise (CW):** Drives mechanical arm forward to perform the **door closing action**.
  * **Counter-Clockwise (CCW):** Drives mechanical arm backward to perform the **retraction action** (returns to Home Limit Switch).
  * **Active Short-Brake:** Motor leads tied across H-bridge to quickly arrest mechanical inertia upon contact, stall, or abort.

#### 3. Current Sensing (INA219 Breakout)
* **Power Shunt (In-line with Motor `12V`):**
  * `VIN+` → 12V Wall Adapter `(+)`
  * `VIN-` → TB6612FNG `VM`
* **Logic & I2C Interface:**
  * `VCC` → Breadboard **`3.3V` Rail**
  * `GND` → Breadboard **`GND` Rail**
  * **Option A (Via white JST-PH KB Chain Cable — `I2C1`):**
    * `SDA` → KidBright JST pin 2 (**`IO4` / `SDA1`**)
    * `SCL` → KidBright JST pin 3 (**`IO5` / `SCL1`**)
  * **Option B (Via center Vertical Header Strip — `I2C0`):**
    * `SDA` → KidBright Vertical pin 4 (**`IO21` / `SDA0`**)
    * `SCL` → KidBright Vertical pin 3 (**`IO22` / `SCL0`**)

#### 4. Door Sensors & Limit Switches
* **TCRT5000 IR Sensor (Door Closed Detect):**
  * `VCC` → Breadboard **`3.3V` Rail**
  * `GND` → Breadboard **`GND` Rail**
  * `DO` (Digital Out) → KidBright **`IO32`** *(Bottom 7-pin header pin 1 / Screw terminal `IN2`)*
* **Roller Limit Switch (Arm Retracted / Home Stop):**
  * `COM` (Common) → Breadboard **`GND` Rail**
  * `NO` (Normally Open) → KidBright **`IO33`** *(Bottom 7-pin header pin 2 / Screw terminal `IN1`, configured with internal `INPUT_PULLUP`)*

#### 5. KidBright32 V1.3 Pin Allocation Quick Reference

| KidBright Physical Pin | GPIO Number | Function / Connected Peripheral |
|---|---|---|
| **Vertical Header Pin 2** | `3V3` | Supplies `3.3V` to Breadboard **`3.3V` Rail** |
| **Vertical Header Pin 3** | `IO22` (`SCL0`) | INA219 `SCL` *(Option B — shared with `HT16K33`)* |
| **Vertical Header Pin 4** | `IO21` (`SDA0`) | INA219 `SDA` *(Option B — shared with `HT16K33`)* |
| **Vertical Header Pin 5** | `IO18` | TB6612FNG `AIN2` (Motor Direction 2) |
| **Vertical Header Pin 8** | `GND` | Logic Ground to Breadboard **`GND` Rail** |
| **Bottom Header Pin 1** *(Screw `IN2`)* | `IO32` | TCRT5000 IR Sensor `DO` (Door Closed Detect) |
| **Bottom Header Pin 2** *(Screw `IN1`)* | `IO33` | Roller Limit Switch Signal (Home Position Detect) |
| **Bottom Header Pin 6** *(Screw `OUT1`)* | `IO27` | TB6612FNG `AIN1` (Motor Direction 1) |
| **Bottom Header Pin 7** *(Screw `OUT2`)* | `IO26` | TB6612FNG `PWMA` (Motor Speed Control) |
| **JST KB Chain Pin 2** | `IO4` (`SDA1`) | INA219 `SDA` *(Option A — shared with `LM73MK-1`)* |
| **JST KB Chain Pin 3** | `IO5` (`SCL1`) | INA219 `SCL` *(Option A — shared with `LM73MK-1`)* |

#### 6. Common Ground (Star Ground) Checklist
Verify continuity (`0 Ω`) between:
* 12V Wall Adapter `(-)` / Buck `IN-`
* Buck Converter `OUT-`
* KidBright Micro-USB Ground & Board `GND`
* TB6612FNG `GND` and `PGND`
* INA219 `GND`
* TCRT5000 `GND`
* Limit Switch `COM` terminal

```text
+-----------------------------------+
| 12V Mains Adapter & Power Rails   |
|                                   |
|   12V DC Input (+)                |
|     |                             |
|     +--> [LM2596 Buck] --(5V Micro-USB)----------+
|     |                                            |
|     v (VIN+)                                     |
|  +------------------------------+                |
|  | INA219 Current Shunt (0x40)  |                |
|  +------------------------------+                |
|     | (VIN- 12V Rail)                            |
|     v (VM)                                       |
|  +------------------------------+                |
|  | TB6612FNG Motor Driver       |                |
|  | - VCC, STBY: 3V3 Rail        |                |
|  | - GND, PGND: Common GND Rail |                |
|  | - AO1 / AO2: Motor Outputs   |                |
|  +------------------------------+                |
|         ^          |                             |
+---------|----------|-----------------------------|-------+
          |          |                             |
          |          +--> [JGY-370 Worm Gear Motor]|
          |               (12V DC, 18 RPM)         |
          |                                        v
+---------|------------------------------------------------+
|         |     KidBright32 V1.3 — Node 'D' (ESP32)        |
|         |                                                |
|         +--[PWMA: IO26, AIN1: IO27, AIN2: IO18]          |
|         <--[I2C: IO4/IO5 (I2C1) or IO21/IO22 (I2C0)]     |
|         <--[IO32: Bottom Pin 1]--(TCRT5000 IR Closed)    |
|         <--[IO33: Bottom Pin 2]--(Limit Switch Home ISR) |
+----------------------------------------------------------+
```

---

## 2. Software & Firmware Stack Architecture

| Layer | Specific Technology / Library | Details & Role |
|---|---|---|
| **Language** | **C++ (`C++17` / `gnu++17`)** | Compiled via `xtensa-esp32-elf-g++` toolchain with strict type safety. |
| **Build System** | **PlatformIO (`pio`)** | Configured in [`platformio.ini`](platformio.ini) (`platform = espressif32`, `board = esp32dev`, `framework = arduino`). |
| **RTOS Multitasking** | **FreeRTOS (ESP-IDF)** | Implements 3+ prioritized tasks (`vCurrentMonitorTask` at priority 4 for safety-critical stall monitoring, `vMotorControlTask` at priority 3, `vMqttCommTask` at priority 2) communicating exclusively via FreeRTOS queues, event groups, and direct task notifications (E1). |
| **Interrupt-Driven I/O** | **ESP32 Hardware GPIO ISRs (`IRAM_ATTR`)** | Attaches hardware interrupts on Limit Switch (`IO33`) and Emergency Stop Button (`S1` / `IO16`) using `vTaskNotifyGiveFromISR()` and `portYIELD_FROM_ISR()` for instantaneous motor cutoff without polling loops (E2). |
| **Motor Control Driver** | **ESP32 `LEDC` Hardware PWM + TB6612FNG State Machine** | Drives `PWMA` (`IO26`), `AIN1` (`IO27`), and `AIN2` (`IO18`) across states (`HOMING_ON_BOOT` [CCW retraction], `IDLE_HOME`, `CLOSING_DOOR` [CW closing], `ABORT_RETRACTING` [CCW retraction], `FAULT_LOCKOUT`) with hard motion timeouts. |
| **Current Sensing Driver** | **`Adafruit INA219`** over `I2C1` (`IO4`/`IO5`) or `I2C0` (`IO21`/`IO22`) | Continuously reads shunt current (`mA`) and bus voltage (`V`), triggering a software stall abort if current exceeds the obstruction threshold. |
| **MQTT over TLS Client** | **`WiFiClientSecure`** + **`PubSubClient`** + **`ArduinoJson`** | Connects to the local Mosquitto broker on Gateway `'C'` over TLS port `8883`. Validates the broker certificate using `MQTT_TLS_CA_CERT` and authenticates via `MQTT_USERNAME` / `MQTT_PASSWORD` from `secrets.h` to receive `CLOSE_DOOR` / `ABORT` commands, publish `CLOSING`, `SUCCESS`, `OBSTRUCTION_ERROR`, `ABORTED`, and `TIMEOUT_ERROR` events, and stream 1 Hz telemetry ([`CBD.md`](../interface/CBD.md), E4, E5). |
