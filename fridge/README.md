# Node 'F': Fridge Internal Sensor (`fridge/`)

**Node `'F'`** is the ultra-low-power internal environmental sensor node for the **FoodWarden** system. Running on a battery-powered **KidBright32 (ESP32)** in **C++/FreeRTOS** inside a moisture-sealed enclosure, it wakes periodically from deep sleep to sample internal temperature (**LM73**), volatile organic compounds from spoiling food (**SGP40**), and door-open ambient light (**LDR**). It packs and encrypts readings with **AES-128-GCM** and transfers them via BLE GATT to Gateway `'C'`, synchronizing its 64-bit Unix RTC timestamp directly over BLE with zero Wi-Fi overhead.

---

## 1. Documentation & File Index

### Local Subproject Files
* **[`ARCHITECTURE.md`](ARCHITECTURE.md):** Hardware components, exact KidBright32 GPIO/I2C pin mappings (`GPIO 4/5`, `GPIO 21/22`, `GPIO 36`, `GPIO 16`, `GPIO 14`), battery protection, and C++/FreeRTOS stack.
* **[`GOAL.md`](GOAL.md):** Incremental checklist of required features, use cases, edge-case handlers, and power/accuracy metrics.
* **[`platformio.ini`](platformio.ini):** PlatformIO project configuration for `esp32dev` (KidBright32).
* **[`secrets.h.example`](secrets.h.example):** Symlink to the root microcontroller secrets template ([`../secrets.h.example`](../secrets.h.example)).
* **[`src/main.cpp`](src/main.cpp):** Firmware application entrypoint.

### System & Interface References
* **Root Documentation:** [`SUMMARY.md`](../SUMMARY.md) | [`AGENTS.md`](../AGENTS.md) | [`RUBRIC.md`](../RUBRIC.md)
* **Communication Contracts ([`interface/`](../interface/README.md)):**
  * [`FUC.md`](../interface/FUC.md) — Fridge (`'F'`) ↔ Camera (`'C'`) Encrypted BLE GATT Telemetry & Time Sync (`AES-128-GCM`)

---

## 2. Build, Flash, Format & Verification Commands (`pio`)

### Setup Secrets
```bash
# Copy secrets template and populate FRIDGE_NODE_ID and AES_KEY
cp secrets.h.example secrets.h
```

### Build & Run (Flash + Serial Monitor)
```bash
# Compile firmware
pio run

# Upload firmware to KidBright32 and open 115200 baud serial monitor
pio run --target upload && pio device monitor
```

### Static Analysis / Type & Lint Check (`pio check`)
```bash
# Run C++ static code analysis (cppcheck) and compiler type verification
pio check
```

### Format (`clang-format`)
```bash
# Format C/C++ source and header files
find src include -name "*.cpp" -o -name "*.h" | xargs -r clang-format -i
```

### Test (`pio test`)
```bash
# Run PlatformIO unit tests
pio test
```
