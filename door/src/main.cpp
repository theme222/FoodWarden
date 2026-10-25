#include <Arduino.h>

void setup() {
  Serial.begin(115200);
}

void loop() {
  vTaskDelay(pdMS_TO_TICKS(1000));
}
