#ifndef VOC_ALGORITHM_H_
#define VOC_ALGORITHM_H_

#include <string.h>

extern "C" { // the Sensirion C header has no C++ guard of its own
#include <algorithm/sensirion_gas_index_algorithm.h>
}

#include "sensors.h"

// Sensirion VOC Gas Index Algorithm across deep sleep.
//
// Every wake is a fresh boot that processes exactly one sample, so the
// algorithm's complete state (GasIndexAlgorithmParams) must be carried in RTC
// memory. Restoring only the baseline with set_states() is not enough: it does
// not restore the uptime counter, so every wake would start a new 45 s initial
// blackout and the index would read 0 forever.
//
// No Arduino dependencies, so the real algorithm can be exercised on a host
// (tools/host_test/sim.cpp).

static_assert(sizeof(GasIndexAlgorithmParams) <= VOC_ALGORITHM_STATE_BYTES,
              "VocAlgorithmState::params is too small for GasIndexAlgorithmParams");

// Initialise `state` for a fresh start (cold boot) unless it already holds a
// running algorithm.
static inline void vocAlgorithmBegin(VocAlgorithmState &state, float sampling_interval_s) {
  if (state.valid) return;
  GasIndexAlgorithmParams params;
  GasIndexAlgorithm_init_with_sampling_interval(&params, GasIndexAlgorithm_ALGORITHM_TYPE_VOC,
                                                sampling_interval_s);
  memcpy(state.params, &params, sizeof(params));
  state.valid = true;
}

// Feed one raw SGP40 signal and return the VOC index (0 during the initial
// 45 s blackout, then 1-500). `state` must have been through vocAlgorithmBegin().
static inline int32_t vocAlgorithmProcess(VocAlgorithmState &state, int32_t sraw) {
  // Copy out and back so the byte buffer never has to be suitably aligned.
  GasIndexAlgorithmParams params;
  memcpy(&params, state.params, sizeof(params));
  int32_t voc_index = 0;
  GasIndexAlgorithm_process(&params, sraw, &voc_index);
  memcpy(state.params, &params, sizeof(params));
  return voc_index;
}

#endif // VOC_ALGORITHM_H_
