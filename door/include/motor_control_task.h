#ifndef DOOR_MOTOR_CONTROL_TASK_H_
#define DOOR_MOTOR_CONTROL_TASK_H_

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "config.h"
#include "controllers.h"
#include "protocol_codec.h"
#include "rtos_state.h"
#include "types.h"

#if __has_include("secrets.h")
#include "secrets.h"
#endif
#ifndef DOOR_NODE_ID
#define DOOR_NODE_ID "D0"
#endif

// ==============================================================================
// Node 'D' (Door Closer Actuator) — vMotorControlTask (Priority 3, Core 1)
// Owns the actuator Finite State Machine, TB6612FNG PWM/direction outputs,
// piezo warning tone, and all safety transition reflexes.
// ==============================================================================

namespace door_tasks {

enum class RetractReason : uint8_t {
  NONE = 0,
  FOR_SUCCESS,
  FOR_OBSTRUCTION,
  FOR_REMOTE_ABORT,
  FOR_MANUAL_ABORT,
  FOR_NET_LOSS
};

struct MotorFsmContext {
  door_types::MotorState state;
  RetractReason retract_reason;
  char active_cmd_id[40];
  char abort_ack_id[40];
  uint32_t motion_start_ms;
  uint32_t stroke_start_ms;
  uint32_t ir_seal_start_ms;
  uint32_t active_timeout_ms;
  uint32_t buzzer_step_ms;
  uint64_t beep_start_us;
  uint64_t ir_seal_start_us;
  uint8_t buzzer_step;
  bool waiting_warning_beeps;
  bool buzzer_active;
};

inline const char* retractReasonName(RetractReason reason) {
  switch (reason) {
    case RetractReason::FOR_SUCCESS:
      return "FOR_SUCCESS";
    case RetractReason::FOR_OBSTRUCTION:
      return "FOR_OBSTRUCTION";
    case RetractReason::FOR_REMOTE_ABORT:
      return "FOR_REMOTE_ABORT";
    case RetractReason::FOR_MANUAL_ABORT:
      return "FOR_MANUAL_ABORT";
    case RetractReason::FOR_NET_LOSS:
      return "FOR_NET_LOSS";
    case RetractReason::NONE:
      return "BOOT_HOMING";
  }
  return "UNKNOWN";
}

inline void enqueueDoorEvent(const door_types::DoorEventMsg& msg) {
  QueueHandle_t q = door_rtos::state().outgoing_queue;
  if (q != nullptr) {
    xQueueSend(q, &msg, 0);
  }
}

inline door_types::DoorEventMsg makeBaseEvent(door_types::DoorEventType type,
                                              const char* ack_cmd_id) {
  door_types::DoorEventMsg msg;
  memset(&msg, 0, sizeof(msg));
  msg.type      = type;
  msg.timestamp = door_rtos::getUnixTimestamp();
  if (ack_cmd_id != nullptr && ack_cmd_id[0] != '\0') {
    snprintf(msg.ack_cmd_id, sizeof(msg.ack_cmd_id), "%s", ack_cmd_id);
  }
  return msg;
}

inline void stopWarningBuzzer(MotorFsmContext& fsm) {
  if (fsm.buzzer_active) {
    door_controllers::buzzerOff();
    fsm.buzzer_active = false;
  }
  fsm.waiting_warning_beeps = false;
}

inline void enterFaultLockout(MotorFsmContext& fsm, const char* reason,
                              const char* ack_cmd_id) {
  door_controllers::motorCoastStop();
  stopWarningBuzzer(fsm);
  fsm.state          = door_types::MotorState::FAULT;
  fsm.retract_reason = RetractReason::NONE;

  door_rtos::updateMotorState(fsm.state, door_controllers::isIrDoorClosed(),
                              door_controllers::isLimitSwitchHomed(), 0, false);

  door_types::DoorEventMsg evt =
      makeBaseEvent(door_types::DoorEventType::FAULT_LOCKOUT, ack_cmd_id);
  snprintf(evt.detail_str, sizeof(evt.detail_str), "%s",
           (reason != nullptr) ? reason : "UNKNOWN_FAULT");
  Serial.printf("[FSM] FAULT_LOCKOUT -> reason=%s\n", evt.detail_str);
  enqueueDoorEvent(evt);
}

inline void finishHomingToIdle(MotorFsmContext& fsm, uint32_t now_ms) {
  door_controllers::motorShortBrake();
  const uint64_t brake_us = door_rtos::nowUs();
  stopWarningBuzzer(fsm);

  const door_types::SharedDoorStatus snap = door_rtos::getSharedStatus();
  const RetractReason reason              = fsm.retract_reason;

  const uint64_t isr_us = door_rtos::state().limit_isr_us;
  if (isr_us > 0 && brake_us >= isr_us) {
    door_rtos::state().limit_isr_us = 0;
    Serial.printf("[TIMING] node=%s evt=LIMIT_ISR_BRAKE t_us=%llu isr_to_brake_us=%llu reason=%s\n",
                  DOOR_NODE_ID, static_cast<unsigned long long>(brake_us),
                  static_cast<unsigned long long>(brake_us - isr_us),
                  retractReasonName(reason));
  }

  fsm.state          = door_types::MotorState::IDLE;
  fsm.retract_reason = RetractReason::NONE;
  door_rtos::updateMotorState(fsm.state, door_controllers::isIrDoorClosed(),
                              true, 0, false);
  Serial.printf("[FSM] Limit switch HOMED -> motor braked, state=IDLE\n");

  if (reason == RetractReason::FOR_SUCCESS) {
    door_types::DoorEventMsg evt =
        makeBaseEvent(door_types::DoorEventType::SUCCESS, fsm.active_cmd_id);
    evt.duration_ms     = now_ms - fsm.stroke_start_ms;
    evt.peak_current_ma = snap.peak_current_ma;
    Serial.printf("[TIMING] node=%s evt=STROKE_SUCCESS t_us=%llu cmd_id=%s duration_ms=%lu peak_ma=%u\n",
                  DOOR_NODE_ID, static_cast<unsigned long long>(brake_us),
                  (fsm.active_cmd_id[0] != '\0') ? fsm.active_cmd_id : "-",
                  static_cast<unsigned long>(evt.duration_ms), evt.peak_current_ma);
    enqueueDoorEvent(evt);
  } else if (reason == RetractReason::FOR_OBSTRUCTION) {
    door_types::DoorEventMsg evt = makeBaseEvent(
        door_types::DoorEventType::OBSTRUCTION_ERROR, fsm.active_cmd_id);
    evt.stall_current_ma = snap.stall_current_ma;
    evt.retracted        = true;
    enqueueDoorEvent(evt);
  } else if (reason == RetractReason::FOR_REMOTE_ABORT ||
             reason == RetractReason::FOR_MANUAL_ABORT ||
             reason == RetractReason::FOR_NET_LOSS) {
    const char* ack_id = (reason == RetractReason::FOR_REMOTE_ABORT &&
                          fsm.abort_ack_id[0] != '\0')
                             ? fsm.abort_ack_id
                             : fsm.active_cmd_id;
    door_types::DoorEventMsg evt =
        makeBaseEvent(door_types::DoorEventType::ABORTED, ack_id);
    evt.retracted = true;
    if (reason == RetractReason::FOR_REMOTE_ABORT) {
      snprintf(evt.detail_str, sizeof(evt.detail_str), "REMOTE_ABORT");
    } else if (reason == RetractReason::FOR_MANUAL_ABORT) {
      snprintf(evt.detail_str, sizeof(evt.detail_str), "MANUAL_BUTTON");
    } else {
      snprintf(evt.detail_str, sizeof(evt.detail_str), "NETWORK_LOST");
    }
    enqueueDoorEvent(evt);
  }

  fsm.active_cmd_id[0] = '\0';
  fsm.abort_ack_id[0]  = '\0';
}

inline void beginRetraction(MotorFsmContext& fsm, RetractReason reason,
                            const char* abort_cmd_id, uint32_t now_ms) {
  door_controllers::motorShortBrake();
  const uint64_t brake_us = door_rtos::nowUs();
  stopWarningBuzzer(fsm);

  if (reason == RetractReason::FOR_REMOTE_ABORT) {
    const uint64_t rx_us = door_rtos::state().mqtt_rx_us;
    const uint64_t delta = (rx_us > 0 && brake_us >= rx_us) ? (brake_us - rx_us) : 0;
    const char* cid = (abort_cmd_id != nullptr && abort_cmd_id[0] != '\0')
                          ? abort_cmd_id
                          : ((fsm.active_cmd_id[0] != '\0') ? fsm.active_cmd_id : "-");
    Serial.printf("[TIMING] node=%s evt=ABORT_BRAKE t_us=%llu cmd_id=%s rx_to_brake_us=%llu\n",
                  DOOR_NODE_ID, static_cast<unsigned long long>(brake_us), cid,
                  static_cast<unsigned long long>(delta));
  } else if (reason == RetractReason::FOR_MANUAL_ABORT) {
    const uint64_t isr_us = door_rtos::state().abort_isr_us;
    door_rtos::state().abort_isr_us = 0;
    const uint64_t delta = (isr_us > 0 && brake_us >= isr_us) ? (brake_us - isr_us) : 0;
    Serial.printf("[TIMING] node=%s evt=S1_ISR_BRAKE t_us=%llu isr_to_brake_us=%llu\n",
                  DOOR_NODE_ID, static_cast<unsigned long long>(brake_us),
                  static_cast<unsigned long long>(delta));
  } else if (reason == RetractReason::FOR_OBSTRUCTION) {
    const uint64_t trip_us  = door_rtos::state().stall_trip_us;
    const uint64_t first_us = door_rtos::state().stall_first_over_us;
    door_rtos::state().stall_trip_us       = 0;
    door_rtos::state().stall_first_over_us = 0;
    const uint64_t trip_delta  = (trip_us > 0 && brake_us >= trip_us) ? (brake_us - trip_us) : 0;
    const uint64_t first_delta = (first_us > 0 && brake_us >= first_us) ? (brake_us - first_us) : 0;
    const door_types::SharedDoorStatus snap = door_rtos::getSharedStatus();
    Serial.printf("[TIMING] node=%s evt=STALL_BRAKE t_us=%llu ma=%u trip_to_brake_us=%llu first_over_to_brake_us=%llu\n",
                  DOOR_NODE_ID, static_cast<unsigned long long>(brake_us), snap.stall_current_ma,
                  static_cast<unsigned long long>(trip_delta),
                  static_cast<unsigned long long>(first_delta));
  } else if (reason == RetractReason::FOR_SUCCESS && fsm.ir_seal_start_us > 0) {
    const uint64_t seal_us = (brake_us >= fsm.ir_seal_start_us)
                                 ? (brake_us - fsm.ir_seal_start_us)
                                 : 0;
    Serial.printf("[TIMING] node=%s evt=IR_RETRACT t_us=%llu cmd_id=%s seal_us=%llu\n",
                  DOOR_NODE_ID, static_cast<unsigned long long>(brake_us),
                  (fsm.active_cmd_id[0] != '\0') ? fsm.active_cmd_id : "-",
                  static_cast<unsigned long long>(seal_us));
  }

  fsm.retract_reason   = reason;
  fsm.ir_seal_start_ms = 0;
  fsm.ir_seal_start_us = 0;
  if (abort_cmd_id != nullptr && abort_cmd_id[0] != '\0') {
    snprintf(fsm.abort_ack_id, sizeof(fsm.abort_ack_id), "%s", abort_cmd_id);
  }

  if (door_controllers::isLimitSwitchHomed()) {
    finishHomingToIdle(fsm, now_ms);
    return;
  }

  fsm.state             = door_types::MotorState::RETRACTING;
  fsm.motion_start_ms   = now_ms;
  fsm.active_timeout_ms = door_config::DEFAULT_MOTION_TIMEOUT_MS;

  Serial.printf("[FSM] Braking & retracting CCW to home (duty=%u)\n",
                door_config::PWM_DUTY_RETRACTING);
  door_rtos::updateMotorState(fsm.state, door_controllers::isIrDoorClosed(),
                              false, now_ms, false);
  door_controllers::motorDriveCCW(door_config::PWM_DUTY_RETRACTING);
}

inline void startClosingFromCommand(MotorFsmContext& fsm,
                                    const door_types::DoorCommandMsg& cmd,
                                    uint32_t now_ms) {
  const door_types::SharedDoorStatus snap = door_rtos::getSharedStatus();
  if (!snap.ina219_healthy) {
    enterFaultLockout(fsm, "INA219_I2C_UNRESPONSIVE", cmd.cmd_id);
    return;
  }
  if (door_controllers::isIrDoorClosed()) {
    Serial.printf("[FSM] Door already CLOSED (IR=LOW) -> ack SUCCESS (cmd_id=%s)\n",
                  cmd.cmd_id);
    door_types::DoorEventMsg evt =
        makeBaseEvent(door_types::DoorEventType::SUCCESS, cmd.cmd_id);
    evt.duration_ms     = 0;
    evt.peak_current_ma = 0;
    enqueueDoorEvent(evt);
    return;
  }

  snprintf(fsm.active_cmd_id, sizeof(fsm.active_cmd_id), "%s", cmd.cmd_id);
  fsm.abort_ack_id[0]       = '\0';
  fsm.retract_reason        = RetractReason::NONE;
  fsm.state                 = door_types::MotorState::CLOSING;
  fsm.motion_start_ms       = now_ms;
  fsm.stroke_start_ms       = now_ms;
  fsm.ir_seal_start_ms      = 0;
  const uint32_t to_s       = (cmd.timeout_s > 0)
                                  ? cmd.timeout_s
                                  : door_config::DEFAULT_MOTION_TIMEOUT_S;
  fsm.active_timeout_ms     = to_s * 1000UL;

  // Sound 3-beep audible warning BEFORE energizing the CW motor drive.
  door_controllers::motorCoastStop();
  door_controllers::buzzerSetTone(door_config::WARNING_BEEP_FREQ_HZ);
  const uint64_t fsm_us     = door_rtos::nowUs();
  fsm.buzzer_active         = true;
  fsm.waiting_warning_beeps = true;
  fsm.buzzer_step           = 0;
  fsm.buzzer_step_ms        = now_ms;
  fsm.beep_start_us         = fsm_us;
  fsm.ir_seal_start_us      = 0;

  const uint64_t rx_us = door_rtos::state().mqtt_rx_us;
  const uint64_t rx_delta =
      (rx_us > 0 && fsm_us >= rx_us && strcmp(cmd.cmd_id, "debug-btn-s2") != 0)
          ? (fsm_us - rx_us)
          : 0;
  Serial.printf("[TIMING] node=%s evt=CLOSING_START t_us=%llu cmd_id=%s rx_to_fsm_us=%llu\n",
                DOOR_NODE_ID, static_cast<unsigned long long>(fsm_us), fsm.active_cmd_id,
                static_cast<unsigned long long>(rx_delta));

  Serial.printf(
      "[FSM] CLOSING started (cmd_id=%s, timeout=%lu s) -> playing warning beeps\n",
      fsm.active_cmd_id, static_cast<unsigned long>(to_s));

  door_rtos::updateMotorState(fsm.state, false,
                              door_controllers::isLimitSwitchHomed(), now_ms,
                              true);
  enqueueDoorEvent(
      makeBaseEvent(door_types::DoorEventType::CLOSING, fsm.active_cmd_id));
}

inline void handleMotorNotifications(MotorFsmContext& fsm, uint32_t bits,
                                     uint32_t now_ms) {
  if ((bits & door_types::NOTIFY_INA219_FAULT) != 0 &&
      fsm.state != door_types::MotorState::FAULT) {
    enterFaultLockout(fsm, "INA219_I2C_UNRESPONSIVE", fsm.active_cmd_id);
    return;
  }

  if ((bits & door_types::NOTIFY_OBSTRUCTION_STALL) != 0) {
    if (fsm.state == door_types::MotorState::CLOSING) {
      beginRetraction(fsm, RetractReason::FOR_OBSTRUCTION, nullptr, now_ms);
      return;
    }
    if (fsm.state == door_types::MotorState::RETRACTING ||
        fsm.state == door_types::MotorState::HOMING_ON_BOOT) {
      enterFaultLockout(fsm, "RETRACTION_MECHANICAL_JAM", fsm.active_cmd_id);
      return;
    }
  }

  if ((bits & door_types::NOTIFY_MANUAL_ABORT_BTN) != 0) {
    if (fsm.state == door_types::MotorState::CLOSING) {
      beginRetraction(fsm, RetractReason::FOR_MANUAL_ABORT, nullptr, now_ms);
      return;
    }
    if (fsm.state == door_types::MotorState::RETRACTING ||
        fsm.state == door_types::MotorState::HOMING_ON_BOOT) {
      enterFaultLockout(fsm, "MANUAL_ABORT_DURING_RETRACT", fsm.active_cmd_id);
      return;
    }
  }

  if ((bits & door_types::NOTIFY_REMOTE_ABORT) != 0 &&
      fsm.state == door_types::MotorState::CLOSING) {
    const door_types::SharedDoorStatus snap = door_rtos::getSharedStatus();
    beginRetraction(fsm, RetractReason::FOR_REMOTE_ABORT,
                    snap.last_abort_cmd_id, now_ms);
    return;
  }

  if ((bits & door_types::NOTIFY_NETWORK_LOST) != 0 &&
      fsm.state == door_types::MotorState::CLOSING) {
    beginRetraction(fsm, RetractReason::FOR_NET_LOSS, nullptr, now_ms);
    return;
  }

  if ((bits & door_types::NOTIFY_LIMIT_SWITCH_HIT) != 0 &&
      (fsm.state == door_types::MotorState::RETRACTING ||
       fsm.state == door_types::MotorState::HOMING_ON_BOOT)) {
    finishHomingToIdle(fsm, now_ms);
    return;
  }

  if ((bits & door_types::NOTIFY_DEBUG_CLOSE_BTN) != 0 &&
      fsm.state == door_types::MotorState::IDLE) {
    Serial.println("[FSM] S2 debug button pressed -> starting CLOSE_DOOR");
    door_types::DoorCommandMsg debug_cmd;
    memset(&debug_cmd, 0, sizeof(debug_cmd));
    snprintf(debug_cmd.cmd_id, sizeof(debug_cmd.cmd_id), "debug-btn-s2");
    debug_cmd.action    = door_types::CommandAction::CLOSE_DOOR;
    debug_cmd.timeout_s = door_config::DEFAULT_MOTION_TIMEOUT_S;
    snprintf(debug_cmd.reason, sizeof(debug_cmd.reason), "DEBUG_BUTTON");
    startClosingFromCommand(fsm, debug_cmd, now_ms);
  }
}

inline void stepActiveMotorState(MotorFsmContext& fsm, uint32_t now_ms) {
  const bool ir_closed   = door_controllers::isIrDoorClosed();
  const bool limit_homed = door_controllers::isLimitSwitchHomed();

  if (fsm.state == door_types::MotorState::IDLE ||
      fsm.state == door_types::MotorState::FAULT) {
    door_rtos::updateMotorState(fsm.state, ir_closed, limit_homed, 0, false);
    return;
  }

  if (fsm.state == door_types::MotorState::CLOSING &&
      fsm.waiting_warning_beeps) {
    if ((now_ms - fsm.buzzer_step_ms) >= door_config::WARNING_BEEP_STEP_MS) {
      fsm.buzzer_step_ms = now_ms;
      ++fsm.buzzer_step;
      if (fsm.buzzer_step >= door_config::WARNING_BEEP_STEPS) {
        stopWarningBuzzer(fsm);
        // Reset motion_start_ms when motor actually energizes so inrush
        // blanking and timeout apply cleanly to motor travel.
        fsm.motion_start_ms = now_ms;
        door_rtos::updateMotorState(fsm.state, ir_closed, limit_homed, now_ms,
                                    false);
        Serial.printf("[FSM] Warning beeps complete -> driving CW (ramp to %u)\n",
                      door_config::PWM_DUTY_CLOSING);
        door_controllers::motorDriveCW(0);
        const uint64_t cw_us = door_rtos::nowUs();
        const uint64_t beep_us = (fsm.beep_start_us > 0 && cw_us >= fsm.beep_start_us)
                                     ? (cw_us - fsm.beep_start_us)
                                     : 0;
        Serial.printf("[TIMING] node=%s evt=MOTOR_CW_START t_us=%llu cmd_id=%s beep_us=%llu\n",
                      DOOR_NODE_ID, static_cast<unsigned long long>(cw_us),
                      (fsm.active_cmd_id[0] != '\0') ? fsm.active_cmd_id : "-",
                      static_cast<unsigned long long>(beep_us));
      } else if ((fsm.buzzer_step % 2) == 1) {
        door_controllers::buzzerOff();
      } else {
        door_controllers::buzzerSetTone(door_config::WARNING_BEEP_FREQ_HZ);
      }
    }
    return;
  }

  const uint32_t elapsed_ms = now_ms - fsm.motion_start_ms;
  if (elapsed_ms >= fsm.active_timeout_ms) {
    door_controllers::motorCoastStop();
    stopWarningBuzzer(fsm);
    if (fsm.state == door_types::MotorState::HOMING_ON_BOOT) {
      enterFaultLockout(fsm, "BOOT_HOMING_TIMEOUT", nullptr);
    } else {
      Serial.printf("[FSM] Motion TIMEOUT (%lu ms) -> cutting power, state=FAULT\n",
                    static_cast<unsigned long>(elapsed_ms));
      fsm.state          = door_types::MotorState::FAULT;
      fsm.retract_reason = RetractReason::NONE;
      door_rtos::updateMotorState(fsm.state, ir_closed, limit_homed, 0, false);
      door_types::DoorEventMsg evt = makeBaseEvent(
          door_types::DoorEventType::TIMEOUT_ERROR, fsm.active_cmd_id);
      evt.elapsed_ms = elapsed_ms;
      enqueueDoorEvent(evt);
    }
    return;
  }

  if (fsm.state == door_types::MotorState::CLOSING) {
    const uint8_t duty = door_protocol::computeSoftStartDuty(
        elapsed_ms, door_config::PWM_DUTY_CLOSING,
        door_config::PWM_SOFT_START_MS);
    door_controllers::motorSetPwmDuty(duty);
    door_rtos::updateMotorState(fsm.state, ir_closed, limit_homed,
                                fsm.motion_start_ms, false);
    if (fsm.ir_seal_start_ms == 0) {
      if (ir_closed) {
        fsm.ir_seal_start_ms = (now_ms == 0) ? 1 : now_ms;
        fsm.ir_seal_start_us = door_rtos::nowUs();
        Serial.printf("[TIMING] node=%s evt=IR_SEAL_START t_us=%llu cmd_id=%s\n",
                      DOOR_NODE_ID, static_cast<unsigned long long>(fsm.ir_seal_start_us),
                      (fsm.active_cmd_id[0] != '\0') ? fsm.active_cmd_id : "-");
        Serial.printf("[FSM] IR door-closed -> sealing gasket for %lu ms\n",
                      static_cast<unsigned long>(
                          door_config::POST_IR_SEAL_DELAY_MS));
      }
    } else if ((now_ms - fsm.ir_seal_start_ms) >=
               door_config::POST_IR_SEAL_DELAY_MS) {
      beginRetraction(fsm, RetractReason::FOR_SUCCESS, nullptr, now_ms);
    }
    return;
  }

  // RETRACTING or HOMING_ON_BOOT
  door_rtos::updateMotorState(fsm.state, ir_closed, limit_homed,
                              fsm.motion_start_ms, false);
  if (limit_homed) {
    finishHomingToIdle(fsm, now_ms);
  }
}

inline void vMotorControlTask(void* pvParameters) {
  (void)pvParameters;

  MotorFsmContext fsm;
  memset(&fsm, 0, sizeof(fsm));
  fsm.state             = door_types::MotorState::HOMING_ON_BOOT;
  fsm.retract_reason    = RetractReason::NONE;
  fsm.active_timeout_ms = door_config::DEFAULT_MOTION_TIMEOUT_MS;

  // Give vCurrentMonitorTask one sample period on boot to verify INA219 health.
  vTaskDelay(pdMS_TO_TICKS(20));
  const uint32_t boot_ms                  = millis();
  const door_types::SharedDoorStatus snap = door_rtos::getSharedStatus();
  if (!snap.ina219_healthy) {
    enterFaultLockout(fsm, "INA219_I2C_UNRESPONSIVE", nullptr);
  } else if (door_controllers::isLimitSwitchHomed()) {
    Serial.println("[FSM] Boot check: Limit switch HOMED -> state=IDLE");
    fsm.state = door_types::MotorState::IDLE;
    door_rtos::updateMotorState(fsm.state, door_controllers::isIrDoorClosed(),
                                true, 0, false);
  } else {
    Serial.println(
        "[FSM] Boot check: Limit switch OPEN -> HOMING_ON_BOOT (slow CCW)");
    fsm.state           = door_types::MotorState::HOMING_ON_BOOT;
    fsm.motion_start_ms = boot_ms;
    door_rtos::updateMotorState(fsm.state, door_controllers::isIrDoorClosed(),
                                false, boot_ms, false);
    door_controllers::motorDriveCCW(door_config::PWM_DUTY_HOMING);
  }

  for (;;) {
    uint32_t notify_bits = 0;
    xTaskNotifyWait(0, 0xFFFFFFFFUL, &notify_bits,
                    pdMS_TO_TICKS(door_config::MOTOR_FSM_TICK_MS));
    const uint32_t now_ms = millis();

    if (notify_bits != 0) {
      handleMotorNotifications(fsm, notify_bits, now_ms);
    }

    QueueHandle_t in_q = door_rtos::state().incoming_queue;
    door_types::DoorCommandMsg cmd;
    while (in_q != nullptr && xQueueReceive(in_q, &cmd, 0) == pdTRUE) {
      if (cmd.action == door_types::CommandAction::ABORT &&
          fsm.state == door_types::MotorState::CLOSING) {
        beginRetraction(fsm, RetractReason::FOR_REMOTE_ABORT, cmd.cmd_id,
                        now_ms);
      } else if (cmd.action == door_types::CommandAction::CLOSE_DOOR &&
                 fsm.state == door_types::MotorState::IDLE) {
        startClosingFromCommand(fsm, cmd, now_ms);
      }
    }

    stepActiveMotorState(fsm, now_ms);
  }
}

}  // namespace door_tasks

#endif  // DOOR_MOTOR_CONTROL_TASK_H_
