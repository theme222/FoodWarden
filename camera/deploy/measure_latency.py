#!/usr/bin/env python3
"""FoodWarden Cross-Subsystem End-to-End Latency Collector & Analyzer.

Implements the canonical [TIMING] contract defined in interface/TIMING.md.
Each subcommand isolates a single measurement path and requires AT MOST ONE
ESP32 connected to the Pi-top [4] via USB-UART at a time:

  1. f-to-dashboard : Node 'F' (USB) + Node 'C' log -> Sensor -> Gateway -> Cloud
  2. vision-abort   : Node 'C' log + Node 'D' (USB) -> YOLO26n -> MQTTS ABORT -> Brake
  3. door-close     : Node 'C' log + Node 'D' (USB) -> Door-Ajar -> CLOSE_DOOR -> Motor
  4. door-local     : Node 'D' (USB) only           -> Limit ISR, S1 ISR, INA219 Stall
  5. f-power        : Node 'F' (USB) only           -> Wake / Sensor / BLE durations (E3)

All cross-node timestamps share the Pi-top's single CLOCK_MONOTONIC clock
(time.perf_counter_ns() // 1000), avoiding cross-device clock skew and the
1-second resolution limit of production protocol timestamps.
"""

from __future__ import annotations

import argparse
import csv
import math
import os
import queue
import statistics
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

TIMING_TAG = "[TIMING]"


@dataclass(frozen=True)
class TimingRecord:
    """Single parsed [TIMING] record with host-side arrival timestamp."""

    node: str
    evt: str
    t_us: int
    host_t_us: int
    fields: dict[str, str] = field(default_factory=dict)

    def get_int(self, key: str, default: int | None = None) -> int | None:
        raw = self.fields.get(key)
        if raw is None or raw == "-":
            return default
        try:
            return int(raw)
        except ValueError:
            return default

    def get_float(self, key: str, default: float | None = None) -> float | None:
        raw = self.fields.get(key)
        if raw is None or raw == "-":
            return default
        try:
            return float(raw)
        except ValueError:
            return default


def host_monotonic_us() -> int:
    """Returns Pi-top system-wide CLOCK_MONOTONIC timestamp in microseconds."""
    return time.perf_counter_ns() // 1000


def parse_timing_line(line: str, *, host_t_us: int | None = None) -> TimingRecord | None:
    """Extracts a TimingRecord from a raw UART or Python log line.

    Returns None for any normal debug line that does not contain '[TIMING] '.
    """
    marker = f"{TIMING_TAG} "
    idx = line.find(marker)
    if idx < 0:
        return None

    body = line[idx + len(marker) :].strip()
    if not body:
        return None

    tokens = body.split()
    kv: dict[str, str] = {}
    for tok in tokens:
        if "=" not in tok:
            continue
        k, v = tok.split("=", 1)
        if k:
            kv[k] = v

    node = kv.pop("node", None)
    evt = kv.pop("evt", None)
    raw_t = kv.pop("t_us", None)
    if not node or not evt or raw_t is None:
        return None

    try:
        t_us = int(raw_t)
    except ValueError:
        return None

    arrival_us = host_monotonic_us() if host_t_us is None else int(host_t_us)
    return TimingRecord(node=node, evt=evt, t_us=t_us, host_t_us=arrival_us, fields=kv)


# ==============================================================================
# Statistics & Reporting
# ==============================================================================


@dataclass(frozen=True)
class MetricStats:
    name: str
    unit: str
    n: int
    mean: float
    sd: float
    median: float
    min_val: float
    max_val: float
    p95: float


def compute_stats(name: str, values: list[float], unit: str = "ms") -> MetricStats | None:
    if not values:
        return None
    ordered = sorted(values)
    n = len(ordered)
    mean_v = statistics.fmean(ordered)
    sd_v = statistics.stdev(ordered) if n >= 2 else 0.0
    med_v = statistics.median(ordered)
    p95_idx = min(n - 1, max(0, math.ceil(0.95 * n) - 1))
    return MetricStats(
        name=name,
        unit=unit,
        n=n,
        mean=mean_v,
        sd=sd_v,
        median=med_v,
        min_val=ordered[0],
        max_val=ordered[-1],
        p95=ordered[p95_idx],
    )


def format_markdown_summary(title: str, stats_list: list[MetricStats]) -> str:
    lines = [
        f"### {title}",
        "",
        "| Metric | Unit | N | Mean | SD | Median | Min | Max | P95 |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for s in stats_list:
        lines.append(
            f"| {s.name} | {s.unit} | {s.n} | {s.mean:.2f} | {s.sd:.2f} | "
            f"{s.median:.2f} | {s.min_val:.2f} | {s.max_val:.2f} | {s.p95:.2f} |"
        )
    return "\n".join(lines)


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames: list[str] = []
    for row in rows:
        for k in row:
            if k not in fieldnames:
                fieldnames.append(k)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


# ==============================================================================
# Per-Mode Trial Correlators (Pure State Machines for Live & Unit Testing)
# ==============================================================================


class FToDashboardCorrelator:
    """Path 1: Node 'F' (USB) + Node 'C' log -> Sensor -> Gateway -> Cloud."""

    def __init__(self) -> None:
        self._last_sensors_done_host_us: int | None = None
        self._last_sensors_read_us: int | None = None
        self._last_adv_host_us: int | None = None
        self._f_by_counter: dict[int, dict[str, Any]] = {}
        self._c_ble_by_ts: dict[int, dict[str, Any]] = {}
        self.trials: list[dict[str, Any]] = []

    def feed(self, rec: TimingRecord) -> dict[str, Any] | None:
        if rec.node.startswith("F"):
            if rec.evt == "SENSORS_DONE":
                self._last_sensors_done_host_us = rec.host_t_us
                self._last_sensors_read_us = rec.get_int("read_us")
            elif rec.evt == "BLE_ADV_START":
                self._last_adv_host_us = rec.host_t_us
            elif rec.evt == "BLE_TX_OK":
                counter = rec.get_int("counter")
                if counter is not None:
                    self._f_by_counter[counter] = {
                        "counter": counter,
                        "sensors_done_host_us": self._last_sensors_done_host_us,
                        "sensors_read_us": self._last_sensors_read_us,
                        "adv_host_us": self._last_adv_host_us,
                        "ble_tx_host_us": rec.host_t_us,
                        "f_tx_us": rec.get_int("tx_us"),
                        "samples": rec.get_int("samples"),
                    }
            return None

        if rec.node.startswith("C"):
            if rec.evt == "BLE_RX":
                counter = rec.get_int("counter")
                ts_s = rec.get_int("ts_s")
                if counter is None or ts_s is None:
                    return None
                f_entry = self._f_by_counter.pop(counter, None)
                if f_entry is None:
                    return None
                # On the same Pi-top, rec.t_us and f_entry[*_host_us] share CLOCK_MONOTONIC
                c_rx_us = rec.t_us
                f_to_c_ms: float | None = None
                if f_entry["sensors_done_host_us"] is not None:
                    f_to_c_ms = (c_rx_us - f_entry["sensors_done_host_us"]) / 1000.0
                adv_to_c_ms: float | None = None
                if f_entry["adv_host_us"] is not None:
                    adv_to_c_ms = (c_rx_us - f_entry["adv_host_us"]) / 1000.0
                self._c_ble_by_ts[ts_s] = {
                    "counter": counter,
                    "ts_s": ts_s,
                    "samples": rec.get_int("samples"),
                    "f_read_ms": (
                        f_entry["sensors_read_us"] / 1000.0
                        if f_entry["sensors_read_us"] is not None
                        else None
                    ),
                    "f_to_c_ble_ms": f_to_c_ms,
                    "adv_to_c_ms": adv_to_c_ms,
                    "sensors_done_host_us": f_entry["sensors_done_host_us"],
                    "c_rx_us": c_rx_us,
                }
                return None

            if rec.evt == "CLOUD_TELEM_DONE":
                ts_s = rec.get_int("ts_s")
                ok = rec.get_int("ok", 0)
                if ts_s is None or ok != 1:
                    return None
                pending = self._c_ble_by_ts.pop(ts_s, None)
                if pending is None:
                    return None
                http_ms = rec.get_float("http_ms")
                total_ms: float | None = None
                if pending["sensors_done_host_us"] is not None:
                    total_ms = (rec.t_us - pending["sensors_done_host_us"]) / 1000.0
                trial = {
                    "trial": len(self.trials) + 1,
                    "counter": pending["counter"],
                    "ts_s": ts_s,
                    "samples": pending["samples"],
                    "f_read_ms": _r(pending["f_read_ms"]),
                    "f_to_c_ble_ms": _r(pending["f_to_c_ble_ms"]),
                    "c_to_s_http_ms": _r(http_ms),
                    "f_to_s_total_ms": _r(total_ms),
                }
                self.trials.append(trial)
                return trial
        return None

    def summarize(self) -> list[MetricStats]:
        metrics = [
            ("F Sensor Read", "f_read_ms", "ms"),
            ("F -> C (BLE + AES-GCM)", "f_to_c_ble_ms", "ms"),
            ("C -> S (HTTPS + D1)", "c_to_s_http_ms", "ms"),
            ("End-to-End F -> C -> S", "f_to_s_total_ms", "ms"),
        ]
        return _collect_stats(self.trials, metrics)


class VisionAbortCorrelator:
    """Path 2: Node 'C' (YOLO26n) -> MQTTS ABORT -> Node 'D' (USB) Brake."""

    def __init__(self) -> None:
        self._pending: dict[str, dict[str, Any]] = {}
        self.trials: list[dict[str, Any]] = []

    def feed(self, rec: TimingRecord) -> dict[str, Any] | None:
        cmd_id = rec.fields.get("cmd_id") or rec.fields.get("ack_cmd_id")
        if not cmd_id or cmd_id == "-":
            return None

        if rec.node.startswith("C") and rec.evt == "MQTT_TX_CMD":
            if rec.fields.get("action") == "ABORT":
                entry = self._pending.setdefault(cmd_id, {"cmd_id": cmd_id})
                entry["c_tx_us"] = rec.t_us
        elif rec.node.startswith("C") and rec.evt == "SAFETY_ABORT_TX":
            entry = self._pending.setdefault(cmd_id, {"cmd_id": cmd_id})
            entry["yolo_ms"] = rec.get_float("yolo_ms")
            entry["conf"] = rec.get_float("conf")
        elif rec.node.startswith("D") and rec.evt == "MQTT_RX":
            if rec.fields.get("action") == "ABORT" and cmd_id in self._pending:
                self._pending[cmd_id]["d_rx_host_us"] = rec.host_t_us
        elif rec.node.startswith("D") and rec.evt == "ABORT_BRAKE":
            entry = self._pending.pop(cmd_id, None)
            if entry is None or "c_tx_us" not in entry:
                return None
            c_tx_us = entry["c_tx_us"]
            d_rx_host_us = entry.get("d_rx_host_us")
            mqtt_transit_ms = (
                (d_rx_host_us - c_tx_us) / 1000.0 if d_rx_host_us is not None else None
            )
            c_to_brake_ms = (rec.host_t_us - c_tx_us) / 1000.0
            d_rx_to_brake_us = rec.get_int("rx_to_brake_us")
            yolo_ms = entry.get("yolo_ms")
            total_ms = (yolo_ms + c_to_brake_ms) if yolo_ms is not None else c_to_brake_ms
            trial = {
                "trial": len(self.trials) + 1,
                "cmd_id": cmd_id,
                "yolo_ms": _r(yolo_ms),
                "c_to_d_mqtt_ms": _r(mqtt_transit_ms),
                "d_rx_to_brake_us": d_rx_to_brake_us,
                "c_tx_to_brake_ms": _r(c_to_brake_ms),
                "vision_to_brake_total_ms": _r(total_ms),
            }
            self.trials.append(trial)
            return trial
        return None

    def summarize(self) -> list[MetricStats]:
        metrics = [
            ("YOLO26n Person Inference", "yolo_ms", "ms"),
            ("C -> D MQTTS Transit", "c_to_d_mqtt_ms", "ms"),
            ("D Internal RX -> Brake", "d_rx_to_brake_us", "us"),
            ("C TX -> D Motor Brake", "c_tx_to_brake_ms", "ms"),
            ("End-to-End Vision -> Brake", "vision_to_brake_total_ms", "ms"),
        ]
        return _collect_stats(self.trials, metrics)


class DoorCloseCorrelator:
    """Path 3: Door-Ajar -> Node 'C' -> MQTTS CLOSE_DOOR -> Node 'D' (USB) Motor."""

    def __init__(self) -> None:
        self._pending: dict[str, dict[str, Any]] = {}
        self.trials: list[dict[str, Any]] = []

    def feed(self, rec: TimingRecord) -> dict[str, Any] | None:
        cmd_id = rec.fields.get("cmd_id") or rec.fields.get("ack_cmd_id")
        if not cmd_id or cmd_id == "-":
            return None

        if rec.node.startswith("C") and rec.evt == "MQTT_TX_CMD":
            if rec.fields.get("action") == "CLOSE_DOOR":
                entry = self._pending.setdefault(cmd_id, {"cmd_id": cmd_id})
                entry["c_tx_us"] = rec.t_us
        elif rec.node.startswith("C") and rec.evt == "SAFETY_CLOSE_TX":
            entry = self._pending.setdefault(cmd_id, {"cmd_id": cmd_id})
            entry["yolo_ms"] = rec.get_float("yolo_ms")
            entry["ajar_s"] = rec.get_float("ajar_s")
        elif rec.node.startswith("D") and rec.evt == "MQTT_RX":
            if rec.fields.get("action") == "CLOSE_DOOR" and cmd_id in self._pending:
                self._pending[cmd_id]["d_rx_host_us"] = rec.host_t_us
        elif rec.node.startswith("D") and rec.evt == "CLOSING_START":
            if cmd_id in self._pending:
                self._pending[cmd_id]["d_closing_host_us"] = rec.host_t_us
                self._pending[cmd_id]["d_rx_to_fsm_us"] = rec.get_int("rx_to_fsm_us")
        elif rec.node.startswith("C") and rec.evt == "MQTT_RX_EVENT":
            if rec.fields.get("type") == "CLOSING" and cmd_id in self._pending:
                self._pending[cmd_id]["c_ack_us"] = rec.t_us
        elif rec.node.startswith("D") and rec.evt == "MOTOR_CW_START":
            entry = self._pending.pop(cmd_id, None)
            if entry is None or "c_tx_us" not in entry:
                return None
            c_tx_us = entry["c_tx_us"]
            d_rx_host_us = entry.get("d_rx_host_us")
            d_closing_host_us = entry.get("d_closing_host_us")
            c_ack_us = entry.get("c_ack_us")
            beep_us = rec.get_int("beep_us")
            trial = {
                "trial": len(self.trials) + 1,
                "cmd_id": cmd_id,
                "yolo_ms": _r(entry.get("yolo_ms")),
                "c_to_d_mqtt_ms": _r(
                    (d_rx_host_us - c_tx_us) / 1000.0 if d_rx_host_us is not None else None
                ),
                "d_rx_to_fsm_us": entry.get("d_rx_to_fsm_us"),
                "c_tx_to_closing_ms": _r(
                    (d_closing_host_us - c_tx_us) / 1000.0
                    if d_closing_host_us is not None
                    else None
                ),
                "c_cmd_to_ack_rtt_ms": _r(
                    (c_ack_us - c_tx_us) / 1000.0 if c_ack_us is not None else None
                ),
                "warning_beep_ms": _r(beep_us / 1000.0 if beep_us is not None else None),
                "c_tx_to_motor_cw_ms": _r((rec.host_t_us - c_tx_us) / 1000.0),
            }
            self.trials.append(trial)
            return trial
        return None

    def summarize(self) -> list[MetricStats]:
        metrics = [
            ("YOLO26n Clear Check", "yolo_ms", "ms"),
            ("C -> D MQTTS Transit", "c_to_d_mqtt_ms", "ms"),
            ("D Internal RX -> FSM", "d_rx_to_fsm_us", "us"),
            ("C TX -> D CLOSING (Buzzer)", "c_tx_to_closing_ms", "ms"),
            ("C Cmd -> CLOSING ACK RTT", "c_cmd_to_ack_rtt_ms", "ms"),
            ("Intentional Warning Beeps", "warning_beep_ms", "ms"),
            ("C TX -> Motor CW Drive", "c_tx_to_motor_cw_ms", "ms"),
        ]
        return _collect_stats(self.trials, metrics)


class DoorLocalCorrelator:
    """Path 4: Node 'D' (USB only) local hardware safety reflexes."""

    def __init__(self) -> None:
        self.trials: list[dict[str, Any]] = []

    def feed(self, rec: TimingRecord) -> dict[str, Any] | None:
        if not rec.node.startswith("D"):
            return None
        row: dict[str, Any] | None = None
        if rec.evt == "LIMIT_ISR_BRAKE":
            row = {
                "trial": len(self.trials) + 1,
                "event": rec.evt,
                "limit_isr_to_brake_us": rec.get_int("isr_to_brake_us"),
                "reason": rec.fields.get("reason", "-"),
            }
        elif rec.evt == "S1_ISR_BRAKE":
            row = {
                "trial": len(self.trials) + 1,
                "event": rec.evt,
                "s1_isr_to_brake_us": rec.get_int("isr_to_brake_us"),
            }
        elif rec.evt == "STALL_BRAKE":
            row = {
                "trial": len(self.trials) + 1,
                "event": rec.evt,
                "stall_ma": rec.get_int("ma"),
                "stall_trip_to_brake_us": rec.get_int("trip_to_brake_us"),
                "stall_first_over_to_brake_ms": _r(
                    (rec.get_int("first_over_to_brake_us") or 0) / 1000.0
                ),
            }
        elif rec.evt == "IR_RETRACT":
            row = {
                "trial": len(self.trials) + 1,
                "event": rec.evt,
                "ir_seal_ms": _r((rec.get_int("seal_us") or 0) / 1000.0),
            }
        if row is not None:
            self.trials.append(row)
        return row

    def summarize(self) -> list[MetricStats]:
        metrics = [
            ("Limit Switch ISR -> Brake", "limit_isr_to_brake_us", "us"),
            ("S1 Emergency ISR -> Brake", "s1_isr_to_brake_us", "us"),
            ("INA219 Stall Trip -> Brake", "stall_trip_to_brake_us", "us"),
            ("INA219 1st Over -> Brake", "stall_first_over_to_brake_ms", "ms"),
            ("IR Closed -> Gasket Seal", "ir_seal_ms", "ms"),
        ]
        return _collect_stats(self.trials, metrics)


class FPowerCorrelator:
    """Path 5: Node 'F' (USB only) wake & BLE phase durations for POWER.md (E3)."""

    def __init__(self) -> None:
        self._cur: dict[str, Any] = {}
        self.trials: list[dict[str, Any]] = []

    def feed(self, rec: TimingRecord) -> dict[str, Any] | None:
        if not rec.node.startswith("F"):
            return None
        if rec.evt == "WAKE":
            self._cur = {"cause": rec.get_int("cause")}
        elif rec.evt == "SENSORS_DONE":
            read_us = rec.get_int("read_us")
            self._cur["read_ms"] = read_us / 1000.0 if read_us is not None else None
            self._cur["door"] = rec.get_int("door")
            self._cur["buf"] = rec.get_int("buf")
        elif rec.evt == "BLE_CONN":
            adv_us = rec.get_int("adv_us")
            self._cur["ble_adv_ms"] = adv_us / 1000.0 if adv_us is not None else None
        elif rec.evt == "BLE_TX_OK":
            tx_us = rec.get_int("tx_us")
            self._cur["ble_tx_ms"] = tx_us / 1000.0 if tx_us is not None else None
        elif rec.evt == "BLE_DONE":
            sess_us = rec.get_int("session_us")
            self._cur["ble_session_ms"] = sess_us / 1000.0 if sess_us is not None else None
            self._cur["ble_outcome"] = rec.get_int("outcome")
        elif rec.evt == "SLEEP_ENTER":
            awake_us = rec.get_int("awake_us")
            awake_ms = awake_us / 1000.0 if awake_us is not None else None
            has_ble = self._cur.get("ble_session_ms") is not None
            trial = {
                "trial": len(self.trials) + 1,
                "has_ble": 1 if has_ble else 0,
                "ble_outcome": self._cur.get("ble_outcome"),
                "sensor_read_ms": _r(self._cur.get("read_ms")),
                "sample_only_awake_ms": _r(awake_ms if not has_ble else None),
                "ble_adv_ms": _r(self._cur.get("ble_adv_ms")),
                "ble_tx_ms": _r(self._cur.get("ble_tx_ms")),
                "ble_session_ms": _r(self._cur.get("ble_session_ms")),
                "ble_wake_awake_ms": _r(awake_ms if has_ble else None),
            }
            self.trials.append(trial)
            self._cur = {}
            return trial
        return None

    def summarize(self) -> list[MetricStats]:
        metrics = [
            ("Sensor Read Duration", "sensor_read_ms", "ms"),
            ("Sample-Only Wake Awake", "sample_only_awake_ms", "ms"),
            ("BLE Advertising -> Connect", "ble_adv_ms", "ms"),
            ("BLE Connect -> TX OK", "ble_tx_ms", "ms"),
            ("BLE Full Session", "ble_session_ms", "ms"),
            ("BLE Wake Total Awake", "ble_wake_awake_ms", "ms"),
        ]
        return _collect_stats(self.trials, metrics)


def _r(val: float | None) -> float | None:
    return round(val, 3) if val is not None else None


def _collect_stats(
    rows: list[dict[str, Any]],
    metrics: list[tuple[str, str, str]],
) -> list[MetricStats]:
    out: list[MetricStats] = []
    for label, key, unit in metrics:
        vals = [float(r[key]) for r in rows if r.get(key) is not None]
        st = compute_stats(label, vals, unit=unit)
        if st is not None:
            out.append(st)
    return out


# ==============================================================================
# Live Input Streams (Serial UART + Tailed Camera Log File)
# ==============================================================================


def _serial_reader_thread(
    port: str,
    baud: int,
    out_q: queue.Queue[TimingRecord],
    stop_evt: threading.Event,
) -> None:
    """Reads lines from a USB-UART port (pyserial if available, else Linux termios)."""
    try:
        import serial  # type: ignore[import-not-found]

        with serial.Serial(port, baudrate=baud, timeout=0.2) as ser:
            while not stop_evt.is_set():
                raw = ser.readline()
                if not raw:
                    continue
                host_us = host_monotonic_us()
                line = raw.decode("utf-8", errors="replace")
                rec = parse_timing_line(line, host_t_us=host_us)
                if rec is not None:
                    out_q.put(rec)
        return
    except ImportError:
        pass

    # Pure-stdlib Linux termios fallback (zero extra packages needed on Pi-top)
    import select
    import termios

    fd = os.open(port, os.O_RDONLY | os.O_NOCTTY | os.O_NONBLOCK)
    try:
        attrs = termios.tcgetattr(fd)
        baud_const = getattr(termios, f"B{baud}", termios.B115200)
        attrs[0] = 0  # iflag
        attrs[1] = 0  # oflag
        attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL  # cflag
        attrs[3] = 0  # lflag (raw)
        attrs[4] = baud_const
        attrs[5] = baud_const
        termios.tcsetattr(fd, termios.TCSANOW, attrs)

        buf = b""
        while not stop_evt.is_set():
            rlist, _, _ = select.select([fd], [], [], 0.2)
            if not rlist:
                continue
            chunk = os.read(fd, 1024)
            if not chunk:
                continue
            buf += chunk
            while b"\n" in buf:
                raw_line, buf = buf.split(b"\n", 1)
                host_us = host_monotonic_us()
                line = raw_line.decode("utf-8", errors="replace")
                rec = parse_timing_line(line, host_t_us=host_us)
                if rec is not None:
                    out_q.put(rec)
    finally:
        os.close(fd)


def _log_tail_thread(
    log_path: Path,
    out_q: queue.Queue[TimingRecord],
    stop_evt: threading.Event,
    from_start: bool = False,
) -> None:
    """Tails Node 'C' log file for [TIMING] lines."""
    while not stop_evt.is_set() and not log_path.exists():
        time.sleep(0.1)
    if stop_evt.is_set():
        return

    with log_path.open("r", encoding="utf-8", errors="replace") as f:
        if not from_start:
            f.seek(0, os.SEEK_END)
        while not stop_evt.is_set():
            line = f.readline()
            if not line:
                time.sleep(0.02)
                continue
            rec = parse_timing_line(line)
            if rec is not None:
                out_q.put(rec)


def _build_correlator(mode: str) -> Any:
    if mode == "f-to-dashboard":
        return FToDashboardCorrelator()
    if mode == "vision-abort":
        return VisionAbortCorrelator()
    if mode == "door-close":
        return DoorCloseCorrelator()
    if mode == "door-local":
        return DoorLocalCorrelator()
    if mode == "f-power":
        return FPowerCorrelator()
    raise ValueError(f"Unknown mode: {mode}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="FoodWarden single-USB-port [TIMING] latency collector (interface/TIMING.md)."
    )
    parser.add_argument(
        "mode",
        choices=["f-to-dashboard", "vision-abort", "door-close", "door-local", "f-power"],
        help="Isolated measurement path to run (max 1 USB-UART node required).",
    )
    parser.add_argument(
        "--serial",
        type=str,
        default=None,
        help="USB-UART device for the single ESP32 under test (e.g. /dev/ttyUSB0).",
    )
    parser.add_argument("--baud", type=int, default=115200, help="UART baud rate (default: 115200).")
    parser.add_argument(
        "--camera-log",
        type=Path,
        default=None,
        help="Path to Node 'C' log file (set TIMING_LOG_FILE when launching foodwarden-camera).",
    )
    parser.add_argument(
        "--trials",
        type=int,
        default=20,
        help="Target number of completed trials before stopping (0 = run until Ctrl+C).",
    )
    parser.add_argument("--csv", type=Path, default=None, help="Output CSV path for raw trials.")
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print every incoming [TIMING] event as it arrives.",
    )
    args = parser.parse_args(argv)

    needs_camera = args.mode in ("f-to-dashboard", "vision-abort", "door-close")
    if not args.serial:
        parser.error(f"--serial is required for mode '{args.mode}'.")
    if needs_camera and not args.camera_log:
        parser.error(f"--camera-log is required for mode '{args.mode}'.")

    correlator = _build_correlator(args.mode)
    rec_q: queue.Queue[TimingRecord] = queue.Queue()
    stop_evt = threading.Event()
    threads: list[threading.Thread] = []

    t_serial = threading.Thread(
        target=_serial_reader_thread,
        args=(args.serial, args.baud, rec_q, stop_evt),
        daemon=True,
        name="SerialTimingReader",
    )
    threads.append(t_serial)

    if args.camera_log is not None:
        t_log = threading.Thread(
            target=_log_tail_thread,
            args=(args.camera_log, rec_q, stop_evt, False),
            daemon=True,
            name="CameraLogTailer",
        )
        threads.append(t_log)

    for t in threads:
        t.start()

    print(
        f"[measure_latency] Mode={args.mode} | serial={args.serial} | "
        f"camera_log={args.camera_log or 'none'} | target_trials={args.trials or 'unlimited'}"
    )
    print("[measure_latency] Listening for [TIMING] events... Press Ctrl+C to finish early.")

    try:
        while True:
            try:
                rec = rec_q.get(timeout=0.25)
            except queue.Empty:
                continue

            if args.verbose:
                print(f"  <- {rec.node} {rec.evt} t_us={rec.t_us} {rec.fields}")

            trial = correlator.feed(rec)
            if trial is not None:
                print(f"[TRIAL {trial['trial']}] {trial}")
                if args.trials > 0 and len(correlator.trials) >= args.trials:
                    break
    except KeyboardInterrupt:
        print("\n[measure_latency] Stopped by user.")
    finally:
        stop_evt.set()
        for t in threads:
            t.join(timeout=1.0)

    if args.csv is not None and correlator.trials:
        write_csv(args.csv, correlator.trials)
        print(f"\nSaved {len(correlator.trials)} trial(s) to {args.csv}")

    stats_list = correlator.summarize()
    print()
    if stats_list:
        print(format_markdown_summary(f"Latency Summary ({args.mode})", stats_list))
    else:
        print("No complete trials captured.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
