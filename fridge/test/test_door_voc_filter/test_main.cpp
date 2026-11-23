#include <Arduino.h>
#include <unity.h>

#include "door_voc_filter.h"

static const uint16_t OPEN = LDR_DOOR_OPEN_THRESHOLD + 1;
static const uint16_t CLOSED = LDR_DOOR_OPEN_THRESHOLD;
static const uint16_t VOC = 123;

void setUp() {}
void tearDown() {}

void test_closed_door_passes_voc() {
  uint8_t cd = 0;
  TEST_ASSERT_EQUAL_UINT16(VOC, doorVocFilter(cd, CLOSED, VOC));
  TEST_ASSERT_EQUAL_UINT8(0, cd);
}

void test_open_door_masks_and_sets_cooldown() {
  uint8_t cd = 0;
  TEST_ASSERT_EQUAL_UINT16(VOC_NULL_SENTINEL, doorVocFilter(cd, OPEN, VOC));
  TEST_ASSERT_EQUAL_UINT8(DOOR_COOLDOWN_PACKETS, cd);
}

void test_cooldown_masks_exactly_twelve_closed_packets() {
  uint8_t cd = 0;
  doorVocFilter(cd, OPEN, VOC);
  for (int i = 0; i < DOOR_COOLDOWN_PACKETS; i++) {
    TEST_ASSERT_EQUAL_UINT16(VOC_NULL_SENTINEL, doorVocFilter(cd, CLOSED, VOC));
  }
  TEST_ASSERT_EQUAL_UINT8(0, cd);
  TEST_ASSERT_EQUAL_UINT16(VOC, doorVocFilter(cd, CLOSED, VOC));
}

void test_reopen_during_cooldown_resets_timer() {
  uint8_t cd = 0;
  doorVocFilter(cd, OPEN, VOC);
  for (int i = 0; i < 5; i++) doorVocFilter(cd, CLOSED, VOC);
  doorVocFilter(cd, OPEN, VOC);
  TEST_ASSERT_EQUAL_UINT8(DOOR_COOLDOWN_PACKETS, cd);
}

void test_ldr_error_does_not_start_cooldown() {
  uint8_t cd = 0;
  TEST_ASSERT_EQUAL_UINT16(VOC, doorVocFilter(cd, SENSOR_LIGHT_ERROR, VOC));
  TEST_ASSERT_EQUAL_UINT8(0, cd);
}

void test_voc_error_passes_through_when_stable() {
  uint8_t cd = 0;
  TEST_ASSERT_EQUAL_UINT16(SENSOR_VOC_ERROR, doorVocFilter(cd, CLOSED, SENSOR_VOC_ERROR));
}

void setup() {
  delay(2000);
  UNITY_BEGIN();
  RUN_TEST(test_closed_door_passes_voc);
  RUN_TEST(test_open_door_masks_and_sets_cooldown);
  RUN_TEST(test_cooldown_masks_exactly_twelve_closed_packets);
  RUN_TEST(test_reopen_during_cooldown_resets_timer);
  RUN_TEST(test_ldr_error_does_not_start_cooldown);
  RUN_TEST(test_voc_error_passes_through_when_stable);
  UNITY_END();
}

void loop() {}
