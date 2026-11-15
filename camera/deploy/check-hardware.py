#!/usr/bin/env python3
"""Hardware & SEN0018 PIR Motion Sensor Diagnostic Tool for FoodWarden Node 'C'."""

from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import dotenv_values, set_key

SCAN_BCM_PINS = list(range(4, 28))


def read_pinctrl_levels(pins: list[int]) -> dict[int, bool]:
    """Reads current logic level of BCM GPIO pins non-destructively via pinctrl."""
    levels: dict[int, bool] = {}
    if not shutil.which("pinctrl"):
        return levels

    pin_arg = ",".join(str(p) for p in pins)
    res = subprocess.run(
        ["pinctrl", "get", pin_arg],
        capture_output=True,
        text=True,
        check=False,
        timeout=2.0,
    )
    if res.returncode != 0:
        return levels

    for line in res.stdout.splitlines():
        if ":" not in line or "|" not in line:
            continue
        pin_part, rest = line.split(":", 1)
        try:
            pin_num = int(pin_part.strip())
        except ValueError:
            continue
        levels[pin_num] = "| hi" in rest.lower()
    return levels


def _detect_lan_ip() -> str:
    """Best-effort detection of Pi-top LAN IPv4 address for Node 'D' configuration."""
    if sys.platform.startswith("linux") and shutil.which("hostname"):
        res = subprocess.run(
            ["hostname", "-I"],
            capture_output=True,
            text=True,
            check=False,
            timeout=2.0,
        )
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip().split()[0]

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return str(sock.getsockname()[0])
    except OSError:
        return "127.0.0.1"


def _is_bluetooth_powered() -> bool | None:
    """Returns True if Bluetooth adapter is powered, False if off, None if unavailable."""
    if not shutil.which("bluetoothctl"):
        return None
    bt = subprocess.run(
        ["bluetoothctl", "show"],
        capture_output=True,
        text=True,
        check=False,
        timeout=2.0,
    )
    return "Powered: yes" in bt.stdout


def check_and_fix_env(env_path: Path, fix_env: bool) -> tuple[int, dict[str, str | None]]:
    """Checks PIR_GPIO_PIN and integration variables in camera/.env."""
    print(f"[1/4] Checking .env at: {env_path}")
    if not env_path.exists():
        print("  ! WARNING: camera/.env does not exist yet.")
        return 22, {}

    values = dict(dotenv_values(env_path))
    raw_pin = values.get("PIR_GPIO_PIN")
    pin = 22
    if raw_pin is None:
        print("  ! WARNING: PIR_GPIO_PIN not set in .env (code defaults to 22).")
    else:
        try:
            pin = int(str(raw_pin).strip())
        except ValueError:
            print(f"  ! ERROR: Invalid PIR_GPIO_PIN='{raw_pin}' in .env.")
            pin = 22
        else:
            if pin < 0:
                print(f"  ! FOUND ISSUE: PIR_GPIO_PIN={pin} (PIR sensor is DISABLED in .env!)")
                should_fix = fix_env
                if not should_fix and sys.stdin.isatty():
                    ans = (
                        input("    Update PIR_GPIO_PIN=-1 to PIR_GPIO_PIN=22 now? [Y/n]: ")
                        .strip()
                        .lower()
                    )
                    should_fix = ans in ("", "y", "yes")
                if should_fix:
                    set_key(str(env_path), "PIR_GPIO_PIN", "22")
                    print("  -> FIXED: Updated PIR_GPIO_PIN=22 in .env")
                    pin = 22
                else:
                    print(
                        "  -> Run with --fix-env or change PIR_GPIO_PIN=22 manually to enable PIR."
                    )
            else:
                print(f"  OK: PIR_GPIO_PIN={pin}")

    token = (values.get("GATEWAY_TOKEN") or "").strip()
    if not token or token == "YOUR_GATEWAY_TOKEN":
        print("  ! GATEWAY_TOKEN: NOT SET (still placeholder 'YOUR_GATEWAY_TOKEN')")
    else:
        print(f"  OK: GATEWAY_TOKEN configured (length={len(token)})")

    mock_cloud = (values.get("MOCK_CLOUD") or "false").strip().lower()
    mode_desc = "simulated" if mock_cloud in ("true", "1", "yes") else "real Server 'S'"
    print(f"  - MOCK_CLOUD={mock_cloud} ({mode_desc})")

    return pin, values


def check_peripherals(
    fix_env: bool = False, env_values: dict[str, str | None] | None = None
) -> None:
    """Checks camera, Mosquitto TLS, LAN IP, Bluetooth adapter, and Server 'S' health."""
    print("[2/4] Checking Peripherals & Integration Links...")
    video0 = Path("/dev/video0")
    print(f"  - Webcam (/dev/video0): {'FOUND' if video0.exists() else 'NOT FOUND'}")

    try:
        with socket.create_connection(("127.0.0.1", 8883), timeout=1.5):
            print("  - Mosquitto MQTTS (127.0.0.1:8883): LISTENING")
    except OSError:
        print("  - Mosquitto MQTTS (127.0.0.1:8883): NOT REACHABLE")

    tls_conf = Path("/etc/mosquitto/conf.d/foodwarden-tls.conf")
    print(
        f"  - Mosquitto TLS Config ({tls_conf}): {'INSTALLED' if tls_conf.exists() else 'NOT FOUND'}"
    )
    print(f"  - Pi-top LAN IP (for Node 'D' MQTT_BROKER_HOST): {_detect_lan_ip()}")

    bt_powered = _is_bluetooth_powered()
    if bt_powered is None:
        print("  - Bluetooth Adapter: bluetoothctl not installed")
    elif bt_powered:
        print("  - Bluetooth Adapter: POWERED ON")
    else:
        print("  - Bluetooth Adapter: OFF / UNKNOWN")
        if fix_env and sys.platform.startswith("linux"):
            print("  -> Attempting to enable Bluetooth (--fix-env)...")
            subprocess.run(["sudo", "rfkill", "unblock", "bluetooth"], check=False, timeout=5.0)
            subprocess.run(["sudo", "systemctl", "start", "bluetooth"], check=False, timeout=5.0)
            subprocess.run(["bluetoothctl", "power", "on"], check=False, timeout=5.0)
            recheck = _is_bluetooth_powered()
            print(
                f"  -> Bluetooth Adapter after fix: {'POWERED ON' if recheck else 'STILL OFF / UNKNOWN'}"
            )

    base_url = (
        (env_values or {}).get("FIREBASE_API_BASE_URL")
        or "https://asia-southeast1-foodwarden-app.cloudfunctions.net/api"
    ).rstrip("/")
    health_url = f"{base_url}/health"
    try:
        with urllib.request.urlopen(health_url, timeout=3.0) as resp:
            print(f"  - Server 'S' Health ({health_url}): REACHABLE (HTTP {resp.status})")
    except urllib.error.HTTPError as exc:
        print(
            f"  - Server 'S' Health ({health_url}): HTTP {exc.code} (reachable, endpoint returned error)"
        )
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        print(f"  - Server 'S' Health ({health_url}): UNREACHABLE ({exc})")


def check_gpiozero_binding(pin: int) -> bool:
    """Tests binding the configured GPIO pin with gpiozero."""
    print(f"[3/4] Testing gpiozero binding on GPIO {pin}...")
    try:
        from gpiozero import DigitalInputDevice  # type: ignore[import-not-found]

        dev = DigitalInputDevice(pin, pull_up=False)
        val = bool(dev.value)
        dev.close()
        print(f"  OK: gpiozero bound GPIO {pin} (current level={'HIGH (1)' if val else 'LOW (0)'})")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  ! gpiozero failed on GPIO {pin}: {exc}")
        if shutil.which("pinctrl"):
            subprocess.run(
                ["pinctrl", "set", str(pin), "ip", "pd"],
                check=False,
                timeout=2.0,
            )
            print(f"  -> Configured GPIO {pin} as input pull-down via pinctrl fallback.")
        return False


def live_pir_scan(target_pin: int, duration_s: float) -> None:
    """Monitors target GPIO pin and scans BCM pins 4..27 for motion edges."""
    print(f"[4/4] Live SEN0018 PIR Monitor for {int(duration_s)}s (target=GPIO {target_pin})")
    print("      Wave your hand in front of the SEN0018 sensor now...")

    if not shutil.which("pinctrl"):
        print("  ! 'pinctrl' not found; trying gpiozero-only monitor on target pin.")
        try:
            from gpiozero import DigitalInputDevice  # type: ignore[import-not-found]

            dev = DigitalInputDevice(target_pin, pull_up=False)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! Cannot monitor GPIO: {exc}")
            return

        last_val: bool | None = None
        end_t = time.time() + duration_s
        try:
            while time.time() < end_t:
                cur = bool(dev.value)
                if cur != last_val:
                    state = "HIGH (1 - MOTION!)" if cur else "LOW (0)"
                    print(f"  [GPIO {target_pin}] -> {state}")
                    last_val = cur
                time.sleep(0.1)
        finally:
            dev.close()
        return

    baseline = read_pinctrl_levels(SCAN_BCM_PINS)
    if not baseline:
        print("  ! Failed to read GPIO levels via pinctrl.")
        return

    print(
        f"  Initial GPIO {target_pin} state: "
        f"{'HIGH (1)' if baseline.get(target_pin) else 'LOW (0)'}"
    )

    last_target = baseline.get(target_pin, False)
    changed_pins: set[int] = set()
    end_t = time.time() + duration_s

    while time.time() < end_t:
        current = read_pinctrl_levels(SCAN_BCM_PINS)
        target_val = current.get(target_pin, False)
        if target_val != last_target:
            state = "HIGH (1 - MOTION!)" if target_val else "LOW (0 - NO MOTION)"
            print(f"  [Target GPIO {target_pin}] -> {state}")
            last_target = target_val

        for pin, val in current.items():
            if pin != target_pin and pin in baseline and val != baseline[pin]:
                if pin not in changed_pins:
                    changed_pins.add(pin)
                level_str = "HIGH (1)" if val else "LOW (0)"
                print(f"  [Activity detected on GPIO {pin}] -> {level_str}")
                baseline[pin] = val
        time.sleep(0.15)

    if changed_pins:
        pins_str = ", ".join(str(p) for p in sorted(changed_pins))
        print(f"  Summary: Activity also seen on BCM GPIO pin(s): {pins_str}")
        if target_pin not in changed_pins and not last_target:
            print(
                "  Tip: If another pin toggled when you waved (e.g. a Pi-top Proto GPIO pin), "
                "set PIR_GPIO_PIN to that pin in camera/.env or Settings."
            )
    else:
        print("  Scan complete.")


def main() -> int:
    parser = argparse.ArgumentParser(description="FoodWarden Node 'C' Hardware Diagnostics")
    parser.add_argument(
        "--fix-env",
        action="store_true",
        help="Automatically change PIR_GPIO_PIN=-1 to 22 in camera/.env",
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=15.0,
        help="Seconds to run live PIR motion scan (default: 15)",
    )
    args = parser.parse_args()

    camera_dir = Path(__file__).resolve().parent.parent
    env_path = camera_dir / ".env"

    if os.name == "nt":
        print("Note: Running on Windows; GPIO hardware checks apply on Raspberry Pi OS.")

    target_pin, env_values = check_and_fix_env(env_path, fix_env=args.fix_env)
    check_peripherals(fix_env=args.fix_env, env_values=env_values)
    check_gpiozero_binding(target_pin)
    live_pir_scan(target_pin, duration_s=args.duration)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
