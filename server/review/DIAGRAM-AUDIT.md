# Fridge diagram coverage

The original source is `Fridge.drawio`, Page-1, ID `40sUoAn1FXmmMzHkS7Pw`. The XML contains 125 cells, with 82 vertices, 41 edges and 2 document roots. The vertices include 29 embedded images. Hardware and service images were translated into labelled blocks. Location photos, legend samples and presentation markers are accounted for below. The converted diagrams describe the original topology. This file records design drift where the firmware or project documents differ.

## Reading order

1. [System overview](../diagrams/fridge.mmd) shows the physical subsystems, server, user and services.
2. [Network and heartbeat](../diagrams/network.mmd) separates direct BLE, LAN MQTT and internet HTTPS. The router carries LAN and internet traffic. It hosts neither the MQTT broker nor the Firebase API.
3. [Cloud components](../diagrams/cloud.mmd) separates sign-in, verified Firestore reads, gateway ingestion, food photos and planned integrations.
4. Use the [gateway](GATEWAY.md), [fridge sensor](FRIDGE-SENSOR.md), [door closer](DOOR-CLOSER.md) and [external flows](EXTERNAL-FLOWS.md) notes for each subsystem’s internal details and boundaries.

Each source has a matching rendered SVG in [diagrams](../diagrams/).

## Cross-check against the drawing

| Original element | Converted location | Details checked |
| --- | --- | --- |
| Pi-top [4], webcam, LCD and PIR | [Gateway](../diagrams/gateway.mmd) | Pi 4, USB-C power brick, 720p USB webcam at `/dev/video0`, 5-inch LCD with Micro-HDMI and USB power, four buttons, 5 V PIR on GPIO 22, ten-minute idle sleep, local vision and offline buffering. |
| Internal fridge sensor and power | [Fridge sensor](../diagrams/fridge-sensor.mmd) | KidBright32, 18650 battery and BMS, deep sleep, enclosure and desiccant, LDR on GPIO 36, LED matrix and two buttons, SHT31 for temperature and humidity, and SGP40 for VOC. |
| External door closer and power | [Door closer](../diagrams/door-closer.mmd) | 220 V adapter input, 12 V barrel jack, buck converter, separate motor supply through INA219, TB6612FNG, JGY-370 motor and rolling arm, IR closure, limit switch ISR, current cutoff, timeout and MQTT abort. |
| Physical location | Fridge sensor and door closer source notes | The source drawing places F inside the fridge door and D on top of the fridge. Main fridge measures 173 × 91 cm. IR sits in the door seam. Embedded location photos and hand-placed coordinates remain in the original draw.io. |
| Home router and link legend | [Network](../diagrams/network.mmd), hardware diagrams | BLE GATT is direct. LAN MQTT uses TLS port 8883. Gateway-to-server HTTPS carries the Bearer token. Power voltages and signal labels appear on the relevant hardware diagrams. |
| Firebase, Gemini, LINE and the phone/computer | [Cloud](../diagrams/cloud.mmd) and [Server Architecture](../ARCHITECTURE.md) | Functions, Firestore, Storage, Hosting, Google SSO, grocery classification, FEFO checkout and alert dispatch. Live telemetry, device heartbeat and manual web photos are implemented in this branch. Camera inventory inference and LINE are marked as planned. |

## Source differences to verify on the actual hardware

| Detail | Draw.io | Other repository evidence |
| --- | --- | --- |
| Camera OS, UI and vision | Bullseye, PyQt5 and YOLOv8n | The [branch camera README](../../camera/README.md) describes Bookworm, PyQt6 and YOLO11n. The camera implementation branch defaults to `yolo26n.pt`. [Camera configuration](https://github.com/theme222/FoodWarden/blob/476aba0/camera/src/foodwarden_camera/config.py) |
| Fridge temperature and I2C | SHT31 and SGP40 on GPIO 21/22 | The root summary names LM73. The fridge fixes branch uses SHT31 and SGP40 on GPIO 4/5 and the LED matrix on GPIO 21/22. [Fridge architecture](https://github.com/theme222/FoodWarden/blob/dc81386/fridge/ARCHITECTURE.md) |
| VOC while door is open | SHT31 compensation and SGP40 heater gated during sleep | The fridge fixes branch still runs the gas index algorithm, reports a missing VOC value during open and cooldown periods, and uses SHT31 compensation when available. The web chart leaves those points blank. [Issue #1](https://github.com/theme222/FoodWarden/issues/1) · [VOC filter](https://github.com/theme222/FoodWarden/blob/dc81386/fridge/src/door_voc_filter.h) |
| Door motor direction pin | AIN2 GPIO 25 | The door implementation branch documents AIN2 GPIO 18. Check its current pin table before wiring. [Door architecture](https://github.com/theme222/FoodWarden/blob/c5d4b7e/door/ARCHITECTURE.md) |
| LINE digest time | 08:00 | The open issue proposes 06:00, summarizes alerts and requests rate limits and user registration. The time remains an open server decision. [Issue #3](https://github.com/theme222/FoodWarden/issues/3) |
| Gateway component heartbeat | Not shown in the original drawing | PR #5 proposes `POST /api/status` every 60 seconds. The server receiver is present here. The camera implementation branch has no matching sender in the reviewed revision. [PR #5](https://github.com/theme222/FoodWarden/pull/5) |

Keep the original draw.io for photos and placement. Use the hardware branch pinouts for building and the external diagrams for explaining how the system communicates.
