#ifndef LDR_SCALE_H_
#define LDR_SCALE_H_

#include <stdint.h>

// Converts the KidBright LDR's raw 12-bit ADC reading to the transmitted light
// level, 0 (dark) .. LDR_LIGHT_MAX (bright).
//
// The raw ADC rises as it gets darker, so it is inverted first (4095 - raw).
// On the bench board (2026-11-16) the inverted value read about 3080 in pitch
// black, 3800 in room light and 4095 under a flashlight, so everything below
// FRIDGE_LDR_DARK is "dark" and the top 1000 counts map 1:1 onto 0..1000:
//   pitch black -> 0, room light -> ~705, flashlight -> 1000.
// Recalibrate without editing code, e.g. build_flags = -DFRIDGE_LDR_DARK=3000
//
// Pure logic with no Arduino dependencies so it can be unit tested on a host.

#define LDR_ADC_MAX 4095   // 12-bit ADC full scale
#define LDR_LIGHT_MAX 1000 // top of the transmitted scale

#ifndef FRIDGE_LDR_DARK
#define FRIDGE_LDR_DARK 3095 // inverted reading at and below which it is fully dark
#endif

static inline uint16_t ldrScale(uint16_t adc_raw) {
  if (adc_raw > LDR_ADC_MAX) adc_raw = LDR_ADC_MAX;
  const int32_t inverted = LDR_ADC_MAX - (int32_t)adc_raw;
  if (inverted <= FRIDGE_LDR_DARK) return 0;
  const int32_t level =
      (inverted - FRIDGE_LDR_DARK) * LDR_LIGHT_MAX / (LDR_ADC_MAX - FRIDGE_LDR_DARK);
  return (uint16_t)(level > LDR_LIGHT_MAX ? LDR_LIGHT_MAX : level);
}

#endif // LDR_SCALE_H_
