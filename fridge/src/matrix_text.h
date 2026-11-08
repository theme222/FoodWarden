#ifndef MATRIX_TEXT_H_
#define MATRIX_TEXT_H_

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

// Text rendering for the 16x8 LED matrix. Pure logic with no Arduino or I2C
// dependencies so it can be unit tested on a host.
//
// Output format: one byte per display column, bit 0 = top row, bit 7 = bottom row.

#define MATRIX_COLS 16
#define MATRIX_FONT_WIDTH 5

struct MatrixGlyph {
  char ch;
  uint8_t cols[MATRIX_FONT_WIDTH];
};

// Classic 5x7 font, only the characters the diagnostic readout needs.
static const MatrixGlyph MATRIX_FONT[] = {
    {' ', {0x00, 0x00, 0x00, 0x00, 0x00}}, {'0', {0x3E, 0x51, 0x49, 0x45, 0x3E}},
    {'1', {0x00, 0x42, 0x7F, 0x40, 0x00}}, {'2', {0x42, 0x61, 0x51, 0x49, 0x46}},
    {'3', {0x21, 0x41, 0x45, 0x4B, 0x31}}, {'4', {0x18, 0x14, 0x12, 0x7F, 0x10}},
    {'5', {0x27, 0x45, 0x45, 0x45, 0x39}}, {'6', {0x3C, 0x4A, 0x49, 0x49, 0x30}},
    {'7', {0x01, 0x71, 0x09, 0x05, 0x03}}, {'8', {0x36, 0x49, 0x49, 0x49, 0x36}},
    {'9', {0x06, 0x49, 0x49, 0x29, 0x1E}}, {'.', {0x00, 0x60, 0x60, 0x00, 0x00}},
    {'-', {0x08, 0x08, 0x08, 0x08, 0x08}}, {':', {0x00, 0x36, 0x36, 0x00, 0x00}},
    {'C', {0x3E, 0x41, 0x41, 0x41, 0x22}}, {'E', {0x7F, 0x49, 0x49, 0x49, 0x41}},
    {'L', {0x7F, 0x40, 0x40, 0x40, 0x40}}, {'T', {0x01, 0x01, 0x7F, 0x01, 0x01}},
    {'V', {0x1F, 0x20, 0x40, 0x20, 0x1F}},
};

static const uint8_t MATRIX_UNKNOWN_GLYPH[MATRIX_FONT_WIDTH] = {0x02, 0x01, 0x51, 0x09, 0x06};

static inline const uint8_t *matrixGlyph(char c) {
  for (size_t i = 0; i < sizeof(MATRIX_FONT) / sizeof(MATRIX_FONT[0]); i++) {
    if (MATRIX_FONT[i].ch == c) return MATRIX_FONT[i].cols;
  }
  return MATRIX_UNKNOWN_GLYPH;
}

// Renders `text` into column bitmaps with one blank column after each glyph.
// Returns the number of columns written (never more than max_cols).
static inline size_t matrixRenderText(const char *text, uint8_t *cols, size_t max_cols) {
  size_t n = 0;
  for (; *text != '\0'; text++) {
    const uint8_t *g = matrixGlyph(*text);
    for (size_t i = 0; i < MATRIX_FONT_WIDTH && n < max_cols; i++) cols[n++] = g[i];
    if (n < max_cols) cols[n++] = 0x00;
  }
  return n;
}

// Formats the diagnostic readout, e.g. "T3.4C V100 L512". A sensor error is
// shown as "E" in place of its value. Returns the string length.
static inline int matrixFormatReadings(char *out, size_t cap, int16_t temp_cdeg,
                                       uint16_t voc_index, uint16_t light_ldr) {
  char t[12];
  if (temp_cdeg == (int16_t)-32768) {
    snprintf(t, sizeof(t), "E");
  } else {
    int v = temp_cdeg;
    const char *sign = "";
    if (v < 0) {
      sign = "-";
      v = -v;
    }
    // One decimal place, rounded half up on the centi-degree value.
    int tenths = (v + 5) / 10;
    snprintf(t, sizeof(t), "%s%d.%d", sign, tenths / 10, tenths % 10);
  }
  char v[8];
  char l[8];
  if (voc_index == 0xFFFF) snprintf(v, sizeof(v), "E");
  else snprintf(v, sizeof(v), "%u", (unsigned)voc_index);
  if (light_ldr == 0xFFFF) snprintf(l, sizeof(l), "E");
  else snprintf(l, sizeof(l), "%u", (unsigned)light_ldr);
  return snprintf(out, cap, "T%sC V%s L%s", t, v, l);
}

#endif // MATRIX_TEXT_H_
