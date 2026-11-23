#include <Arduino.h>
#include <esp_system.h>

#include "node_state.h"
#include "tasks.h"

#if __has_include("secrets.h")
#include "secrets.h"
#define HAVE_SECRETS 1
#endif

// Survives deep sleep; cleared on power loss.
RTC_DATA_ATTR static NodeState node;

// Warn on the serial log when telemetry cannot be sent securely.
static void checkSecrets() {
#ifndef HAVE_SECRETS
  Serial.println("WARNING: no secrets.h, BLE telemetry is disabled");
#else
  bool example_key = true; // template key 00 01 02 ... 0F
  for (uint8_t i = 0; i < sizeof(AES_KEY); i++) {
    if (AES_KEY[i] != i) example_key = false;
  }
  if (example_key) Serial.println("WARNING: AES_KEY is the example key, replace it in secrets.h");
#endif
}

void setup() {
  Serial.begin(115200);

  if (!node.initialised) {
    uint8_t salt[8];
    esp_fill_random(salt, sizeof(salt));
    nodeStateColdBoot(node, salt);
    Serial.println("cold boot: new session salt");
    checkSecrets();
  }

  tasksStart(node);
}

// All work happens in the FreeRTOS tasks; the chip deep-sleeps from vSensorTask.
void loop() { vTaskDelay(portMAX_DELAY); }
