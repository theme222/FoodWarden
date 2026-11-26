#ifndef DOOR_CURRENT_MONITOR_TASK_H_
#define DOOR_CURRENT_MONITOR_TASK_H_

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <stdint.h>

#include "config.h"
#include "controllers.h"
#include "protocol_codec.h"
#include "rtos_state.h"
#include "types.h"

// ==============================================================================
// Node 'D' (Door Closer Actuator) — vCurrentMonitorTask (Priority 4, Core 1)
// Samples INA219 at 100 Hz during motion (10 Hz idle), triggers stall/I2C fault
// notifications in <= 20 ms, and updates the KidBright32 16x8 LED matrix.
// ==============================================================================

namespace door_tasks {

inline bool isMotorStateActive(door_types::MotorState state) {
  return state == door_types::MotorState::CLOSING ||
         state == door_types::MotorState::RETRACTING ||
         state == door_types::MotorState::HOMING_ON_BOOT;
}

inline void sampleAndEvaluateCurrent(uint32_t now_ms,
                                     const door_types::SharedDoorStatus& status,
                                     uint8_t& consecutive_stall_count,
                                     bool& fault_notified) {
  door_rtos::RtosState& rtos = door_rtos::state();
  uint16_t current_ma        = door_config::CURRENT_FAULT_SENTINEL_MA;
  const bool moving          = isMotorStateActive(status.motor_state);

  if (!rtos.ina_hw_ok || !door_controllers::readCurrentMa(rtos.ina, current_ma)) {
    rtos.ina_hw_ok          = false;
    consecutive_stall_count = 0;
    door_rtos::updateCurrentMetrics(door_config::CURRENT_FAULT_SENTINEL_MA, false,
                                    0);
    if (!fault_notified && rtos.motor_task_handle != nullptr) {
      Serial.println("[INA219] I2C fault -> notifying motor task");
      xTaskNotify(rtos.motor_task_handle, door_types::NOTIFY_INA219_FAULT,
                  eSetBits);
      fault_notified = true;
    }
    return;
  }

  fault_notified = false;
  if (!moving) {
    consecutive_stall_count = 0;
    door_rtos::updateCurrentMetrics(current_ma, true, 0);
    return;
  }

  const uint32_t elapsed_ms = now_ms - status.motion_start_ms;
  const uint8_t prev_stall  = consecutive_stall_count;
  const bool tripped        = door_protocol::evaluateStallSample(
      elapsed_ms, current_ma, consecutive_stall_count);
  if (!tripped) {
    if (prev_stall == 0 && consecutive_stall_count > 0) {
      rtos.stall_first_over_us = door_rtos::nowUs();
    } else if (consecutive_stall_count == 0) {
      rtos.stall_first_over_us = 0;
    }
  }
  door_rtos::updateCurrentMetrics(current_ma, true, tripped ? current_ma : 0);

  if (tripped && rtos.motor_task_handle != nullptr) {
    const uint64_t trip_us = door_rtos::nowUs();
    rtos.stall_trip_us     = trip_us;
    if (rtos.stall_first_over_us == 0) {
      rtos.stall_first_over_us = trip_us;
    }
    Serial.printf("[INA219] Stall tripped (%u mA >= %u mA) -> notifying motor task\n",
                  current_ma, door_config::CURRENT_STALL_LIMIT_MA);
    consecutive_stall_count = 0;
    xTaskNotify(rtos.motor_task_handle, door_types::NOTIFY_OBSTRUCTION_STALL,
                eSetBits);
  }
}

inline void refreshCurrentDisplay(uint32_t now_ms,
                                  const door_types::SharedDoorStatus& status,
                                  door_types::MotorState& prev_state,
                                  uint32_t& last_matrix_ms) {
  door_rtos::RtosState& rtos = door_rtos::state();
  if (!rtos.matrix_hw_ok) {
    return;
  }

  if (isMotorStateActive(status.motor_state)) {
    if ((now_ms - last_matrix_ms) >= door_config::LED_MATRIX_REFRESH_MS) {
      last_matrix_ms = now_ms;
      door_controllers::displayMatrixCurrentMa(rtos.matrix, status.current_ma);
    }
  } else if (status.motor_state != prev_state) {
    door_controllers::displayMatrixText(
        rtos.matrix,
        (status.motor_state == door_types::MotorState::FAULT) ? "ERR" : "OK");
  }
  prev_state = status.motor_state;
}

inline void vCurrentMonitorTask(void* pvParameters) {
  (void)pvParameters;

  uint8_t consecutive_stall_count    = 0;
  bool fault_notified                = false;
  uint32_t last_matrix_ms            = 0;
  door_types::MotorState prev_state  = door_types::MotorState::HOMING_ON_BOOT;

  for (;;) {
    const uint32_t now_ms = millis();
    const door_types::SharedDoorStatus status = door_rtos::getSharedStatus();

    sampleAndEvaluateCurrent(now_ms, status, consecutive_stall_count,
                             fault_notified);

    const door_types::SharedDoorStatus updated = door_rtos::getSharedStatus();
    refreshCurrentDisplay(now_ms, updated, prev_state, last_matrix_ms);

    const uint32_t period_ms = isMotorStateActive(updated.motor_state)
                                   ? door_config::CURRENT_SAMPLE_MOVING_MS
                                   : door_config::CURRENT_SAMPLE_IDLE_MS;
    vTaskDelay(pdMS_TO_TICKS(period_ms));
  }
}

}  // namespace door_tasks

#endif  // DOOR_CURRENT_MONITOR_TASK_H_
