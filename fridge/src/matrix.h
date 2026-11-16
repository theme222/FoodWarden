#ifndef MATRIX_H_
#define MATRIX_H_

#include <stdint.h>

// Onboard 16x8 red LED matrix (HT16K33) on I2C0: SDA = GPIO 21, SCL = GPIO 22, 0x70
// (KidBright V1.3 wiring diagram, resources/ on feat/resources).
#define MATRIX_I2C_ADDRESS 0x70
#define PIN_I2C0_SDA 21
#define PIN_I2C0_SCL 22

// How the 16 display columns map onto the HT16K33's 16 RAM bytes.
//   1:           column x is RAM byte x, row y is bit y.
//   2:           Adafruit-style backpack: byte = 2*y + (x >= 8), bit = x % 8.
//   3 (default): KidBright32, two 8x8 modules side by side:
//                byte = 2*(x % 8) + (x >= 8), bit = 7 - y (rows wired bottom-up).
// Found on the bench KidBright (2026-11-16): layout 1 showed the same squashed
// text on both 8x8 halves; without the row flip the text was upside down, and
// adding a column flip as well mirrored it.
#ifndef MATRIX_RAM_LAYOUT
#define MATRIX_RAM_LAYOUT 3
#endif

// Tell the driver another user (the sensors) shares I2C0, so it must leave the
// bus running when the display is off or missing.
void matrixShareBus(bool shared);

// Power up the HT16K33 and clear it. Returns false if the chip does not answer
// (the node keeps running without a display).
bool matrixBegin();

// Scroll `text` across the display from right to left, `step_ms` per column.
void matrixScrollText(const char *text, uint16_t step_ms);

// Blank the display and put the HT16K33 oscillator in standby to save power.
void matrixOff();

#endif // MATRIX_H_
