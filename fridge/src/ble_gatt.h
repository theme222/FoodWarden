#ifndef BLE_GATT_H_
#define BLE_GATT_H_

#include <stdint.h>

#include "node_state.h"

// Bring up the NimBLE stack and the FUC.md GATT table:
//   Service   0000FFF0-0000-1000-8000-00805F9B34FB
//   FFF1      encrypted telemetry (Read, Notify)
//   FFF2      8-byte little-endian Unix timestamp (Write, Read)
void bleGattInit();

// Run one send session (call from the BLE task only):
//   1. advertise the service for up to `adv_timeout_ms`
//   2. wait for the Gateway to connect and write the time to FFF2
//      (the RTC is set and buffered sample timestamps are shifted by the same delta)
//   3. encrypt the buffered samples (consuming one counter value) and expose them
//      on FFF1, notifying if the Gateway subscribed
//   4. wait for the Gateway to read/receive the packet, then disconnect.
// Returns SEND_NO_CONNECTION if nobody connected, SEND_FAILED if the exchange broke
// after connecting, SEND_OK otherwise. Does not modify the sample buffer.
// Takes at most bleGattMaxSessionMs(adv_timeout_ms), plus stack start-up time.
SendOutcome bleGattRunSession(NodeState &state, uint32_t adv_timeout_ms);

// Upper bound of the waits inside one bleGattRunSession() call.
uint32_t bleGattMaxSessionMs(uint32_t adv_timeout_ms);

// Stop BLE and release its resources before deep sleep.
void bleGattShutdown();

#endif // BLE_GATT_H_
