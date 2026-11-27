"""Unit tests for [TIMING] emitter and single-USB-port latency correlators."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

from foodwarden_camera.timing import format_timing_line


def _load_measure_module() -> Any:
    script_path = Path(__file__).resolve().parent.parent / "deploy" / "measure_latency.py"
    spec = importlib.util.spec_from_file_location("measure_latency", script_path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["measure_latency"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_format_and_parse_timing_line_ignores_debug_noise() -> None:
    ml = _load_measure_module()

    # Regular UART / Python debug lines must be ignored
    assert ml.parse_timing_line("[FSM] Limit switch HOMED -> motor braked") is None
    assert ml.parse_timing_line("t=1794800010 temp_cdeg=342 light=12") is None
    assert ml.parse_timing_line("2026-11-26 09:00:00 [INFO] Connected to broker") is None

    # Canonical [TIMING] line with optional logger prefix
    raw = format_timing_line("BLE_RX", node_id="C0", t_us=5_000_000, src="F0", counter=7, ok=True)
    prefixed = f"2026-11-26 09:00:00 [INFO] (foodwarden_camera.timing) {raw}"
    rec = ml.parse_timing_line(prefixed, host_t_us=5_000_100)
    assert rec is not None
    assert rec.node == "C0"
    assert rec.evt == "BLE_RX"
    assert rec.t_us == 5_000_000
    assert rec.host_t_us == 5_000_100
    assert rec.get_int("counter") == 7
    assert rec.get_int("ok") == 1


def test_f_to_dashboard_correlator() -> None:
    ml = _load_measure_module()
    corr = ml.FToDashboardCorrelator()

    events = [
        ml.parse_timing_line(
            "[TIMING] node=F0 evt=SENSORS_DONE t_us=300000 door=1 buf=1 read_us=280000",
            host_t_us=10_000_000,
        ),
        ml.parse_timing_line(
            "[TIMING] node=F0 evt=BLE_ADV_START t_us=320000 buf=1",
            host_t_us=10_020_000,
        ),
        ml.parse_timing_line(
            "[TIMING] node=F0 evt=BLE_TX_OK t_us=900000 counter=12 samples=1 tx_us=450000",
            host_t_us=10_600_000,
        ),
        ml.parse_timing_line(
            "[TIMING] node=C0 evt=BLE_RX t_us=10620000 src=F0 counter=12 samples=1 ts_s=1795000100",
            host_t_us=10_625_000,
        ),
        ml.parse_timing_line(
            "[TIMING] node=C0 evt=CLOUD_TELEM_DONE t_us=10920000 ok=1 http_ms=300.00 ts_s=1795000100",
            host_t_us=10_925_000,
        ),
    ]
    trial = None
    for rec in events:
        assert rec is not None
        res = corr.feed(rec)
        if res is not None:
            trial = res

    assert trial is not None
    assert trial["counter"] == 12
    assert trial["f_read_ms"] == 280.0
    assert trial["f_to_c_ble_ms"] == 620.0
    assert trial["c_to_s_http_ms"] == 300.0
    assert trial["f_to_s_total_ms"] == 920.0
    assert len(corr.summarize()) == 4


def test_vision_abort_correlator() -> None:
    ml = _load_measure_module()
    corr = ml.VisionAbortCorrelator()

    for line, host_us in [
        ("[TIMING] node=C0 evt=MQTT_TX_CMD t_us=20000000 action=ABORT cmd_id=c-1 dst=D0", 20_000_050),
        ("[TIMING] node=C0 evt=SAFETY_ABORT_TX t_us=20000100 cmd_id=c-1 conf=0.88 yolo_ms=140.50", 20_000_150),
        ("[TIMING] node=D0 evt=MQTT_RX t_us=500000 action=ABORT cmd_id=c-1", 20_018_000),
        ("[TIMING] node=D0 evt=ABORT_BRAKE t_us=500320 cmd_id=c-1 rx_to_brake_us=320", 20_020_000),
    ]:
        rec = ml.parse_timing_line(line, host_t_us=host_us)
        assert rec is not None
        corr.feed(rec)

    assert len(corr.trials) == 1
    t = corr.trials[0]
    assert t["yolo_ms"] == 140.5
    assert t["c_to_d_mqtt_ms"] == 18.0
    assert t["d_rx_to_brake_us"] == 320
    assert t["c_tx_to_brake_ms"] == 20.0
    assert t["vision_to_brake_total_ms"] == 160.5


def test_door_close_and_local_and_f_power_correlators() -> None:
    ml = _load_measure_module()

    # Path 3: door-close
    dc = ml.DoorCloseCorrelator()
    for line, host_us in [
        ("[TIMING] node=C0 evt=MQTT_TX_CMD t_us=30000000 action=CLOSE_DOOR cmd_id=c-2 dst=D0", 30_000_010),
        ("[TIMING] node=C0 evt=SAFETY_CLOSE_TX t_us=30000050 cmd_id=c-2 ajar_s=3.10 yolo_ms=125.00", 30_000_060),
        ("[TIMING] node=D0 evt=MQTT_RX t_us=100000 action=CLOSE_DOOR cmd_id=c-2", 30_015_000),
        ("[TIMING] node=D0 evt=CLOSING_START t_us=112000 cmd_id=c-2 rx_to_fsm_us=12000", 30_027_000),
        ("[TIMING] node=C0 evt=MQTT_RX_EVENT t_us=30040000 src=D0 type=CLOSING ack_cmd_id=c-2", 30_040_050),
        ("[TIMING] node=D0 evt=MOTOR_CW_START t_us=832000 cmd_id=c-2 beep_us=720000", 30_747_000),
    ]:
        rec = ml.parse_timing_line(line, host_t_us=host_us)
        assert rec is not None
        dc.feed(rec)
    assert len(dc.trials) == 1
    assert dc.trials[0]["warning_beep_ms"] == 720.0
    assert dc.trials[0]["c_cmd_to_ack_rtt_ms"] == 40.0

    # Path 4: door-local
    dl = ml.DoorLocalCorrelator()
    for line in [
        "[TIMING] node=D0 evt=LIMIT_ISR_BRAKE t_us=1000 isr_to_brake_us=62 reason=FOR_SUCCESS",
        "[TIMING] node=D0 evt=S1_ISR_BRAKE t_us=2000 isr_to_brake_us=75",
        "[TIMING] node=D0 evt=STALL_BRAKE t_us=3000 ma=260 trip_to_brake_us=110 first_over_to_brake_us=10400",
    ]:
        rec = ml.parse_timing_line(line, host_t_us=100)
        assert rec is not None
        dl.feed(rec)
    assert len(dl.trials) == 3

    # Path 5: f-power
    fp = ml.FPowerCorrelator()
    for line in [
        "[TIMING] node=F0 evt=WAKE t_us=1000 cause=4",
        "[TIMING] node=F0 evt=SENSORS_DONE t_us=290000 door=0 buf=1 read_us=289000",
        "[TIMING] node=F0 evt=SLEEP_ENTER t_us=350000 awake_us=350000",
    ]:
        rec = ml.parse_timing_line(line, host_t_us=100)
        assert rec is not None
        fp.feed(rec)
    assert len(fp.trials) == 1
    assert fp.trials[0]["sample_only_awake_ms"] == 350.0


def test_pdr_correlator_windows_gaps_and_reboots() -> None:
    ml = _load_measure_module()
    corr = ml.PDRCorrelator(window_size=5)

    # Window 1 (counters 1..5): 1, 2, 3, 4, 5 all arrive -> 100% PDR
    for c in (1, 2, 3, 4, 5):
        rec = ml.parse_timing_line(
            f"[TIMING] node=C0 evt=BLE_RX t_us={c * 1000} src=F0 counter={c} "
            f"samples=6 ts_s={1795000000 + c} salt=aabbccdd new_session={1 if c == 1 else 0} rssi=-62",
            host_t_us=c * 1000,
        )
        assert rec is not None
        corr.feed(rec)
    assert len(corr.trials) == 1
    assert corr.trials[0]["pdr_pct"] == 100.0
    assert corr.trials[0]["missed"] == 0
    assert corr.trials[0]["rssi_mean_dbm"] == -62.0

    # Window 2 (counters 6..10): counter 7 and 10 are missed; 1 corrupted error logged.
    # Packet 11 arrives -> closes Window 2 (rx=3/5 = 60%) and starts Window 3.
    err_rec = ml.parse_timing_line(
        "[TIMING] node=C0 evt=BLE_RX_ERR t_us=7500 kind=corrupted pdr_corrupt=1",
        host_t_us=7500,
    )
    assert err_rec is not None
    corr.feed(err_rec)

    for c in (6, 8, 9, 11):
        rec = ml.parse_timing_line(
            f"[TIMING] node=C0 evt=BLE_RX t_us={c * 1000} src=F0 counter={c} "
            f"samples=6 ts_s={1795000000 + c} salt=aabbccdd new_session=0 rssi=-74",
            host_t_us=c * 1000,
        )
        assert rec is not None
        corr.feed(rec)
    assert len(corr.trials) == 2
    assert corr.trials[1]["counter_start"] == 6
    assert corr.trials[1]["counter_end"] == 10
    assert corr.trials[1]["received"] == 3
    assert corr.trials[1]["missed"] == 2
    assert corr.trials[1]["corrupted"] == 1
    assert corr.trials[1]["pdr_pct"] == 60.0
    assert corr.trials[1]["rssi_mean_dbm"] == -74.0

    # Node F cold-boots with a new salt -> partial Window 3 resets cleanly without closing
    reboot_rec = ml.parse_timing_line(
        "[TIMING] node=C0 evt=BLE_RX t_us=99000 src=F0 counter=1 samples=1 "
        "ts_s=1795000200 salt=11223344 new_session=1 rssi=-68",
        host_t_us=99000,
    )
    assert reboot_rec is not None
    assert corr.feed(reboot_rec) is None
    assert len(corr.trials) == 2

    stats = corr.summarize()
    assert len(stats) == 2
    assert stats[0].mean == 80.0

