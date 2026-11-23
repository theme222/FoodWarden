#include <Arduino.h>
#include <unity.h>

#include "ldr_scale.h"

// Raw ADC = 4095 - inverted level (the KidBright LDR reads higher in the dark).
static uint16_t raw(uint16_t inverted) { return (uint16_t)(LDR_ADC_MAX - inverted); }

void setUp() {}
void tearDown() {}

void test_bench_readings() {
  TEST_ASSERT_EQUAL_UINT16(0, ldrScale(raw(3080)));    // pitch black
  TEST_ASSERT_EQUAL_UINT16(705, ldrScale(raw(3800)));  // room light
  TEST_ASSERT_EQUAL_UINT16(1000, ldrScale(raw(4095))); // flashlight
}

void test_dark_point_and_below_clamp_to_zero() {
  TEST_ASSERT_EQUAL_UINT16(0, ldrScale(raw(FRIDGE_LDR_DARK)));
  TEST_ASSERT_EQUAL_UINT16(0, ldrScale(4095)); // inverted 0
  TEST_ASSERT_EQUAL_UINT16(1, ldrScale(raw(FRIDGE_LDR_DARK + 1)));
}

void test_out_of_range_raw_clamps_to_dark() {
  TEST_ASSERT_EQUAL_UINT16(0, ldrScale(0xFFFF));
}

void test_brighter_is_never_lower() {
  uint16_t prev = 0;
  for (uint16_t inv = 0; inv <= LDR_ADC_MAX; inv++) {
    const uint16_t v = ldrScale(raw(inv));
    TEST_ASSERT_TRUE(v >= prev);
    TEST_ASSERT_TRUE(v <= LDR_LIGHT_MAX);
    prev = v;
  }
}

void setup() {
  delay(2000);
  UNITY_BEGIN();
  RUN_TEST(test_bench_readings);
  RUN_TEST(test_dark_point_and_below_clamp_to_zero);
  RUN_TEST(test_out_of_range_raw_clamps_to_dark);
  RUN_TEST(test_brighter_is_never_lower);
  UNITY_END();
}

void loop() {}
