#ifndef DOOR_PROTOCOL_CODEC_H_
#define DOOR_PROTOCOL_CODEC_H_

#include <ArduinoJson.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "config.h"
#include "types.h"

// ==============================================================================
// Node 'D' (Door Closer Actuator) — Pure Protocol Codecs & Safety Helpers
// Mirrors interface/CBD.md JSON contracts and deterministic safety calculations
// with zero hardware or RTOS side-effects so unit tests can run cleanly.
// ==============================================================================

namespace door_protocol {

/**
 * @brief Computes linear soft-start PWM duty cycle over [0, ramp_ms].
 */
inline uint8_t computeSoftStartDuty(uint32_t elapsed_ms, uint8_t target_duty,
                                    uint16_t ramp_ms) {
  if (ramp_ms == 0 || elapsed_ms >= ramp_ms) {
    return target_duty;
  }
  const uint32_t scaled =
      (static_cast<uint32_t>(target_duty) * elapsed_ms) / ramp_ms;
  return static_cast<uint8_t>(scaled);
}

/**
 * @brief Evaluates one current sample against inrush blanking and consecutive
 *        stall count rules. Returns true when stall cutoff must trigger.
 */
inline bool evaluateStallSample(uint32_t elapsed_ms, uint16_t current_ma,
                                uint8_t& inout_consecutive_count) {
  if (elapsed_ms < door_config::CURRENT_INRUSH_BLANKING_MS) {
    inout_consecutive_count = 0;
    return false;
  }
  if (current_ma >= door_config::CURRENT_STALL_LIMIT_MA) {
    if (inout_consecutive_count < 255) {
      ++inout_consecutive_count;
    }
    return inout_consecutive_count >=
           door_config::CURRENT_STALL_CONSECUTIVE_SAMPLES;
  }
  inout_consecutive_count = 0;
  return false;
}

/**
 * @brief Parses an incoming `fridge/door/cmd` JSON payload into DoorCommandMsg.
 */
inline bool parseDoorCommandJson(const char* json_str, size_t len,
                                 const char* expected_node_id,
                                 door_types::DoorCommandMsg& out_msg) {
  if (json_str == nullptr || expected_node_id == nullptr) {
    return false;
  }
  memset(&out_msg, 0, sizeof(out_msg));

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, json_str, len);
  if (err != DeserializationError::Ok) {
    return false;
  }

  const char* node_id = doc["node_id"] | "";
  const char* cmd_id  = doc["cmd_id"] | "";
  const char* action  = doc["action"] | "";
  if (strcmp(node_id, expected_node_id) != 0 || cmd_id[0] == '\0') {
    return false;
  }

  if (strcmp(action, "CLOSE_DOOR") == 0) {
    out_msg.action = door_types::CommandAction::CLOSE_DOOR;
  } else if (strcmp(action, "ABORT") == 0) {
    out_msg.action = door_types::CommandAction::ABORT;
  } else {
    return false;
  }

  snprintf(out_msg.cmd_id, sizeof(out_msg.cmd_id), "%s", cmd_id);
  const char* reason = doc["reason"] | "";
  snprintf(out_msg.reason, sizeof(out_msg.reason), "%s", reason);

  const uint32_t timeout_s = doc["timeout_s"] | static_cast<uint32_t>(0);
  out_msg.timeout_s =
      (timeout_s > 0) ? timeout_s : door_config::DEFAULT_MOTION_TIMEOUT_S;
  out_msg.timestamp = doc["timestamp"] | static_cast<uint64_t>(0);
  return true;
}

/**
 * @brief Parses an incoming `fridge/door/time/res` payload and extracts epoch s.
 */
inline bool parseTimeResJson(const char* json_str, size_t len,
                             const char* expected_node_id,
                             uint64_t& out_timestamp) {
  if (json_str == nullptr || expected_node_id == nullptr) {
    return false;
  }
  JsonDocument doc;
  if (deserializeJson(doc, json_str, len) != DeserializationError::Ok) {
    return false;
  }
  const char* node_id = doc["node_id"] | "";
  if (strcmp(node_id, expected_node_id) != 0) {
    return false;
  }
  const uint64_t ts = doc["timestamp"] | static_cast<uint64_t>(0);
  if (ts == 0) {
    return false;
  }
  out_timestamp = ts;
  return true;
}

/**
 * @brief Serializes a DoorEventMsg into a `fridge/door/event` JSON string.
 */
inline size_t serializeDoorEventJson(const char* node_id,
                                     const door_types::DoorEventMsg& msg,
                                     char* out_buf, size_t out_buf_size) {
  if (node_id == nullptr || out_buf == nullptr || out_buf_size == 0) {
    return 0;
  }
  JsonDocument doc;
  doc["node_id"] = node_id;
  if (msg.ack_cmd_id[0] != '\0') {
    doc["ack_cmd_id"] = msg.ack_cmd_id;
  } else {
    doc["ack_cmd_id"] = nullptr;
  }

  JsonObject evt = doc["event"].to<JsonObject>();
  evt["type"]    = door_types::eventTypeToString(msg.type);

  switch (msg.type) {
    case door_types::DoorEventType::CLOSING:
      break;
    case door_types::DoorEventType::SUCCESS:
      evt["duration_ms"]     = msg.duration_ms;
      evt["peak_current_ma"] = msg.peak_current_ma;
      break;
    case door_types::DoorEventType::OBSTRUCTION_ERROR:
      evt["stall_current_ma"] = msg.stall_current_ma;
      evt["retracted"]        = msg.retracted;
      break;
    case door_types::DoorEventType::ABORTED:
      evt["trigger"]   = msg.detail_str;
      evt["retracted"] = msg.retracted;
      break;
    case door_types::DoorEventType::TIMEOUT_ERROR:
      evt["elapsed_ms"] = msg.elapsed_ms;
      break;
    case door_types::DoorEventType::FAULT_LOCKOUT:
    default:
      evt["reason"] = msg.detail_str;
      break;
  }

  doc["timestamp"] = msg.timestamp;
  return serializeJson(doc, out_buf, out_buf_size);
}

/**
 * @brief Serializes 1 Hz SharedDoorStatus into `fridge/door/telemetry` JSON.
 */
inline size_t serializeTelemetryJson(
    const char* node_id, uint64_t timestamp,
    const door_types::SharedDoorStatus& status, char* out_buf,
    size_t out_buf_size) {
  if (node_id == nullptr || out_buf == nullptr || out_buf_size == 0) {
    return 0;
  }
  JsonDocument doc;
  doc["node_id"]            = node_id;
  doc["timestamp"]          = timestamp;
  doc["ir_door_closed"]     = status.ir_door_closed;
  doc["limit_switch_homed"] = status.limit_switch_homed;
  doc["motor_state"]        = door_types::motorStateToString(status.motor_state);
  doc["current_ma"]         = status.current_ma;
  return serializeJson(doc, out_buf, out_buf_size);
}

/**
 * @brief Serializes ONLINE/OFFLINE lifecycle JSON for `fridge/door/status`.
 */
inline size_t serializeStatusJson(const char* node_id, bool online,
                                  uint64_t timestamp, char* out_buf,
                                  size_t out_buf_size) {
  if (node_id == nullptr || out_buf == nullptr || out_buf_size == 0) {
    return 0;
  }
  JsonDocument doc;
  doc["node_id"] = node_id;
  doc["state"]   = online ? "ONLINE" : "OFFLINE";
  if (online) {
    doc["timestamp"] = timestamp;
  } else {
    doc["timestamp"] = nullptr;
  }
  return serializeJson(doc, out_buf, out_buf_size);
}

/**
 * @brief Serializes `fridge/door/time/req` payload.
 */
inline size_t serializeTimeReqJson(const char* node_id, char* out_buf,
                                   size_t out_buf_size) {
  if (node_id == nullptr || out_buf == nullptr || out_buf_size == 0) {
    return 0;
  }
  JsonDocument doc;
  doc["node_id"] = node_id;
  return serializeJson(doc, out_buf, out_buf_size);
}

}  // namespace door_protocol

#endif  // DOOR_PROTOCOL_CODEC_H_
