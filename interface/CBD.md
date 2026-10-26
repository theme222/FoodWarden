# CBD: Camera ('C') ↔ Door ('D') Interface Contract

This document defines the bidirectional communication interface between the edge gateway (**Node `'C'`**, Pi-top [4] Raspberry Pi 4) and the motorized door closer actuator (**Node `'D'`**, KidBright32 ESP32).

* **Source / Broker (`'C'`):** Edge Gateway (Pi-top [4] — Python / Mosquitto Broker)
* **Destination / Actuator (`'D'`):** Door Closer Actuator (KidBright32 — C++/FreeRTOS)
* **Transport Protocol:** MQTT over TLS (`MQTTS`, Port `8883`)
* **Serialization:** JSON strings (parsed via `ArduinoJson` on Node `'D'`, `pydantic` on Node `'C'`)
* **Delivery Guarantee:** **QoS 1** (At least once) for safety commands and events; **QoS 0** for 1 Hz periodic telemetry
* **Security:** Transport Layer Security (`TLS 1.2` / `TLS 1.3`) authenticated via server certificate (`MQTT_TLS_CA_CERT`) and pre-shared credentials (`MQTT_USERNAME`, `MQTT_PASSWORD`)

---

## 1. Node Identification & Topic Topology

### A. Node ID Standard (`XN`)
Every participating device in the SmarterFridge ecosystem is uniquely identified by a compact 2-character identifier:
* **Format:** `XN`
  * `X` = Single-character node type (`'C'` for Gateway, `'D'` for Door Actuator, `'F'` for Internal Sensor)
  * `N` = Numeric instance index (`'0'`, `'1'`, `'2'`, `'3'`, ...)
* **Examples:** `D0` (Primary Door Closer), `D1` (Secondary Door Closer), `C0` (Gateway).

### B. Topic Namespace Hierarchy
Topics are organized by functional domain to allow multiple instances of the same node type without topic pollution. Node IDs are carried inside the JSON payload to eliminate topic redundancy:

| Topic Pattern | Direction | QoS | Description |
|---|---|---|---|
| `fridge/door/cmd` | `C → D` | 1 | Actuation commands (`CLOSE_DOOR`, `ABORT`) |
| `fridge/door/event` | `D → C` | 1 | Discrete actuation state changes, completions, aborts, and safety errors |
| `fridge/door/telemetry` | `D → C` | 0 | 1 Hz periodic telemetry (IR sensor, limit switch, motor current, state) |
| `fridge/door/time/req` | `D → C` | 1 | Timestamp synchronization request (on boot and every 7 days) |
| `fridge/door/time/res` | `C → D` | 1 | Timestamp synchronization response |
| `fridge/door/status` | `D → C` | 1 (Retained) | Connection lifecycle status and MQTT Last Will and Testament (LWT) |

---

## 2. Time Synchronization (`/time/...`)

Node `'D'` maintains an internal RTC for second-accurate timestamping of telemetry and events. Because Node `'D'` is mains-powered (12V) and continuously connected to local MQTTS, it synchronizes its clock:
1. **At Cold Boot:** Immediately after establishing the TLS connection to Mosquitto.
2. **Periodic Resynchronization:** Once every **7 days** (604,800 seconds) to correct internal clock drift.

### A. Request Payload (`fridge/door/time/req`)
```json
{
  "node_id": "D0"
}
```

### B. Response Payload (`fridge/door/time/res`)
```json
{
  "node_id": "D0",
  "timestamp": 1729930000
}
```

---

## 3. Command Payloads: Gateway `'C'` → Door `'D'` (`fridge/door/cmd`)

All commands must be published with **QoS 1** and include a unique `cmd_id` to enable delivery confirmation, deduplication, and rubric E4 acknowledgment tracking.

### A. `CLOSE_DOOR` Command
Dispatched by Gateway `'C'` when the door has remained open for longer than **60 seconds** and local YOLO11n vision detects no human in the camera frame.

```json
{
  "cmd_id": "c-9b1d8f20-1a2b",
  "node_id": "D0",
  "action": "CLOSE_DOOR",
  "timeout_s": 30,
  "timestamp": 1729930015
}
```

| Field | Type | Description |
|---|---|---|
| `cmd_id` | `string` | Unique command identifier (UUID or monotonic string) for E4 ACK tracking. |
| `node_id` | `string` | Target actuator identifier (`"D0"`). |
| `action` | `string` | Must be `"CLOSE_DOOR"`. |
| `timeout_s` | `integer` | Hard motion timeout in seconds (Default: `30`). If motion exceeds this duration without IR/limit switch trigger, power is cut immediately. |
| `timestamp` | `integer` | Second-accurate Unix epoch timestamp (`uint64`). |

### B. `ABORT` Command (Emergency Halt & Retract)
Dispatched by Gateway `'C'` if a human enters the camera frame while the door is actively closing, or if the user presses `X` (Cancel) on the Gateway LCD.

```json
{
  "cmd_id": "c-9b1d8f20-1a2c",
  "node_id": "D0",
  "action": "ABORT",
  "reason": "HUMAN_APPROACH",
  "timestamp": 1729930020
}
```

| Field | Type | Description |
|---|---|---|
| `cmd_id` | `string` | Unique command identifier for E4 ACK tracking. |
| `node_id` | `string` | Target actuator identifier (`"D0"`). |
| `action` | `string` | Must be `"ABORT"`. |
| `reason` | `string` | Cause of abort: `"HUMAN_APPROACH"` or `"USER_CANCEL"`. |
| `timestamp` | `integer` | Second-accurate Unix epoch timestamp (`uint64`). |

---

## 4. Event Payloads: Door `'D'` → Gateway `'C'` (`fridge/door/event`)

Published with **QoS 1** on discrete state transitions. Every event envelope contains top-level `node_id`, `ack_cmd_id` (mirroring the command `cmd_id`, or `null` if unsolicited), `timestamp`, and a structured `event` object discriminated by `event.type` containing all event-specific fields.

### Event Types & Schemas

#### 1. `CLOSING` (Command Acknowledgment)
Published the instant Node `'D'` accepts a `CLOSE_DOOR` command and initiates motor drive with warning buzzer.
```json
{
  "node_id": "D0",
  "ack_cmd_id": "c-9b1d8f20-1a2b",
  "event": {
    "type": "CLOSING"
  },
  "timestamp": 1729930016
}
```

#### 2. `SUCCESS` (Door Closed & Arm Retracted)
Published when the optical TCRT5000 IR sensor detects the door is fully shut (`GPIO 32`), and the motorized arm has fully retracted to the Home Limit Switch (`GPIO 33`).
```json
{
  "node_id": "D0",
  "ack_cmd_id": "c-9b1d8f20-1a2b",
  "event": {
    "type": "SUCCESS",
    "duration_ms": 4250,
    "peak_current_ma": 480
  },
  "timestamp": 1729930020
}
```

#### 3. `OBSTRUCTION_ERROR` (Physical Stall Cutoff)
Published when the INA219 current sensor detects motor draw exceeding the obstruction threshold (`≥ 1200 mA`). Forward drive is cut instantly, the motor reverses back to the Home Limit Switch, and the error is reported.
```json
{
  "node_id": "D0",
  "ack_cmd_id": "c-9b1d8f20-1a2b",
  "event": {
    "type": "OBSTRUCTION_ERROR",
    "stall_current_ma": 1340,
    "retracted": true
  },
  "timestamp": 1729930018
}
```

#### 4. `ABORTED` (Remote or Manual Emergency Halt)
Published when motor motion is halted and retracted to home in response to a software `ABORT` command or a manual hardware emergency button press (`S1` / `GPIO 16`).
```json
{
  "node_id": "D0",
  "ack_cmd_id": "c-9b1d8f20-1a2c",
  "event": {
    "type": "ABORTED",
    "trigger": "REMOTE_ABORT",
    "retracted": true
  },
  "timestamp": 1729930022
}
```
* `event.trigger` values: `"REMOTE_ABORT"` (vision/UI triggered via MQTTS) or `"MANUAL_BUTTON"` (physical `S1` interrupt on Node `'D'`).

#### 5. `TIMEOUT_ERROR` (Hard Motion Timeout)
Published if forward or reverse motion continues for longer than `30 seconds` without tripping the IR sensor or Limit Switch. Motor power is cut immediately.
```json
{
  "node_id": "D0",
  "ack_cmd_id": "c-9b1d8f20-1a2b",
  "event": {
    "type": "TIMEOUT_ERROR",
    "elapsed_ms": 30000
  },
  "timestamp": 1729930046
}
```

#### 6. `FAULT_LOCKOUT` (Hardware Safety Lockout)
Published on boot or runtime if a critical safety hardware check fails. The actuator refuses to move while locked out.
```json
{
  "node_id": "D0",
  "ack_cmd_id": null,
  "event": {
    "type": "FAULT_LOCKOUT",
    "reason": "INA219_I2C_UNRESPONSIVE"
  },
  "timestamp": 1729930001
}
```
* `event.reason` values: `"INA219_I2C_UNRESPONSIVE"` (INA219 current sensor failed I2C communication check) or `"BOOT_HOMING_TIMEOUT"` (boot homing retraction failed to trip the limit switch within 30 seconds).

---

## 5. Periodic 1 Hz Telemetry (`fridge/door/telemetry`)

Node `'D'` continuously publishes telemetry at **1 Hz (every 1 second)** with **QoS 0**. Gateway `'C'` monitors this stream to actively determine whether the refrigerator door is open or closed, track motor load, and verify actuator health.

```json
{
  "node_id": "D0",
  "timestamp": 1729930010,
  "ir_door_closed": false,
  "limit_switch_homed": true,
  "motor_state": "IDLE",
  "current_ma": 0
}
```

| Field | Type | Description |
|---|---|---|
| `node_id` | `string` | Actuator ID (`"D0"`). |
| `timestamp` | `integer` | Second-accurate Unix epoch timestamp (`uint64`). |
| `ir_door_closed` | `boolean` | `true` when TCRT5000 optical IR sensor detects door is closed; `false` when door is open. |
| `limit_switch_homed` | `boolean` | `true` when mechanical arm is resting against the Home Limit Switch (`GPIO 33`). |
| `motor_state` | `string` | Current actuator state: `"IDLE"`, `"CLOSING"`, `"RETRACTING"`, or `"FAULT"`. |
| `current_ma` | `integer` | Instantaneous DC motor current sampled via INA219 in milliamps. |

---

## 6. Connection Lifecycle & Last Will (`fridge/door/status`)

Published with **QoS 1** and **Retain = true**:
* **Online Announcement (on connect):**
  ```json
  {
    "node_id": "D0",
    "state": "ONLINE",
    "timestamp": 1729930001
  }
  ```
* **Last Will and Testament (LWT):** Registered with broker at connect; published automatically by Mosquitto if the TCP connection drops unexpectedly:
  ```json
  {
    "node_id": "D0",
    "state": "OFFLINE",
    "timestamp": null
  }
  ```

---

## 7. Safety Invariants & Contradiction Detection Rules

### A. Power Interruption & Boot Homing
On cold boot, Node `'D'` checks the Home Limit Switch (`GPIO 33`):
* If the limit switch is already engaged (`limit_switch_homed: true`), the actuator enters `IDLE`.
* If the limit switch is not engaged (e.g. power was interrupted mid-swing), Node `'D'` enters `HOMING` mode and slowly reverses the motor until the limit switch trips (or until the 30-second timeout expires).

### B. Wi-Fi / MQTT Link Loss Mid-Motion
If Node `'D'` loses its Wi-Fi or TLS connection while the arm is actively driving forward (`CLOSING`):
* Node `'D'` must **immediately halt forward motion and retract to the Home Limit Switch**.
* *Rationale:* Without a live connection to Gateway `'C'`, the gateway cannot deliver vision-based human-approach `ABORT` commands. Retracting immediately is the strictly fail-safe default.

### C. Contradiction Error Detection (`CONTRADICTION_ERROR`)
Gateway `'C'` evaluates door sensors across nodes:
* **Active Sensor (Fast Loop, 1 Hz):** Node `'D'`'s TCRT5000 IR sensor (`ir_door_closed`).
* **Authoritative Sensor (Passive Check, Cyclic):** Node `'F'`'s internal LDR ambient light sensor.
* **Contradiction Rule:** A `CONTRADICTION_ERROR` is flagged by Gateway `'C'` **if and only if** Node `'F'` reports elevated internal light (door open) while Node `'D'`'s IR sensor reports `ir_door_closed: true` **consistently for 3 consecutive Node `'F'` readings**.
