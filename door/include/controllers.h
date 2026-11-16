#ifndef DOOR_CONTROLLERS_H_
#define DOOR_CONTROLLERS_H_

#include <Adafruit_INA219.h>
#include <Adafruit_LEDBackpack.h>
#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>

#include "config.h"

// ==============================================================================
// Node 'D' (Door Closer Actuator) — Hardware Port & Peripheral Drivers
// Provides direct, stateless read/write helpers for testing and controlling
// every connected hardware component on KidBright32 V1.3.
// ==============================================================================

namespace door_controllers {

// Dedicated LEDC channel on Timer 1 for the passive piezo buzzer (kept on a
// separate timer from door_config::PWM_LEDC_CHANNEL = 0 which uses Timer 0,
// because ESP32 channels 0 and 1 share Timer 0 and ledcWriteTone() changes
// Timer 0's resolution to 10-bit!).
constexpr uint8_t BUZZER_LEDC_CHANNEL    = 2;
constexpr uint8_t BUZZER_RESOLUTION_BITS = 8;
constexpr uint8_t MATRIX_BRIGHTNESS      = 8;  // 0..15 safe mid-brightness

// ------------------------------------------------------------------------------
// 1. I2C Bus Management (I2C0 = Onboard HT16K33, I2C1 = JST KB Chain / INA219)
// ------------------------------------------------------------------------------

/**
 * @brief Initializes both ESP32 I2C buses with non-blocking timeout protection.
 */
inline void initI2CBuses() {
  Wire.begin(door_config::PIN_I2C0_SDA, door_config::PIN_I2C0_SCL,
             door_config::I2C_FREQ_HZ);
  Wire.setTimeOut(door_config::I2C_TIMEOUT_MS);

  Wire1.begin(door_config::PIN_I2C1_SDA, door_config::PIN_I2C1_SCL,
              door_config::I2C_FREQ_HZ);
  Wire1.setTimeOut(door_config::I2C_TIMEOUT_MS);
}

/**
 * @brief Probes an I2C address to confirm the target device ACKs on the bus.
 */
inline bool i2cPing(TwoWire& wire, uint8_t address) {
  wire.beginTransmission(address);
  return wire.endTransmission() == 0;
}

/**
 * @brief Returns the configured TwoWire bus for the INA219 current sensor.
 */
inline TwoWire& getIna219Wire() {
  return door_config::INA219_USE_I2C1 ? Wire1 : Wire;
}

// ------------------------------------------------------------------------------
// 2. Motor Driver (Toshiba TB6612FNG -> JGY-370 12V Worm Gear Motor)
// ------------------------------------------------------------------------------

namespace detail {

inline void attachPwmPin(int pin, uint8_t channel, uint32_t freq_hz,
                         uint8_t resolution_bits) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
  ledcAttachChannel(pin, freq_hz, resolution_bits, channel);
#else
  ledcSetup(channel, freq_hz, resolution_bits);
  ledcAttachPin(pin, channel);
#endif
}

inline void writePwmDuty(int pin, uint8_t channel, uint8_t duty) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
  (void)channel;
  ledcWrite(pin, duty);
#else
  (void)pin;
  ledcWrite(channel, duty);
#endif
}

inline void writePwmTone(int pin, uint8_t channel, uint32_t freq_hz) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
  (void)channel;
  ledcWriteTone(pin, freq_hz);
#else
  (void)pin;
  ledcWriteTone(channel, freq_hz);
#endif
}

// Single shared write path so all H-bridge states update direction and PWM atomically.
inline void writeMotorBridge(uint8_t ain1_level, uint8_t ain2_level,
                             uint8_t duty) {
  digitalWrite(door_config::PIN_MOTOR_AIN1, ain1_level);
  digitalWrite(door_config::PIN_MOTOR_AIN2, ain2_level);
  writePwmDuty(door_config::PIN_MOTOR_PWMA, door_config::PWM_LEDC_CHANNEL,
               duty);
}

}  // namespace detail

/**
 * @brief Configures TB6612FNG control GPIOs and 20 kHz LEDC PWM, leaving the
 *        motor in a safe coast-stopped state.
 */
inline void initMotorDriver() {
  // Force direction pins LOW before enabling PWM so the motor never twitches on boot.
  pinMode(door_config::PIN_MOTOR_AIN1, OUTPUT);
  pinMode(door_config::PIN_MOTOR_AIN2, OUTPUT);
  digitalWrite(door_config::PIN_MOTOR_AIN1, LOW);
  digitalWrite(door_config::PIN_MOTOR_AIN2, LOW);

  detail::attachPwmPin(door_config::PIN_MOTOR_PWMA,
                       door_config::PWM_LEDC_CHANNEL, door_config::PWM_FREQ_HZ,
                       door_config::PWM_RESOLUTION_BITS);
  detail::writePwmDuty(door_config::PIN_MOTOR_PWMA,
                       door_config::PWM_LEDC_CHANNEL, 0);
}

/**
 * @brief Drives motor Clockwise (CW — forward door-closing push) at `duty` (0-255).
 */
inline void motorDriveCW(uint8_t duty) {
  detail::writeMotorBridge(LOW, HIGH, duty);
}

/**
 * @brief Drives motor Counter-Clockwise (CCW — arm retraction) at `duty` (0-255).
 */
inline void motorDriveCCW(uint8_t duty) {
  detail::writeMotorBridge(HIGH, LOW, duty);
}

/**
 * @brief Applies active H-bridge short-brake (AIN1=HIGH, AIN2=HIGH, PWMA=0).
 */
inline void motorShortBrake() { detail::writeMotorBridge(HIGH, HIGH, 0); }

/**
 * @brief Cuts motor drive / high-Z coast stop (AIN1=LOW, AIN2=LOW, PWMA=0).
 */
inline void motorCoastStop() { detail::writeMotorBridge(LOW, LOW, 0); }

/**
 * @brief Updates only the PWMA duty cycle (0-255) without altering direction.
 */
inline void motorSetPwmDuty(uint8_t duty) {
  detail::writePwmDuty(door_config::PIN_MOTOR_PWMA,
                       door_config::PWM_LEDC_CHANNEL, duty);
}

// ------------------------------------------------------------------------------
// 3. INA219 High-Side Current & 12V Bus Voltage Monitor
// ------------------------------------------------------------------------------

/**
 * @brief Verifies INA219 presence on I2C and initializes 32V / 2A calibration.
 * @return true if the INA219 responded and initialized cleanly.
 */
inline bool initCurrentSensor(Adafruit_INA219& ina) {
  TwoWire& bus = getIna219Wire();
  if (!i2cPing(bus, door_config::I2C_ADDR_INA219)) {
    return false;
  }
  if (!ina.begin(&bus)) {
    return false;
  }
  ina.setCalibration_32V_2A();
  return true;
}

/**
 * @brief Reads signed motor current in mA (negative values indicate reversed
 *        VIN+ / VIN- wiring).
 * @return true on successful I2C transaction.
 */
inline bool readCurrentRawMa(Adafruit_INA219& ina, float& out_ma) {
  if (!i2cPing(getIna219Wire(), door_config::I2C_ADDR_INA219)) {
    return false;
  }
  const float reading_ma = ina.getCurrent_mA();
  if (!ina.success()) {
    return false;
  }
  out_ma = reading_ma;
  return true;
}

/**
 * @brief Reads motor current magnitude in mA, returning CURRENT_FAULT_SENTINEL_MA
 *        (0xFFFF) and false if the INA219 fails to respond.
 */
inline bool readCurrentMa(Adafruit_INA219& ina, uint16_t& out_ma) {
  float raw_ma = 0.0f;
  if (!readCurrentRawMa(ina, raw_ma)) {
    out_ma = door_config::CURRENT_FAULT_SENTINEL_MA;
    return false;
  }
  const float abs_ma = fabsf(raw_ma);
  out_ma = (abs_ma >= static_cast<float>(door_config::CURRENT_FAULT_SENTINEL_MA - 1))
               ? static_cast<uint16_t>(door_config::CURRENT_FAULT_SENTINEL_MA - 1)
               : static_cast<uint16_t>(abs_ma + 0.5f);
  return true;
}

/**
 * @brief Reads the 12V motor supply bus voltage at INA219 VIN- in Volts.
 * @return true on successful I2C transaction.
 */
inline bool readBusVoltageV(Adafruit_INA219& ina, float& out_volts) {
  if (!i2cPing(getIna219Wire(), door_config::I2C_ADDR_INA219)) {
    return false;
  }
  const float volts = ina.getBusVoltage_V();
  if (!ina.success()) {
    return false;
  }
  out_volts = volts;
  return true;
}

// ------------------------------------------------------------------------------
// 4. Digital Sensors & Onboard Pushbuttons (IR, Limit Switch, S1, S2)
// ------------------------------------------------------------------------------

/**
 * @brief Configures TCRT5000 IR input, Home Limit Switch, and S1/S2 buttons.
 */
inline void initDigitalInputs() {
  pinMode(door_config::PIN_IR_DOOR_CLOSED, INPUT);
  pinMode(door_config::PIN_LIMIT_SWITCH,
          (door_config::LIMIT_SWITCH_ACTIVE_LEVEL == HIGH) ? INPUT_PULLDOWN
                                                           : INPUT_PULLUP);
  pinMode(door_config::PIN_BTN_EMERGENCY_ABORT, INPUT_PULLUP);
  pinMode(door_config::PIN_BTN_DEBUG_CLOSE, INPUT_PULLUP);
}

/**
 * @brief Returns true when an active-LOW digital input pin reads LOW.
 */
inline bool readActiveLowPin(int pin) { return digitalRead(pin) == LOW; }

/**
 * @brief Returns true when TCRT5000 (IO32) detects the door is closed (LOW).
 */
inline bool isIrDoorClosed() {
  return readActiveLowPin(door_config::PIN_IR_DOOR_CLOSED);
}

/**
 * @brief Returns true when the Home Limit Switch (IO33, active HIGH) is depressed.
 */
inline bool isLimitSwitchHomed() {
  return digitalRead(door_config::PIN_LIMIT_SWITCH) ==
         door_config::LIMIT_SWITCH_ACTIVE_LEVEL;
}

/**
 * @brief Returns true when onboard Emergency Abort button S1 (IO16) is pressed.
 */
inline bool isEmergencyAbortPressed() {
  return readActiveLowPin(door_config::PIN_BTN_EMERGENCY_ABORT);
}

/**
 * @brief Returns true when onboard Debug Close button S2 (IO14) is pressed.
 */
inline bool isDebugClosePressed() {
  return readActiveLowPin(door_config::PIN_BTN_DEBUG_CLOSE);
}

// ------------------------------------------------------------------------------
// 5. KidBright32 Onboard Status LEDs & Piezo Buzzer
// ------------------------------------------------------------------------------

enum class StatusLed : int {
  BT   = door_config::PIN_LED_BT,
  WIFI = door_config::PIN_LED_WIFI,
  NTP  = door_config::PIN_LED_NTP,
  IOT  = door_config::PIN_LED_IOT
};

/**
 * @brief Sets an onboard active-LOW status LED ON (true -> LOW) or OFF (false -> HIGH).
 */
inline void setStatusLed(StatusLed led, bool on) {
  digitalWrite(static_cast<int>(led), on ? LOW : HIGH);
}

/**
 * @brief Initializes all four KidBright32 status LEDs in the OFF state.
 */
inline void initStatusLeds() {
  const StatusLed leds[] = {StatusLed::BT, StatusLed::WIFI, StatusLed::NTP,
                            StatusLed::IOT};
  for (size_t i = 0; i < (sizeof(leds) / sizeof(leds[0])); ++i) {
    pinMode(static_cast<int>(leds[i]), OUTPUT);
    setStatusLed(leds[i], false);
  }
}

/**
 * @brief Configures the onboard piezo buzzer (IO13) on its dedicated LEDC channel.
 */
inline void initBuzzer() {
  detail::attachPwmPin(door_config::PIN_BUZZER, BUZZER_LEDC_CHANNEL, 2000,
                       BUZZER_RESOLUTION_BITS);
  detail::writePwmDuty(door_config::PIN_BUZZER, BUZZER_LEDC_CHANNEL, 0);
}

/**
 * @brief Emits a square-wave tone on the piezo buzzer (pass 0 Hz to silence).
 */
inline void buzzerSetTone(uint32_t freq_hz) {
  if (freq_hz == 0) {
    detail::writePwmDuty(door_config::PIN_BUZZER, BUZZER_LEDC_CHANNEL, 0);
    return;
  }
  detail::writePwmTone(door_config::PIN_BUZZER, BUZZER_LEDC_CHANNEL, freq_hz);
}

/**
 * @brief Silences the onboard piezo buzzer.
 */
inline void buzzerOff() { buzzerSetTone(0); }

// ------------------------------------------------------------------------------
// 6. Onboard 16x8 LED Dot Matrix (HT16K33 @ 0x70 on I2C0)
// ------------------------------------------------------------------------------

/**
 * @brief Initializes the KidBright32 16x8 LED matrix in landscape orientation.
 * @return true if the HT16K33 ACKed on I2C0 and initialized cleanly.
 */
inline bool initLedMatrix(Adafruit_8x16minimatrix& matrix) {
  if (!i2cPing(Wire, door_config::I2C_ADDR_HT16K33)) {
    return false;
  }
  if (!matrix.begin(door_config::I2C_ADDR_HT16K33, &Wire)) {
    return false;
  }
  matrix.setBrightness(MATRIX_BRIGHTNESS);
  matrix.setRotation(1);  // Landscape 16 wide x 8 tall on KidBright32
  matrix.setTextSize(1);
  matrix.setTextWrap(false);
  matrix.setTextColor(LED_ON);
  matrix.clear();
  matrix.writeDisplay();
  return true;
}

/**
 * @brief Renders a short ASCII string (up to ~3 chars cleanly) on the 16x8 matrix.
 */
inline void displayMatrixText(Adafruit_8x16minimatrix& matrix,
                              const char* text) {
  matrix.clear();
  matrix.setCursor(0, 0);
  if (text != nullptr) {
    matrix.print(text);
  }
  matrix.writeDisplay();
}

/**
 * @brief Displays motor current (mA) or "ERR" on the 16x8 LED matrix.
 */
inline void displayMatrixCurrentMa(Adafruit_8x16minimatrix& matrix,
                                   uint16_t current_ma) {
  char buf[8];
  if (current_ma == door_config::CURRENT_FAULT_SENTINEL_MA) {
    snprintf(buf, sizeof(buf), "ERR");
  } else if (current_ma >= 1000) {
    // Format >= 1000 mA concisely as e.g. "1.2A" to fit 16px width.
    snprintf(buf, sizeof(buf), "%.1f", static_cast<double>(current_ma) / 1000.0);
  } else {
    snprintf(buf, sizeof(buf), "%u", static_cast<unsigned int>(current_ma));
  }
  displayMatrixText(matrix, buf);
}

// ------------------------------------------------------------------------------
// 7. Convenience Combined Hardware Bring-Up
// ------------------------------------------------------------------------------

/**
 * @brief Initializes all GPIO, PWM, I2C buses, INA219, and HT16K33 peripherals
 *        in a deterministic, motor-safe sequence.
 */
inline void initAllHardware(Adafruit_INA219& ina,
                            Adafruit_8x16minimatrix& matrix, bool& out_ina_ok,
                            bool& out_matrix_ok) {
  initMotorDriver();
  initDigitalInputs();
  initStatusLeds();
  initBuzzer();
  initI2CBuses();
  out_ina_ok    = initCurrentSensor(ina);
  out_matrix_ok = initLedMatrix(matrix);
}

}  // namespace door_controllers

#endif  // DOOR_CONTROLLERS_H_
