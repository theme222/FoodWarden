# C0 camera and gateway

[Hardware diagram](../diagrams/gateway.mmd) · [Network diagram](../diagrams/network.mmd)

## Hardware and local controls

The Pi-top [4] contains a Raspberry Pi 4 and the Pi-top Hub. Its USB-C power brick feeds the board. The 720p Logitech webcam connects over USB-A and appears as `/dev/video0`. The 5-inch 800 × 480 LCD receives HDMI video from the Micro-HDMI port and 5 V from USB-A to Micro-USB. The Hub handles Up, Down, O and X. O starts or confirms check-in, X starts check-out or backs out, and Up and Down change the selection. The camera branch also documents a built-in OLED diagnostics screen.

The digital PIR on GPIO 22 wakes the display and webcam on motion. The ten-minute idle rule lets them sleep again. The camera branch describes PyQt6 and Python 3.11, and its code defaults to `yolo26n.pt`. The drawing lists PyQt5 and YOLOv8n. The branch-local project summary names YOLO11n. Record the weights actually loaded on the device when measuring inference.

## Data and safety paths

- BLE GATT receives and decrypts fridge samples, verifies the authentication tag and supplies clock sync. See [FUC](../../interface/FUC.md).
- Mosquitto on the Pi-top serves MQTT over TLS port 8883. It sends close and abort commands and receives acknowledgements, 1 Hz readings and retained connection status from D0. See [CBD](../../interface/CBD.md).
- Food check-in and check-out use local image cropping when detection succeeds, with the full frame as fallback. Human detection protects an active closing cycle. The local safety loop can operate with internet service unavailable.
- The camera branch contains a SQLite offline queue and cloud client. The active server validates CBS telemetry batches under the gateway Bearer token. The camera branch payload needs reconciliation with [CBS](../../interface/CBS.md).
- [PR #5](https://github.com/theme222/FoodWarden/pull/5) adds C0, F0 and D0 contact reports every 60 seconds. The server receiver is implemented. Gateway-side collection and dispatch need verification against the Pi software before treating the dashboard timestamps as field observations.

[Local architecture](../../camera/ARCHITECTURE.md) · [Camera implementation architecture](https://github.com/theme222/FoodWarden/blob/476aba0/camera/ARCHITECTURE.md)
