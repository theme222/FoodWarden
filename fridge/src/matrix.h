#ifndef MATRIX_H_
#define MATRIX_H_

#include <stdint.h>

// Onboard 16x8 red LED matrix (HT16K33) on I2C0: SDA = GPIO 4, SCL = GPIO 5, 0x70.
#define MATRIX_I2C_ADDRESS 0x70
#define PIN_I2C0_SDA 4
#define PIN_I2C0_SCL 5

// How the 16 display columns map onto the HT16K33's 16 RAM bytes.
//   1 (default): column x is RAM byte x, row y is bit y.
//   2:           Adafruit-style backpack: byte = 2*y + (x >= 8), bit = x % 8.
// The KidBright32 wiring is not documented in this repo, so this is UNVERIFIED
// until tested on the board. If the S1 readout looks scrambled, build with
// -DMATRIX_RAM_LAYOUT=2.
#ifndef MATRIX_RAM_LAYOUT
#define MATRIX_RAM_LAYOUT 1
#endif

// Power up the HT16K33 and clear it. Returns false if the chip does not answer
// (the node keeps running without a display).
bool matrixBegin();

// Scroll `text` across the display from right to left, `step_ms` per column.
void matrixScrollText(const char *text, uint16_t step_ms);

// Blank the display and put the HT16K33 oscillator in standby to save power.
void matrixOff();

#endif // MATRIX_H_
