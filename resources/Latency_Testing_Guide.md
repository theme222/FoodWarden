# FoodWarden End-to-End Latency Testing Guide

This guide provides step-by-step instructions to measure real quantitative latency data across all FoodWarden subsystems (**Node `'F'`**, **Node `'C'`**, **Node `'D'`**, and **Server `'S'`**) for **Rubric Section 5.IV (Quantitative Metrics — 4 points)**.

* **Canonical Log Contract:** [`interface/TIMING.md`](../interface/TIMING.md)
* **Collector & Statistics Script:** [`camera/deploy/measure_latency.py`](../camera/deploy/measure_latency.py)
* **Design Principle:** Every test path below requires **at most ONE ESP32 plugged into a Pi-top [4] USB port at a time**, so you never run out of USB ports while the webcam is connected.

---

## 0. One-Time Setup Before Testing

### A. Flash Updated `[TIMING]` Firmware on Nodes `'F'` and `'D'`
On your development PC (with PlatformIO):
```bash
# Flash Node 'F' (Fridge Internal Sensor)
cd fridge && pio run --target upload

# Flash Node 'D' (Door Closer Actuator) — verify door_config::DEBUG = false
cd ../door && pio run --target upload
```

### B. Launch Node `'C'` on Pi-top [4] with Timing Log Enabled
Open **Terminal 1** on the Pi-top [4] and launch the gateway with `TIMING_LOG_FILE` set so `[TIMING]` records are written to a file that `measure_latency.py` can tail:
```bash
cd ~/Code/FoodWarden/camera
TIMING_LOG_FILE=/tmp/foodwarden-c.log uv run foodwarden-camera
```
*(For **Path 3 (`door-close`)**, you can also set `DOOR_CLOSE_TIMEOUT_S=3` in `.env` or via the Pi-top Settings screen so you don't have to wait 60 seconds per trial. Restore `60` after testing.)*

### C. Find the Single USB-UART Port on Pi-top [4]
Plug in **only the one ESP32** required by the path you are about to run, then check its device path in **Terminal 2**:
```bash
ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null
```
Usually this is `/dev/ttyUSB0`. All commands below assume `/dev/ttyUSB0` (replace if yours differs).

---

## Path 1: Sensor → Gateway → Cloud (`f-to-dashboard`)

* **Rubric Category:** End-to-End Latency (`sensor → dashboard`)
* **Hardware Plugged Into Pi-top USB:** **Node `'F'` ONLY** (Node `'D'` stays unplugged / wireless)
* **What It Measures (`N = 20` trials):**
  1. `F Sensor Read` (`WAKE → SENSORS_DONE`, `~250–350 ms` including 170 ms SGP40 heat-up)
  2. `F → C (BLE + AES-GCM)` (`F.SENSORS_DONE → C.BLE_RX` on Pi-top single monotonic clock)
  3. `C → S (HTTPS + D1)` (`C.CLOUD_TELEM_START → C.CLOUD_TELEM_DONE`)
  4. `End-to-End F → C → S` (total active latency from sensor read completion to Cloudflare D1 ingest)

### Step-by-Step Procedure
1. Unplug Node `'D'` from USB (if connected). Plug **Node `'F'`** into the Pi-top [4] USB port (`/dev/ttyUSB0`).
2. Confirm Node `'C'` is running in Terminal 1 with `TIMING_LOG_FILE=/tmp/foodwarden-c.log` and `MOCK_CLOUD=false` in `camera/.env`.
3. Create an output folder and start the collector in **Terminal 2**:
   ```bash
   mkdir -p ~/latency_results
   cd ~/Code/FoodWarden/camera
   uv run python deploy/measure_latency.py f-to-dashboard \
     --serial /dev/ttyUSB0 \
     --camera-log /tmp/foodwarden-c.log \
     --trials 20 \
     --csv ~/latency_results/path1_f_to_s.csv
   ```
4. **Trigger 20 transmissions** (two options):
   * **Fast / Active Mode (recommended):** Press button **`S2`** (`GPIO 14`) on Node `'F'` once every ~10 seconds (or keep a light shining on Node `'F'`'s LDR so it sends every 5-second wake).
   * **Normal Batch Mode:** Leave Node `'F'` in the dark — it will automatically send every 30 seconds (20 trials = ~10 minutes).
5. Watch `[TRIAL 1] ... [TRIAL 20]` print in Terminal 2. At trial 20, the script automatically stops, writes `path1_f_to_s.csv`, and prints the Markdown summary table (`N`, `Mean`, `SD`, `Median`, `Min`, `Max`, `P95`).
6. *(Optional — Server `'S'` → Browser WebSocket Push):* Open the live web dashboard in Chromium on the Pi-top [4] alongside the run to confirm each reading updates live via the `FridgeRoom` Durable Object WebSocket (typically `< 50 ms` after `CLOUD_TELEM_DONE`).

---

## Path 2: AI Vision Sensor → Actuator (`vision-abort`)

* **Rubric Category:** End-to-End Latency (`sensor → actuator`, closed-loop AI — Rubric M4 + E7)
* **Hardware Plugged Into Pi-top USB:** **Node `'D'` ONLY** (Node `'F'` stays on battery / unplugged)
* **What It Measures (`N = 20` trials):**
  1. `YOLO26n Person Inference` (`yolo_ms` on Pi-top 4 CPU)
  2. `C → D MQTTS Transit` (`C.MQTT_TX_CMD(ABORT) → D.MQTT_RX(ABORT)` over Wi-Fi + TLS)
  3. `D Internal RX → Brake` (`rx_to_brake_us` measured on Node `'D'` in microseconds)
  4. `C TX → D Motor Brake` (total network + MCU reflex)
  5. `End-to-End Vision → Brake` (`YOLO inference + MQTTS + MCU motorShortBrake()`)

### Step-by-Step Procedure
1. Unplug Node `'F'` from USB. Plug **Node `'D'`** into the Pi-top [4] USB port (`/dev/ttyUSB0`) while keeping Node `'D'`'s 12V motor rail powered normally.
2. Confirm Node `'D'` connects to Wi-Fi and Mosquitto TLS (`IOT` LED lit, `D0` badge green on Pi-top UI).
3. Set `DOOR_CLOSE_TIMEOUT_S=3` in Pi-top Settings (or `.env`) so closures start quickly.
4. Start the collector in **Terminal 2**:
   ```bash
   cd ~/Code/FoodWarden/camera
   uv run python deploy/measure_latency.py vision-abort \
     --serial /dev/ttyUSB0 \
     --camera-log /tmp/foodwarden-c.log \
     --trials 20 \
     --csv ~/latency_results/path2_vision_abort.csv
   ```
5. **Execute 20 abort trials:**
   * Step out of the webcam frame and keep Node `'D'`'s IR sensor uncovered (door open).
   * Wait ~3 seconds for Node `'C'` to issue `CLOSE_DOOR` and Node `'D'` to start closing.
   * **As soon as Node `'D'` begins closing**, step/lean into the webcam frame so YOLO26n detects a person and immediately dispatches `ABORT`.
   * Wait for Node `'D'` to retract to the Home Limit Switch and wait 5 seconds (the `abort_cooldown_ok` window in `orchestrator.py`), then repeat until `[TRIAL 20]` completes.
6. Copy the printed Markdown summary table and keep `path2_vision_abort.csv`.

---

## Path 3: Door-Ajar Sensor → Gateway → Actuator (`door-close`)

* **Rubric Category:** End-to-End Latency (`sensor → actuator`, cross-node automated closure)
* **Hardware Plugged Into Pi-top USB:** **Node `'D'` ONLY** (Node `'F'` runs wirelessly on battery as normal)
* **What It Measures (`N = 20` trials):**
  1. `YOLO26n Clear Check` (`yolo_ms` before issuing `CLOSE_DOOR`)
  2. `C → D MQTTS Transit` (`C.MQTT_TX_CMD(CLOSE_DOOR) → D.MQTT_RX(CLOSE_DOOR)`)
  3. `D Internal RX → FSM` (`rx_to_fsm_us` on Node `'D'`)
  4. `C TX → D CLOSING (Buzzer)` (control latency until warning beeps start & `CLOSING` ACK is queued)
  5. `C Cmd → CLOSING ACK RTT` (round-trip MQTT confirmation back to Gateway `'C'`)
  6. `Intentional Warning Beeps` (`~720 ms` safety delay — reported separately from comm latency)
  7. `C TX → Motor CW Drive` (total time until motor physically energizes CW)

### Step-by-Step Procedure
1. Keep **Node `'D'`** plugged into `/dev/ttyUSB0` on the Pi-top [4] (Node `'F'` unplugged, running on battery).
2. Ensure `DOOR_CLOSE_TIMEOUT_S=3` in Pi-top Settings (note in your report that `3.0 s` was used for test throughput vs. `60 s` in production, and that the intentional policy countdown is separated from system latency).
3. Start the collector in **Terminal 2**:
   ```bash
   cd ~/Code/FoodWarden/camera
   uv run python deploy/measure_latency.py door-close \
     --serial /dev/ttyUSB0 \
     --camera-log /tmp/foodwarden-c.log \
     --trials 20 \
     --csv ~/latency_results/path3_door_close.csv
   ```
4. **Execute 20 closure trials:**
   * Stay out of the webcam frame.
   * Open the fridge door (or uncover Node `'D'`'s TCRT5000 IR sensor).
   * Wait ~3 seconds for Node `'C'` to dispatch `CLOSE_DOOR`, Node `'D'` to beep (`720 ms`), drive CW until IR detects closed, and retract to Home Limit Switch.
   * Once Node `'D'` returns to `IDLE`, open the door again for the next trial until `[TRIAL 20]` completes.
5. Restore `DOOR_CLOSE_TIMEOUT_S=60` in Pi-top Settings once finished.

---

## Path 4: Node `'D'` Local Hardware Safety Reflexes (`door-local`)

* **Rubric Category:** Hardware Safety Reflex Latency (`sensor → actuator`, microsecond on-MCU precision)
* **Hardware Plugged Into Pi-top USB:** **Node `'D'` ONLY** (can run on Pi-top [4] **or** your laptop; Node `'C'` does not even need to be running!)
* **What It Measures (exact `esp_timer_get_time()` `µs` on ESP32):**
  1. `Limit Switch ISR -> Brake` (`IO33` hardware ISR → `motorShortBrake()`)
  2. `S1 Emergency ISR -> Brake` (`IO16` manual stop ISR → `motorShortBrake()`)
  3. `INA219 Stall Trip -> Brake` (2nd consecutive sample `≥ 225 mA` → `motorShortBrake()`)
  4. `INA219 1st Over -> Brake` (1st over-threshold sample → `motorShortBrake()`, proving `≤ 100 ms` safety target)
  5. `IR Closed -> Gasket Seal` (verifying `~75 ms` `POST_IR_SEAL_DELAY_MS`)

### Step-by-Step Procedure
1. Plug **Node `'D'`** into `/dev/ttyUSB0` (on Pi-top [4] or laptop).
2. Start the collector with `--trials 0` (stop manually with `Ctrl+C` after collecting 20 of each reflex):
   ```bash
   cd ~/Code/FoodWarden/camera
   uv run python deploy/measure_latency.py door-local \
     --serial /dev/ttyUSB0 \
     --trials 0 \
     --csv ~/latency_results/path4_door_local.csv
   ```
3. **Collect 20 samples of each reflex** using Node `'D'`'s onboard **`S2`** (`GPIO 14`) debug close button:
   * **Obstruction Stall (`N = 20`):** Press `S2` → wait `> 1 s` (past 720 ms beeps + 150 ms inrush blanking) → gently block the moving arm until it brakes and retracts (`STALL_BRAKE` + `LIMIT_ISR_BRAKE` logged automatically!).
   * **Manual Emergency Stop (`N = 20`):** Press `S2` → once the arm is moving CW, press **`S1`** (`GPIO 16`) (`S1_ISR_BRAKE` + `LIMIT_ISR_BRAKE` logged automatically!).
   * **Normal IR Closure (`N = 20`):** Press `S2` → trigger the TCRT5000 IR sensor with a reflective target/door (`IR_RETRACT` + `LIMIT_ISR_BRAKE` logged automatically!).
4. Press `Ctrl+C` to save `path4_door_local.csv` and print the complete Markdown stats table.

---

## Path 5: Node `'F'` Wake & BLE Phase Durations (`f-power`, Bonus for E3)

* **Rubric Category:** Supports **E3 (Low Power)** by filling in the `_TBD_` phase durations in [`fridge/POWER.md`](../fridge/POWER.md).
* **Hardware Plugged Into Pi-top USB:** **Node `'F'` ONLY** (Node `'C'` running wirelessly so BLE connects normally).

### Step-by-Step Procedure
1. Plug **Node `'F'`** into `/dev/ttyUSB0` on the Pi-top [4] with Node `'C'` running.
2. Run the collector for ~30 wakes (~2.5 minutes, capturing both sample-only wakes and BLE-session wakes):
   ```bash
   cd ~/Code/FoodWarden/camera
   uv run python deploy/measure_latency.py f-power \
     --serial /dev/ttyUSB0 \
     --trials 30 \
     --csv ~/latency_results/path5_f_power.csv
   ```
3. Copy the measured `Sample-Only Wake Awake` and `BLE Wake Total Awake` durations into [`fridge/POWER.md`](../fridge/POWER.md) Section 3 to finalize your battery life calculation.

---

## Reporting Checklist (For Final Report — Rubric Section 5.IV)

To secure the full **4/4 points** on Quantitative Metrics:
* **State the exact method:** Explain that production protocol timestamps (`1 s` integer resolution) are not used; instead, intra-node hardware reflexes are timed directly on the ESP32 via `esp_timer_get_time()` (`1 µs`, IRAM-safe, unaffected by Unix RTC resyncs), and cross-node paths are timed on the Pi-top [4]'s single `CLOCK_MONOTONIC` clock via `[TIMING]` USB-UART/log correlation (`~2–4 ms` UART transit uncertainty at `115200 baud`).
* **Report variation across repeated trials (`N ≥ 20`):** Paste the Markdown summary tables (`N`, `Mean`, `SD`, `Median`, `Min`, `Max`, `P95`) generated by `measure_latency.py`.
* **Separate intentional delays from system latency:** Explicitly distinguish safety/policy timers (`5 s` deep-sleep cycle on `'F'`, `60 s` door-ajar timer on `'C'`, `720 ms` pre-motion warning beeps and `75 ms` gasket seal on `'D'`) from actual wireless/processing/actuation latency.
