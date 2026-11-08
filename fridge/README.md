# Node 'F': Fridge Internal Sensor (`fridge/`)

**Node `'F'`** is the ultra-low-power internal environmental sensor node for the **FoodWarden** system. Running on a battery-powered **KidBright32 (ESP32)** in **C++/FreeRTOS** inside a moisture-sealed enclosure, it wakes periodically from deep sleep to sample internal temperature and humidity (**SHT31**), volatile organic compounds from spoiling food (**SGP40**), and door-open ambient light (**LDR**). It packs and encrypts readings with **AES-128-GCM** and transfers them via BLE GATT to Gateway `'C'`, synchronizing its 64-bit Unix RTC timestamp directly over BLE with zero Wi-Fi overhead.

---

## 1. Documentation & File Index

### Local Subproject Files
* **[`ARCHITECTURE.md`](ARCHITECTURE.md):** Hardware components, exact KidBright32 GPIO/I2C pin mappings (`GPIO 4/5` LED matrix, `GPIO 21/22` SHT31 + SGP40, `GPIO 36`, `GPIO 16`, `GPIO 14`), battery protection, and C++/FreeRTOS stack.
* **[`POWER.md`](POWER.md):** Power estimate (not yet measured) and the procedure for measuring deep-sleep/active current and battery runtime.
* **[`tools/decrypt_packet.py`](tools/decrypt_packet.py):** Gateway-side decrypt and validation of a packet captured from Node F (`--selftest` to check the tool itself).
* **[`tools/host_test/`](tools/host_test/run_host_tests.sh):** PC tests that need no board (see "Host tests without hardware").
* **[`GOAL.md`](GOAL.md):** Incremental checklist of required features, use cases, edge-case handlers, and power/accuracy metrics.
* **[`platformio.ini`](platformio.ini):** PlatformIO project configuration for `esp32dev` (KidBright32).
* **[`secrets.h.example`](secrets.h.example):** Symlink to the root microcontroller secrets template ([`../secrets.h.example`](../secrets.h.example)).
* **[`src/`](src/main.cpp):** Firmware sources (entrypoint `main.cpp`); see the file map in [`ARCHITECTURE.md`](ARCHITECTURE.md) §4.
* **[`test/`](test/test_node_state/test_main.cpp):** Unity tests for the pure-logic headers.

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

### Host tests without hardware
```bash
# One-time: download libraries and install the Python decrypt dependency
pio run
pio test --without-uploading --without-testing
python -m pip install cryptography

# Run everything on the PC (Git Bash on Windows, any shell on Linux/macOS)
bash tools/host_test/run_host_tests.sh
```
This runs the Unity suites in `test/`, a simulation of the real Sensirion VOC algorithm with the door filter, and a packet check where the real `src/crypto.cpp` encrypts and Python (`cryptography`) decrypts and checks every field. On the PC, `mbedtls_gcm_*` is replaced by Windows BCrypt or OpenSSL (`tools/host_test/stub/mbedtls/gcm_host.cpp`). It needs a C++ compiler: `g++`, `clang++`, or `python -m pip install ziglang`. Set `CC`, `CXX` or `PYTHON` to choose them. The same Unity suites also run on the board with `pio test`.

#### Windows (PowerShell) notes
* **`pio` not recognized:** PlatformIO is installed but not on `PATH`. Add it once, then fully close and reopen VS Code / the terminal app (a new tab is not enough):
  ```powershell
  [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ";$env:USERPROFILE\.platformio\penv\Scripts", 'User')
  ```
  Alternatively, use **PlatformIO sidebar → Miscellaneous → PlatformIO Core CLI** in VS Code, which already has `pio` on `PATH`.
* **Use Git Bash, not `bash`:** in PowerShell, `bash` starts WSL. Run the script with Git Bash, keeping the `&`:
  ```powershell
  & "C:\Program Files\Git\bin\bash.exe" tools/host_test/run_host_tests.sh
  ```
* **No `g++`:** `python -m pip install ziglang` provides a compiler; the script finds it automatically.

### Build options (`build_flags`)
| Flag | Effect |
|---|---|
| `-DFRIDGE_LDR_THRESHOLD=<n>` | Door-open LDR threshold (default `1500`, placeholder) |
| `-DFRIDGE_LDR_OPEN_IS_LOW=1` | "Door open" means the LDR reading is **below** the threshold |
| `-DFRIDGE_SGP40_HEATER_OFF` | Turn the SGP40 heater off after each reading to save power (check accuracy) |
| `-DFRIDGE_LOG_PACKETS` | Print each encrypted packet as `packet=<hex>` |
| `-DMATRIX_RAM_LAYOUT=2` | Alternative LED matrix RAM mapping |

### Debugging the encrypted packet
```bash
# Build with packet logging, flash, and copy a "packet=<hex>" line from the monitor
pio run -e esp32dev --target upload   # add -DFRIDGE_LOG_PACKETS to build_flags first
python tools/decrypt_packet.py <hex> --key-hex <your AES_KEY as 32 hex chars>
```

### Display layout note
The LED matrix RAM mapping is unverified on real hardware. If the S1 readout looks scrambled, add `-DMATRIX_RAM_LAYOUT=2` to `build_flags` (see `src/matrix.h`).
