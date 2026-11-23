#ifndef DOOR_TYPES_H_
#define DOOR_TYPES_H_

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/portmacro.h>
#include <stdbool.h>
#include <stdint.h>

// ==============================================================================
// Node 'D' (Door Closer Actuator) — Strongly-Typed Data Contracts & RTOS Types
// Mirrors schemas from interface/CBD.md locally without cross-folder linking.
// ==============================================================================

namespace door_types {

// ------------------------------------------------------------------------------
// 1. Actuator Finite State Machine (FSM) States
//    Maps directly to CBD.md telemetry `motor_state` strings:
//    "IDLE", "CLOSING", "RETRACTING", "FAULT" (HOMING_ON_BOOT reports as "RETRACTING")
// ------------------------------------------------------------------------------
enum class MotorState : uint8_t {
  HOMING_ON_BOOT = 0,  // Slow CCW retraction on boot if Limit Switch (IO33) is open
  IDLE,                // Arm parked against Home Limit Switch (IO33 == HIGH)
  CLOSING,             // CW forward drive pushing the refrigerator door shut
  RETRACTING,          // CCW reverse drive returning arm to Home Limit Switch
  FAULT                // Hardware safety lockout (INA219 dead or 30s timeout)
};

inline const char* motorStateToString(MotorState state) {
  switch (state) {
    case MotorState::IDLE:
      return "IDLE";
    case MotorState::CLOSING:
      return "CLOSING";
    case MotorState::HOMING_ON_BOOT:
    case MotorState::RETRACTING:
      return "RETRACTING";
    case MotorState::FAULT:
    default:
      return "FAULT";
  }
}

// ------------------------------------------------------------------------------
// 2. Direct Task Notification Bitmask (Sent to vMotorControlTask)
//    Used by Hardware ISRs, vCurrentMonitorTask, and vMqttCommTask to wake
//    vMotorControlTask in microseconds via xTaskNotify / xTaskNotifyFromISR.
// ------------------------------------------------------------------------------
enum MotorNotifyBits : uint32_t {
  NOTIFY_LIMIT_SWITCH_HIT  = (1UL << 0),  // IO33 RISING ISR: Arm reached home stop
  NOTIFY_MANUAL_ABORT_BTN  = (1UL << 1),  // IO16 (S1) FALLING ISR: Emergency stop pressed
  NOTIFY_DEBUG_CLOSE_BTN   = (1UL << 2),  // IO14 (S2) FALLING ISR: Manual debug close trigger
  NOTIFY_OBSTRUCTION_STALL = (1UL << 3),  // vCurrentMonitorTask: Motor current >= 1200 mA
  NOTIFY_INA219_FAULT      = (1UL << 4),  // vCurrentMonitorTask: INA219 I2C unresponsive
  NOTIFY_REMOTE_ABORT      = (1UL << 5),  // vMqttCommTask: Remote MQTTS ABORT received
  NOTIFY_NETWORK_LOST      = (1UL << 6)   // vMqttCommTask: Wi-Fi/MQTTS dropped during motion
};

// ------------------------------------------------------------------------------
// 3. Shared Inter-Task State (vCurrentMonitorTask <-> vMotorControlTask <-> vMqttCommTask)
//    Protected by a FreeRTOS critical section spinlock (portMUX_TYPE) so reads
//    and writes across Core 0 and Core 1 are atomic and non-blocking.
// ------------------------------------------------------------------------------
struct SharedDoorStatus {
  // Written by vCurrentMonitorTask (100 Hz moving / 10 Hz idle):
  uint16_t current_ma;        // Instantaneous DC motor draw in mA (0xFFFF on I2C fault)
  uint16_t peak_current_ma;   // Peak current observed during the active closing stroke
  uint16_t stall_current_ma;  // Current reading that triggered an OBSTRUCTION_ERROR
  bool ina219_healthy;        // True if INA219 is responding on I2C

  // Written by vMotorControlTask:
  MotorState motor_state;     // Current FSM state
  bool ir_door_closed;        // True when TCRT5000 (IO32) reads LOW
  bool limit_switch_homed;    // True when Limit Switch (IO33) reads HIGH
  uint32_t motion_start_ms;   // millis() timestamp when the motor was energized (inrush & timeout tracking)

  // Written by vMqttCommTask:
  bool mqtt_connected;        // True when TLS session to Gateway 'C' is active
  char last_abort_cmd_id[40]; // Stores cmd_id of an urgent remote ABORT command
};

// ------------------------------------------------------------------------------
// 4. Incoming Message Queue Payload: vMqttCommTask -> vMotorControlTask (xIncomingMsgQueue)
//    Mirrors `fridge/door/cmd` in interface/CBD.md Section 3.
// ------------------------------------------------------------------------------
enum class CommandAction : uint8_t {
  CLOSE_DOOR = 0,
  ABORT      = 1
};

struct DoorCommandMsg {
  char cmd_id[40];        // Unique command ID (or "debug-btn-s2" for local IO14 trigger)
  CommandAction action;   // CLOSE_DOOR or ABORT
  char reason[24];        // "HUMAN_APPROACH", "USER_CANCEL", "DEBUG_BUTTON", or ""
  uint32_t timeout_s;     // Hard motion timeout in seconds (default 30)
  uint64_t timestamp;     // Second-accurate Unix epoch timestamp
};

// ------------------------------------------------------------------------------
// 5. Outgoing Message Queue Payload: vMotorControlTask -> vMqttCommTask (xOutgoingMsgQueue)
//    Mirrors `fridge/door/event` in interface/CBD.md Section 4.
// ------------------------------------------------------------------------------
enum class DoorEventType : uint8_t {
  CLOSING = 0,        // Command accepted, warning buzzer + CW motor started
  SUCCESS,            // IR sensor confirmed shut + arm retracted to Limit Switch
  OBSTRUCTION_ERROR,  // INA219 >= 1200 mA during CLOSING -> halted & retracted to Limit Switch
  ABORTED,            // Remote ABORT or Manual S1 button -> halted & retracted
  TIMEOUT_ERROR,      // Motion > timeout_s without sensor trigger -> power cut
  FAULT_LOCKOUT       // Retraction stall jam, unresponsive INA219, or boot homing timeout
};

inline const char* eventTypeToString(DoorEventType type) {
  switch (type) {
    case DoorEventType::CLOSING:
      return "CLOSING";
    case DoorEventType::SUCCESS:
      return "SUCCESS";
    case DoorEventType::OBSTRUCTION_ERROR:
      return "OBSTRUCTION_ERROR";
    case DoorEventType::ABORTED:
      return "ABORTED";
    case DoorEventType::TIMEOUT_ERROR:
      return "TIMEOUT_ERROR";
    case DoorEventType::FAULT_LOCKOUT:
    default:
      return "FAULT_LOCKOUT";
  }
}

struct DoorEventMsg {
  DoorEventType type;
  char ack_cmd_id[40];   // Mirrors cmd_id, or empty "" (serialized as JSON null)
  uint64_t timestamp;    // Second-accurate Unix epoch timestamp

  // Event-specific payload fields (populated according to `type`):
  uint32_t duration_ms;      // SUCCESS: total closing + retraction time (ms)
  uint16_t peak_current_ma;  // SUCCESS: maximum current recorded during stroke (mA)
  uint16_t stall_current_ma; // OBSTRUCTION_ERROR: current spike that caused trip (mA)
  uint32_t elapsed_ms;       // TIMEOUT_ERROR: elapsed time before cutoff (ms)
  bool retracted;            // OBSTRUCTION_ERROR & ABORTED: true once homed
  char detail_str[32];       // ABORTED `trigger` ("REMOTE_ABORT" / "MANUAL_BUTTON")
                             // or FAULT_LOCKOUT `reason` ("RETRACTION_MECHANICAL_JAM" /
                             // "INA219_I2C_UNRESPONSIVE" / "BOOT_HOMING_TIMEOUT")
};

}  // namespace door_types

#endif  // DOOR_TYPES_H_
