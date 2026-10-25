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
* **Board:** **KidBright32** (powered by **ESP32-WROOM-32**, Dual-Core Xtensa 32-bit LX6 @ 240 MHz, 520 KB SRAM, 4 MB Flash).
* **Power Supply & Physical Isolation:**
  * **Primary Source:** `12V DC` Wall Adapter connected via a female DC barrel jack.
  * **12V High-Power Motor Rail:** `12V` → `INA219 VIN+` → `INA219 VIN-` → `TB6612FNG VM`.
  * **5V Logic Rail:** `12V` stepped down via a **Mini DC-DC Buck Converter (`LM2596` / `MP1584EN`)** regulated to `5.0V` → powers the KidBright32 via its Micro-USB port.
  * **Common Ground:** The `12V` power supply ground, Buck converter ground, TB6612FNG `GND`, INA219 `GND`, and KidBright32 `GND` share a single star-point **Common `GND`**.

### B. Actuator, Driver & Sensor Pinout Table

| Component | Part Number / Model | Interface / Bus | KidBright32 / ESP32 Exact Pin(s) | Electrical Details | Role & Safety Function |
|---|---|---|---|---|---|
| **Current Reader** | **Texas Instruments INA219** Breakout | External **KB Chain `I2C1`** (`Wire1`) | • `SDA` = **`GPIO 21`**<br>• `SCL` = **`GPIO 22`**<br>• `VCC` = **`3V3`**<br>• `GND` = **`GND`** | • I2C Addr: **`0x40`**<br>• Shunt (`0.1 Ω`): `VIN+` to `12V`, `VIN-` to `TB6612FNG VM` | High-side DC current monitor sampling motor draw at `≥ 50 Hz` to detect physical obstructions/stalls and trigger immediate retraction. |
| **Motor Driver** | **Toshiba TB6612FNG** Dual H-Bridge | Digital GPIO + Hardware `LEDC` PWM | • `PWMA` = **`GPIO 26`** (`OUT1`)<br>• `AIN1` = **`GPIO 27`** (`OUT2`)<br>• `AIN2` = **`GPIO 25`** (`USB_OUT` GPIO)<br>• `STBY` = Tied to **`3V3`** (`10 kΩ` pull-up) | • `VCC` = **`3V3`**<br>• `VM` = **`12V`** (from `INA219 VIN-`)<br>• `AO1`, `AO2` = Motor terminals | Controls speed (`PWMA`) and direction (`AIN1`/`AIN2`: forward push, reverse retract, or active short-brake). |
| **Worm Gear Motor** | **JGY-370 12V DC Worm Gear Motor** (`18 RPM`) | 2-Wire DC Motor Output (`AO1`, `AO2`) | Driven via **TB6612FNG** (`GPIO 26`, `GPIO 27`, `GPIO 25`) | `12V DC`, high-torque self-locking worm gear | Drives the mechanical arm to push the refrigerator door shut and retracts to the home position so users can open the door freely. |
| **Limit Switch** | Mechanical Roller Lever Microswitch (`NO`/`NC`) | Digital Input (`INPUT_PULLUP` + Hardware ISR) | **`GPIO 33`** (KidBright `IN2`) | Switches between **`GPIO 33`** and **`GND`** (`FALLING` edge trigger) | Hardware fail-safe home stop: triggers an `IRAM_ATTR` ISR when the motorized arm is fully retracted. |
| **Close-Range IR Sensor** | **TCRT5000** Digital IR Obstacle Sensor | Digital Input | **`GPIO 32`** (KidBright `IN1`) | • `VCC` = **`3V3`**<br>• `GND` = **`GND`**<br>• `DO` = **`GPIO 32`** | Detects when the refrigerator door has completely closed (`SUCCESS` state), immediately stopping forward motion and starting arm retraction. |
| **Onboard Peripherals** | • **16×8 LED Matrix (`HT16K33`)**<br>• **Buttons (`S1`, `S2`)**<br>• **Buzzer** | Onboard **`I2C0`** (`Wire`) & Digital GPIO | • `I2C0`: `SDA = GPIO 4`, `SCL = GPIO 5` (`0x70`)<br>• `S1` = **`GPIO 16`**<br>• `S2` = **`GPIO 14`**<br>• Buzzer = **`GPIO 13`** | `3.3V` Onboard Logic | `S1` (`GPIO 16`) acts as a manual hardware emergency abort ISR; buzzer sounds an audible warning prior to and during door movement. |

```text
+-----------------------------------+
| 12V Mains Adapter & Power Rails   |
|                                   |
|   12V DC Input                    |
|     |                             |
|     +--> [5V Buck Converter] --(5V Micro-USB)----+
|     |                                            |
|     v (VIN+)                                     |
|  +------------------------------+                |
|  | INA219 Current Shunt (0x40)  |                |
|  +------------------------------+                |
|     | (VIN- 12V Rail)                            |
|     v (VM)                                       |
|  +------------------------------+                |
|  | TB6612FNG Motor Driver       |                |
|  | - VCC: 3V3                   |                |
|  | - AO1 / AO2: Motor Outputs   |                |
|  +------------------------------+                |
|         ^          |                             |
+---------|----------|-----------------------------|-------+
          |          |                             |
          |          +--> [JGY-370 Worm Gear Motor]|
          |               (12V DC, 18 RPM)         |
          |                                        v
+---------|------------------------------------------------+
|         |        KidBright32 — Node 'D' (ESP32)          |
|         |                                                |
|         +--[PWM/Dir: GPIO 26, 27, 25]                    |
|         <--[I2C1: SDA 21, SCL 22]----(INA219 Readings)   |
|         <--[GPIO 32: Digital In]-----(IR Door Closed)    |
|         <--[GPIO 33: Hardware ISR]---(Limit Switch Home) |
+----------------------------------------------------------+
```

---

## 2. Software & Firmware Stack Architecture

| Layer | Specific Technology / Library | Details & Role |
|---|---|---|
| **Language** | **C++ (`C++17` / `gnu++17`)** | Compiled via `xtensa-esp32-elf-g++` toolchain with strict type safety. |
| **Build System** | **PlatformIO (`pio`)** | Configured in [`platformio.ini`](platformio.ini) (`platform = espressif32`, `board = esp32dev`, `framework = arduino`). |
| **RTOS Multitasking** | **FreeRTOS (ESP-IDF)** | Implements 3+ prioritized tasks (`vMotorControlTask` at priority 3, `vCurrentMonitorTask` at priority 2, `vMqttCommTask` at priority 1) communicating exclusively via FreeRTOS queues, event groups, and direct task notifications (E1). |
| **Interrupt-Driven I/O** | **ESP32 Hardware GPIO ISRs (`IRAM_ATTR`)** | Attaches hardware interrupts on Limit Switch (`GPIO 33`) and Emergency Stop Button (`S1` / `GPIO 16`) using `vTaskNotifyGiveFromISR()` and `portYIELD_FROM_ISR()` for instantaneous motor cutoff without polling loops (E2). |
| **Motor Control Driver** | **ESP32 `LEDC` Hardware PWM + TB6612FNG State Machine** | Drives `PWMA` (`GPIO 26`), `AIN1` (`GPIO 27`), and `AIN2` (`GPIO 25`) across states (`HOMING_ON_BOOT`, `IDLE_HOME`, `CLOSING_DOOR`, `ABORT_RETRACTING`, `FAULT_LOCKOUT`) with hard motion timeouts. |
| **Current Sensing Driver** | **`Adafruit INA219`** over `Wire1` (`GPIO 21`, `GPIO 22`) | Continuously reads shunt current (`mA`) and bus voltage (`V`), triggering a software stall abort if current exceeds the obstruction threshold. |
| **MQTT over TLS Client** | **`WiFiClientSecure`** + **`PubSubClient`** + **`ArduinoJson`** | Connects to the local Mosquitto broker on Gateway `'C'` over TLS port `8883` using `MQTT_TLS_CA_CERT` from `secrets.h` to receive `CLOSE_DOOR` / `ABORT` commands and publish `DOOR_OPEN`, `SUCCESS`, and `OBSTRUCTION_ERROR` events ([`CBD.md`](../interface/CBD.md), E4, E5). |
