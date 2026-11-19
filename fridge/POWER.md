# Node 'F' — Power Profile & Battery Runtime (`POWER.md`)

> [!IMPORTANT]
> **Everything in section 2 is an ESTIMATE built from assumptions, not a measurement.** Rubric E3 requires measured numbers. Section 3 says how to measure them; replace the estimates with the results.

* **Related Documents:** [`README.md`](README.md) | [`ARCHITECTURE.md`](ARCHITECTURE.md) | [`GOAL.md`](GOAL.md)

---

## 1. What the firmware does each cycle

| Phase | When | Radio | Notes |
|---|---|---|---|
| Deep sleep | Most of every 5 s | Off | `esp_deep_sleep_start()`, RTC memory kept, timer + S2 (`GPIO 14`) wake |
| Sample wake | Every 5 s | Off | Boot, read SHT31 + SGP40 + LDR (about 300 ms, including the 170 ms SGP40 heat-up), append to RTC buffer, back to sleep |
| BLE session | Every 6th wake (30 s), every wake while the door is open, on door close, on S2 | On | Advertise up to 5 s, connect, time sync, send; ends as soon as the Gateway disconnects |
| LED matrix readout | Only when S1 is held at wake | Off | Scroll about 4 s, then display and oscillator off |

## 2. Estimate (replace with measurements)

Inputs (each is an assumption to verify):

| Quantity | Assumed value | Source |
|---|---|---|
| Sleep current | 15 µA | `interface/FUC.md` target; a dev board with USB bridge and LEDs will draw far more |
| Sample wake: current | 50 mA | ESP32 CPU active, radio off, SGP40 heater on for ~0.2 s then off |
| Sample wake: duration | 0.35 s | Boot plus sensor reads, to be measured |
| BLE session: current | 100 mA | `interface/FUC.md` (80 to 120 mA) |
| BLE session: duration | 1.5 s | Assumed Gateway connects quickly; up to 5 s if it does not |
| BLE sessions | 1 per 30 s | 6 wakes x 5 s |
| Battery | 2 x 18650, 3500 mAh each, assumed in parallel = 7000 mAh, 80% usable | Cell label; DW01A cutoff reduces usable capacity. If wired in series instead, use 3500 mAh at twice the voltage (runtime then depends on the regulator) |

Average current per 30 s block (6 sample wakes + 1 BLE session):

```text
sample wakes : 6 x 0.35 s x 50 mA        = 105.0 mA·s
BLE session  : 1 x 1.5 s  x 100 mA       = 150.0 mA·s
sleep        : (30 - 2.1 - 1.5) s x 0.015 mA = 0.4 mA·s
total        : 255.4 mA·s per 30 s       = 8.5 mA average
runtime      : (7000 mAh x 0.8) / 8.5 mA = about 660 h = about 27 days
```

That is with the door closed. While the door is open every 5 s wake also runs a BLE session:

```text
door open, Gateway present : (0.35 s x 50 mA + 1.5 s x 100 mA) / 5 s = 34 mA
door open, Gateway absent  : (0.35 s x 50 mA + 5.0 s x 100 mA) / 5 s = 104 mA
```

For example, the door open 10 minutes a day (Gateway present) adds 34 mA x 10/1440 = 0.24 mA, so the average becomes about 8.7 mA and runtime about 27 days. A door left open with the Gateway down would empty the 5600 mAh usable in about 55 h.

If the Gateway never connects, each BLE attempt costs 5 s x 100 mA = 500 mA·s, which is the worst case the 6-sample hold-off in `src/node_state.h` limits to once per 30 s.

The sample wakes dominate the budget, so the biggest savings come from shortening the awake time (for example faster boot, a lower CPU clock) or lengthening the sampling interval. Neither is changed yet.

## 3. How to measure (needed for E3)

1. Put a power profiler (or a multimeter in series with the battery supply, with a capacitor across it for the pulses) in the 3.3 V or battery line.
2. **Sleep current:** let the node reach deep sleep and read the steady current between wakes. Remove the USB cable first, since USB-powered readings include the bridge chip.
3. **Sample wake:** record current and duration of a wake that does not send (serial log lines `t=...` mark each wake).
4. **BLE session:** record a session with the Gateway present (log line `ble outcome=0`) and one with the Gateway off (outcome 2, 5 s timeout).
5. The SGP40 heater is always turned off before sleep: confirm the sleep current shows no milliamp-level SGP40 draw, and check the VOC readings stay sensible.
6. Enter the results in the table below and recompute the average and runtime with the formula in section 2.
7. For battery runtime, discharge test at the measured average load, or divide usable capacity by the average current.

| Measurement | Value | Date / setup |
|---|---|---|
| Deep sleep current | _TBD_ | |
| Sample wake: current / duration | _TBD_ | |
| BLE session: current / duration | _TBD_ | |
| Average current | _TBD_ | |
| Projected runtime | _TBD_ | |
