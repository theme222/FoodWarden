#!/usr/bin/env bash
# Host (PC) tests for Node F: no board needed. Run from anywhere:
#   bash tools/host_test/run_host_tests.sh
#
# 1. Unity suites in test/ (door/VOC filter, buffer and send rules, display text)
# 2. VOC simulation: real Sensirion Gas Index Algorithm + door filter
# 3. Packet check: the real src/crypto.cpp encrypts, Python decrypts and checks
#    every field (independent AES-GCM implementation)
#
# Needs: a C/C++ compiler (g++/gcc, clang, or `pip install ziglang`), Python 3
# with `pip install cryptography`, and PlatformIO libraries downloaded once
# (`pio run` and `pio test --without-uploading --without-testing`).
# Override the tools with CC, CXX and PYTHON environment variables.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
FRIDGE="$(cd "$HERE/../.." && pwd)"
LIBS="$FRIDGE/.pio/libdeps/esp32dev"
OUT="$FRIDGE/.pio/host_test" # build output stays inside the ignored .pio folder
mkdir -p "$OUT"

PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  for p in python3 python; do
    if command -v "$p" >/dev/null && "$p" -c "import sys; sys.exit(sys.version_info < (3,))" 2>/dev/null; then
      PYTHON="$p"; break
    fi
  done
fi
[ -n "$PYTHON" ] || { echo "Python 3 not found (set PYTHON=...)"; exit 2; }

if [ -z "${CXX:-}" ]; then
  if command -v g++ >/dev/null; then CC=gcc; CXX=g++
  elif command -v clang++ >/dev/null; then CC=clang; CXX=clang++
  elif "$PYTHON" -c "import ziglang" 2>/dev/null; then CC="$PYTHON -m ziglang cc"; CXX="$PYTHON -m ziglang c++"
  else echo "No C++ compiler found (install g++, or: $PYTHON -m pip install ziglang)"; exit 2
  fi
fi
CC="${CC:-cc}"

UNITY="$LIBS/Unity/src"
GIA="$LIBS/Sensirion Gas Index Algorithm/src"
for d in "$UNITY" "$GIA"; do
  [ -d "$d" ] || { echo "Missing $d: run 'pio run' and 'pio test --without-uploading --without-testing' once"; exit 2; }
done

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT) EXE=.exe; CRYPTO_LIB=-lbcrypt ;;
  *) EXE=; CRYPTO_LIB=-lcrypto ;;
esac

FAILED=0
step() { echo; echo "=== $1"; }

step "Unity suites"
$CC -c -I"$UNITY" "$UNITY/unity.c" -o "$OUT/unity.o"
for suite in "$FRIDGE"/test/*/; do
  name="$(basename "$suite")"
  $CXX -std=c++17 -I"$HERE/stub" -I"$UNITY" -I"$FRIDGE/src" \
    "$suite/test_main.cpp" "$HERE/run_unit.cpp" "$OUT/unity.o" -o "$OUT/$name$EXE"
  if "$OUT/$name$EXE" | tail -n 3; then :; else FAILED=1; fi
done

step "VOC simulation (Sensirion algorithm + door filter)"
$CC -c -I"$GIA/algorithm" "$GIA/algorithm/sensirion_gas_index_algorithm.c" -o "$OUT/gia.o"
$CXX -std=c++17 -I"$HERE/stub" -I"$GIA" -I"$GIA/algorithm" -I"$FRIDGE/src" \
  "$HERE/sim.cpp" "$GIA/VOCGasIndexAlgorithm.cpp" "$GIA/SensirionGasIndexAlgorithm.cpp" \
  "$OUT/gia.o" -o "$OUT/sim$EXE"
"$OUT/sim$EXE" || FAILED=1

step "Packet check (src/crypto.cpp -> Python AES-GCM)"
$CXX -std=c++17 -Wall -Wextra -I"$HERE/stub" -I"$FRIDGE/src" \
  "$HERE/gen_packet.cpp" "$FRIDGE/src/crypto.cpp" "$HERE/stub/mbedtls/gcm_host.cpp" \
  $CRYPTO_LIB -o "$OUT/gen_packet$EXE"
"$PYTHON" "$HERE/check_packet.py" "$OUT/gen_packet$EXE" || FAILED=1

echo
if [ "$FAILED" -eq 0 ]; then echo "ALL HOST TESTS PASSED"; else echo "SOME HOST TESTS FAILED"; fi
exit "$FAILED"
