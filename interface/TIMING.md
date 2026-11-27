# TIMING: Cross-Subsystem UART & Edge Latency Measurement Interface

This document defines the canonical diagnostic timing log format emitted by **Node `'F'`** (Fridge Sensor), **Node `'D'`** (Door Closer Actuator), and **Node `'C'`** (Camera & Edge Gateway) for measuring quantitative end-to-end latency metrics (Rubric Section 5.IV).

* **Scope:** Diagnostic & benchmarking instrumentation only (does **not** alter production BLE, MQTTS, or HTTPS wire contracts in [`FUC.md`](FUC.md), [`CBD.md`](CBD.md), or [`CBS.md`](CBS.md)).
* **Transports:**
  * **Nodes `'F'` & `'D'`:** USB-UART Serial (`115200 baud`, `8N1`, `LF` `\n` line-terminated) interleaved with normal human-readable debug logs.
  * **Node `'C'`:** Python `logging` output (`INFO` level, `LF` `\n` line-terminated, written to stdout/stderr or a log file).
* **Clocking Policy:** Production protocol timestamps (`timestamp_s` / `timestamp`) have 1-second integer resolution and **must not** be subtracted for millisecond latency. Instead:
  * **Intra-node intervals** use each node's local microsecond monotonic clock (`t_us` / `delta_us`).
  * **Cross-node end-to-end intervals** use a **single host monotonic clock** on the Pi-top [4] collector script (`time.perf_counter_ns() // 1000`) stamping lines as they arrive, avoiding cross-device clock skew.

---

## 1. Line Grammar & Parsing Rules

Every timing record is a single ASCII line containing the exact tag **`[TIMING]`** followed by whitespace-separated `key=value` fields:

```text
[TIMING] node=<NODE_ID> evt=<EVENT_NAME> t_us=<UINT64> [key=value ...]
```

### Rules
1. **Strict Tag Filtering:** Parsers must **ignore** any line that does not contain `[TIMING] ` (such as normal `[FSM]`, `[MQTTS]`, `t=...`, or Python `INFO` debug lines). On Node `'C'`, Python's logger prefix may precede `[TIMING] `; parsers match from `[TIMING] ` onward.
2. **Mandatory Fields (in order):**
   * `node` (`string`): 2-character Node ID matching [`README.md`](README.md) (`F0`, `D0`, `C0`, etc.).
   * `evt` (`string`): Canonical uppercase `SNAKE_CASE` event identifier from Section 2.
   * `t_us` (`uint64`): Local monotonic timestamp in microseconds at the moment the event occurred:
     * ESP32 (`F`, `D`): `(uint64_t)esp_timer_get_time()` (64-bit, `1 µs` resolution, IRAM-safe for ISRs).
     * Raspberry Pi 4 (`C`): `time.perf_counter_ns() // 1000`.
3. **Optional `key=value` Fields:**
   * Keys are lowercase `snake_case` (`[a-z0-9_]+`).
   * Values contain **no whitespace** (`[^\s]+`). Missing or unavailable values use `-` (or are omitted if optional).
   * Booleans are encoded as `0` or `1`.
   * Numeric units are always encoded in the key name (`_us`, `_ms`, `_s`, `_ma`).
4. **Single-USB-Port Operation:** Because Pi-top [4] has limited free USB ports (webcam, peripherals), every measurement mode requires **at most one** ESP32 connected over USB-UART at a time (Section 3).

---

## 2. Canonical Event Catalog

### A. Node `'F'` — Fridge Internal Sensor (`fridge/`, USB-UART 115200)

| `evt` | Emitted When | Extra Fields |
|---|---|---|
| `WAKE` | Start of `vSensorTask` after boot / deep-sleep wake | `cause=<int>` (`esp_sleep_get_wakeup_cause()`) |
| `SENSORS_DONE` | Immediately after `sensorsRead()` completes (LDR + SHT31 + SGP40) | `door=<0\|1>` `buf=<uint8>` `read_us=<uint64>` |
| `BLE_ADV_START` | Immediately before `adv->start()` (counter already incremented per attempt) | `counter=<uint32>` `buf=<uint8>` |
| `BLE_CONN` | Immediately after `EVT_CONNECTED` is received | `adv_us=<uint64>` |
| `BLE_TIME_SYNC` | Immediately after `EVT_TIME_WRITTEN` is received | `sync_us=<uint64>` |
| `BLE_TX_OK` | Immediately after `notify()` or `EVT_READ` succeeds (`SEND_OK`) | `counter=<uint32>` `samples=<uint8>` `tx_us=<uint64>` |
| `BLE_DONE` | Immediately after `bleGattRunSession()` returns | `outcome=<0\|1\|2>` `counter=<uint32>` `session_us=<uint64>` |
| `SLEEP_ENTER` | Immediately before `esp_deep_sleep_start()` | `awake_us=<uint64>` |

*Example line:*
```text
[TIMING] node=F0 evt=BLE_TX_OK t_us=1482910 counter=42 samples=1 tx_us=312450
```

---

### B. Node `'D'` — Door Closer Actuator (`door/`, USB-UART 115200)

| `evt` | Emitted When | Extra Fields |
|---|---|---|
| `MQTT_RX` | Inside `handleIncomingMqttMessage()` when a valid command arrives | `action=<CLOSE_DOOR\|ABORT>` `cmd_id=<str>` |
| `CLOSING_START` | Inside `startClosingFromCommand()` when buzzer starts & `CLOSING` ACK is enqueued | `cmd_id=<str>` `rx_to_fsm_us=<uint64>` |
| `MOTOR_CW_START` | Inside `stepActiveMotorState()` when warning beeps finish & `motorDriveCW(0)` is called | `cmd_id=<str>` `beep_us=<uint64>` |
| `ABORT_BRAKE` | Inside `beginRetraction()` right after `motorShortBrake()` on `REMOTE_ABORT` | `cmd_id=<str>` `rx_to_brake_us=<uint64>` |
| `S1_ISR_BRAKE` | Inside `beginRetraction()` right after `motorShortBrake()` on `MANUAL_BUTTON` (`S1` ISR) | `isr_to_brake_us=<uint64>` |
| `STALL_BRAKE` | Inside `beginRetraction()` right after `motorShortBrake()` on INA219 obstruction stall | `ma=<uint16>` `trip_to_brake_us=<uint64>` `first_over_to_brake_us=<uint64>` |
| `IR_SEAL_START` | Inside `stepActiveMotorState()` when IR first detects door closed | `cmd_id=<str>` |
| `IR_RETRACT` | Inside `beginRetraction()` after post-IR gasket seal (`75 ms`) | `cmd_id=<str>` `seal_us=<uint64>` |
| `LIMIT_ISR_BRAKE` | Inside `finishHomingToIdle()` right after `motorShortBrake()` triggered by Limit Switch ISR | `isr_to_brake_us=<uint64>` `reason=<str>` |
| `STROKE_SUCCESS` | Inside `finishHomingToIdle()` when `SUCCESS` event is enqueued | `cmd_id=<str>` `duration_ms=<uint32>` `peak_ma=<uint16>` |
| `MQTT_TX_EVENT` | Inside `flushOutgoingDoorEvents()` right after `mqtt.publish()` succeeds | `type=<str>` `ack_cmd_id=<str>` |

*Example lines:*
```text
[TIMING] node=D0 evt=MQTT_RX t_us=58210440 action=ABORT cmd_id=c-9b1d8f20-1a2c
[TIMING] node=D0 evt=ABORT_BRAKE t_us=58210725 cmd_id=c-9b1d8f20-1a2c rx_to_brake_us=285
[TIMING] node=D0 evt=LIMIT_ISR_BRAKE t_us=61204112 isr_to_brake_us=64 reason=FOR_SUCCESS
```

---

### C. Node `'C'` — Camera & Edge Gateway (`camera/`, Python Logger)

| `evt` | Emitted When | Extra Fields |
|---|---|---|
| `BLE_RX` | Inside `BLEReceiver.handle_raw_telemetry()` after AES-128-GCM decrypt & replay check | `src=<NODE_ID>` `counter=<uint32>` `samples=<int>` `ts_s=<int>` `salt=<hex8>` `new_session=<0\|1>` `missed_delta=<int>` `pdr_rx=<int>` `pdr_missed=<int>` `pdr_corrupt=<int>` `pdr_pct=<float>` `rssi=<int\|->` |
| `BLE_RX_ERR` | Inside `BLEReceiver.handle_raw_telemetry()` when a BLE packet fails AES-GCM decrypt or anti-replay validation | `kind=<corrupted\|replay>` `pdr_rx=<int>` `pdr_missed=<int>` `pdr_corrupt=<int>` `pdr_replay=<int>` `pdr_pct=<float>` `rssi=<int\|->` (`src`, `counter` on replay) |
| `CLOUD_TELEM_START` | Inside `CloudClient.sync_telemetry()` immediately before `POST /telemetry` | `samples=<int>` `ts_s=<int>` |
| `CLOUD_TELEM_DONE` | Inside `CloudClient.sync_telemetry()` immediately after HTTP response | `ok=<0\|1>` `http_ms=<float>` `ts_s=<int>` |
| `SAFETY_CLOSE_TX` | Inside `GatewayOrchestrator._evaluate_safety_step()` right before/after `send_close_door()` | `cmd_id=<str>` `ajar_s=<float>` `yolo_ms=<float>` |
| `SAFETY_ABORT_TX` | Inside `GatewayOrchestrator._evaluate_safety_step()` right before/after `send_abort()` | `cmd_id=<str>` `conf=<float>` `yolo_ms=<float>` |
| `MQTT_TX_CMD` | Inside `DoorMQTTClient.send_close_door()` / `send_abort()` right after `publish()` | `action=<CLOSE_DOOR\|ABORT>` `cmd_id=<str>` `dst=<NODE_ID>` |
| `MQTT_RX_EVENT` | Inside `DoorMQTTClient._handle_door_event()` upon receiving `fridge/door/event` | `src=<NODE_ID>` `type=<str>` `ack_cmd_id=<str>` |

*Example line:*
```text
[TIMING] node=C0 evt=SAFETY_ABORT_TX t_us=9120445102 cmd_id=c-9b1d8f20-1a2c conf=0.87 yolo_ms=142.3
```

---

## 3. Measurement Modes & USB Port Requirements

Each test mode isolates one end-to-end path and requires **at most 1 USB-UART port** on the Pi-top [4]:

```text
Mode             | USB Port Needed | Log Sources Correlated                       | Primary Metric
-----------------+-----------------+----------------------------------------------+-------------------------------------------
f-to-dashboard   | Node 'F' only   | Serial('F') + Log('C') + Optional WS('S')    | Sensor -> Gateway -> Cloud -> Dashboard
vision-abort     | Node 'D' only   | Log('C') + Serial('D')                       | Webcam + YOLO26n -> MQTTS ABORT -> Brake
door-close       | Node 'D' only   | Log('C') + Serial('D')                       | Door-Ajar -> MQTTS CLOSE_DOOR -> Motor
door-local       | Node 'D' only   | Serial('D') only                             | Limit ISR, S1 ISR, INA219 Stall -> Brake
f-power          | Node 'F' only   | Serial('F') only                             | Wake / Sensor / BLE phase durations (E3)
pdr              | None (0 USB)    | Log('C') only (Node 'F' wireless on battery) | Windowed BLE PDR (%) & RSSI variation
```

### Correlation Keys
* **`F → C → S` (`f-to-dashboard`):** Matched by `counter` between `F0.BLE_TX_OK` / `F0.BLE_DONE` and `C0.BLE_RX`, and by newest sample `ts_s` between `C0.BLE_RX`, `C0.CLOUD_TELEM_DONE`, and `S` WebSocket `telemetry` event.
* **`C ↔ D` (`vision-abort`, `door-close`):** Matched by `cmd_id` / `ack_cmd_id` between `C0.MQTT_TX_CMD`, `D0.MQTT_RX`, `D0.CLOSING_START` / `D0.ABORT_BRAKE` / `D0.MOTOR_CW_START`, and `C0.MQTT_RX_EVENT`.
* **`D` Local (`door-local`) & `F` Power (`f-power`):** Self-contained single-node records using `delta_us` / `*_us` fields directly from `esp_timer_get_time()`.
