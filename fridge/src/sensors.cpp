#include "sensors.h"

#include <Arduino.h>
#include <SensirionI2CSgp40.h>
#include <SensirionI2cSht3x.h>
#include <Wire.h>

#include "telemetry_types.h"
#include "voc_algorithm.h"

// I2C transaction timeout so an unplugged sensor cannot lock up the bus.
static const uint32_t I2C_TIMEOUT_MS = 50;
static const uint32_t I2C_CLOCK_HZ = 100000;

// SGP40 default compensation ticks (50 %RH, 25 degC), used when the SHT31 fails.
static const uint16_t SGP40_DEFAULT_RH_TICKS = 0x8000;
static const uint16_t SGP40_DEFAULT_T_TICKS = 0x6666;

static SensirionI2cSht3x sht31;
static SensirionI2CSgp40 sgp40;
static VocAlgorithmState *vocState = nullptr; // RTC memory, set by sensorsInit()

static bool i2cDevicePresent(uint8_t address) {
  Wire1.beginTransmission(address);
  return Wire1.endTransmission() == 0;
}

static uint16_t rhToTicks(float rh) {
  if (rh < 0.0f) rh = 0.0f;
  if (rh > 100.0f) rh = 100.0f;
  return (uint16_t)(rh * 65535.0f / 100.0f);
}

static uint16_t tempToTicks(float temp_c) {
  if (temp_c < -45.0f) temp_c = -45.0f;
  if (temp_c > 130.0f) temp_c = 130.0f;
  return (uint16_t)((temp_c + 45.0f) * 65535.0f / 175.0f);
}

void sensorsInit(VocAlgorithmState &voc) {
  Wire1.begin(PIN_I2C1_SDA, PIN_I2C1_SCL, I2C_CLOCK_HZ);
  Wire1.setTimeOut(I2C_TIMEOUT_MS);

  sht31.begin(Wire1, SHT31_I2C_ADDRESS);
  sgp40.begin(Wire1);

  vocAlgorithmBegin(voc, (float)SAMPLE_INTERVAL_S);
  vocState = &voc;

  analogReadResolution(12);
  analogSetPinAttenuation(PIN_LDR, ADC_11db);
}

SensorReading sensorsRead() {
  SensorReading reading;
  reading.temp_cdeg = SENSOR_TEMP_ERROR;
  reading.voc_index = SENSOR_VOC_ERROR;
  reading.humidity_rh = -1.0f;

  // 1. LDR
  reading.light_ldr = (uint16_t)analogRead(PIN_LDR);

  // 2. SHT31 temperature + humidity (single shot, high repeatability)
  uint16_t rh_ticks = SGP40_DEFAULT_RH_TICKS;
  uint16_t t_ticks = SGP40_DEFAULT_T_TICKS;
  if (i2cDevicePresent(SHT31_I2C_ADDRESS)) {
    float temp_c = 0.0f;
    float rh = 0.0f;
    if (sht31.measureSingleShot(REPEATABILITY_HIGH, false, temp_c, rh) == 0) {
      reading.temp_cdeg = (int16_t)lroundf(temp_c * 100.0f);
      reading.humidity_rh = rh;
      rh_ticks = rhToTicks(rh);
      t_ticks = tempToTicks(temp_c);
    }
  }

  // 3. SGP40: always feed the Gas Index Algorithm, whatever the door state, so
  //    its moving baseline sees an uninterrupted stream. Compensate with the
  //    real SHT31 humidity and temperature when available.
  if (vocState != nullptr && i2cDevicePresent(SGP40_I2C_ADDRESS)) {
    uint16_t sraw = 0;
    if (sgp40.measureRawSignal(rh_ticks, t_ticks, sraw) == 0) {
      int32_t voc = vocAlgorithmProcess(*vocState, (int32_t)sraw);
      if (voc >= 0 && voc <= 500) {
        reading.voc_index = (uint16_t)voc;
      }
    }
#ifdef FRIDGE_SGP40_HEATER_OFF
    // Opt-in power saving: the heater otherwise stays on through deep sleep.
    // Whether the VOC index stays accurate this way must be checked on hardware.
    sgp40.turnHeaterOff();
#endif
  }

  return reading;
}
