# Node 'F' — Power Profile & Battery Runtime (`POWER.md`)

> [!IMPORTANT]
> **The currents in section 2 are measured with a multimeter (2026-11-23); the durations are still assumptions.** Section 3 says how to measure the durations; the runtime figures change once they are known.

* **Related Documents:** [`README.md`](README.md) | [`ARCHITECTURE.md`](ARCHITECTURE.md) | [`GOAL.md`](GOAL.md)

---

## 1. What the firmware does each cycle

| Phase | When | Radio | Notes |
|---|---|---|---|
| Deep sleep | Most of every 5 s | Off | `esp_deep_sleep_start()`, RTC memory kept, timer + S2 (`GPIO 14`) wake |
| Sample wake | Every 5 s | Off | Boot, read SHT31 + SGP40 + LDR (about 300 ms, including the 170 ms SGP40 heat-up), append to RTC buffer, back to sleep |
| BLE session | Every 6th wake (30 s), every wake while the door is open, on door close, on S2 | On | Advertise up to 5 s, connect, time sync, send; ends as soon as the Gateway disconnects |
| LED matrix readout | Only when S1 is held at wake | Off | Scroll about 4 s, then display and oscillator off |

## 2. Estimate from measured currents

Inputs:

| Quantity | Value | Source |
|---|---|---|
| Sleep current | 3 to 5 mA (4 mA used below) | **Measured**, multimeter. About 270x the 15 µA `interface/FUC.md` target: the dev board itself (USB bridge, regulator, LEDs), not the ESP32, sets this floor |
| Sample wake: current | 40 to 50 mA (45 mA used below) | **Measured**, multimeter |
| Sample wake: duration | 0.35 s | Assumed: boot plus sensor reads, to be measured |
| BLE session: current | 60 mA, one peak of 160 mA | **Measured**, multimeter. The 160 mA peak is brief (seen once per session) and is left out of the average |
| BLE session: duration | 1.5 s | Assumed: Gateway connects quickly; up to 5 s if it does not |
| BLE sessions | 1 per 30 s | 6 wakes x 5 s |
| Battery | 2 x 18650, 3500 mAh each, assumed in parallel = 7000 mAh, 80% usable | Cell label; DW01A cutoff reduces usable capacity. If wired in series instead, use 3500 mAh at twice the voltage (runtime then depends on the regulator) |

Average current per 30 s block (6 sample wakes + 1 BLE session):

```text
sample wakes : 6 x 0.35 s x 45 mA          =  94.5 mA·s
BLE session  : 1 x 1.5 s  x 60 mA          =  90.0 mA·s
sleep        : (30 - 2.1 - 1.5) s x 4 mA   = 105.6 mA·s
total        : 290.1 mA·s per 30 s         =   9.7 mA average
runtime      : (7000 mAh x 0.8) / 9.7 mA   = about 580 h = about 24 days
```

Over the measured ranges (sleep 3 to 5 mA, sample wake 40 to 50 mA) the average is 8.4 to 10.9 mA, so runtime is about 21 to 28 days.

That is with the door closed. While the door is open every 5 s wake also runs a BLE session:

```text
door open, Gateway present : (0.35 s x 45 mA + 1.5 s x 60 mA + 3.15 s x 4 mA) / 5 s = 24 mA
door open, Gateway absent  : (0.35 s x 45 mA + 5.0 s x 60 mA) / 5.35 s              = 59 mA
```

(With the Gateway absent the wake lasts longer than the 5 s cycle, so the node sleeps only 100 ms between wakes.)

For example, the door open 10 minutes a day (Gateway present) adds (24 - 9.7) mA x 10/1440 = 0.1 mA, so the average becomes about 9.8 mA and runtime stays about 24 days. A door left open with the Gateway down would empty the 5600 mAh usable in about 95 h.

If the Gateway never connects, each BLE attempt costs 5 s x 60 mA = 300 mA·s; the 6-sample hold-off in `src/node_state.h` limits that to once per 30 s, giving about 16 mA average (about 14 days).

Sleep, sample wakes and BLE now cost about the same per 30 s block, with sleep the largest share (about 36%). Because the 3 to 5 mA sleep floor comes from the board rather than the firmware, the biggest single saving would be a board without the always-on USB bridge and LEDs; on the firmware side, shortening the awake time or lengthening the sampling interval still helps. Neither is changed yet.

## 3. How to measure (needed for E3)

1. Put a power profiler (or a multimeter, as used for the 2026-11-23 currents, in series with the battery supply, with a capacitor across it for the pulses) in the 3.3 V or battery line.
2. **Sleep current:** let the node reach deep sleep and read the steady current between wakes. Remove the USB cable first, since USB-powered readings include the bridge chip.
3. **Sample wake:** record current and duration of a wake that does not send (serial log lines `t=...` mark each wake).
4. **BLE session:** record a session with the Gateway present (log line `ble outcome=0`) and one with the Gateway off (outcome 2, 5 s timeout).
5. The SGP40 heater is always turned off before sleep: confirm the sleep current shows no milliamp-level SGP40 draw, and check the VOC readings stay sensible.
6. Durations are still needed: a multimeter shows current but not how long each phase lasts. Time the phases with a power profiler, or from serial log timestamps (`millis()` at wake versus the `ble outcome=` line).
7. Enter the results in the table below and recompute the average and runtime with the formula in section 2.
8. For battery runtime, discharge test at the measured average load, or divide usable capacity by the average current.

| Measurement | Value | Date / setup |
|---|---|---|
| Deep sleep current | 3 to 5 mA | 2026-11-23, multimeter |
| Sample wake: current / duration | 40 to 50 mA / _TBD_ | 2026-11-23, multimeter |
| BLE session: current / duration | 60 mA, one 160 mA peak / _TBD_ | 2026-11-23, multimeter |
| Average current | about 9.7 mA (8.4 to 10.9), using assumed durations | Computed, section 2 |
| Projected runtime | about 24 days (21 to 28), using assumed durations | Computed, section 2 |
