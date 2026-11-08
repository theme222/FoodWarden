#include "tasks.h"

#include <Arduino.h>
#include <driver/rtc_io.h>
#include <esp_sleep.h>
#include <freertos/FreeRTOS.h>
#include <freertos/event_groups.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <sys/time.h>

#include "ble_gatt.h"
#include "matrix.h"
#include "matrix_text.h"
#include "door_voc_filter.h"
#include "sensors.h"
#include "telemetry_types.h"

// Pins (ARCHITECTURE.md §1.B)
#define PIN_BUTTON_S1 16 // not an RTC GPIO on the ESP32: cannot wake from deep sleep
#define PIN_BUTTON_S2 14 // RTC_GPIO16: ext0 wake source

static const uint32_t BLE_ADVERTISING_TIMEOUT_MS = 5000; // GOAL.md: 5 s then give up
static const uint32_t BLE_STARTUP_MARGIN_MS = 2000;      // NimBLE init + encryption, generous
static const uint32_t DISPLAY_IDLE_WINDOW_MS = 300;      // time to catch a button press
static const uint32_t DISPLAY_SLEEP_GATE_MS = 9000;      // max wait for a readout scroll to finish

enum {
  EVT_READING_READY = 1 << 0, // sensor task published g_last_reading
  EVT_FORCE_BLE = 1 << 1,     // S2: send now
  EVT_BLE_DONE = 1 << 2,      // BLE task finished the requested session
  EVT_DISPLAY_DONE = 1 << 3,  // display task is idle, OK to sleep
};

enum { NOTIFY_S1 = 1 << 0, NOTIFY_S2 = 1 << 1 };

static NodeState *g_state = nullptr;
static EventGroupHandle_t g_events = nullptr;
static QueueHandle_t g_bleRequests = nullptr;
static TaskHandle_t g_displayTask = nullptr;
static SensorReading g_last_reading;          // written before EVT_READING_READY is set
static volatile SendOutcome g_ble_outcome = SEND_OK; // written before EVT_BLE_DONE is set

struct BleRequest {
  bool unused;
};

// --- Button ISRs: do nothing but notify the display task (E2) ---------------

static void IRAM_ATTR isrButtonS1() {
  BaseType_t woken = pdFALSE;
  xTaskNotifyFromISR(g_displayTask, NOTIFY_S1, eSetBits, &woken);
  if (woken == pdTRUE) portYIELD_FROM_ISR();
}

static void IRAM_ATTR isrButtonS2() {
  BaseType_t woken = pdFALSE;
  xTaskNotifyFromISR(g_displayTask, NOTIFY_S2, eSetBits, &woken);
  if (woken == pdTRUE) portYIELD_FROM_ISR();
}

// --- BLE task --------------------------------------------------------------

static void vBleGattTask(void *) {
  BleRequest request;
  for (;;) {
    if (xQueueReceive(g_bleRequests, &request, portMAX_DELAY) == pdTRUE) {
      g_ble_outcome = bleGattRunSession(*g_state, BLE_ADVERTISING_TIMEOUT_MS);
      xEventGroupSetBits(g_events, EVT_BLE_DONE);
    }
  }
}

// --- Display / button task -------------------------------------------------

static const uint16_t MATRIX_SCROLL_STEP_MS = 45;

static void showLiveReading() {
  xEventGroupWaitBits(g_events, EVT_READING_READY, pdFALSE, pdFALSE, pdMS_TO_TICKS(2000));
  const SensorReading &r = g_last_reading;

  char text[32];
  matrixFormatReadings(text, sizeof(text), r.temp_cdeg, r.voc_index, r.light_ldr);
  Serial.printf("[S1] %s\n", text);

  // Scroll the readout, then power the display down to save battery (GOAL.md).
  if (matrixBegin()) {
    matrixScrollText(text, MATRIX_SCROLL_STEP_MS);
    matrixOff();
  }
}

static void vDisplayTask(void *) {
  pinMode(PIN_BUTTON_S1, INPUT_PULLUP);
  pinMode(PIN_BUTTON_S2, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_BUTTON_S1), isrButtonS1, FALLING);
  attachInterrupt(digitalPinToInterrupt(PIN_BUTTON_S2), isrButtonS2, FALLING);

  // The ISRs only see presses while awake. S2 woke us if the wake cause is ext0;
  // S1 cannot wake the chip, so a held S1 is picked up by polling at boot.
  uint32_t pending = 0;
  if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT0) pending |= NOTIFY_S2;
  if (digitalRead(PIN_BUTTON_S1) == LOW) pending |= NOTIFY_S1;

  for (;;) {
    uint32_t bits = 0;
    if (pending == 0) {
      // Wait a short window for a press, then report idle so the node can sleep.
      if (xTaskNotifyWait(0, UINT32_MAX, &bits, pdMS_TO_TICKS(DISPLAY_IDLE_WINDOW_MS)) != pdTRUE) {
        xEventGroupSetBits(g_events, EVT_DISPLAY_DONE);
        // Keep listening until the sensor task puts the chip to sleep.
        xTaskNotifyWait(0, UINT32_MAX, &bits, portMAX_DELAY);
        xEventGroupClearBits(g_events, EVT_DISPLAY_DONE);
      }
    } else {
      bits = pending;
      pending = 0;
    }

    if (bits & NOTIFY_S2) xEventGroupSetBits(g_events, EVT_FORCE_BLE);
    if (bits & NOTIFY_S1) showLiveReading();
  }
}

// --- Sensor task: orchestrates one wake cycle then sleeps -----------------

static void goToSleep(uint32_t awake_ms) {
  bleGattShutdown();
  Serial.flush();

  const uint64_t cycle_ms = (uint64_t)SAMPLE_INTERVAL_S * 1000ULL;
  uint64_t sleep_ms = awake_ms >= cycle_ms ? 100 : cycle_ms - awake_ms;

  esp_sleep_enable_timer_wakeup(sleep_ms * 1000ULL);
  esp_sleep_enable_ext0_wakeup((gpio_num_t)PIN_BUTTON_S2, 0); // wake on press (LOW)
  rtc_gpio_pullup_en((gpio_num_t)PIN_BUTTON_S2);
  rtc_gpio_pulldown_dis((gpio_num_t)PIN_BUTTON_S2);
  esp_deep_sleep_start();
}

static void vSensorTask(void *) {
  const uint32_t start_ms = millis();
  NodeState &node = *g_state;

  sensorsInit(node.voc);                       // algorithm state lives in RTC memory
  const SensorReading reading = sensorsRead(); // always feeds the VOC algorithm
  g_last_reading = reading;
  xEventGroupSetBits(g_events, EVT_READING_READY);

  const bool door_open = doorIsOpen(reading.light_ldr);

  SensorSample sample;
  sample.timestamp_s = (uint64_t)time(nullptr);
  sample.temp_cdeg = reading.temp_cdeg;
  sample.voc_index =
      doorVocFilter(node.cooldown_packets_remaining, reading.light_ldr, reading.voc_index);
  sample.light_ldr = reading.light_ldr;

  nodeStateTickHoldoff(node);
  nodeStateAppend(node, sample);

  Serial.printf("t=%llu temp_cdeg=%d rh=%.1f voc_raw=%u voc_tx=%u light=%u cooldown=%u buf=%u\n",
                (unsigned long long)sample.timestamp_s, sample.temp_cdeg, reading.humidity_rh,
                reading.voc_index, sample.voc_index, sample.light_ldr,
                node.cooldown_packets_remaining, node.sample_count);

  // Give the display task a moment to publish a manual S2 request.
  const bool force =
      (xEventGroupWaitBits(g_events, EVT_FORCE_BLE, pdFALSE, pdFALSE, pdMS_TO_TICKS(20)) &
       EVT_FORCE_BLE) != 0;

  if (nodeStateShouldSend(node, door_open, force)) {
    BleRequest request = {true};
    xEventGroupClearBits(g_events, EVT_BLE_DONE);
    xQueueSend(g_bleRequests, &request, portMAX_DELAY);
    // Guard against a hung BLE stack only: it must be longer than any normal
    // session, or sleep would deinit NimBLE while the BLE task is still using it.
    const uint32_t guard_ms =
        bleGattMaxSessionMs(BLE_ADVERTISING_TIMEOUT_MS) + BLE_STARTUP_MARGIN_MS;
    const EventBits_t done = xEventGroupWaitBits(g_events, EVT_BLE_DONE, pdFALSE, pdFALSE,
                                                 pdMS_TO_TICKS(guard_ms));
    const SendOutcome outcome = (done & EVT_BLE_DONE) ? g_ble_outcome : SEND_FAILED;
    nodeStateOnSendResult(node, outcome);
    Serial.printf("ble outcome=%d counter=%lu buf=%u\n", (int)outcome,
                  (unsigned long)node.counter, node.sample_count);
  }
  node.door_was_open = door_open;

  // Do not sleep while a button press is being handled.
  xEventGroupWaitBits(g_events, EVT_DISPLAY_DONE, pdFALSE, pdFALSE, pdMS_TO_TICKS(DISPLAY_SLEEP_GATE_MS));

  goToSleep(millis() - start_ms);
}

void tasksStart(NodeState &state) {
  g_state = &state;
  g_events = xEventGroupCreate();
  g_bleRequests = xQueueCreate(1, sizeof(BleRequest));

  xTaskCreate(vDisplayTask, "display", 3072, nullptr, 2, &g_displayTask);
  xTaskCreate(vBleGattTask, "ble", 8192, nullptr, 4, nullptr);
  xTaskCreate(vSensorTask, "sensor", 4096, nullptr, 3, nullptr);
}
