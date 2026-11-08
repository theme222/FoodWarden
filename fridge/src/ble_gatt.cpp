#include "ble_gatt.h"

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <freertos/FreeRTOS.h>
#include <freertos/event_groups.h>
#include <sys/time.h>

#include "crypto.h"

#if __has_include("secrets.h")
#include "secrets.h"
#define HAVE_SECRETS 1
#endif

// Characteristic / service UUIDs (interface/FUC.md §1)
#define UUID_SERVICE "0000FFF0-0000-1000-8000-00805F9B34FB"
#define UUID_TELEMETRY "0000FFF1-0000-1000-8000-00805F9B34FB"
#define UUID_TIME_SYNC "0000FFF2-0000-1000-8000-00805F9B34FB"

// Largest ATT MTU we ask for; the Gateway negotiates >= 128 (FUC.md §1).
static const uint16_t PREFERRED_MTU = 247;

// How long to wait for each step once a Gateway is connected.
static const uint32_t TIME_SYNC_WAIT_MS = 3000;
static const uint32_t DELIVERY_WAIT_MS = 3000;
static const uint32_t DISCONNECT_WAIT_MS = 1500; // each of: Gateway closes, then forced close

uint32_t bleGattMaxSessionMs(uint32_t adv_timeout_ms) {
  return adv_timeout_ms + TIME_SYNC_WAIT_MS + DELIVERY_WAIT_MS + 2 * DISCONNECT_WAIT_MS;
}

enum {
  EVT_CONNECTED = 1 << 0,
  EVT_DISCONNECTED = 1 << 1,
  EVT_TIME_WRITTEN = 1 << 2,
  EVT_SUBSCRIBED = 1 << 3,
  EVT_READ = 1 << 4,
};

static NimBLEServer *server = nullptr;
static NimBLECharacteristic *telemetryChr = nullptr;
static NimBLECharacteristic *timeChr = nullptr;
static EventGroupHandle_t events = nullptr;
static NodeState *sessionState = nullptr; // valid only inside bleGattRunSession
static volatile uint16_t connHandle = 0xFFFF;
static volatile bool packetReady = false; // FFF1 holds this session's packet
static bool bleReady = false;

static void applyTimeSync(uint64_t new_unix_s) {
  struct timeval now;
  gettimeofday(&now, nullptr);
  const int64_t delta = (int64_t)new_unix_s - (int64_t)now.tv_sec;

  struct timeval tv;
  tv.tv_sec = (time_t)new_unix_s;
  tv.tv_usec = 0;
  settimeofday(&tv, nullptr);

  // Samples buffered before the sync were stamped with the old clock; shifting
  // by the same delta keeps their spacing exact.
  if (sessionState != nullptr) {
    for (uint8_t i = 0; i < sessionState->sample_count; i++) {
      sessionState->samples[i].timestamp_s += (uint64_t)delta;
    }
  }
}

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *, ble_gap_conn_desc *desc) override {
    connHandle = desc->conn_handle;
    xEventGroupSetBits(events, EVT_CONNECTED);
  }
  void onDisconnect(NimBLEServer *) override {
    connHandle = 0xFFFF;
    xEventGroupSetBits(events, EVT_DISCONNECTED);
  }
};

class TimeCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *chr) override {
    NimBLEAttValue value = chr->getValue();
    if (value.size() != 8) return; // FUC.md: exactly 8 bytes (uint64_t, LE)
    uint64_t ts = 0;
    memcpy(&ts, value.data(), 8); // ESP32 is little-endian
    applyTimeSync(ts);
    xEventGroupSetBits(events, EVT_TIME_WRITTEN);
  }
};

class TelemetryCallbacks : public NimBLECharacteristicCallbacks {
  // A read before the packet is in place returns a stale/empty value: not a delivery.
  void onRead(NimBLECharacteristic *) override {
    if (packetReady) xEventGroupSetBits(events, EVT_READ);
  }
  void onSubscribe(NimBLECharacteristic *, ble_gap_conn_desc *, uint16_t subValue) override {
    if (subValue & 1) xEventGroupSetBits(events, EVT_SUBSCRIBED); // notifications on
  }
};

static ServerCallbacks serverCallbacks;
static TimeCallbacks timeCallbacks;
static TelemetryCallbacks telemetryCallbacks;

void bleGattInit() {
  if (bleReady) return;
  events = xEventGroupCreate();

  NimBLEDevice::init("FoodWarden-Fridge");
  NimBLEDevice::setMTU(PREFERRED_MTU);

  server = NimBLEDevice::createServer();
  server->setCallbacks(&serverCallbacks);
  server->advertiseOnDisconnect(false); // never keep advertising on our own

  NimBLEService *service = server->createService(UUID_SERVICE);
  telemetryChr = service->createCharacteristic(
      UUID_TELEMETRY, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  telemetryChr->setCallbacks(&telemetryCallbacks);
  timeChr = service->createCharacteristic(
      UUID_TIME_SYNC, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::WRITE);
  timeChr->setCallbacks(&timeCallbacks);
  const uint64_t zero = 0;
  timeChr->setValue((const uint8_t *)&zero, sizeof(zero));
  service->start();

  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(UUID_SERVICE);
  adv->setScanResponse(true);
  bleReady = true;
}

static bool waitDisconnected() {
  return (xEventGroupWaitBits(events, EVT_DISCONNECTED, pdFALSE, pdFALSE,
                              pdMS_TO_TICKS(DISCONNECT_WAIT_MS)) &
          EVT_DISCONNECTED) != 0;
}

// FUC.md §6: the Gateway closes the link once it has the packet. Waiting for
// that also gives a queued (unacknowledged) notification time to go out before
// the link is torn down. If it does not close in time, force it.
static void disconnectPeer(bool let_peer_close) {
  if (let_peer_close && waitDisconnected()) return;
  if (connHandle != 0xFFFF) server->disconnect(connHandle);
  waitDisconnected();
}

SendOutcome bleGattRunSession(NodeState &state, uint32_t adv_timeout_ms) {
#ifndef HAVE_SECRETS
  (void)state;
  (void)adv_timeout_ms;
  return SEND_FAILED; // cannot encrypt without AES_KEY
#else
  bleGattInit(); // lazy: the radio is only powered up when there is something to send
  sessionState = &state;
  packetReady = false;
  xEventGroupClearBits(events, 0xFF);

  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->start();

  // 1. Wait for the Gateway to connect.
  EventBits_t bits = xEventGroupWaitBits(events, EVT_CONNECTED, pdFALSE, pdFALSE,
                                         pdMS_TO_TICKS(adv_timeout_ms));
  adv->stop();
  if (!(bits & EVT_CONNECTED)) {
    sessionState = nullptr;
    return SEND_NO_CONNECTION;
  }

  SendOutcome outcome = SEND_FAILED;

  // 2. Wait for the Gateway to write the time (FUC.md §6 step order).
  bits = xEventGroupWaitBits(events, EVT_TIME_WRITTEN | EVT_DISCONNECTED, pdFALSE, pdFALSE,
                             pdMS_TO_TICKS(TIME_SYNC_WAIT_MS));
  if (!(bits & EVT_DISCONNECTED)) {
    // 3. Encrypt and expose the telemetry. The counter is consumed here so a
    //    (salt, counter) pair is never used for two different packets.
    uint8_t packet[TELEMETRY_MAX_PACKET_LEN];
    const uint32_t counter = nodeStateNextCounter(state);
    const size_t len = buildEncryptedPacket(AES_KEY, FRIDGE_NODE_ID, state.session_salt, counter,
                                            state.samples, state.sample_count, packet,
                                            sizeof(packet));
    if (len > 0) {
#ifdef FRIDGE_LOG_PACKETS
      // Debug aid: feed this line to tools/decrypt_packet.py to validate the packet.
      Serial.print("packet=");
      for (size_t i = 0; i < len; i++) Serial.printf("%02x", packet[i]);
      Serial.println();
#endif
      telemetryChr->setValue(packet, len);
      packetReady = true;

      // 4. Deliver: notify if subscribed (or once the Gateway subscribes), else
      //    the Gateway reads the value. NimBLE silently truncates a notification
      //    to MTU - 3 bytes, so only notify when the whole packet fits; a read
      //    of a longer value still works (ATT long read).
      const uint16_t conn = connHandle;
      const bool can_notify = conn != 0xFFFF && server->getPeerMTU(conn) >= len + 3;
      const EventBits_t wanted =
          EVT_READ | EVT_DISCONNECTED | (can_notify ? (EventBits_t)EVT_SUBSCRIBED : 0);
      bits = xEventGroupWaitBits(events, wanted, pdFALSE, pdFALSE,
                                 pdMS_TO_TICKS(DELIVERY_WAIT_MS)); // returns at once if set
      if (can_notify && (bits & EVT_SUBSCRIBED)) {
        telemetryChr->notify();
        outcome = SEND_OK;
      } else if (bits & EVT_READ) {
        outcome = SEND_OK;
      }
    }
  }

  disconnectPeer(outcome == SEND_OK);
  packetReady = false;
  sessionState = nullptr;
  return outcome;
#endif
}

void bleGattShutdown() {
  if (!bleReady) return;
  NimBLEDevice::deinit(true);
  bleReady = false;
}
