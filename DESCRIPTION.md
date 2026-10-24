# SmarterFridge — Project Summary & System Architecture

## 1. Project Overview
The **SmarterFridge** upgrades a standard "dumb" refrigerator into an intelligent appliance without permanently modifying the fridge internals. It addresses food waste, inventory management, and energy efficiency through three core functions:
1. **AI Food Logging & Expiry Tracking:** Uses a camera, local instance segmentation (YOLO), and a cloud VLM (Gemini 3.5 Flash Lite) to log groceries entering/leaving the fridge and estimate expiration dates.
2. **Spoiled Food & Internal Environment Monitoring:** Uses an internal sensor node to track temperature, door-open light state, and Volatile Organic Compounds (VOCs) emitted by spoiling food.
3. **Automated Door Closing with Safety Reflexes:** Uses a motorized arm to automatically shut the fridge door if left ajar while no human is present, featuring multi-layer hardware and software obstruction aborts.

---

## 2. System Architecture & Network Topology

### Physical Controllers

1. **Camera Logger** ID: `'C'`. A network gateway that is located infront of the fridge. There are 2 devices connecting to it: A 5 inch LCD Display and a Logitech 720p USB Webcam. This device is a Pi-Top\[4\].
2. **Fridge Sensor** ID: `'F'`. A sensor node located inside of the fridge near the rubber seal. There are 3 total sensors that will be used: A temperature sensor, light sensor and SGP40 VOC Sensor. This device is a Kidbright.
3. **Door Closer** ID: `'D'`. A sensor node with a physical actuator located on top of the fridge. There are 3 total sensors that will be used: A current sensor, IR Close range sensor, and limit switch. It is connected to a motor driver that is controlling a JGY 370 Worm gear motor 18rpm. This motor will be controlling an arm that physically closes the fridge door if it is left open.

---

## 3. User & Control Flows

### A. Grocery Check-In (Adding Items)
1. The user approaches the **Pi-top \[4\] (`ID: 'C'`)** with groceries and presses the **Check-In Button**.
2. The USB webcam captures an image of the item.
3. A local **YOLO** model runs instance segmentation to mask/crop the food item, and sends the cropped image to **Gemini 2.5 Flash Lite** via HTTPS.
4. Gemini returns the **Name, Category, and Estimated Expiration Date**, which is displayed on the 8-inch LCD screen (the user can manually adjust the expiry date if needed).
5. The item is saved to **Firebase**, and the process repeats for remaining groceries.

### B. Grocery Check-Out (Removing Items)
1. The user takes an item from the fridge, heads to the **Pi-top [4]**, and presses the **Check-Out Button**.
2. The camera + AI pipeline identifies the item and queries **Firebase**:
   * **Single match:** Automatically removed from the database.
   * **Multiple matches:** Sorted on the LCD menu by earliest expiration date (FEFO) for the user to select.
   * **No match:** Displays an "Item not found" error on the LCD screen.

### C. Automated Door Closing & Safety Aborts
1. **Detection:** When the fridge door opens, the onboard LDR light sensor on **KidBright `'F'` (Fridge Sensor)** trips and notifies **Pi-top `'C'` (Gateway)** over MQTT.
2. **AI Human Check:** The Gateway monitors the webcam feed using local **YOLO** human detection. If the door remains open and **no human is in frame** for a set timeout, the Gateway sends a `CLOSE_DOOR` command over MQTT to **KidBright `'D'` (Door Closer)**.
3. **Actuation & Abort Conditions:** KidBright `'D'` drives the 12V worm gear motor to push the door shut, then retracts back to its **Limit Switch** home position. It immediately aborts and retracts to the Limit Switch if any of the following occur:
   * **Close-Range IR Sensor trips:** Door has successfully shut (sends `SUCCESS` to Gateway).
   * **INA219 Current Sensor spikes:** Physical obstruction detected against the door/arm (sends `ERROR` to Gateway $\rightarrow$ triggers **Discord Webhook** alert).
   * **YOLO detects a person entering the frame:** Gateway sends a software `ABORT` over MQTT to KidBright `'D'`.

---

## 4. Hardware Components & Brief Connection Guide

### Node `'C'`: Pi-top [4] "Camera Logger" (Gateway)
* **Pi-top [4] (Raspberry Pi 4):** Powered via official 15V USB-C PD power brick from wall outlet. Hosts local MQTT broker, local YOLO model, and UI.
* **Logitech 720p USB Webcam:** Connected via USB-A port (`USB0`/`USB1`).
* **8-inch LCD Display:** Connected via HDMI/Display port + power for local user interface.
* **Physical Navigation Buttons:** Used to trigger grocery check-in/check-out and navigate LCD menus *(plus optional external GPIO sensor/button on the Pi-top breakout header to ensure $\ge 2$ wired gateway sensors)*.

### Node `'D'`: KidBright32 "Door Closer" (Sensor & Actuator Node)
* **Power Supply:** 12V Wall Adapter $\rightarrow$ Female DC Barrel Jack. Splits into two rails (with a shared Common `GND`):
  * **12V Rail:** Feeds `VIN+` of the INA219 $\rightarrow$ `VM` of the TB6612FNG motor driver.
  * **5V Rail:** 12V stepped down via **Mini Buck Converter** to `5.0V` $\rightarrow$ powers KidBright `'D'` via Micro-USB port (cut USB cable pigtail).
* **Close-Range IR Sensor:** Connected to `3V3`, `GND`, and Digital Input `IN1` (`IO32`). Detects when the door is fully closed.
* **Limit Switch:** Connected to `GND` and Digital Input `IN2` (`IO33`, configured with hardware ISR + internal pull-up). Stops the motor arm when fully retracted.
* **INA219 Current Sensor:** Connected to the **KB Chain I2C1 connector** (`3V3`, `GND`, `SDA = IO21`, `SCL = IO22`). High-side current shunt (`VIN+` / `VIN-`) wired in series with the 12V motor power line to detect stalls/obstructions.
* **TB6612FNG Dual H-Bridge Motor Driver:**
  * Logic power `VCC` $\rightarrow$ `3V3`, Motor power `VM` $\rightarrow$ 12V (from INA219 `VIN-`), `GND` $\rightarrow$ Common `GND`, `STBY` $\rightarrow$ tied to `3V3` (via 10k$\Omega$ resistor).
  * Control pins connected to KidBright outputs: `PWMA` $\rightarrow$ `OUT1` (`IO26`), `AIN1` $\rightarrow$ `OUT2` (`IO27`), `AIN2` $\rightarrow$ `IO25` (or expansion GPIO output; avoiding input-only pins `IO34`/`IO35`).
* **JGY-370 12V Worm Gear Motor:** 2-wire DC terminals connected to `AO1` and `AO2` on the TB6612FNG.

### Node `'F'`: KidBright32 "Fridge Sensor" (Internal Sensor Node)
* **Enclosure:** Housed inside a waterproof sealed container with silica gel desiccant packets to prevent condensation inside the fridge.
* **Onboard LDR Light Sensor:** Hardwired internally to `IO36` (ADC). Detects fridge light state (door open/closed).
* **Onboard LM73 Temperature Sensor:** Hardwired internally to `I2C0` (`SDA = IO4`, `SCL = IO5`, address `0x4D`). Monitors internal fridge temperature.
* **SGP40 VOC Gas Sensor:** Connected to the external **KB Chain I2C1 connector** (`3V3`, `GND`, `SDA = IO21`, `SCL = IO22`, address `0x59`). Detects volatile organic compounds from spoiling food.
* **Battery Power System (Currently Undecided between Option B and Option C):**
  * **Option B (18650 Li-ion Battery Shield V3/V8):**
    * *Components:* 1x or 2x 3.7V 18650 Li-ion cells (3,000 mAh) inside a Wemos 18650 Battery Shield (includes built-in DW01A BMS protection IC and USB charging port).
    * *Connection:* Connects from the shield's 5V USB output port into KidBright `'F'`'s Micro-USB port.
    * *Estimated Runtime (at 4°C):* ~14.7 hrs (1 cell) / ~29.5 hrs (2 cells) always-on; ~5.5 days (1 cell) / ~11.1 days (2 cells) using ESP32 Deep Sleep.
  * **Option C (18650 LiFePO4 Direct 3.3V Rail):**
    * *Components:* 1x or 2x 3.2V 18650 LiFePO4 cells (1,600 mAh) in parallel + 1S 3.2V LiFePO4 BMS protection board + TP5000 charger module (jumper set to 3.6V LiFePO4 mode) + power slide switch.
    * *Connection:* Bypasses the 5V boost and onboard LDO entirely; BMS output `P+` (3.2V–3.3V nominal) wires via a switch directly to KidBright `'F'`'s `3V3` pin, and `P-` wires to `GND`.
    * *Estimated Runtime (at 4°C):* ~14.7 hrs (1 cell) / ~29.4 hrs (2 cells) always-on; ~10.3 days (1 cell) / ~20.7 days (2 cells) using ESP32 Deep Sleep.

---

## 5. Cloud & Software Stack
* **Gemini API (Gemini 3.5 Flash Lite):** Cloud VLM that takes cropped food images from the Pi-top [4] and returns structured JSON (`name`, `category`, `estimated_expiry_date`).
* **Firebase:** Stores raw sensor telemetry (temperature, VOC index, door events) and food inventory; hosts the public web dashboard with authentication and security rules.
* **Discord Webhook:** Notification channel triggered by Firebase/Gateway to alert users of expiring/spoiled food or an obstructed door-closing attempt.