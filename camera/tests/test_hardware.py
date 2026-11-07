"""Unit tests for ButtonController and PIRController hardware abstractions."""

import time

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
