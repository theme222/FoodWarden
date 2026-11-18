#ifndef DOOR_CONFIG_H_
#define DOOR_CONFIG_H_

#include <Arduino.h>
#include <stdint.h>

// ==============================================================================
// Node 'D' (Door Closer Actuator) — Hardware & System Configuration
// Target Hardware: KidBright32 V1.3 (ESP32-WROOM-32)
// ==============================================================================

namespace door_config {

// ------------------------------------------------------------------------------
// 0. Firmware Mode Toggle
//    - true:  Boot into standalone interactive Serial CLI (serial_cli.h) + S2 close test.
//    - false: Boot full FreeRTOS + MQTTS production firmware.
// ------------------------------------------------------------------------------
constexpr bool DEBUG = false;

// ------------------------------------------------------------------------------
// 1. I2C Bus Pin Allocations
//    - I2C0 (Onboard Bus): HT16K33 16x8 LED Matrix (0x70) + Option B INA219
//    - I2C1 (JST KB Chain): LM73 Temp Sensor (0x4D) + Option A INA219
// ------------------------------------------------------------------------------
constexpr int PIN_I2C0_SDA = 21;  // Vertical Header Pin 4 (SDA0)
constexpr int PIN_I2C0_SCL = 22;  // Vertical Header Pin 3 (SCL0)

constexpr int PIN_I2C1_SDA = 4;   // JST-PH KB Chain Pin 2 (SDA1)
constexpr int PIN_I2C1_SCL = 5;   // JST-PH KB Chain Pin 3 (SCL1)

// Set to true if INA219 is wired to JST KB Chain (IO4/IO5, Option A).
// Set to false if INA219 is wired to Vertical Header (IO21/IO22, Option B).
constexpr bool INA219_USE_I2C1 = false;

constexpr uint8_t I2C_ADDR_INA219  = 0x40;
constexpr uint8_t I2C_ADDR_HT16K33 = 0x70;
constexpr uint32_t I2C_FREQ_HZ     = 400000;  // 400 kHz Fast Mode
constexpr uint16_t I2C_TIMEOUT_MS  = 50;      // Defensive non-blocking bus timeout

// ------------------------------------------------------------------------------
// 2. Motor Driver (Toshiba TB6612FNG) + Worm Gear Motor (JGY-370 12V)
//    - Clockwise (CW):         AIN1 = LOW,  AIN2 = HIGH (Door Closing Action)
//    - Counter-Clockwise (CCW):AIN1 = HIGH, AIN2 = LOW  (Arm Retraction Action)
//    - Short-Brake:            AIN1 = HIGH, AIN2 = HIGH, PWMA = 0
//    - Coast / Stop:           AIN1 = LOW,  AIN2 = LOW,  PWMA = 0
// ------------------------------------------------------------------------------
constexpr int PIN_MOTOR_PWMA = 23;  // Vertical Header Pin 7 (IO23)
constexpr int PIN_MOTOR_AIN1 = 19;  // Vertical Header Pin 6 (IO19)
constexpr int PIN_MOTOR_AIN2 = 18;  // Vertical Header Pin 5 (IO18)

constexpr uint8_t PWM_LEDC_CHANNEL    = 0;
constexpr uint32_t PWM_FREQ_HZ        = 20000;  // 20 kHz (ultrasonic, silent PWM)
constexpr uint8_t PWM_RESOLUTION_BITS = 8;      // 0 - 255 duty cycle

constexpr uint8_t PWM_DUTY_CLOSING    = 220;    // Forward push speed (0-255)
constexpr uint8_t PWM_DUTY_RETRACTING = 200;    // Reverse retraction speed (0-255)
constexpr uint8_t PWM_DUTY_HOMING     = 150;    // Slower boot homing speed (0-255)
constexpr uint16_t PWM_SOFT_START_MS  = 250;    // Ramp duration to reduce inrush spike

// Pre-motion audible warning pattern (3 x 120 ms beeps = 720 ms before motor starts)
constexpr uint16_t WARNING_BEEP_STEP_MS  = 120;
constexpr uint8_t WARNING_BEEP_STEPS     = 6;
constexpr uint32_t WARNING_BEEP_FREQ_HZ  = 2200;

// Extra CW push after IR detects closed to firmly seat the magnetic fridge gasket
constexpr uint32_t POST_IR_SEAL_DELAY_MS = 75;

// ------------------------------------------------------------------------------
// 3. Door & Position Sensors + KidBright32 Onboard Peripherals
// ------------------------------------------------------------------------------
// TCRT5000 Digital IR Obstacle Sensor (LOW = Door Closed / Reflection <= 5mm)
constexpr int PIN_IR_DOOR_CLOSED = 32;  // Bottom Header Pin 1 / Screw Terminal IN2

// Mechanical Roller Lever Microswitch (COM -> 3.3V, NO -> IO33/IN1 + 1k pulldown to GND; HIGH = Homed)
constexpr int PIN_LIMIT_SWITCH              = 33;    // Bottom Header Pin 2 / Screw Terminal IN1
constexpr uint8_t LIMIT_SWITCH_ACTIVE_LEVEL = HIGH;  // Active HIGH when pressed to 3.3V

// KidBright32 Onboard Pushbuttons (Active LOW with INPUT_PULLUP)
constexpr int PIN_BTN_EMERGENCY_ABORT = 16;  // Button S1 (Hardware Emergency Abort ISR)
constexpr int PIN_BTN_DEBUG_CLOSE     = 14;  // Button S2 (Manual Debug Close Trigger ISR)

// KidBright32 Onboard Piezo Buzzer & Status LEDs
constexpr int PIN_BUZZER   = 13;
constexpr int PIN_LED_BT   = 17;  // Active LOW onboard LED
constexpr int PIN_LED_WIFI = 2;   // Active LOW onboard LED
constexpr int PIN_LED_NTP  = 15;  // Active LOW onboard LED
constexpr int PIN_LED_IOT  = 12;  // Active LOW onboard LED

// Switch / Button ISR Software Debounce Window
constexpr uint32_t ISR_DEBOUNCE_MS = 50;

// ------------------------------------------------------------------------------
// 4. Current Sensing & Mechanical Safety Thresholds
//    Calibrated for the bench JGY-370 12V worm gear motor (20-70 mA free-run)
// ------------------------------------------------------------------------------
constexpr uint16_t CURRENT_NORMAL_MIN_MA     = 20;
constexpr uint16_t CURRENT_WARNING_MA        = 150;
constexpr uint16_t CURRENT_STALL_LIMIT_MA    = 225;
constexpr uint16_t CURRENT_FAULT_SENTINEL_MA = 0xFFFF;

// Ignore startup DC motor inrush current for the first 150 ms of movement
constexpr uint32_t CURRENT_INRUSH_BLANKING_MS = 150;

// Number of consecutive >= CURRENT_STALL_LIMIT_MA samples at 100 Hz (10 ms) required to trip
// (2 samples * 10 ms = 20 ms response time, well within <= 100 ms requirement)
constexpr uint8_t CURRENT_STALL_CONSECUTIVE_SAMPLES = 2;

// Hard motion timeout (default 30 seconds if not overridden by CLOSE_DOOR cmd)
constexpr uint32_t DEFAULT_MOTION_TIMEOUT_S  = 30;
constexpr uint32_t DEFAULT_MOTION_TIMEOUT_MS = DEFAULT_MOTION_TIMEOUT_S * 1000UL;

// ------------------------------------------------------------------------------
// 5. FreeRTOS Task Priorities, Stack Sizes, Core Affinity & Timing
// ------------------------------------------------------------------------------
// Priority hierarchy: CurrentMonitor (4) > MotorControl (3) > MqttComm (2)
constexpr UBaseType_t TASK_PRIO_CURRENT_MONITOR = 4;
constexpr UBaseType_t TASK_PRIO_MOTOR_CONTROL   = 3;
constexpr UBaseType_t TASK_PRIO_MQTT_COMM       = 2;

constexpr uint32_t STACK_SIZE_CURRENT_MONITOR = 4096;
constexpr uint32_t STACK_SIZE_MOTOR_CONTROL   = 6144;
constexpr uint32_t STACK_SIZE_MQTT_COMM       = 8192;  // TLS requires larger stack

constexpr BaseType_t CORE_APP_SAFETY = 1;  // Core 1 for deterministic real-time control
constexpr BaseType_t CORE_NET_COMM   = 0;  // Core 0 alongside Wi-Fi / LwIP stack

// Sampling & loop intervals
constexpr uint32_t CURRENT_SAMPLE_MOVING_MS = 10;    // 100 Hz while motor is active
constexpr uint32_t CURRENT_SAMPLE_IDLE_MS   = 100;   // 10 Hz while motor is idle
constexpr uint32_t MOTOR_FSM_TICK_MS        = 20;    // 50 Hz IR & timeout check while moving
constexpr uint32_t LED_MATRIX_REFRESH_MS    = 100;   // 10 Hz current display update on 16x8 LED
constexpr uint32_t MQTT_LOOP_INTERVAL_MS    = 10;    // 100 Hz PubSubClient keepalive pump
constexpr uint32_t TELEMETRY_INTERVAL_MS    = 1000;  // 1 Hz periodic telemetry stream

// Queue depths
constexpr UBaseType_t INCOMING_MSG_QUEUE_LENGTH = 8;   // Commands from Gateway 'C' (xIncomingMsgQueue)
constexpr UBaseType_t OUTGOING_MSG_QUEUE_LENGTH = 16;  // Events to Gateway 'C' (xOutgoingMsgQueue)

// ------------------------------------------------------------------------------
// 6. MQTTS Topics & Reconnection Backoff (per interface/CBD.md)
// ------------------------------------------------------------------------------
constexpr const char* TOPIC_DOOR_CMD       = "fridge/door/cmd";
constexpr const char* TOPIC_DOOR_EVENT     = "fridge/door/event";
constexpr const char* TOPIC_DOOR_TELEMETRY = "fridge/door/telemetry";
constexpr const char* TOPIC_DOOR_TIME_REQ  = "fridge/door/time/req";
constexpr const char* TOPIC_DOOR_TIME_RES  = "fridge/door/time/res";
constexpr const char* TOPIC_DOOR_STATUS    = "fridge/door/status";

constexpr uint32_t TIME_RESYNC_INTERVAL_S  = 604800UL;  // 7 days in seconds
constexpr uint32_t RECONNECT_BACKOFF_MIN_MS = 1000;     // 1s initial backoff
constexpr uint32_t RECONNECT_BACKOFF_MAX_MS = 16000;    // 16s max exponential cap

// Expected DNS SAN / Common Name inside Mosquitto's server.crt for TLS verification.
// Matches `DNS:foodwarden-gateway.local` in server.crt even when connecting by IP.
constexpr const char* MQTT_TLS_SERVER_CN = "foodwarden-gateway.local";

}  // namespace door_config

#endif  // DOOR_CONFIG_H_
