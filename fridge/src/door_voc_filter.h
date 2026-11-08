#ifndef DOOR_VOC_FILTER_H_
#define DOOR_VOC_FILTER_H_

#include <stdint.h>

#include "telemetry_types.h"

// Door-open VOC masking. Opening the fridge door pushes warm, humid room air
// over the SGP40 and causes artificial VOC spikes. While the door is open, and
// for DOOR_COOLDOWN_PACKETS samples after it closes, the reported VOC index is
// replaced with VOC_NULL_SENTINEL. The Gas Index Algorithm itself must still be
// fed every cycle (see sensors.cpp) so its baseline stays valid.
//
// Pure logic with no Arduino dependencies so it can be unit tested on a host.

// Door-open threshold on the raw LDR ADC reading (0-4095). Placeholder:
// calibrate against the real fridge light level (the serial log prints
// `light=` every wake) and override without editing code, e.g.
//   build_flags = -DFRIDGE_LDR_THRESHOLD=900
#ifndef FRIDGE_LDR_THRESHOLD
#define FRIDGE_LDR_THRESHOLD 1500
#endif
static const uint16_t LDR_DOOR_OPEN_THRESHOLD = FRIDGE_LDR_THRESHOLD;

// Polarity: by default "open" means reading > threshold (brighter = higher, as
// in the issue spec). If the board's LDR reads LOWER in light, build with
// -DFRIDGE_LDR_OPEN_IS_LOW=1 so "open" means reading < threshold.
#ifndef FRIDGE_LDR_OPEN_IS_LOW
#define FRIDGE_LDR_OPEN_IS_LOW 0
#endif

// 12 packets x 5 s = 60 s of stable closed-door environment.
static const uint8_t DOOR_COOLDOWN_PACKETS = 12;

// True if the LDR reading says the door is open. An LDR fault counts as closed.
static inline bool doorIsOpen(uint16_t light_ldr) {
  if (light_ldr == SENSOR_LIGHT_ERROR) return false;
#if FRIDGE_LDR_OPEN_IS_LOW
  return light_ldr < LDR_DOOR_OPEN_THRESHOLD;
#else
  return light_ldr > LDR_DOOR_OPEN_THRESHOLD;
#endif
}

// Returns the VOC value to transmit.
//   cooldown_packets_remaining: caller-owned state; place it in RTC_DATA_ATTR
//     so it survives deep sleep.
//   light_ldr: raw LDR reading. SENSOR_LIGHT_ERROR is treated as "door state
//     unknown" and does not start a new cooldown.
//   voc_index: real algorithm output (or SENSOR_VOC_ERROR if the SGP40 failed).
static inline uint16_t doorVocFilter(uint8_t &cooldown_packets_remaining,
                                     uint16_t light_ldr, uint16_t voc_index) {
  if (doorIsOpen(light_ldr)) {
    cooldown_packets_remaining = DOOR_COOLDOWN_PACKETS;
    return VOC_NULL_SENTINEL;
  }
  if (cooldown_packets_remaining > 0) {
    cooldown_packets_remaining--;
    return VOC_NULL_SENTINEL;
  }
  return voc_index;
}

#endif // DOOR_VOC_FILTER_H_
