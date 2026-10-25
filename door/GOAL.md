# Node 'D' (Door Closer Actuator) — Completion Checklist (`GOAL.md`)

> [!IMPORTANT]
> **Incremental Development Guideline:**
> This file is a master checklist of features, use cases, tests, and edge-case handlers strictly required before the **Door Closer Actuator (`door/`)** subsystem is considered finished.
> **This checklist does NOT need to be completed in a single prompt.** Developers and AI agents are expected to implement and verify these components incrementally across multiple steps.

* **Related Documents:** [`README.md`](README.md) | [`ARCHITECTURE.md`](ARCHITECTURE.md)

---

## 1. Core Features
- [ ] **FreeRTOS Multi-Task Architecture (E1):** Implement discrete prioritized tasks (`vMotorControlTask`, `vCurrentMonitorTask`, `vMqttCommTask`) communicating via queues, semaphores, or direct task notifications.
- [ ] **Interrupt-Driven Safety Inputs (E2):** Configure `IRAM_ATTR` hardware ISRs for the Home Limit Switch (`GPIO 33`) and Emergency Stop Button (`S1` / `GPIO 16`) with deferred task notification (`vTaskNotifyGiveFromISR`).
- [ ] **TB6612FNG Worm Gear Motor Control:** Drive JGY-370 12V worm gear motor via `PWMA` (`GPIO 26`), `AIN1` (`GPIO 27`), and `AIN2` (`GPIO 25`) with soft-start PWM ramping and active short-braking.
- [ ] **INA219 Stall & Obstruction Cutoff:** Continuously sample motor current (`I2C1`: `GPIO 21/22`, `0x40`) at `≥ 50 Hz` while moving and trigger immediate motor reversal/retraction when current exceeds the obstruction threshold.
- [ ] **Close-Range IR Door Shut Detection:** Monitor the digital IR obstacle sensor (`GPIO 32`) to detect full door closure, stop forward push, retract arm to the limit switch, and report `SUCCESS`.
- [ ] **MQTT over TLS Client ([`CBD.md`](../interface/CBD.md), E4, E5):** Maintain a persistent TLS connection to Gateway `'C'` (`port 8883`), subscribe to `CLOSE_DOOR` and `ABORT` commands, and publish status/safety events.

---

## 2. Use Cases
- [ ] **Normal Automated Door Closure:** Receive `CLOSE_DOOR` command → sound audible buzzer warning → drive arm forward until IR sensor (`GPIO 32`) detects door closed → retract arm until Limit Switch (`GPIO 33`) ISR fires → publish `SUCCESS`.
- [ ] **Physical Obstruction Reflex:** While closing, user's hand or object blocks the door → INA219 current spikes above threshold → immediately brake and reverse arm back to the Home Limit Switch → publish `OBSTRUCTION_ERROR`.
- [ ] **Vision Human-Approach Software Abort:** Gateway `'C'` detects a person approaching via YOLO and sends `ABORT` over MQTTS → Node `'D'` immediately halts forward push, retracts arm to the Home Limit Switch, and acknowledges abort.

---

## 3. Edge Cases & Failure Mode Handlers
- [ ] **Power Interruption / Reboot Recovery:** On boot, if the Limit Switch (`GPIO 33`) is not depressed, automatically enter `HOMING_ON_BOOT` state and slowly retract the arm until the Limit Switch trips (or timeout) so the arm never blocks the fridge door after a power outage.
- [ ] **Hard Motion Timeout Fail-Safe:** Enforce a strict maximum duration (e.g. `8 seconds`) for any forward closing or reverse retracting motion; if neither the IR sensor nor the Limit Switch trips before timeout, cut motor power immediately and enter `FAULT_LOCKOUT`.
- [ ] **Wi-Fi / MQTTS Disconnection During Motion:** Local hardware safety loops (INA219 stall detection, Limit Switch ISR, IR sensor, motion timeout) must execute independently on high-priority FreeRTOS tasks even if Wi-Fi or MQTTS drops mid-swing.
- [ ] **Unplugged INA219 Sensor Defense:** Verify INA219 I2C connectivity before starting motor movement; refuse to drive the motor forward (`FAULT_LOCKOUT`) if the current sensor is unresponsive on `I2C1`.

---

## 4. Tests & Quantitative Metrics
- [ ] **Obstruction Cutoff Response Time:** Measure latency (`ms`) from physical stall/current spike to motor reversal and verify safe mechanical force.
- [ ] **Limit Switch ISR Latency:** Verify immediate motor stop when `GPIO 33` trips with zero mechanical overrun.
- [ ] **End-to-End Actuation Latency:** Measure elapsed time from Gateway `'C'` publishing `CLOSE_DOOR` to motor start and `SUCCESS` confirmation.
