#ifndef SENSORS_H_
#define SENSORS_H_

#include <stdint.h>

// Pin map (fridge/ARCHITECTURE.md §1.B)
// I2C1 is the board's 4-pin I2C connector, shared with the unused onboard LM73 (0x4D).
#define PIN_I2C1_SDA 4 // SHT31 (0x44) + SGP40 (0x59) on Wire1
#define PIN_I2C1_SCL 5
#define PIN_LDR 36 // ADC1_CH0

#define SHT31_I2C_ADDRESS 0x44
#define SGP40_I2C_ADDRESS 0x59

// Interval between samples; the Gas Index Algorithm is configured with it.
#define SAMPLE_INTERVAL_S 5

struct SensorReading {
  int16_t temp_cdeg;  // SENSOR_TEMP_ERROR on failure
  uint16_t voc_index; // Raw algorithm output: 0 = warming up, SENSOR_VOC_ERROR on failure
  uint16_t light_ldr; // SENSOR_LIGHT_ERROR on failure
  float humidity_rh;  // %RH, or negative if unavailable (diagnostic only, not transmitted)
};

// Bytes reserved for the Sensirion GasIndexAlgorithmParams struct (about 200
// bytes; checked by a static_assert in voc_algorithm.h).
#define VOC_ALGORITHM_STATE_BYTES 256

// Complete Gas Index Algorithm state, kept in RTC_DATA_ATTR across deep sleep.
// Opaque here so this header (and node_state.h) stays free of library includes.
struct VocAlgorithmState {
  bool valid; // false on cold boot: the algorithm starts fresh
  uint8_t params[VOC_ALGORITHM_STATE_BYTES];
};

// Initialise Wire1, the SHT31, the SGP40 and the LDR pin. `voc` is the RTC
// algorithm state: initialised if not valid, then updated by every sensorsRead().
// It must outlive all sensorsRead() calls.
void sensorsInit(VocAlgorithmState &voc);

// Read all sensors. The VOC algorithm is fed on every call regardless of door
// state. Never blocks on a missing sensor; failures return sentinels.
SensorReading sensorsRead();

#endif // SENSORS_H_
