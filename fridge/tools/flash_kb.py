# One-shot flasher for the KidBright32 when auto-reset timing fails on Windows.
# Keeps ONE serial connection open the whole time, so nothing toggles DTR/RTS:
# 1. Holds DTR=1 / RTS=0 (GPIO0 low, EN untouched) and waits for you to press RESET.
# 2. Hands the open port to esptool (library, --before no-reset) and flashes.
# 3. Releases GPIO0 and pulses EN so the new firmware boots, then shows its first lines.
# Build first with `pio run` in fridge/. Usage: python tools/flash_kb.py [COMx]  (needs pyserial + esptool)
import os, sys, time
import serial
import esptool
from esptool.targets import ESP32ROM

PORT = sys.argv[1] if len(sys.argv) > 1 else "COM5"
HOME = os.environ["USERPROFILE"]
BUILD = r"C:\Users\Admin\code\embedded\FoodWarden\fridge\.pio\build\esp32dev"
BOOT_APP0 = os.path.join(HOME, ".platformio", "packages", "framework-arduinoespressif32",
                         "tools", "partitions", "boot_app0.bin")

s = serial.Serial(PORT, 115200, timeout=0.1)
s.rts = False; s.dtr = True
print("Press RESET on the board now (waiting up to 60 s)...", flush=True)
buf = b""; end = time.time() + 60
while time.time() < end and b"waiting for download" not in buf:
    buf += s.read(256)
if b"waiting for download" not in buf:
    print("FAILED: board never entered download mode (RESET not pressed?)")
    sys.exit(1)
print("Download mode OK, flashing...", flush=True)

esp = ESP32ROM(s, 115200)
esp.connect("no-reset")
rc = 0
try:
    esptool.main(["--chip", "esp32", "--baud", "460800", "--before", "no-reset",
                  "--after", "no-reset", "write-flash", "-z",
                  "0x1000", os.path.join(BUILD, "bootloader.bin"),
                  "0x8000", os.path.join(BUILD, "partitions.bin"),
                  "0xe000", BOOT_APP0,
                  "0x10000", os.path.join(BUILD, "firmware.bin")], esp=esp)
except BaseException as e:
    print(f"FAILED: {e!r}"); rc = 1

# Release GPIO0, then reset into the new firmware.
s.baudrate = 115200
s.dtr = False; s.rts = True; time.sleep(0.1); s.rts = False
if rc == 0:
    out = b""; end = time.time() + 4
    while time.time() < end: out += s.read(512)
    text = "".join(chr(b) if 32 <= b < 127 or b in (10, 13) else "?" for b in out)
    print("--- first boot output ---\n" + text[-1500:])
    print("DONE: firmware flashed")
s.close()
sys.exit(rc)
