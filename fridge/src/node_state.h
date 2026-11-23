#ifndef NODE_STATE_H_
#define NODE_STATE_H_

#include <stdint.h>
#include <string.h>

#include "sensors.h"
#include "telemetry_types.h"

// Samples collected before a transmission (6 wakes x 5 s = 30 s).
#define NODE_BATCH_SIZE 6

// While the door is open (light above the threshold) every wake is sent at once,
// without waiting for a full batch. A door close is also sent at once; if the
// Gateway is not reached it is retried on each following wake, up to this many
// attempts in total (3 x 5 s = 15 s), after which the batch schedule takes over.
#define NODE_DOOR_ALERT_ATTEMPTS 3

// State kept in RTC_DATA_ATTR memory so it survives deep sleep. Wiped on a cold
// boot (power loss / brown-out / battery change), which also re-seeds the salt.
// Pure logic, no Arduino dependencies, so it can be unit tested on a host.
struct NodeState {
  bool initialised;
  uint8_t session_salt[8]; // Random per cold boot (hardware TRNG)
  uint32_t counter;        // Monotonic, incremented once per transmission attempt
  uint8_t cooldown_packets_remaining;
  bool door_was_open;       // Door state on the previous wake (detects door edges)
  uint8_t door_alert_attempts; // Immediate-send attempts left for the last door change
  uint8_t retry_holdoff;    // Wakes to wait before retrying a failed-to-connect send
  VocAlgorithmState voc;
  uint8_t sample_count;
  SensorSample samples[NODE_BATCH_SIZE];
};

// Reset everything and install a fresh session salt (call on cold boot).
static inline void nodeStateColdBoot(NodeState &s, const uint8_t salt[8]) {
  memset(&s, 0, sizeof(s));
  memcpy(s.session_salt, salt, sizeof(s.session_salt));
  s.initialised = true;
}

// Append a sample. If the buffer is already full the oldest sample is dropped.
// Returns true when the buffer holds NODE_BATCH_SIZE samples and is ready to send.
static inline bool nodeStateAppend(NodeState &s, const SensorSample &sample) {
  if (s.sample_count >= NODE_BATCH_SIZE) {
    memmove(&s.samples[0], &s.samples[1], (NODE_BATCH_SIZE - 1) * sizeof(SensorSample));
    s.sample_count = NODE_BATCH_SIZE - 1;
  }
  s.samples[s.sample_count++] = sample;
  return s.sample_count >= NODE_BATCH_SIZE;
}

// Drop all buffered samples (after a send attempt, successful or not).
static inline void nodeStateClearBuffer(NodeState &s) { s.sample_count = 0; }

// Result of a BLE send attempt.
enum SendOutcome {
  SEND_OK,            // Gateway received the packet
  SEND_FAILED,        // Connected but the exchange failed
  SEND_NO_CONNECTION, // Gateway never connected within the advertising window
};

// Call once per wake before deciding to send.
static inline void nodeStateTickHoldoff(NodeState &s) {
  if (s.retry_holdoff > 0) s.retry_holdoff--;
}

// Record this wake's door state. A change (closed -> open or open -> closed)
// arms an immediate send so the Gateway learns about it without waiting for the
// batch. Call once per wake, after appending the sample, before deciding to send.
static inline void nodeStateNoteDoor(NodeState &s, bool door_open_now) {
  if (door_open_now != s.door_was_open) s.door_alert_attempts = NODE_DOOR_ALERT_ATTEMPTS;
  s.door_was_open = door_open_now;
}

// Decide whether to open a BLE session this wake: on every wake while the door
// is open, immediately while a door change is still undelivered, on a full batch
// (unless a failed attempt is still holding off), or on a manual request `force`
// (button S2). Uses the door state recorded by nodeStateNoteDoor() this wake.
static inline bool nodeStateShouldSend(const NodeState &s, bool force) {
  if (s.sample_count == 0) return false;
  const bool door_alert = s.door_was_open || s.door_alert_attempts > 0;
  const bool batch_ready = s.sample_count >= NODE_BATCH_SIZE && s.retry_holdoff == 0;
  return force || door_alert || batch_ready;
}

// Apply a send result. A real exchange (ok or failed) discards the batch and the
// next attempt happens when the next batch is ready (GOAL.md: values can be
// discarded). If the Gateway never connected the batch is retained, and the
// next attempt is held off for a whole new batch so the radio is not kept busy
// every cycle; the oldest samples are overwritten as new ones arrive.
// A pending door alert is cleared on success; otherwise one attempt is used up
// and it is retried next wake (ignoring the hold-off) while attempts remain.
static inline void nodeStateOnSendResult(NodeState &s, SendOutcome outcome) {
  if (outcome == SEND_OK) {
    s.door_alert_attempts = 0;
  } else if (s.door_alert_attempts > 0) {
    s.door_alert_attempts--;
  }
  if (outcome == SEND_NO_CONNECTION) {
    s.retry_holdoff = NODE_BATCH_SIZE;
  } else {
    nodeStateClearBuffer(s);
    s.retry_holdoff = 0;
  }
}

// Take the next counter value for a transmission. Counter starts at 1 so the
// (salt, counter) IV pair is unique for every packet in a session.
static inline uint32_t nodeStateNextCounter(NodeState &s) { return ++s.counter; }

#endif // NODE_STATE_H_
