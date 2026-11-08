#include <Arduino.h>
#include <unity.h>

#include "node_state.h"

static const uint8_t SALT[8] = {1, 2, 3, 4, 5, 6, 7, 8};

static SensorSample makeSample(uint64_t ts) {
  SensorSample s;
  s.timestamp_s = ts;
  s.temp_cdeg = 400;
  s.voc_index = 100;
  s.light_ldr = 10;
  return s;
}

void setUp() {}
void tearDown() {}

void test_cold_boot_resets_state_and_installs_salt() {
  NodeState s;
  memset(&s, 0xAB, sizeof(s));
  nodeStateColdBoot(s, SALT);
  TEST_ASSERT_TRUE(s.initialised);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(SALT, s.session_salt, 8);
  TEST_ASSERT_EQUAL_UINT32(0, s.counter);
  TEST_ASSERT_EQUAL_UINT8(0, s.sample_count);
  TEST_ASSERT_EQUAL_UINT8(0, s.cooldown_packets_remaining);
  TEST_ASSERT_FALSE(s.voc.valid);
}

void test_buffer_reports_full_on_sixth_sample() {
  NodeState s;
  nodeStateColdBoot(s, SALT);
  for (int i = 0; i < NODE_BATCH_SIZE - 1; i++) {
    TEST_ASSERT_FALSE(nodeStateAppend(s, makeSample(i)));
  }
  TEST_ASSERT_TRUE(nodeStateAppend(s, makeSample(99)));
  TEST_ASSERT_EQUAL_UINT8(NODE_BATCH_SIZE, s.sample_count);
  TEST_ASSERT_EQUAL_UINT64(0, s.samples[0].timestamp_s);
  TEST_ASSERT_EQUAL_UINT64(99, s.samples[NODE_BATCH_SIZE - 1].timestamp_s);
}

void test_append_when_full_drops_oldest() {
  NodeState s;
  nodeStateColdBoot(s, SALT);
  for (int i = 0; i < NODE_BATCH_SIZE; i++) nodeStateAppend(s, makeSample(i));
  nodeStateAppend(s, makeSample(100));
  TEST_ASSERT_EQUAL_UINT8(NODE_BATCH_SIZE, s.sample_count);
  TEST_ASSERT_EQUAL_UINT64(1, s.samples[0].timestamp_s);
  TEST_ASSERT_EQUAL_UINT64(100, s.samples[NODE_BATCH_SIZE - 1].timestamp_s);
}

void test_clear_buffer_keeps_counter_and_salt() {
  NodeState s;
  nodeStateColdBoot(s, SALT);
  nodeStateNextCounter(s);
  nodeStateAppend(s, makeSample(1));
  nodeStateClearBuffer(s);
  TEST_ASSERT_EQUAL_UINT8(0, s.sample_count);
  TEST_ASSERT_EQUAL_UINT32(1, s.counter);
  TEST_ASSERT_EQUAL_UINT8_ARRAY(SALT, s.session_salt, 8);
}

void test_counter_is_strictly_increasing_from_one() {
  NodeState s;
  nodeStateColdBoot(s, SALT);
  uint32_t prev = 0;
  for (int i = 0; i < 1000; i++) {
    uint32_t c = nodeStateNextCounter(s);
    TEST_ASSERT_TRUE(c > prev);
    prev = c;
  }
  TEST_ASSERT_EQUAL_UINT32(1000, prev);
}

static void fill(NodeState &s, int n) {
  for (int i = 0; i < n; i++) nodeStateAppend(s, makeSample(i));
}

void test_no_send_with_empty_buffer_even_if_forced() {
  NodeState s;
  nodeStateColdBoot(s, SALT);
  TEST_ASSERT_FALSE(nodeStateShouldSend(s, true, true));
}

void test_send_when_batch_full() {
  NodeState s;
  nodeStateColdBoot(s, SALT);
  fill(s, NODE_BATCH_SIZE - 1);
  TEST_ASSERT_FALSE(nodeStateShouldSend(s, false, false));
  fill(s, 1);
  TEST_ASSERT_TRUE(nodeStateShouldSend(s, false, false));
}

void test_door_open_edge_sends_partial_buffer_once() {
  NodeState s;
  nodeStateColdBoot(s, SALT);
  fill(s, 2);
  TEST_ASSERT_TRUE(nodeStateShouldSend(s, true, false));  // closed -> open
  s.door_was_open = true;
  TEST_ASSERT_FALSE(nodeStateShouldSend(s, true, false)); // still open: no repeat
  s.door_was_open = false;
  TEST_ASSERT_TRUE(nodeStateShouldSend(s, true, false));  // opens again
}

void test_force_sends_partial_buffer() {
  NodeState s;
  nodeStateColdBoot(s, SALT);
  fill(s, 1);
  TEST_ASSERT_TRUE(nodeStateShouldSend(s, false, true));
}

void test_ok_and_failed_results_discard_buffer() {
  NodeState s;
  nodeStateColdBoot(s, SALT);
  fill(s, NODE_BATCH_SIZE);
  nodeStateOnSendResult(s, SEND_OK);
  TEST_ASSERT_EQUAL_UINT8(0, s.sample_count);
  fill(s, NODE_BATCH_SIZE);
  nodeStateOnSendResult(s, SEND_FAILED);
  TEST_ASSERT_EQUAL_UINT8(0, s.sample_count);
  TEST_ASSERT_EQUAL_UINT8(0, s.retry_holdoff);
}

void test_no_connection_retains_buffer_and_holds_off_a_full_batch() {
  NodeState s;
  nodeStateColdBoot(s, SALT);
  fill(s, NODE_BATCH_SIZE);
  nodeStateOnSendResult(s, SEND_NO_CONNECTION);
  TEST_ASSERT_EQUAL_UINT8(NODE_BATCH_SIZE, s.sample_count);
  for (int i = 0; i < NODE_BATCH_SIZE; i++) {
    nodeStateTickHoldoff(s);
    nodeStateAppend(s, makeSample(100 + i));
    bool expect_send = (i == NODE_BATCH_SIZE - 1);
    TEST_ASSERT_EQUAL(expect_send, nodeStateShouldSend(s, false, false));
  }
  TEST_ASSERT_EQUAL_UINT8(NODE_BATCH_SIZE, s.sample_count); // oldest were overwritten
}

void test_door_open_edge_ignores_holdoff() {
  NodeState s;
  nodeStateColdBoot(s, SALT);
  fill(s, NODE_BATCH_SIZE);
  nodeStateOnSendResult(s, SEND_NO_CONNECTION);
  TEST_ASSERT_TRUE(nodeStateShouldSend(s, true, false));
}

void setup() {
  delay(2000);
  UNITY_BEGIN();
  RUN_TEST(test_cold_boot_resets_state_and_installs_salt);
  RUN_TEST(test_buffer_reports_full_on_sixth_sample);
  RUN_TEST(test_append_when_full_drops_oldest);
  RUN_TEST(test_clear_buffer_keeps_counter_and_salt);
  RUN_TEST(test_counter_is_strictly_increasing_from_one);
  RUN_TEST(test_no_send_with_empty_buffer_even_if_forced);
  RUN_TEST(test_send_when_batch_full);
  RUN_TEST(test_door_open_edge_sends_partial_buffer_once);
  RUN_TEST(test_force_sends_partial_buffer);
  RUN_TEST(test_ok_and_failed_results_discard_buffer);
  RUN_TEST(test_no_connection_retains_buffer_and_holds_off_a_full_batch);
  RUN_TEST(test_door_open_edge_ignores_holdoff);
  UNITY_END();
}

void loop() {}
