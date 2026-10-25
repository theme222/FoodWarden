# Node 'C' (Camera & Edge Gateway) — Hardware & Software Architecture

This document specifies the hardware configuration, physical interconnections, pin mappings, and software stack for **Node `'C'`** (`camera/`), the edge processor and local communication broker mounted on the front of the refrigerator.

* **Related Documents:**
  * [`README.md`](README.md) — Setup, build, and execution commands
  * [`GOAL.md`](GOAL.md) — Feature and edge-case checklist
  * [`SUMMARY.md`](../SUMMARY.md) — System-wide architecture
  * **Interfaces:** [`FUC.md`](../interface/FUC.md), [`CBF.md`](../interface/CBF.md), [`CBD.md`](../interface/CBD.md), [`CBS.md`](../interface/CBS.md)

---

## 1. Hardware Architecture & Connections

### A. Compute Module
* **Board:** **Pi-top [4]** housing a **Raspberry Pi 4 Model B** (Broadcom BCM2711, Quad-core Cortex-A72 64-bit SoC @ 1.5 GHz, 4 GB / 8 GB LPDDR4 RAM).
* **Power Supply:** Official Pi-top 15V USB-C Power Delivery (PD) wall adapter (36W). The internal battery has degraded and is effectively useless. Account for power loss as one of the edge cases.
* **Wireless Interfaces:**
  * **Bluetooth 5.0 (BLE):** Onboard Cypress CYW43455 (`hci0`) operating in passive/active BLE scanning mode to receive encrypted beacons from Node `'F'`.
  * **Wi-Fi (802.11ac Dual-Band):** Connects to local network/hotspot to host the local Mosquitto MQTTS broker (`8883`) and communicate with Server `'S'` over HTTPS.

### B. Peripherals & Pin Mappings

| Component | Model / Type | Physical Connection / Port | Internal Pin / Bus Mapping | Role |
|---|---|---|---|---|
| **4 Physical Buttons** | Pi-top [4] Built-in Case Buttons (`Up`, `Down`, `O`, `X`) | Integrated on Pi-top [4] top chassis | Interfaced via Pi-top Hub MCU (`I2C1`: `SDA = GPIO 2`, `SCL = GPIO 3`) and Hub GPIO lines:<br>• **Up (`▲`):** Hub GPIO (`pitop.miniscreen.up_button`)<br>• **Down (`▼`):** Hub GPIO (`pitop.miniscreen.down_button`)<br>• **Select (`O`):** Hub GPIO (`pitop.miniscreen.select_button`)<br>• **Cancel (`X`):** Hub GPIO (`pitop.miniscreen.cancel_button`) | One-button check-in/check-out triggers and menu navigation (`Up`/`Down` scroll, `O` confirm, `X` cancel/back). |
| **External 5-inch LCD Display** | 5-inch Capacitive/HDMI TFT LCD (`800×480`) | • **Video:** Pi-top [4] **Micro-HDMI (`HDMI0`)** → Display **Standard HDMI**<br>• **Power:** Pi-top [4] **USB-A (`5V`)** → Display **Micro-USB Power Port** | `HDMI0` framebuffer (`/dev/fb0` / X11 display `:0`) | Renders the primary **PyQt** graphical user interface for check-in/check-out and inventory visualization. |
| **USB Webcam** | **Logitech C270 HD Webcam** (`720p` @ `30 fps`) | Pi-top [4] **USB-A 2.0/3.0 Port** | V4L2 device node `/dev/video0` | Captures food items during check-in/check-out and monitors the area in front of the fridge for human presence. |
| **Built-in OLED Miniscreen** | Pi-top [4] `128×64` Monochrome OLED | Integrated on Pi-top [4] top chassis | `SPI0` (`MOSI = GPIO 10`, `SCLK = GPIO 11`, `CE0 = GPIO 8`, `DC = GPIO 17`) via `pitop-display` service | Displays system IP, MQTTS broker status, and diagnostic indicators. |

```text
+---------------------------------------------------------------------------------+
|                        Pi-top [4] (Node 'C' Gateway)                            |
|                                                                                 |
|  +---------------------------+                 +-----------------------------+  |
|  |    Pi-top Internal Hub    |                 |      Raspberry Pi 4         |  |
|  |  (I2C1: GPIO 2/3, SPI0)   |--[pitop SDK]--> | (Bullseye 64-bit / Py 3.11) |  |
|  +---------------------------+                 +-----------------------------+  |
|                ^                                      ^              |          |
|                | [Internal Bus]                       |              |          |
|  +---------------------------+                        |              |          |
|  | 4 Physical Buttons        |                        |              |          |
|  | (Up, Down, O, X)          |                        |              |          |
|  +---------------------------+                        |              |          |
|                                                       |              |          |
|  +---------------------------+                        |              |          |
|  | Bluetooth 5.0 (hci0)      |                        |              |          |
|  | Wi-Fi Interface (wlan0)   |                        |              |          |
|  +---------------------------+                        |              |          |
+-------------------------------------------------------|--------------|----------+
                                                        |              |
      +--------------------------------+                |              |
      | Logitech 720p USB Webcam       |--[USB-A /dev/video0]--+       |
      +--------------------------------+                               |
                                                                       |
      +--------------------------------+                               |
      | 5-inch LCD Display (800x480)   | <---[Micro-HDMI to HDMI]------+
      | (UI Display & Touch Frame)     | <---[USB-A to Micro-USB 5V]---+
      +--------------------------------+
```

---

## 2. Software & Tech Stack Architecture

> [!IMPORTANT]
> **Strict OS & Python Version Requirement:**
> The Pi-top [4] hardware SDK (`pitop.miniscreen` for the 4 physical buttons and onboard screen) **only works on Raspberry Pi OS (Legacy, 64-bit) Bullseye with Python 3.11**. Do not upgrade to Bookworm or Python 3.12+.

| Layer | Specific Technology / Package | Version / Constraint | Purpose |
|---|---|---|---|
| **Operating System** | **Raspberry Pi OS (Legacy, 64-bit) Bullseye** | Debian 11 (Kernel 6.1 LTS, `aarch64`) | Required base OS for `pt-device-manager` and `pitop` hardware drivers. |
| **Language & Runtime** | **Python** | **`3.11.x` (`==3.11.*`)** | Strictly pinned in [`.python-version`](.python-version) and [`pyproject.toml`](pyproject.toml) for Pi-top SDK compatibility. |
| **Project Manager** | **`uv`** | `>=0.12` | Fast dependency resolution, virtual environment management, and script execution. |
| **Object Detection AI** | **YOLOv8 Nano (`yolov8n.pt`)** via **`ultralytics`** & **`opencv-python`** | `ultralytics >=8.2`, `opencv-python >=4.10` | Runs real-time local bounding-box object detection on CPU to crop grocery items and detect `person` class during door-ajar safety checks. |
| **Graphical UI** | **PyQt (`PyQt6` / `PyQt5`)** | `PyQt6 >=6.7` (or system `python3-pyqt5`) | Renders the user-facing full-screen 5-inch LCD interface controlled via hardware button events (`Up`, `Down`, `O`, `X`) with bilingual display support. |
| **Bilingual Fonts** | **Thai OpenType/TrueType Fonts** | `fonts-thai-tlwg` / `fonts-noto-core` | Ensures proper rendering of Thai tone marks and consonants alongside English typography on the framebuffer. |
| **Hardware Buttons SDK** | **`pitop` (`pitop.miniscreen`)** | `pitop` (apt/system site-packages) | Registers interrupt-driven callbacks (`when_pressed`) for the `Up`, `Down`, `O` (Select), and `X` (Cancel) buttons. |
| **MQTT Broker (Server)** | **Eclipse Mosquitto (`mosquitto`)** | `mosquitto >=2.0` (Systemd Daemon) | Local TLS-encrypted MQTT broker (`MQTTS`, port `8883`) authenticating Node `'D'` and Node `'F'` using `MQTT_TLS_CA_CERT`. |
| **MQTT Client** | **`paho-mqtt`** | `paho-mqtt >=2.1.0` | Connects local Python gateway services to the Mosquitto broker to publish `CLOSE_DOOR` / `ABORT` ([`CBD.md`](../interface/CBD.md)) and serve RTC timestamps ([`CBF.md`](../interface/CBF.md)). |
| **Bluetooth Receiver** | **`bleak`** + **`cryptography`** | `bleak >=0.22`, `cryptography >=43.0` | Scans BLE advertisements from Node `'F'` and decrypts `AES-128-GCM` payloads using `AESGCM` ([`FUC.md`](../interface/FUC.md)). |
| **Cloud Client & Cache** | **`httpx`** + **`sqlite3`** | `httpx >=0.27` | Communicates with Firebase Cloud Functions ([`CBS.md`](../interface/CBS.md)) and buffers telemetry locally in SQLite during Internet outages (E4 store-and-forward). |
| **Code Quality Tools** | **`ruff`**, **`mypy`**, **`pytest`** | Dev dependency group | Linting, formatting, strict static type checking, and unit testing. |

---

## 3. User-Facing LCD Interface & Bilingual Display Architecture

Node `'C'` provides the direct physical human-machine interface (HMI) for the refrigerator via the mounted 5-inch LCD (`800×480`) and 4 case buttons.

### A. Bilingual Display Standard (Thai Default + English Translation)

To maximize accessibility for all household members, **every on-screen instruction, workflow guidance, button action prompt, food review summary, and safety alert is displayed in Thai by default with a secondary English translation**:

```text
+-----------------------------------------------------------------------------+
| SmarterFridge - ตรวจรับอาหารเข้าตู้ (Check-In)                 [Wi-Fi: OK]  |
+-----------------------------------------------------------------------------+
|                                                                             |
|      [ แสดงภาพสดจากกล้อง / Live Camera Feed ]                                 |
|                                                                             |
|  คำแนะนำ (Instruction):                                                     |
|  "กรุณาวางอาหารหน้ากล้องให้ชัดเจน"                                           |
|  "Please place the grocery item clearly in front of the camera"             |
|                                                                             |
|  ผลการตรวจจับ (Detected Item):                                              |
|  ชื่อ: นมสดพาสเจอร์ไรส์ / Pasteurized Whole Milk                             |
|  หมวดหมู่: นมและผลิตภัณฑ์นม (Dairy)                                         |
|  วันหมดอายุโดยประมาณ: 2026-11-04 (อีก 10 วัน / in 10 days)                  |
|                                                                             |
|  [O] ยืนยัน (Confirm)   [▲/▼] ปรับวัน (Adjust Date)   [X] ยกเลิก (Cancel)   |
|  ยืนยันอัตโนมัติใน: 5 วินาที (Auto-confirming in: 5s)                        |
+-----------------------------------------------------------------------------+
```

### B. UI Component & Typography Structure

1. **Two-Tier Text Layout:** UI labels use a two-tier presentation pattern:
   * **Primary Thai Line:** Prominent header typography (e.g. 16–18pt bold font).
   * **Secondary English Subtitle:** Clean secondary subtitle font (e.g. 12–13pt regular/italic) positioned directly below or alongside the Thai string.
2. **Font Rendering Stack:** The OS uses `fonts-thai-tlwg` / Noto Sans Thai ensuring correct glyph rendering for complex Thai vowel marks (`ิ`, `ี`, `ึ`, `ื`, `ุ`, `ู`) and tone marks (`่`, `้`, `๊`, `๋`).
3. **Hardware Button Navigation Mappings:**
   * **`O` (Select):** Confirm detected item, commit check-in, or finalize checkout selection.
   * **`X` (Cancel):** Cancel current operation, return to home idle screen, or discard captured frame.
   * **`▲` (Up) / `▼` (Down):** Scroll through FEFO checkout candidate matches or adjust estimated shelf-life days during review.

### C. Local Bilingual Data Model (`CBS.md` Client)

The local Python application parses bilingual responses returned by Server `'S'` ([`CBS.md`](../interface/CBS.md)) into structured dataclasses:

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class BilingualFoodItem:
    name_th: str                         # e.g. "นมสดพาสเจอร์ไรส์"
    name_en: str                         # e.g. "Pasteurized Whole Milk"
    category: str                        # Canonical category (e.g. "Dairy")
    category_th: str                     # Localized category (e.g. "นมและผลิตภัณฑ์นม")
    estimated_expiry_date: str           # ISO 8601 "YYYY-MM-DD"
    storage_recommendation_th: str       # e.g. "เก็บในช่องแช่เย็นหลัก"
    storage_recommendation_en: str       # e.g. "Store in main refrigerator shelf"
    confidence: float
```
