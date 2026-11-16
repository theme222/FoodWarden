#ifndef DOOR_MQTT_COMM_TASK_H_
#define DOOR_MQTT_COMM_TASK_H_

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
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
#include "secrets.h"
#include "types.h"

// ==============================================================================
// Node 'D' (Door Closer Actuator) — vMqttCommTask (Priority 2, Core 0)
// Manages Wi-Fi & TLS 1.2/1.3 MQTTS connection to Gateway 'C', LWT lifecycle,
// time synchronization, 1 Hz telemetry, and event/command queuing (E4, E5).
// ==============================================================================

namespace door_tasks {

inline void notifyMotorNetworkLostIfClosing() {
  const door_types::SharedDoorStatus snap = door_rtos::getSharedStatus();
  if (snap.motor_state == door_types::MotorState::CLOSING &&
      door_rtos::state().motor_task_handle != nullptr) {
    xTaskNotify(door_rtos::state().motor_task_handle,
                door_types::NOTIFY_NETWORK_LOST, eSetBits);
  }
}

inline void handleIncomingMqttMessage(char* topic, uint8_t* payload,
                                      unsigned int length) {
  if (topic == nullptr || payload == nullptr || length == 0) {
    return;
  }
  const char* raw = reinterpret_cast<const char*>(payload);

  if (strcmp(topic, door_config::TOPIC_DOOR_TIME_RES) == 0) {
    uint64_t epoch_s = 0;
    if (door_protocol::parseTimeResJson(raw, length, DOOR_NODE_ID, epoch_s)) {
      door_rtos::setUnixTimestamp(epoch_s);
      door_controllers::setStatusLed(door_controllers::StatusLed::NTP, true);
      Serial.printf("[TIME] Synced Unix epoch: %llu\n",
                    static_cast<unsigned long long>(epoch_s));
    }
    return;
  }

  if (strcmp(topic, door_config::TOPIC_DOOR_CMD) == 0) {
    door_types::DoorCommandMsg cmd;
    if (!door_protocol::parseDoorCommandJson(raw, length, DOOR_NODE_ID, cmd)) {
      Serial.println("[MQTTS] Ignored invalid or foreign command payload");
      return;
    }
    if (cmd.action == door_types::CommandAction::ABORT) {
      Serial.printf("[MQTTS <- CMD] ABORT (cmd_id=%s, reason=%s)\n",
                    cmd.cmd_id, cmd.reason);
      door_rtos::updateMqttState(true, cmd.cmd_id);
      if (door_rtos::state().motor_task_handle != nullptr) {
        xTaskNotify(door_rtos::state().motor_task_handle,
                    door_types::NOTIFY_REMOTE_ABORT, eSetBits);
      }
      return;
    }
    Serial.printf("[MQTTS <- CMD] CLOSE_DOOR (cmd_id=%s, timeout_s=%lu)\n",
                  cmd.cmd_id, static_cast<unsigned long>(cmd.timeout_s));
    QueueHandle_t in_q = door_rtos::state().incoming_queue;
    if (in_q != nullptr) {
      xQueueSend(in_q, &cmd, 0);
    }
  }
}

inline uint32_t nextBackoffMs(uint32_t current_ms) {
  const uint32_t doubled = current_ms * 2UL;
  return (doubled > door_config::RECONNECT_BACKOFF_MAX_MS)
             ? door_config::RECONNECT_BACKOFF_MAX_MS
             : doubled;
}

inline bool connectMqttWithTls(PubSubClient& mqtt) {
  char lwt_buf[128];
  door_protocol::serializeStatusJson(DOOR_NODE_ID, false, 0, lwt_buf,
                                     sizeof(lwt_buf));

  char client_id[32];
  snprintf(client_id, sizeof(client_id), "foodwarden-%s", DOOR_NODE_ID);

  if (!mqtt.connect(client_id, MQTT_USERNAME, MQTT_PASSWORD,
                    door_config::TOPIC_DOOR_STATUS, 1, true, lwt_buf)) {
    return false;
  }

  char status_buf[128];
  door_protocol::serializeStatusJson(DOOR_NODE_ID, true,
                                     door_rtos::getUnixTimestamp(), status_buf,
                                     sizeof(status_buf));
  mqtt.publish(door_config::TOPIC_DOOR_STATUS, status_buf, true);

  mqtt.subscribe(door_config::TOPIC_DOOR_CMD, 1);
  mqtt.subscribe(door_config::TOPIC_DOOR_TIME_RES, 1);

  char req_buf[64];
  door_protocol::serializeTimeReqJson(DOOR_NODE_ID, req_buf, sizeof(req_buf));
  mqtt.publish(door_config::TOPIC_DOOR_TIME_REQ, req_buf);
  return true;
}

inline void flushOutgoingDoorEvents(PubSubClient& mqtt) {
  QueueHandle_t out_q = door_rtos::state().outgoing_queue;
  if (out_q == nullptr || !mqtt.connected()) {
    return;
  }
  door_types::DoorEventMsg evt;
  char json_buf[256];
  while (xQueuePeek(out_q, &evt, 0) == pdTRUE) {
    const size_t n = door_protocol::serializeDoorEventJson(
        DOOR_NODE_ID, evt, json_buf, sizeof(json_buf));
    if (n > 0 && mqtt.publish(door_config::TOPIC_DOOR_EVENT, json_buf)) {
      Serial.printf("[MQTTS -> EVENT] %s\n", json_buf);
      xQueueReceive(out_q, &evt, 0);
    } else {
      break;  // Retry on next loop tick if publish failed
    }
  }
}

inline void vMqttCommTask(void* pvParameters) {
  (void)pvParameters;

  WiFi.mode(WIFI_STA);
  Serial.printf("[WIFI] Connecting to SSID '%s'...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  WiFiClientSecure tls_client;
  tls_client.setCACert(MQTT_TLS_CA_CERT);

  PubSubClient mqtt(tls_client);
  mqtt.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  mqtt.setCallback(handleIncomingMqttMessage);
  mqtt.setBufferSize(512);

  bool was_wifi_up          = false;
  bool was_mqtt_up          = false;
  uint32_t wifi_backoff_ms  = door_config::RECONNECT_BACKOFF_MIN_MS;
  uint32_t mqtt_backoff_ms  = door_config::RECONNECT_BACKOFF_MIN_MS;
  uint32_t next_wifi_try_ms = millis() + wifi_backoff_ms;
  uint32_t next_mqtt_try_ms = 0;
  uint32_t last_telemetry_ms = 0;
  uint32_t last_time_req_ms  = 0;

  for (;;) {
    const uint32_t now_ms = millis();
    const bool wifi_up    = (WiFi.status() == WL_CONNECTED);

    if (wifi_up != was_wifi_up) {
      door_controllers::setStatusLed(door_controllers::StatusLed::WIFI, wifi_up);
      if (wifi_up) {
        Serial.printf("[WIFI] Connected! IP=%s\n",
                      WiFi.localIP().toString().c_str());
        wifi_backoff_ms  = door_config::RECONNECT_BACKOFF_MIN_MS;
        next_mqtt_try_ms = now_ms;
      } else {
        Serial.println("[WIFI] Disconnected from AP");
        notifyMotorNetworkLostIfClosing();
      }
      was_wifi_up = wifi_up;
    }

    if (!wifi_up) {
      if (was_mqtt_up) {
        was_mqtt_up = false;
        door_rtos::updateMqttState(false, nullptr);
        door_controllers::setStatusLed(door_controllers::StatusLed::IOT, false);
      }
      if (static_cast<int32_t>(now_ms - next_wifi_try_ms) >= 0) {
        Serial.printf("[WIFI] Reconnecting to '%s' (backoff=%lu ms)...\n",
                      WIFI_SSID, static_cast<unsigned long>(wifi_backoff_ms));
        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
        next_wifi_try_ms = now_ms + wifi_backoff_ms;
        wifi_backoff_ms  = nextBackoffMs(wifi_backoff_ms);
      }
      vTaskDelay(pdMS_TO_TICKS(door_config::MQTT_LOOP_INTERVAL_MS));
      continue;
    }

    const bool mqtt_up = mqtt.connected();
    if (mqtt_up != was_mqtt_up) {
      door_rtos::updateMqttState(mqtt_up, nullptr);
      door_controllers::setStatusLed(door_controllers::StatusLed::IOT, mqtt_up);
      if (!mqtt_up) {
        Serial.println("[MQTTS] Connection lost");
        notifyMotorNetworkLostIfClosing();
      }
      was_mqtt_up = mqtt_up;
    }

    if (!mqtt_up) {
      if (static_cast<int32_t>(now_ms - next_mqtt_try_ms) >= 0) {
        Serial.printf("[MQTTS] Connecting to %s:%u...\n", MQTT_BROKER_HOST,
                      static_cast<unsigned int>(MQTT_BROKER_PORT));
        if (connectMqttWithTls(mqtt)) {
          Serial.println(
              "[MQTTS] Connected! Published ONLINE & subscribed to cmd/time");
          mqtt_backoff_ms  = door_config::RECONNECT_BACKOFF_MIN_MS;
          last_time_req_ms = now_ms;
          door_rtos::updateMqttState(true, nullptr);
          door_controllers::setStatusLed(door_controllers::StatusLed::IOT, true);
          was_mqtt_up = true;
        } else {
          Serial.printf("[MQTTS] Connect failed (rc=%d) — retry in %lu ms\n",
                        mqtt.state(),
                        static_cast<unsigned long>(mqtt_backoff_ms));
          next_mqtt_try_ms = now_ms + mqtt_backoff_ms;
          mqtt_backoff_ms  = nextBackoffMs(mqtt_backoff_ms);
        }
      }
      vTaskDelay(pdMS_TO_TICKS(door_config::MQTT_LOOP_INTERVAL_MS));
      continue;
    }

    mqtt.loop();
    flushOutgoingDoorEvents(mqtt);

    if ((now_ms - last_telemetry_ms) >= door_config::TELEMETRY_INTERVAL_MS) {
      last_telemetry_ms = now_ms;
      char tele_buf[256];
      const door_types::SharedDoorStatus snap = door_rtos::getSharedStatus();
      if (door_protocol::serializeTelemetryJson(
              DOOR_NODE_ID, door_rtos::getUnixTimestamp(), snap, tele_buf,
              sizeof(tele_buf)) > 0) {
        mqtt.publish(door_config::TOPIC_DOOR_TELEMETRY, tele_buf);
      }
    }

    const uint32_t resync_ms = door_config::TIME_RESYNC_INTERVAL_S * 1000UL;
    if ((now_ms - last_time_req_ms) >= resync_ms) {
      last_time_req_ms = now_ms;
      char req_buf[64];
      door_protocol::serializeTimeReqJson(DOOR_NODE_ID, req_buf,
                                          sizeof(req_buf));
      mqtt.publish(door_config::TOPIC_DOOR_TIME_REQ, req_buf);
    }

    vTaskDelay(pdMS_TO_TICKS(door_config::MQTT_LOOP_INTERVAL_MS));
  }
}

}  // namespace door_tasks

#endif  // DOOR_MQTT_COMM_TASK_H_
