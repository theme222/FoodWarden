#include <Arduino.h>
#include <ArduinoJson.h>
#include <string.h>
#include <unity.h>

#include "config.h"
#include "protocol_codec.h"
#include "rtos_state.h"
#include "types.h"

void setUp() {}

void tearDown() {}

void test_parse_close_door_cmd() {
  const char* valid_json =
      "{\"cmd_id\":\"c-9b1d8f20-1a2b\",\"node_id\":\"D0\",\"action\":\"CLOSE_"
      "DOOR\",\"timeout_s\":25,\"timestamp\":1729930015}";
  door_types::DoorCommandMsg msg;
  TEST_ASSERT_TRUE(door_protocol::parseDoorCommandJson(
      valid_json, strlen(valid_json), "D0", msg));
  TEST_ASSERT_EQUAL_STRING("c-9b1d8f20-1a2b", msg.cmd_id);
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(door_types::CommandAction::CLOSE_DOOR),
      static_cast<uint8_t>(msg.action));
  TEST_ASSERT_EQUAL_UINT32(25, msg.timeout_s);
  TEST_ASSERT_TRUE(msg.timestamp == 1729930015ULL);

  // Missing timeout_s falls back to DEFAULT_MOTION_TIMEOUT_S
  const char* no_timeout_json =
      "{\"cmd_id\":\"c-2\",\"node_id\":\"D0\",\"action\":\"CLOSE_DOOR\","
      "\"timestamp\":1729930099}";
  TEST_ASSERT_TRUE(door_protocol::parseDoorCommandJson(
      no_timeout_json, strlen(no_timeout_json), "D0", msg));
  TEST_ASSERT_EQUAL_UINT32(door_config::DEFAULT_MOTION_TIMEOUT_S,
                           msg.timeout_s);

  // Malformed JSON or empty cmd_id must fail
  const char* bad_json = "{\"node_id\":\"D0\",\"action\":\"CLOSE_DOOR\"}";
  TEST_ASSERT_FALSE(door_protocol::parseDoorCommandJson(
      bad_json, strlen(bad_json), "D0", msg));
}

void test_parse_abort_cmd_and_node_filter() {
  const char* abort_json =
      "{\"cmd_id\":\"c-abort-1\",\"node_id\":\"D0\",\"action\":\"ABORT\","
      "\"reason\":\"HUMAN_APPROACH\",\"timestamp\":1729930020}";
  door_types::DoorCommandMsg msg;
  TEST_ASSERT_TRUE(door_protocol::parseDoorCommandJson(
      abort_json, strlen(abort_json), "D0", msg));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(door_types::CommandAction::ABORT),
      static_cast<uint8_t>(msg.action));
  TEST_ASSERT_EQUAL_STRING("HUMAN_APPROACH", msg.reason);

  // Wrong node_id must be rejected
  const char* wrong_node =
      "{\"cmd_id\":\"c-abort-2\",\"node_id\":\"D1\",\"action\":\"ABORT\","
      "\"timestamp\":1729930021}";
  TEST_ASSERT_FALSE(door_protocol::parseDoorCommandJson(
      wrong_node, strlen(wrong_node), "D0", msg));

  // Time sync response validation
  uint64_t ts         = 0;
  const char* time_ok = "{\"node_id\":\"D0\",\"timestamp\":1729930000}";
  TEST_ASSERT_TRUE(
      door_protocol::parseTimeResJson(time_ok, strlen(time_ok), "D0", ts));
  TEST_ASSERT_TRUE(ts == 1729930000ULL);

  const char* time_bad_node = "{\"node_id\":\"D1\",\"timestamp\":1729930000}";
  TEST_ASSERT_FALSE(door_protocol::parseTimeResJson(
      time_bad_node, strlen(time_bad_node), "D0", ts));
}

void test_serialize_all_door_events() {
  char buf[256];
  door_types::DoorEventMsg evt;

  // 1. CLOSING
  memset(&evt, 0, sizeof(evt));
  evt.type      = door_types::DoorEventType::CLOSING;
  evt.timestamp = 1729930016ULL;
  snprintf(evt.ack_cmd_id, sizeof(evt.ack_cmd_id), "c-1");
  TEST_ASSERT_GREATER_THAN_UINT32(
      0, door_protocol::serializeDoorEventJson("D0", evt, buf, sizeof(buf)));
  {
    JsonDocument doc;
    TEST_ASSERT_TRUE(deserializeJson(doc, buf) == DeserializationError::Ok);
    TEST_ASSERT_EQUAL_STRING("D0", doc["node_id"]);
    TEST_ASSERT_EQUAL_STRING("c-1", doc["ack_cmd_id"]);
    TEST_ASSERT_EQUAL_STRING("CLOSING", doc["event"]["type"]);
  }

  // 2. SUCCESS
  memset(&evt, 0, sizeof(evt));
  evt.type            = door_types::DoorEventType::SUCCESS;
  evt.duration_ms     = 4250;
  evt.peak_current_ma = 185;
  evt.timestamp       = 1729930020ULL;
  snprintf(evt.ack_cmd_id, sizeof(evt.ack_cmd_id), "c-1");
  TEST_ASSERT_GREATER_THAN_UINT32(
      0, door_protocol::serializeDoorEventJson("D0", evt, buf, sizeof(buf)));
  {
    JsonDocument doc;
    TEST_ASSERT_TRUE(deserializeJson(doc, buf) == DeserializationError::Ok);
    TEST_ASSERT_EQUAL_STRING("SUCCESS", doc["event"]["type"]);
    TEST_ASSERT_EQUAL_UINT32(4250, doc["event"]["duration_ms"]);
    TEST_ASSERT_EQUAL_UINT16(185, doc["event"]["peak_current_ma"]);
  }

  // 3. OBSTRUCTION_ERROR
  memset(&evt, 0, sizeof(evt));
  evt.type             = door_types::DoorEventType::OBSTRUCTION_ERROR;
  evt.stall_current_ma = 240;
  evt.retracted        = true;
  evt.timestamp        = 1729930018ULL;
  snprintf(evt.ack_cmd_id, sizeof(evt.ack_cmd_id), "c-1");
  TEST_ASSERT_GREATER_THAN_UINT32(
      0, door_protocol::serializeDoorEventJson("D0", evt, buf, sizeof(buf)));
  {
    JsonDocument doc;
    TEST_ASSERT_TRUE(deserializeJson(doc, buf) == DeserializationError::Ok);
    TEST_ASSERT_EQUAL_STRING("OBSTRUCTION_ERROR", doc["event"]["type"]);
    TEST_ASSERT_EQUAL_UINT16(240, doc["event"]["stall_current_ma"]);
    TEST_ASSERT_TRUE(doc["event"]["retracted"]);
  }

  // 4. ABORTED
  memset(&evt, 0, sizeof(evt));
  evt.type      = door_types::DoorEventType::ABORTED;
  evt.retracted = true;
  evt.timestamp = 1729930022ULL;
  snprintf(evt.ack_cmd_id, sizeof(evt.ack_cmd_id), "c-abort");
  snprintf(evt.detail_str, sizeof(evt.detail_str), "REMOTE_ABORT");
  TEST_ASSERT_GREATER_THAN_UINT32(
      0, door_protocol::serializeDoorEventJson("D0", evt, buf, sizeof(buf)));
  {
    JsonDocument doc;
    TEST_ASSERT_TRUE(deserializeJson(doc, buf) == DeserializationError::Ok);
    TEST_ASSERT_EQUAL_STRING("ABORTED", doc["event"]["type"]);
    TEST_ASSERT_EQUAL_STRING("REMOTE_ABORT", doc["event"]["trigger"]);
    TEST_ASSERT_TRUE(doc["event"]["retracted"]);
  }

  // 5. TIMEOUT_ERROR
  memset(&evt, 0, sizeof(evt));
  evt.type       = door_types::DoorEventType::TIMEOUT_ERROR;
  evt.elapsed_ms = 30000;
  evt.timestamp  = 1729930046ULL;
  snprintf(evt.ack_cmd_id, sizeof(evt.ack_cmd_id), "c-1");
  TEST_ASSERT_GREATER_THAN_UINT32(
      0, door_protocol::serializeDoorEventJson("D0", evt, buf, sizeof(buf)));
  {
    JsonDocument doc;
    TEST_ASSERT_TRUE(deserializeJson(doc, buf) == DeserializationError::Ok);
    TEST_ASSERT_EQUAL_STRING("TIMEOUT_ERROR", doc["event"]["type"]);
    TEST_ASSERT_EQUAL_UINT32(30000, doc["event"]["elapsed_ms"]);
  }

  // 6. FAULT_LOCKOUT with null ack_cmd_id
  memset(&evt, 0, sizeof(evt));
  evt.type      = door_types::DoorEventType::FAULT_LOCKOUT;
  evt.timestamp = 1729930001ULL;
  snprintf(evt.detail_str, sizeof(evt.detail_str), "INA219_I2C_UNRESPONSIVE");
  TEST_ASSERT_GREATER_THAN_UINT32(
      0, door_protocol::serializeDoorEventJson("D0", evt, buf, sizeof(buf)));
  {
    JsonDocument doc;
    TEST_ASSERT_TRUE(deserializeJson(doc, buf) == DeserializationError::Ok);
    TEST_ASSERT_TRUE(doc["ack_cmd_id"].isNull());
    TEST_ASSERT_EQUAL_STRING("FAULT_LOCKOUT", doc["event"]["type"]);
    TEST_ASSERT_EQUAL_STRING("INA219_I2C_UNRESPONSIVE",
                             doc["event"]["reason"]);
  }
}

void test_serialize_telemetry_and_status() {
  char buf[256];
  door_types::SharedDoorStatus status;
  memset(&status, 0, sizeof(status));
  status.ir_door_closed     = false;
  status.limit_switch_homed = true;
  status.motor_state        = door_types::MotorState::HOMING_ON_BOOT;
  status.current_ma         = 48;

  TEST_ASSERT_GREATER_THAN_UINT32(
      0, door_protocol::serializeTelemetryJson("D0", 1729930010ULL, status, buf,
                                               sizeof(buf)));
  {
    JsonDocument doc;
    TEST_ASSERT_TRUE(deserializeJson(doc, buf) == DeserializationError::Ok);
    TEST_ASSERT_EQUAL_STRING("D0", doc["node_id"]);
    TEST_ASSERT_FALSE(doc["ir_door_closed"]);
    TEST_ASSERT_TRUE(doc["limit_switch_homed"]);
    TEST_ASSERT_EQUAL_STRING("RETRACTING", doc["motor_state"]);
    TEST_ASSERT_EQUAL_UINT16(48, doc["current_ma"]);
  }

  // ONLINE & OFFLINE status
  TEST_ASSERT_GREATER_THAN_UINT32(
      0, door_protocol::serializeStatusJson("D0", true, 1729930001ULL, buf,
                                            sizeof(buf)));
  {
    JsonDocument doc;
    TEST_ASSERT_TRUE(deserializeJson(doc, buf) == DeserializationError::Ok);
    TEST_ASSERT_EQUAL_STRING("ONLINE", doc["state"]);
    TEST_ASSERT_TRUE(doc["timestamp"].as<uint64_t>() == 1729930001ULL);
  }

  TEST_ASSERT_GREATER_THAN_UINT32(
      0, door_protocol::serializeStatusJson("D0", false, 0, buf, sizeof(buf)));
  {
    JsonDocument doc;
    TEST_ASSERT_TRUE(deserializeJson(doc, buf) == DeserializationError::Ok);
    TEST_ASSERT_EQUAL_STRING("OFFLINE", doc["state"]);
    TEST_ASSERT_TRUE(doc["timestamp"].isNull());
  }
}

void test_soft_start_ramp_and_stall_blanking() {
  TEST_ASSERT_EQUAL_UINT8(0,
                          door_protocol::computeSoftStartDuty(0, 220, 250));
  TEST_ASSERT_EQUAL_UINT8(110,
                          door_protocol::computeSoftStartDuty(125, 220, 250));
  TEST_ASSERT_EQUAL_UINT8(220,
                          door_protocol::computeSoftStartDuty(250, 220, 250));
  TEST_ASSERT_EQUAL_UINT8(220,
                          door_protocol::computeSoftStartDuty(500, 220, 250));
  TEST_ASSERT_EQUAL_UINT8(220,
                          door_protocol::computeSoftStartDuty(0, 220, 0));

  uint8_t count = 0;
  // During 150 ms inrush blanking, even 500 mA must not trip
  TEST_ASSERT_FALSE(door_protocol::evaluateStallSample(100, 500, count));
  TEST_ASSERT_EQUAL_UINT8(0, count);

  // First sample >= 225 mA after blanking increments count to 1 (no trip yet)
  TEST_ASSERT_FALSE(door_protocol::evaluateStallSample(150, 225, count));
  TEST_ASSERT_EQUAL_UINT8(1, count);

  // Dropping below 225 mA resets consecutive count
  TEST_ASSERT_FALSE(door_protocol::evaluateStallSample(160, 224, count));
  TEST_ASSERT_EQUAL_UINT8(0, count);

  // Two consecutive >= 225 mA samples trip cutoff
  TEST_ASSERT_FALSE(door_protocol::evaluateStallSample(170, 225, count));
  TEST_ASSERT_TRUE(door_protocol::evaluateStallSample(180, 240, count));
  TEST_ASSERT_EQUAL_UINT8(2, count);
}

void test_rtos_shared_state_and_clock() {
  door_rtos::initRtosPrimitives();
  TEST_ASSERT_NOT_NULL(door_rtos::state().incoming_queue);
  TEST_ASSERT_NOT_NULL(door_rtos::state().outgoing_queue);

  door_rtos::updateMotorState(door_types::MotorState::CLOSING, false, false,
                              100, true);
  door_rtos::updateCurrentMetrics(65, true, 0);
  door_rtos::updateCurrentMetrics(180, true, 0);
  door_rtos::updateCurrentMetrics(120, true, 0);

  const door_types::SharedDoorStatus snap = door_rtos::getSharedStatus();
  TEST_ASSERT_EQUAL_UINT16(120, snap.current_ma);
  TEST_ASSERT_EQUAL_UINT16(180, snap.peak_current_ma);
  TEST_ASSERT_TRUE(snap.ina219_healthy);

  door_rtos::setUnixTimestamp(1729930000ULL);
  const uint64_t ts = door_rtos::getUnixTimestamp();
  TEST_ASSERT_TRUE(ts >= 1729930000ULL);
}

void setup() {
  delay(2000);
  UNITY_BEGIN();
  RUN_TEST(test_parse_close_door_cmd);
  RUN_TEST(test_parse_abort_cmd_and_node_filter);
  RUN_TEST(test_serialize_all_door_events);
  RUN_TEST(test_serialize_telemetry_and_status);
  RUN_TEST(test_soft_start_ramp_and_stall_blanking);
  RUN_TEST(test_rtos_shared_state_and_clock);
  UNITY_END();
}

void loop() {}
