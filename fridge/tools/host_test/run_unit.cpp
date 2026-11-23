// Runs a test/*/test_main.cpp suite on a PC: those suites use the Arduino
// setup() entry point, so call it and turn Unity's failure count into the
// process exit code.
#include "unity.h"

void setup();

int main() {
  setup();
  return Unity.TestFailures == 0 ? 0 : 1;
}
