#ifndef DOOR_RTOS_STATE_H_
#define DOOR_RTOS_STATE_H_

#include <Adafruit_INA219.h>
#include <Adafruit_LEDBackpack.h>
#include <Arduino.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/portmacro.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "config.h"
#include "controllers.h"
#include "types.h"

// ==============================================================================
// Node 'D' (Door Closer Actuator) — Shared FreeRTOS Primitives, Clock & ISRs
// Provides spinlock-protected SharedDoorStatus, message queues, epoch clock
// tracking, and IRAM_ATTR hardware interrupts (Rubric E1 & E2).
// ==============================================================================

namespace door_rtos {

struct RtosState {
  portMUX_TYPE status_mux;
  door_types::SharedDoorStatus status;

  QueueHandle_t incoming_queue;
  QueueHandle_t outgoing_queue;
  TaskHandle_t motor_task_handle;
  TaskHandle_t current_task_handle;
  TaskHandle_t mqtt_task_handle;

  Adafruit_INA219 ina;
  Adafruit_8x16minimatrix matrix;
  bool ina_hw_ok;
  bool matrix_hw_ok;

  uint64_t base_epoch_s;
  uint32_t base_millis;
  bool time_synced;

  volatile uint32_t last_limit_isr_ms;
  volatile uint32_t last_abort_isr_ms;
  volatile uint32_t last_debug_isr_ms;

  volatile uint64_t limit_isr_us;
  volatile uint64_t abort_isr_us;
  volatile uint64_t stall_first_over_us;
  volatile uint64_t stall_trip_us;
  volatile uint64_t mqtt_rx_us;
};

// C++11 header-only single-instance storage without runtime static-init guards
// so IRAM_ATTR ISRs can read motor_task_handle without touching flash locks.
template <int Unused = 0>
struct StateStorage {
  static RtosState instance;
};

template <int Unused>
RtosState StateStorage<Unused>::instance = {
    portMUX_INITIALIZER_UNLOCKED,
    {0, 0, 0, false, door_types::MotorState::HOMING_ON_BOOT, false, false, 0,
     false, {0}},
    nullptr,
    nullptr,
    nullptr,
    nullptr,
    nullptr,
    Adafruit_INA219(door_config::I2C_ADDR_INA219),
    Adafruit_8x16minimatrix(),
    false,
    false,
    0,
    0,
    false,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0};

inline RtosState& state() { return StateStorage<>::instance; }

inline uint64_t nowUs() { return static_cast<uint64_t>(esp_timer_get_time()); }

/**
 * @brief Creates or resets FreeRTOS queues and resets SharedDoorStatus defaults.
 */
inline void initRtosPrimitives() {
  RtosState& s = state();
  s.status_mux = portMUX_INITIALIZER_UNLOCKED;

  if (s.incoming_queue == nullptr) {
    s.incoming_queue = xQueueCreate(door_config::INCOMING_MSG_QUEUE_LENGTH,
                                    sizeof(door_types::DoorCommandMsg));
  } else {
    xQueueReset(s.incoming_queue);
  }

  if (s.outgoing_queue == nullptr) {
    s.outgoing_queue = xQueueCreate(door_config::OUTGOING_MSG_QUEUE_LENGTH,
                                    sizeof(door_types::DoorEventMsg));
  } else {
    xQueueReset(s.outgoing_queue);
  }

  portENTER_CRITICAL(&s.status_mux);
  memset(&s.status, 0, sizeof(s.status));
  s.status.motor_state    = door_types::MotorState::HOMING_ON_BOOT;
  s.status.ina219_healthy = s.ina_hw_ok;
  s.base_epoch_s          = 0;
  s.base_millis           = 0;
  s.time_synced           = false;
  s.limit_isr_us          = 0;
  s.abort_isr_us          = 0;
  s.stall_first_over_us   = 0;
  s.stall_trip_us         = 0;
  s.mqtt_rx_us            = 0;
  portEXIT_CRITICAL(&s.status_mux);
}

/**
 * @brief Returns a thread-safe snapshot of SharedDoorStatus.
 */
inline door_types::SharedDoorStatus getSharedStatus() {
  RtosState& s = state();
  portENTER_CRITICAL(&s.status_mux);
  const door_types::SharedDoorStatus copy = s.status;
  portEXIT_CRITICAL(&s.status_mux);
  return copy;
}

/**
 * @brief Atomically updates INA219 current readings and peak stroke tracking.
 */
inline void updateCurrentMetrics(uint16_t current_ma, bool healthy,
                                 uint16_t stall_ma_if_tripped) {
  RtosState& s = state();
  portENTER_CRITICAL(&s.status_mux);
  s.status.current_ma     = current_ma;
  s.status.ina219_healthy = healthy;
  if (healthy && s.status.motor_state == door_types::MotorState::CLOSING &&
      current_ma != door_config::CURRENT_FAULT_SENTINEL_MA &&
      current_ma > s.status.peak_current_ma) {
    s.status.peak_current_ma = current_ma;
  }
  if (stall_ma_if_tripped > 0) {
    s.status.stall_current_ma = stall_ma_if_tripped;
  }
  portEXIT_CRITICAL(&s.status_mux);
}

/**
 * @brief Atomically updates motor FSM state and sensor flags.
 */
inline void updateMotorState(door_types::MotorState motor_state, bool ir_closed,
                             bool limit_homed, uint32_t motion_start_ms,
                             bool reset_peak) {
  RtosState& s = state();
  portENTER_CRITICAL(&s.status_mux);
  s.status.motor_state        = motor_state;
  s.status.ir_door_closed     = ir_closed;
  s.status.limit_switch_homed = limit_homed;
  s.status.motion_start_ms    = motion_start_ms;
  if (reset_peak) {
    s.status.peak_current_ma  = 0;
    s.status.stall_current_ma = 0;
  }
  portEXIT_CRITICAL(&s.status_mux);
}

/**
 * @brief Atomically updates MQTTS connection state and optional abort cmd_id.
 */
inline void updateMqttState(bool connected, const char* abort_cmd_id) {
  RtosState& s = state();
  portENTER_CRITICAL(&s.status_mux);
  s.status.mqtt_connected = connected;
  if (abort_cmd_id != nullptr) {
    snprintf(s.status.last_abort_cmd_id, sizeof(s.status.last_abort_cmd_id),
             "%s", abort_cmd_id);
  }
  portEXIT_CRITICAL(&s.status_mux);
}

/**
 * @brief Records Unix epoch seconds from Gateway 'C' `/time/res` sync.
 */
inline void setUnixTimestamp(uint64_t epoch_s) {
  RtosState& s = state();
  portENTER_CRITICAL(&s.status_mux);
  s.base_epoch_s = epoch_s;
  s.base_millis  = millis();
  s.time_synced  = (epoch_s > 0);
  portEXIT_CRITICAL(&s.status_mux);
}

/**
 * @brief Returns current Unix epoch seconds (or 0 if not yet synchronized).
 */
inline uint64_t getUnixTimestamp() {
  RtosState& s = state();
  portENTER_CRITICAL(&s.status_mux);
  const bool synced      = s.time_synced;
  const uint64_t base_s  = s.base_epoch_s;
  const uint32_t base_ms = s.base_millis;
  portEXIT_CRITICAL(&s.status_mux);

  if (!synced) {
    return 0;
  }
  const uint32_t elapsed_s = (millis() - base_ms) / 1000UL;
  return base_s + static_cast<uint64_t>(elapsed_s);
}

// ------------------------------------------------------------------------------
// Hardware Interrupt Service Routines (IRAM_ATTR + Deferred Task Notification)
// ------------------------------------------------------------------------------

static void IRAM_ATTR notifyFromIsr(uint32_t notify_bit,
                                    volatile uint32_t& last_isr_ms,
                                    volatile uint64_t* stamp_us) {
  const uint32_t now_ms =
      static_cast<uint32_t>(xTaskGetTickCountFromISR() * portTICK_PERIOD_MS);
  if ((now_ms - last_isr_ms) < door_config::ISR_DEBOUNCE_MS) {
    return;
  }
  last_isr_ms = now_ms;
  if (stamp_us != nullptr) {
    *stamp_us = static_cast<uint64_t>(esp_timer_get_time());
  }

  TaskHandle_t target = state().motor_task_handle;
  if (target != nullptr) {
    BaseType_t higher_woken = pdFALSE;
    xTaskNotifyFromISR(target, notify_bit, eSetBits, &higher_woken);
    if (higher_woken == pdTRUE) {
      portYIELD_FROM_ISR();
    }
  }
}

static void IRAM_ATTR onLimitSwitchIsr() {
  notifyFromIsr(door_types::NOTIFY_LIMIT_SWITCH_HIT,
                state().last_limit_isr_ms, &state().limit_isr_us);
}

static void IRAM_ATTR onEmergencyAbortIsr() {
  notifyFromIsr(door_types::NOTIFY_MANUAL_ABORT_BTN,
                state().last_abort_isr_ms, &state().abort_isr_us);
}

static void IRAM_ATTR onDebugCloseIsr() {
  notifyFromIsr(door_types::NOTIFY_DEBUG_CLOSE_BTN,
                state().last_debug_isr_ms, nullptr);
}

/**
 * @brief Attaches hardware ISRs for Limit Switch, S1 Abort, and S2 Debug Close.
 */
inline void attachSafetyIsrs() {
  const int limit_mode =
      (door_config::LIMIT_SWITCH_ACTIVE_LEVEL == HIGH) ? RISING : FALLING;
  attachInterrupt(digitalPinToInterrupt(door_config::PIN_LIMIT_SWITCH),
                  onLimitSwitchIsr, limit_mode);
  attachInterrupt(digitalPinToInterrupt(door_config::PIN_BTN_EMERGENCY_ABORT),
                  onEmergencyAbortIsr, FALLING);
  attachInterrupt(digitalPinToInterrupt(door_config::PIN_BTN_DEBUG_CLOSE),
                  onDebugCloseIsr, FALLING);
}

}  // namespace door_rtos

#endif  // DOOR_RTOS_STATE_H_
