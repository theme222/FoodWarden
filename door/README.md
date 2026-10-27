# Node 'D': Door Closer Actuator (`door/`)

**Node `'D'`** is the external motorized door-closing and safety reflex node for the **FoodWarden** system. Running on a 12V-powered **KidBright32 (ESP32)** in **C++/FreeRTOS** mounted on top of the refrigerator, it listens for `CLOSE_DOOR` and `ABORT` commands from Gateway `'C'` over **MQTT over TLS**. It drives a **JGY-370 12V worm gear motor** via a **TB6612FNG** dual H-Bridge driver while enforcing multi-layered hardware and software fail-safes: high-frequency stall/obstruction current sensing (**INA219**), closed-door confirmation (**Close-Range IR Sensor**), home-position **Limit Switch** hardware ISR, and hard motion timeouts.

---

## 1. Documentation & File Index

### Local Subproject Files
* **[`ARCHITECTURE.md`](ARCHITECTURE.md):** Hardware components, 12V/5V isolated power rails, exact KidBright32 pinouts (`GPIO 21/22`, `GPIO 25/26/27`, `GPIO 32`, `GPIO 33`, `GPIO 16/14`), and FreeRTOS firmware stack.
* **[`GOAL.md`](GOAL.md):** Incremental checklist of required features, safety fail-safes, use cases, edge-case handlers, and tests.
* **[`platformio.ini`](platformio.ini):** PlatformIO project configuration for `esp32dev` (KidBright32).
* **[`secrets.h.example`](secrets.h.example):** Symlink to the root microcontroller secrets template ([`../secrets.h.example`](../secrets.h.example)).
* **[`src/main.cpp`](src/main.cpp):** Firmware application entrypoint.

### System & Interface References
* **Root Documentation:** [`SUMMARY.md`](../SUMMARY.md) | [`AGENTS.md`](../AGENTS.md) | [`RUBRIC.md`](../RUBRIC.md)
* **Communication Contract ([`interface/`](../interface/README.md)):**
  * [`CBD.md`](../interface/CBD.md) — Camera (`'C'`) ↔ Door (`'D'`) Bidirectional MQTTS Commands & Safety Events

---

## 2. Build, Flash, Format & Verification Commands (`pio`)

### Setup Secrets
```bash
# Copy secrets template and populate Wi-Fi and MQTTS credentials
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
