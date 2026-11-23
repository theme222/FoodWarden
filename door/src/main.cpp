#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include "config.h"
#include "controllers.h"
#include "current_monitor_task.h"
#include "motor_control_task.h"
#include "mqtt_comm_task.h"
#include "rtos_state.h"
#include "secrets.h"
#include "serial_cli.h"
#include "types.h"

// ==============================================================================
// Node 'D' (Door Closer Actuator) — Firmware Entrypoint
// Controlled by `door_config::DEBUG`:
//   - true:  Standalone interactive Serial test CLI + S2 close-cycle test
//   - false: Full 3-task FreeRTOS + MQTTS production firmware
// ==============================================================================

void setup() {
  if (door_config::DEBUG) {
    door_serial_cli::setup();
    return;
  }

  Serial.begin(115200);
  delay(200);

  door_rtos::RtosState& rtos = door_rtos::state();
  door_controllers::initAllHardware(rtos.ina, rtos.matrix, rtos.ina_hw_ok,
                                    rtos.matrix_hw_ok);
  door_rtos::initRtosPrimitives();

  xTaskCreatePinnedToCore(
      door_tasks::vCurrentMonitorTask, "CurrentMonitor",
      door_config::STACK_SIZE_CURRENT_MONITOR, nullptr,
      door_config::TASK_PRIO_CURRENT_MONITOR, &rtos.current_task_handle,
      door_config::CORE_APP_SAFETY);

  xTaskCreatePinnedToCore(
      door_tasks::vMotorControlTask, "MotorControl",
      door_config::STACK_SIZE_MOTOR_CONTROL, nullptr,
      door_config::TASK_PRIO_MOTOR_CONTROL, &rtos.motor_task_handle,
      door_config::CORE_APP_SAFETY);

  xTaskCreatePinnedToCore(
      door_tasks::vMqttCommTask, "MqttComm",
      door_config::STACK_SIZE_MQTT_COMM, nullptr,
      door_config::TASK_PRIO_MQTT_COMM, &rtos.mqtt_task_handle,
      door_config::CORE_NET_COMM);

  door_rtos::attachSafetyIsrs();
  Serial.println("[BOOT] Node 'D' production FreeRTOS tasks started.");
}

void loop() {
  if (door_config::DEBUG) {
    door_serial_cli::loop();
    return;
  }
  vTaskDelay(pdMS_TO_TICKS(1000));
}
