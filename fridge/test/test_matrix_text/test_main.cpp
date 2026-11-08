#include <Arduino.h>
#include <string.h>
#include <unity.h>

#include "matrix_text.h"

void setUp() {}
void tearDown() {}

void test_render_one_digit_adds_blank_column() {
  uint8_t cols[16];
  size_t n = matrixRenderText("1", cols, sizeof(cols));
  TEST_ASSERT_EQUAL_UINT32(6, n);
  const uint8_t expected[6] = {0x00, 0x42, 0x7F, 0x40, 0x00, 0x00};
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, cols, 6);
}

void test_render_never_overflows_buffer() {
  uint8_t cols[7];
  memset(cols, 0xEE, sizeof(cols));
  size_t n = matrixRenderText("8888", cols, 7);
  TEST_ASSERT_EQUAL_UINT32(7, n);
}

void test_unknown_character_uses_placeholder() {
  uint8_t cols[6];
  matrixRenderText("#", cols, sizeof(cols));
  TEST_ASSERT_EQUAL_UINT8_ARRAY(MATRIX_UNKNOWN_GLYPH, cols, MATRIX_FONT_WIDTH);
}

void test_all_font_glyphs_fit_in_seven_rows() {
  for (size_t i = 0; i < sizeof(MATRIX_FONT) / sizeof(MATRIX_FONT[0]); i++) {
    for (int c = 0; c < MATRIX_FONT_WIDTH; c++) TEST_ASSERT_EQUAL_UINT8(0, MATRIX_FONT[i].cols[c] & 0x80);
  }
}

void test_format_normal_readings() {
  char out[32];
  matrixFormatReadings(out, sizeof(out), 342, 100, 512);
  TEST_ASSERT_EQUAL_STRING("T3.4C V100 L512", out);
}

void test_format_rounds_and_handles_negative() {
  char out[32];
  matrixFormatReadings(out, sizeof(out), -149, 1, 0);
  TEST_ASSERT_EQUAL_STRING("T-1.5C V1 L0", out);
  matrixFormatReadings(out, sizeof(out), 399, 500, 4095);
  TEST_ASSERT_EQUAL_STRING("T4.0C V500 L4095", out);
}

void test_format_shows_errors_as_E() {
  char out[32];
  matrixFormatReadings(out, sizeof(out), (int16_t)-32768, 0xFFFF, 0xFFFF);
  TEST_ASSERT_EQUAL_STRING("TEC VE LE", out);
}

void test_format_fits_scroll_buffer_worst_case() {
  char out[32];
  int n = matrixFormatReadings(out, sizeof(out), -3000, 500, 4095);
  TEST_ASSERT_TRUE(n > 0 && n < (int)sizeof(out));
  uint8_t cols[160];
  TEST_ASSERT_TRUE(matrixRenderText(out, cols, sizeof(cols)) < sizeof(cols));
}

void setup() {
  delay(2000);
  UNITY_BEGIN();
  RUN_TEST(test_render_one_digit_adds_blank_column);
  RUN_TEST(test_render_never_overflows_buffer);
  RUN_TEST(test_unknown_character_uses_placeholder);
  RUN_TEST(test_all_font_glyphs_fit_in_seven_rows);
  RUN_TEST(test_format_normal_readings);
  RUN_TEST(test_format_rounds_and_handles_negative);
  RUN_TEST(test_format_shows_errors_as_E);
  RUN_TEST(test_format_fits_scroll_buffer_worst_case);
  UNITY_END();
}

void loop() {}
