#ifndef SENSORS_H_
#define SENSORS_H_

#include <stdint.h>

// Pin map (fridge/ARCHITECTURE.md §1.B)
// The SHT31 (0x44) + SGP40 (0x59) can sit on either bus; sensorsInit() uses the
// one they answer on:
//   I2C1 (Wire1): GPIO 4/5, shared with the onboard LM73 (0x4D) and RTC (0x6F).
//   I2C0 (Wire):  GPIO 21/22, shared with the LED matrix (0x70). The KidBright
//                 board on the bench (2026-11-16) has the sensor connector here.
#define PIN_I2C1_SDA 4
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
  uint16_t voc_sraw;  // SGP40 raw signal fed to the algorithm, 0 if not read (diagnostic only)
  int16_t sgp40_err;  // SGP40 driver error code, 0 = OK, -1 = not found (diagnostic only)
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

// True when sensorsInit() found the sensors on I2C0 (GPIO 21/22), the bus the
// LED matrix also uses, so the matrix must not shut that bus down.
bool sensorsShareMatrixBus();

// Read all sensors. The VOC algorithm is fed on every call regardless of door
// state. Never blocks on a missing sensor; failures return sentinels.
SensorReading sensorsRead();

#endif // SENSORS_H_
