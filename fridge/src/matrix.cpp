#include "matrix.h"

#include <Arduino.h>
#include <Wire.h>
#include <string.h>

#include "matrix_text.h"

// HT16K33 commands
static const uint8_t CMD_OSCILLATOR_ON = 0x21;
static const uint8_t CMD_OSCILLATOR_STANDBY = 0x20;
static const uint8_t CMD_DISPLAY_ON = 0x81;
static const uint8_t CMD_DISPLAY_OFF = 0x80;
static const uint8_t CMD_BRIGHTNESS = 0xE0; // | 0..15
static const uint8_t DEFAULT_BRIGHTNESS = 4;

static const uint32_t I2C_TIMEOUT_MS = 50;
static const uint32_t I2C_CLOCK_HZ = 100000;

// Longest scrolled text: "T-12.3C V500 L4095" is 18 chars; leave generous room.
static const size_t MAX_TEXT_COLS = 160;

static bool started = false;
static bool busShared = false; // sensors also use Wire: never end() it here

void matrixShareBus(bool shared) { busShared = shared; }

static void releaseBus() {
  if (!busShared) Wire.end();
}

static bool sendCommand(uint8_t cmd) {
  Wire.beginTransmission(MATRIX_I2C_ADDRESS);
  Wire.write(cmd);
  return Wire.endTransmission() == 0;
}

// Pushes 16 column bitmaps (bit 0 = top row) to the HT16K33 display RAM.
static bool writeFrame(const uint8_t cols[MATRIX_COLS]) {
  uint8_t ram[16];
  memset(ram, 0, sizeof(ram));
#if MATRIX_RAM_LAYOUT == 3
  // KidBright32: two 8x8 modules share COM0-7; one is on ROW0-7 (even RAM
  // bytes), the other on ROW8-15 (odd bytes). Rows are wired bottom-up, so
  // flip each column vertically (checked on the bench board).
  for (uint8_t x = 0; x < MATRIX_COLS; x++) {
    const uint8_t px = x;
    uint8_t col = cols[x], flipped = 0;
    for (uint8_t y = 0; y < 8; y++) {
      if (col & (1 << y)) flipped |= (uint8_t)(1 << (7 - y));
    }
    ram[2 * (px % 8) + (px >= 8 ? 1 : 0)] = flipped;
  }
#elif MATRIX_RAM_LAYOUT == 2
  for (uint8_t x = 0; x < MATRIX_COLS; x++) {
    for (uint8_t y = 0; y < 8; y++) {
      if (cols[x] & (1 << y)) ram[2 * y + (x >= 8 ? 1 : 0)] |= (uint8_t)(1 << (x % 8));
    }
  }
#else
  memcpy(ram, cols, MATRIX_COLS);
#endif
  Wire.beginTransmission(MATRIX_I2C_ADDRESS);
  Wire.write((uint8_t)0x00); // display RAM start address
  Wire.write(ram, sizeof(ram));
  return Wire.endTransmission() == 0;
}

bool matrixBegin() {
  Wire.begin(PIN_I2C0_SDA, PIN_I2C0_SCL, I2C_CLOCK_HZ);
  Wire.setTimeOut(I2C_TIMEOUT_MS);

  Wire.beginTransmission(MATRIX_I2C_ADDRESS);
  if (Wire.endTransmission() != 0) {
    releaseBus();
    return false;
  }

  uint8_t blank[MATRIX_COLS] = {0};
  bool ok = sendCommand(CMD_OSCILLATOR_ON) && writeFrame(blank) &&
            sendCommand(CMD_BRIGHTNESS | DEFAULT_BRIGHTNESS) && sendCommand(CMD_DISPLAY_ON);
  started = ok;
  if (!ok) releaseBus();
  return ok;
}

void matrixScrollText(const char *text, uint16_t step_ms) {
  if (!started) return;

  // Layout: 16 blank columns, the text, 16 blank columns, so it scrolls in and out.
  uint8_t strip[MATRIX_COLS + MAX_TEXT_COLS + MATRIX_COLS];
  memset(strip, 0, sizeof(strip));
  const size_t n = matrixRenderText(text, strip + MATRIX_COLS, MAX_TEXT_COLS);
  const size_t total = MATRIX_COLS + n + MATRIX_COLS;

  for (size_t offset = 0; offset + MATRIX_COLS <= total; offset++) {
    if (!writeFrame(strip + offset)) return; // display unplugged mid-scroll
    vTaskDelay(pdMS_TO_TICKS(step_ms));
  }
}

void matrixOff() {
  if (!started) return;
  uint8_t blank[MATRIX_COLS] = {0};
  writeFrame(blank);
  sendCommand(CMD_DISPLAY_OFF);
  sendCommand(CMD_OSCILLATOR_STANDBY);
  releaseBus();
  started = false;
}
