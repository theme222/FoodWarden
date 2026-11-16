#include "sensors.h"

#include <Arduino.h>
#include <SensirionI2CSgp40.h>
#include <SensirionI2cSht3x.h>
#include <Wire.h>

#include "ldr_scale.h"
#include "telemetry_types.h"
#include "voc_algorithm.h"

// I2C transaction timeout so an unplugged sensor cannot lock up the bus.
static const uint32_t I2C_TIMEOUT_MS = 50;
static const uint32_t I2C_CLOCK_HZ = 100000;
static const int PIN_I2C0_SDA_SCAN = 21; // I2C0, shared with the HT16K33 matrix
static const int PIN_I2C0_SCL_SCAN = 22;

// SGP40 default compensation ticks (50 %RH, 25 degC), used when the SHT31 fails.
static const uint16_t SGP40_DEFAULT_RH_TICKS = 0x8000;
static const uint16_t SGP40_DEFAULT_T_TICKS = 0x6666;

static SensirionI2cSht3x sht31;
static SensirionI2CSgp40 sgp40;
static VocAlgorithmState *vocState = nullptr; // RTC memory, set by sensorsInit()
static TwoWire *bus = &Wire1;                 // bus the sensors were found on

static bool i2cDevicePresent(TwoWire &b, uint8_t address) {
  b.beginTransmission(address);
  return b.endTransmission() == 0;
}

static bool i2cDevicePresent(uint8_t address) { return i2cDevicePresent(*bus, address); }

static bool sensorsOn(TwoWire &b) {
  return i2cDevicePresent(b, SHT31_I2C_ADDRESS) || i2cDevicePresent(b, SGP40_I2C_ADDRESS);
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

// Cold-boot wiring diagnostic: list every address that ACKs on a bus.
static void scanI2C(TwoWire &bus, const char *name) {
  Serial.printf("i2c scan %s:", name);
  int found = 0;
  for (uint8_t addr = 0x08; addr < 0x78; addr++) {
    bus.beginTransmission(addr);
    if (bus.endTransmission() == 0) {
      Serial.printf(" 0x%02X", addr);
      found++;
    }
  }
  Serial.println(found ? "" : " (nothing)");
}

void sensorsInit(VocAlgorithmState &voc) {
  Wire1.begin(PIN_I2C1_SDA, PIN_I2C1_SCL, I2C_CLOCK_HZ);
  Wire1.setTimeOut(I2C_TIMEOUT_MS);
  Wire.begin(PIN_I2C0_SDA_SCAN, PIN_I2C0_SCL_SCAN, I2C_CLOCK_HZ);
  Wire.setTimeOut(I2C_TIMEOUT_MS);

  if (!voc.valid) { // cold boot only: show what is wired
    scanI2C(Wire1, "GPIO4/5 (onboard 0x4D 0x6F)");
    scanI2C(Wire, "GPIO21/22 (matrix 0x70)");
  }

  // The SHT31 + SGP40 may sit on either 4-pin connector: GPIO 4/5 (I2C1) or
  // GPIO 21/22 (I2C0, shared with the LED matrix). Use whichever answers.
  if (sensorsOn(Wire1) || !sensorsOn(Wire)) {
    bus = &Wire1;
    Wire.end(); // the matrix driver starts Wire itself when needed
  } else {
    bus = &Wire;
    Wire1.end();
  }
  if (!voc.valid) {
    Serial.printf("sensors on %s\n", bus == &Wire ? "GPIO21/22" : "GPIO4/5");
  }

  sht31.begin(*bus, SHT31_I2C_ADDRESS);
  sgp40.begin(*bus);

  vocAlgorithmBegin(voc, (float)SAMPLE_INTERVAL_S);
  vocState = &voc;

  analogReadResolution(12);
  analogSetPinAttenuation(PIN_LDR, ADC_11db);
}

bool sensorsShareMatrixBus() { return bus == &Wire; }

SensorReading sensorsRead() {
  SensorReading reading;
  reading.temp_cdeg = SENSOR_TEMP_ERROR;
  reading.voc_index = SENSOR_VOC_ERROR;
  reading.humidity_rh = -1.0f;
  reading.voc_sraw = 0;
  reading.sgp40_err = -1;

  // 1. LDR: inverted and scaled to 0 (dark) .. 1000 (bright), see ldr_scale.h
  reading.light_ldr = ldrScale((uint16_t)analogRead(PIN_LDR));

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
    const uint16_t err = sgp40.measureRawSignal(rh_ticks, t_ticks, sraw);
    reading.sgp40_err = (int16_t)err;
    reading.voc_sraw = sraw;
    if (err == 0) {
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
