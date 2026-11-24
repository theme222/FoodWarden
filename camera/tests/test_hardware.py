"""Unit tests for ButtonController and PIRController hardware abstractions."""

import subprocess
import sys
import time
from unittest.mock import MagicMock

import pytest

from foodwarden_camera.hardware.buttons import ButtonController, ButtonType
from foodwarden_camera.hardware.pir import PIRController


def test_button_controller_callbacks() -> None:
    controller = ButtonController()
    pressed_buttons: list[ButtonType] = []

    controller.register_callback(ButtonType.UP, lambda: pressed_buttons.append(ButtonType.UP))
    controller.register_callback(ButtonType.DOWN, lambda: pressed_buttons.append(ButtonType.DOWN))
    controller.register_callback(
        ButtonType.SELECT, lambda: pressed_buttons.append(ButtonType.SELECT)
    )
    controller.register_callback(
        ButtonType.CANCEL, lambda: pressed_buttons.append(ButtonType.CANCEL)
    )

    controller.emit_button_press(ButtonType.UP)
    controller.emit_button_press(ButtonType.SELECT)
    controller.emit_button_press(ButtonType.DOWN)
    controller.emit_button_press(ButtonType.CANCEL)

    assert pressed_buttons == [
        ButtonType.UP,
        ButtonType.SELECT,
        ButtonType.DOWN,
        ButtonType.CANCEL,
    ]


def test_button_controller_error_resilience() -> None:
    controller = ButtonController()
    success_called = False

    def faulty_handler() -> None:
        raise RuntimeError("Simulated button crash")

    def safe_handler() -> None:
        nonlocal success_called
        success_called = True

    controller.register_callback(ButtonType.SELECT, faulty_handler)
    controller.register_callback(ButtonType.SELECT, safe_handler)

    # Must not raise an exception, safe_handler must still run
    controller.emit_button_press(ButtonType.SELECT)
    assert success_called is True


def test_pir_controller_motion_and_sleep() -> None:
    wake_events: list[str] = []
    sleep_events: list[str] = []

    controller = PIRController(
        inactivity_timeout_s=5.0,  # 5 seconds for fast test
        on_wake=lambda: wake_events.append("WAKE"),
        on_sleep=lambda: sleep_events.append("SLEEP"),
    )

    assert controller.is_display_awake is True
    assert controller.idle_duration_s < 1.0

    # Simulate 6 seconds of no motion
    controller._last_motion_time = time.time() - 6.0
    assert controller.idle_duration_s >= 5.0

    # Check inactivity -> should trigger sleep
    slept = controller.check_inactivity()
    assert slept is True
    assert controller.is_display_awake is False
    assert sleep_events == ["SLEEP"]

    # Now detect motion -> should trigger wake
    controller.record_motion(True)
    assert controller.is_display_awake is True
    assert wake_events == ["WAKE"]


def test_pir_manual_controls() -> None:
    sleep_called = False
    wake_called = False

    def on_sleep() -> None:
        nonlocal sleep_called
        sleep_called = True

    def on_wake() -> None:
        nonlocal wake_called
        wake_called = True

    controller = PIRController(on_wake=on_wake, on_sleep=on_sleep)

    controller.sleep()
    assert controller.is_display_awake is False
    assert sleep_called is True

    controller.wake()
    assert controller.is_display_awake is True
    assert wake_called is True
    assert controller.is_motion_detected is False


def test_pir_idle_duration_and_motion_change_callback() -> None:
    events: list[tuple[bool, float]] = []

    controller = PIRController(
        inactivity_timeout_s=60.0,
        on_motion_change=lambda has_motion, idle_s: events.append((has_motion, idle_s)),
    )

    controller.record_motion(True)
    assert controller.is_motion_detected is True
    assert controller.idle_duration_s == 0.0
    assert events[-1][0] is True
    assert events[-1][1] == 0.0

    # Transitioning from motion -> no motion resets the idle counter to ~0s
    controller.record_motion(False)
    assert controller.is_motion_detected is False
    assert controller.idle_duration_s < 1.0
    assert events[-1][0] is False
    assert events[-1][1] < 1.0

    # Simulate 12 seconds of no motion and ensure repeated False does not reset timer
    controller._last_motion_time = time.time() - 12.0
    controller.record_motion(False)
    assert controller.idle_duration_s >= 12.0
    assert events[-1][0] is False
    assert events[-1][1] >= 12.0


def test_pir_pinctrl_fallback_and_reconfigure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(
        "shutil.which", lambda cmd: "/usr/bin/pinctrl" if cmd == "pinctrl" else None
    )

    def fake_run(cmd: list[str], **_kwargs: object) -> subprocess.CompletedProcess[str]:
        if cmd[:2] == ["pinctrl", "get"]:
            return subprocess.CompletedProcess(
                cmd, 0, stdout="22: ip    pd | hi // GPIO22 = input\n", stderr=""
            )
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr("subprocess.run", fake_run)
    # Force gpiozero import inside _init_hardware to fail so pinctrl fallback triggers
    monkeypatch.setitem(
        sys.modules,
        "gpiozero",
        MagicMock(DigitalInputDevice=MagicMock(side_effect=RuntimeError("no lgpio"))),
    )

    controller = PIRController(gpio_pin=22)
    assert controller.is_hardware_available is True
    assert controller._use_pinctrl is True
    assert controller.hardware_status_text == "GPIO 22: HW"
    assert controller._read_hardware_pin() is True

    # Disabling pin (-1) turns off hardware binding
    controller.reconfigure_pin(-1)
    assert controller.is_hardware_available is False
    assert controller.hardware_status_text == "PIR Disabled"


def test_pir_requires_one_second_continuous_detection() -> None:
    wake_events: list[str] = []
    controller = PIRController(
        inactivity_timeout_s=5.0,
        min_motion_duration_s=1.0,
        on_wake=lambda: wake_events.append("WAKE"),
    )
    controller._last_motion_time = time.time() - 10.0
    controller.sleep()
    assert controller.is_display_awake is False

    # Brief < 1.0s HIGH glitch must NOT confirm motion or wake the display
    controller.update_raw_motion(True, now_monotonic=100.0)
    assert controller.is_motion_detected is False
    assert controller.is_display_awake is False

    controller.update_raw_motion(True, now_monotonic=100.8)
    assert controller.is_motion_detected is False
    assert controller.is_display_awake is False

    controller.update_raw_motion(False, now_monotonic=100.9)
    assert controller.is_motion_detected is False
    assert controller.is_display_awake is False
    assert wake_events == []

    # Continuous >= 1.0s HIGH detection MUST confirm motion and wake the display
    controller.update_raw_motion(True, now_monotonic=200.0)
    controller.update_raw_motion(True, now_monotonic=200.5)
    assert controller.is_motion_detected is False
    controller.update_raw_motion(True, now_monotonic=201.0)
    assert controller.is_motion_detected is True
    assert controller.is_display_awake is True
    assert wake_events == ["WAKE"]

    # Dropping LOW clears confirmed motion
    controller.update_raw_motion(False, now_monotonic=201.3)
    assert controller.is_motion_detected is False
