# Node 'F' — Power Profile & Battery Runtime (`POWER.md`)

> [!IMPORTANT]
> **Everything in section 2 is an ESTIMATE built from assumptions, not a measurement.** Rubric E3 requires measured numbers. Section 3 says how to measure them; replace the estimates with the results.

* **Related Documents:** [`README.md`](README.md) | [`ARCHITECTURE.md`](ARCHITECTURE.md) | [`GOAL.md`](GOAL.md)

---

## 1. What the firmware does each cycle

| Phase | When | Radio | Notes |
|---|---|---|---|
| Deep sleep | Most of every 5 s | Off | `esp_deep_sleep_start()`, RTC memory kept, timer + S2 (`GPIO 14`) wake |
| Sample wake | Every 5 s | Off | Boot, read SHT31 + SGP40 + LDR (about 100 to 150 ms), append to RTC buffer, back to sleep |
| BLE session | Every 6th wake (30 s), on door-open, on S2 | On | Advertise up to 5 s, connect, time sync, send; ends as soon as the Gateway disconnects |
| LED matrix readout | Only when S1 is held at wake | Off | Scroll about 4 s, then display and oscillator off |

## 2. Estimate (replace with measurements)

Inputs (each is an assumption to verify):

| Quantity | Assumed value | Source |
|---|---|---|
| Sleep current | 15 µA | `interface/FUC.md` target; a dev board with USB bridge and LEDs will draw far more |
| Sample wake: current | 50 mA | ESP32 CPU active, radio off, SGP40 heater on |
| Sample wake: duration | 0.20 s | Boot plus sensor reads, to be measured |
| BLE session: current | 100 mA | `interface/FUC.md` (80 to 120 mA) |
| BLE session: duration | 1.5 s | Assumed Gateway connects quickly; up to 5 s if it does not |
| BLE sessions | 1 per 30 s | 6 wakes x 5 s |
| Battery | 18650, 2600 mAh nominal, 80% usable | Cell datasheet; DW01A cutoff reduces usable capacity |

Average current per 30 s block (6 sample wakes + 1 BLE session):

```text
sample wakes : 6 x 0.20 s x 50 mA        =  60.0 mA·s
BLE session  : 1 x 1.5 s  x 100 mA       = 150.0 mA·s
sleep        : (30 - 1.2 - 1.5) s x 0.015 mA = 0.4 mA·s
total        : 210.4 mA·s per 30 s       = 7.0 mA average
runtime      : (2600 mAh x 0.8) / 7.0 mA = about 297 h = about 12 days
```

If the Gateway never connects, each BLE attempt costs 5 s x 100 mA = 500 mA·s, which is the worst case the 6-sample hold-off in `src/node_state.h` limits to once per 30 s.

The sample wakes dominate the budget, so the biggest savings come from shortening the awake time (for example faster boot, a lower CPU clock) or lengthening the sampling interval. Neither is changed yet.

## 3. How to measure (needed for E3)

1. Put a power profiler (or a multimeter in series with the battery supply, with a capacitor across it for the pulses) in the 3.3 V or battery line.
2. **Sleep current:** let the node reach deep sleep and read the steady current between wakes. Remove the USB cable first, since USB-powered readings include the bridge chip.
3. **Sample wake:** record current and duration of a wake that does not send (serial log lines `t=...` mark each wake).
4. **BLE session:** record a session with the Gateway present (log line `ble outcome=0`) and one with the Gateway off (outcome 2, 5 s timeout).
5. Repeat the sleep measurement with `-DFRIDGE_SGP40_HEATER_OFF` in `build_flags` to see how much the SGP40 heater costs, and compare the VOC readings of both builds.
6. Enter the results in the table below and recompute the average and runtime with the formula in section 2.
7. For battery runtime, discharge test at the measured average load, or divide usable capacity by the average current.

| Measurement | Value | Date / setup |
|---|---|---|
| Deep sleep current | _TBD_ | |
| Sample wake: current / duration | _TBD_ | |
| BLE session: current / duration | _TBD_ | |
| Average current | _TBD_ | |
| Projected runtime | _TBD_ | |
