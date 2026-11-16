#ifndef DOOR_SERIAL_CLI_H_
#define DOOR_SERIAL_CLI_H_

#include <Adafruit_INA219.h>
#include <Adafruit_LEDBackpack.h>
#include <Arduino.h>
#include <ctype.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "config.h"
#include "controllers.h"

// ==============================================================================
// Node 'D' (Door Closer Actuator) — Archived Interactive Hardware Test CLI
// Call `door_serial_cli::setup()` and `door_serial_cli::loop()` from `main.cpp`
// whenever standalone bench testing of `<component> <instruction>` is needed.
// ==============================================================================

namespace door_serial_cli {

enum class TestMotorMode : uint8_t { STOPPED = 0, CW, CCW, HOME };

struct CliContext {
  Adafruit_INA219 ina;
  Adafruit_8x16minimatrix matrix;
  bool ina_ok;
  bool matrix_ok;

  TestMotorMode motor_mode;
  bool ramping;
  bool auto_closing_cycle;
  bool pending_close_after_warn;
  uint32_t motor_start_ms;
  uint32_t ir_seal_start_ms;
  uint32_t last_matrix_ms;
  uint8_t stall_sample_count;

  bool stream_ina;
  bool watch_ir;
  bool watch_limit;
  bool watch_btns;
  uint32_t last_stream_ms;

  bool prev_ir_closed;
  bool prev_limit_homed;
  bool prev_s1_pressed;
  bool prev_s2_pressed;

  bool led_state[4];

  bool buzzer_pattern_active;
  uint8_t buzzer_step;
  uint32_t buzzer_step_ms;

  char cmd_buf[64];
  size_t cmd_len;

  CliContext()
      : ina(door_config::I2C_ADDR_INA219),
        matrix(),
        ina_ok(false),
        matrix_ok(false),
        motor_mode(TestMotorMode::STOPPED),
        ramping(false),
        auto_closing_cycle(false),
        pending_close_after_warn(false),
        motor_start_ms(0),
        ir_seal_start_ms(0),
        last_matrix_ms(0),
        stall_sample_count(0),
        stream_ina(false),
        watch_ir(false),
        watch_limit(false),
        watch_btns(false),
        last_stream_ms(0),
        prev_ir_closed(false),
        prev_limit_homed(false),
        prev_s1_pressed(false),
        prev_s2_pressed(false),
        led_state{false, false, false, false},
        buzzer_pattern_active(false),
        buzzer_step(0),
        buzzer_step_ms(0),
        cmd_buf{0},
        cmd_len(0) {}
};

inline CliContext& ctx() {
  static CliContext instance;
  return instance;
}

inline const char* motorModeName(TestMotorMode mode) {
  switch (mode) {
    case TestMotorMode::CW:
      return "CW (CLOSING)";
    case TestMotorMode::CCW:
      return "CCW (RETRACTING)";
    case TestMotorMode::HOME:
      return "HOME (SLOW CCW)";
    case TestMotorMode::STOPPED:
    default:
      return "STOPPED";
  }
}

inline void stopMotorSafely(const char* reason, bool use_brake) {
  CliContext& c = ctx();
  if (use_brake) {
    door_controllers::motorShortBrake();
  } else {
    door_controllers::motorCoastStop();
  }
  c.motor_mode               = TestMotorMode::STOPPED;
  c.ramping                  = false;
  c.auto_closing_cycle       = false;
  c.pending_close_after_warn = false;
  c.ir_seal_start_ms         = 0;
  c.stall_sample_count       = 0;
  if (reason != nullptr) {
    Serial.printf("[MOTOR] %s -> %s\n", use_brake ? "BRAKE" : "COAST STOP",
                  reason);
  }
}

inline void startMotor(TestMotorMode mode, bool with_ramp) {
  CliContext& c = ctx();
  if (mode == TestMotorMode::CW && door_controllers::isIrDoorClosed()) {
    Serial.println(
        "[SAFETY] IR sensor reads CLOSED (LOW) — CW drive blocked.");
    return;
  }
  if ((mode == TestMotorMode::CCW || mode == TestMotorMode::HOME) &&
      door_controllers::isLimitSwitchHomed()) {
    Serial.println("[SAFETY] Limit switch reads HOMED — CCW drive blocked.");
    return;
  }
  if (!c.ina_ok) {
    Serial.println(
        "[WARN] INA219 offline — motor running WITHOUT current stall cutoff!");
  }

  c.motor_mode         = mode;
  c.ramping            = with_ramp && (mode == TestMotorMode::CW);
  c.motor_start_ms     = millis();
  c.ir_seal_start_ms   = 0;
  c.last_matrix_ms     = 0;
  c.stall_sample_count = 0;

  uint8_t duty = door_config::PWM_DUTY_CLOSING;
  if (mode == TestMotorMode::CCW) {
    duty = door_config::PWM_DUTY_RETRACTING;
  } else if (mode == TestMotorMode::HOME) {
    duty = door_config::PWM_DUTY_HOMING;
  }

  if (c.ramping) {
    door_controllers::motorDriveCW(0);
    Serial.printf("[MOTOR] Ramping CW 0 -> %u over %u ms\n", duty,
                  static_cast<unsigned int>(door_config::PWM_SOFT_START_MS));
  } else if (mode == TestMotorMode::CW) {
    door_controllers::motorDriveCW(duty);
    Serial.printf("[MOTOR] Driving CW at duty %u\n", duty);
  } else {
    door_controllers::motorDriveCCW(duty);
    Serial.printf("[MOTOR] Driving %s at duty %u\n", motorModeName(mode), duty);
  }
}

inline void startFullCloseCycle(const char* trigger_label) {
  CliContext& c = ctx();
  if (c.motor_mode != TestMotorMode::STOPPED || c.pending_close_after_warn) {
    Serial.printf("[MOTOR] Busy (%s) — ignoring %s close trigger.\n",
                  motorModeName(c.motor_mode), trigger_label);
    return;
  }
  if (door_controllers::isIrDoorClosed()) {
    Serial.printf("[SAFETY] %s: door already CLOSED (IR=LOW).\n",
                  trigger_label);
    return;
  }
  c.auto_closing_cycle       = true;
  c.pending_close_after_warn = true;
  c.ir_seal_start_ms         = 0;
  c.buzzer_pattern_active    = true;
  c.buzzer_step              = 0;
  c.buzzer_step_ms           = millis();
  door_controllers::buzzerSetTone(door_config::WARNING_BEEP_FREQ_HZ);
  Serial.printf("[MOTOR] Warning beeps started (%s) — CW begins after alarm\n",
                trigger_label);
}

inline void printHelp() {
  Serial.println("\n=== FoodWarden Node 'D' Hardware Test CLI ===");
  Serial.println("Format: <component> <instruction>");
  Serial.println("  motor  cw | ccw | home | ramp | close | brake | stop");
  Serial.println("  ina    init | read | stream | stop");
  Serial.println("  ir     read | watch | stop");
  Serial.println("  limit  read | watch | stop");
  Serial.println("  btn    read | watch | stop");
  Serial.println("  led    on | off | bt | wifi | ntp | iot");
  Serial.println("  buzzer on | off | warn");
  Serial.println("  matrix init | test | ma | clear");
  Serial.println("  i2c    scan");
  Serial.println("  sys    status | stop | help");
  Serial.println("Shortcuts: status, stop, help\n");
}

inline void printInaSnapshot() {
  CliContext& c = ctx();
  if (!c.ina_ok) {
    c.ina_ok = door_controllers::initCurrentSensor(c.ina);
    if (!c.ina_ok) {
      Serial.println("[INA219] Offline (check wiring / 0x40 / I2C bus).");
      return;
    }
  }
  float bus_v     = 0.0f;
  float raw_ma    = 0.0f;
  const bool v_ok = door_controllers::readBusVoltageV(c.ina, bus_v);
  const bool i_ok = door_controllers::readCurrentRawMa(c.ina, raw_ma);
  if (!v_ok || !i_ok) {
    c.ina_ok = false;
    Serial.println("[INA219] Read failed (check wiring / 0x40 / I2C bus).");
    return;
  }
  Serial.printf("[INA219] Bus: %.2f V | Current: %.1f mA%s\n", bus_v, raw_ma,
                (raw_ma < -5.0f) ? " (NEGATIVE: VIN+/VIN- swapped?)" : "");
}

inline void printSystemStatus() {
  CliContext& c          = ctx();
  const bool limit_homed = door_controllers::isLimitSwitchHomed();
  const bool limit_high  = (digitalRead(door_config::PIN_LIMIT_SWITCH) == HIGH);

  Serial.println("\n--- System Snapshot ---");
  Serial.printf("Motor : %s\n", motorModeName(c.motor_mode));
  Serial.printf("IR    : %s (IO%d=%s)\n",
                door_controllers::isIrDoorClosed() ? "CLOSED" : "OPEN",
                door_config::PIN_IR_DOOR_CLOSED,
                door_controllers::isIrDoorClosed() ? "LOW" : "HIGH");
  Serial.printf("Limit : %s (IO%d=%s)\n", limit_homed ? "HOMED" : "RELEASED",
                door_config::PIN_LIMIT_SWITCH, limit_high ? "HIGH" : "LOW");
  Serial.printf(
      "Btns  : S1=%s | S2=%s\n",
      door_controllers::isEmergencyAbortPressed() ? "PRESSED" : "IDLE",
      door_controllers::isDebugClosePressed() ? "PRESSED" : "IDLE");
  printInaSnapshot();
  Serial.printf("Matrix: %s (0x%02X on I2C0)\n",
                c.matrix_ok ? "READY" : "OFFLINE",
                door_config::I2C_ADDR_HT16K33);
  Serial.println("-----------------------\n");
}

inline void scanI2CBus(TwoWire& wire, const char* label, int sda, int scl) {
  Serial.printf("[I2C] Scanning %s (SDA=IO%d, SCL=IO%d)...\n", label, sda, scl);
  uint8_t found = 0;
  for (uint8_t addr = 0x03; addr <= 0x77; ++addr) {
    if (door_controllers::i2cPing(wire, addr)) {
      Serial.printf("  - Found device at 0x%02X\n", addr);
      ++found;
    }
  }
  if (found == 0) {
    Serial.println("  - No devices found.");
  }
}

inline void handleMotorCmd(const char* instr) {
  if (strcmp(instr, "cw") == 0) {
    startMotor(TestMotorMode::CW, false);
  } else if (strcmp(instr, "ramp") == 0) {
    startMotor(TestMotorMode::CW, true);
  } else if (strcmp(instr, "close") == 0) {
    startFullCloseCycle("serial cmd");
  } else if (strcmp(instr, "ccw") == 0) {
    startMotor(TestMotorMode::CCW, false);
  } else if (strcmp(instr, "home") == 0) {
    startMotor(TestMotorMode::HOME, false);
  } else if (strcmp(instr, "brake") == 0) {
    stopMotorSafely("Manual command", true);
  } else if (strcmp(instr, "stop") == 0) {
    stopMotorSafely("Manual command", false);
  } else {
    Serial.println(
        "Unknown motor instruction. Try: cw, ccw, home, ramp, close, brake, stop");
  }
}

inline void handleInaCmd(const char* instr) {
  CliContext& c = ctx();
  if (strcmp(instr, "init") == 0) {
    c.ina_ok = door_controllers::initCurrentSensor(c.ina);
    Serial.printf("[INA219] Init %s (0x%02X on %s)\n",
                  c.ina_ok ? "OK" : "FAILED", door_config::I2C_ADDR_INA219,
                  door_config::INA219_USE_I2C1 ? "I2C1" : "I2C0");
  } else if (strcmp(instr, "read") == 0) {
    printInaSnapshot();
  } else if (strcmp(instr, "stream") == 0) {
    c.stream_ina = true;
    Serial.println(
        "[INA219] Streaming 10 Hz (send `ina stop` or `stop` to end).");
  } else if (strcmp(instr, "stop") == 0) {
    c.stream_ina = false;
    Serial.println("[INA219] Stream stopped.");
  } else {
    Serial.println("Unknown ina instruction. Try: init, read, stream, stop");
  }
}

inline void handleWatchableInputCmd(const char* name, const char* instr,
                                    bool& watch_flag, bool state_now,
                                    const char* true_label,
                                    const char* false_label) {
  if (strcmp(instr, "read") == 0) {
    Serial.printf("[%s] %s\n", name, state_now ? true_label : false_label);
  } else if (strcmp(instr, "watch") == 0) {
    watch_flag = true;
    Serial.printf("[%s] Watching changes (send `%s stop` or `stop` to end).\n",
                  name, name);
  } else if (strcmp(instr, "stop") == 0) {
    watch_flag = false;
    Serial.printf("[%s] Watch stopped.\n", name);
  } else {
    Serial.printf("Unknown %s instruction. Try: read, watch, stop\n", name);
  }
}

inline void handleBtnCmd(const char* instr) {
  CliContext& c = ctx();
  if (strcmp(instr, "read") == 0) {
    Serial.printf(
        "[BTN] S1(Abort)=%s | S2(DebugClose)=%s\n",
        door_controllers::isEmergencyAbortPressed() ? "PRESSED" : "IDLE",
        door_controllers::isDebugClosePressed() ? "PRESSED" : "IDLE");
  } else if (strcmp(instr, "watch") == 0) {
    c.watch_btns = true;
    Serial.println(
        "[BTN] Watching S1/S2 presses (send `btn stop` or `stop` to end).");
  } else if (strcmp(instr, "stop") == 0) {
    c.watch_btns = false;
    Serial.println("[BTN] Watch stopped.");
  } else {
    Serial.println("Unknown btn instruction. Try: read, watch, stop");
  }
}

inline void handleLedCmd(const char* instr) {
  CliContext& c                             = ctx();
  const door_controllers::StatusLed leds[4] = {
      door_controllers::StatusLed::BT, door_controllers::StatusLed::WIFI,
      door_controllers::StatusLed::NTP, door_controllers::StatusLed::IOT};
  const char* names[4] = {"bt", "wifi", "ntp", "iot"};

  if (strcmp(instr, "on") == 0 || strcmp(instr, "off") == 0) {
    const bool on = (strcmp(instr, "on") == 0);
    for (size_t i = 0; i < 4; ++i) {
      c.led_state[i] = on;
      door_controllers::setStatusLed(leds[i], on);
    }
    Serial.printf("[LED] All status LEDs %s\n", on ? "ON" : "OFF");
    return;
  }

  for (size_t i = 0; i < 4; ++i) {
    if (strcmp(instr, names[i]) == 0) {
      c.led_state[i] = !c.led_state[i];
      door_controllers::setStatusLed(leds[i], c.led_state[i]);
      Serial.printf("[LED] %s -> %s\n", names[i],
                    c.led_state[i] ? "ON" : "OFF");
      return;
    }
  }
  Serial.println("Unknown led instruction. Try: on, off, bt, wifi, ntp, iot");
}

inline void handleBuzzerCmd(const char* instr) {
  CliContext& c = ctx();
  if (strcmp(instr, "on") == 0) {
    c.buzzer_pattern_active = false;
    door_controllers::buzzerSetTone(2000);
    Serial.println("[BUZZER] Tone 2000 Hz ON");
  } else if (strcmp(instr, "off") == 0) {
    c.buzzer_pattern_active = false;
    door_controllers::buzzerOff();
    Serial.println("[BUZZER] OFF");
  } else if (strcmp(instr, "warn") == 0) {
    c.buzzer_pattern_active = true;
    c.buzzer_step           = 0;
    c.buzzer_step_ms        = millis();
    door_controllers::buzzerSetTone(2200);
    Serial.println("[BUZZER] Playing 3-beep closing warning");
  } else {
    Serial.println("Unknown buzzer instruction. Try: on, off, warn");
  }
}

inline void handleMatrixCmd(const char* instr) {
  CliContext& c = ctx();
  if (strcmp(instr, "init") == 0) {
    c.matrix_ok = door_controllers::initLedMatrix(c.matrix);
    Serial.printf("[MATRIX] Init %s\n", c.matrix_ok ? "OK" : "FAILED");
    return;
  }
  if (!c.matrix_ok) {
    Serial.println("[MATRIX] Offline — run `matrix init` or `i2c scan`.");
    return;
  }
  if (strcmp(instr, "test") == 0) {
    c.matrix.fillScreen(LED_ON);
    c.matrix.writeDisplay();
    Serial.println("[MATRIX] All 16x8 pixels ON");
  } else if (strcmp(instr, "ma") == 0) {
    if (!c.ina_ok) {
      c.ina_ok = door_controllers::initCurrentSensor(c.ina);
    }
    uint16_t ma = door_config::CURRENT_FAULT_SENTINEL_MA;
    if (c.ina_ok) {
      c.ina_ok = door_controllers::readCurrentMa(c.ina, ma);
    }
    door_controllers::displayMatrixCurrentMa(c.matrix, ma);
    Serial.printf("[MATRIX] Displayed current: %u mA\n", ma);
  } else if (strcmp(instr, "clear") == 0) {
    c.matrix.clear();
    c.matrix.writeDisplay();
    Serial.println("[MATRIX] Cleared");
  } else {
    Serial.println("Unknown matrix instruction. Try: init, test, ma, clear");
  }
}

inline void emergencyStopAll() {
  CliContext& c = ctx();
  stopMotorSafely("Emergency/sys stop", true);
  c.buzzer_pattern_active = false;
  door_controllers::buzzerOff();
  c.stream_ina  = false;
  c.watch_ir    = false;
  c.watch_limit = false;
  c.watch_btns  = false;
  Serial.println("[SYS] All outputs & streams stopped.");
}

inline void executeCommandLine(char* line) {
  CliContext& c = ctx();
  for (size_t i = 0; line[i] != '\0'; ++i) {
    line[i] = static_cast<char>(tolower(static_cast<unsigned char>(line[i])));
  }

  char* saveptr   = nullptr;
  char* component = strtok_r(line, " \t", &saveptr);
  if (component == nullptr) {
    return;
  }
  char* instr = strtok_r(nullptr, " \t", &saveptr);

  if (instr == nullptr) {
    if (strcmp(component, "help") == 0 || strcmp(component, "?") == 0) {
      printHelp();
    } else if (strcmp(component, "status") == 0) {
      printSystemStatus();
    } else if (strcmp(component, "stop") == 0) {
      emergencyStopAll();
    } else {
      Serial.println("Expected `<component> <instruction>`. Type `help`.");
    }
    return;
  }

  if (strcmp(component, "motor") == 0) {
    handleMotorCmd(instr);
  } else if (strcmp(component, "ina") == 0) {
    handleInaCmd(instr);
  } else if (strcmp(component, "ir") == 0) {
    handleWatchableInputCmd("ir", instr, c.watch_ir,
                            door_controllers::isIrDoorClosed(), "CLOSED (LOW)",
                            "OPEN (HIGH)");
  } else if (strcmp(component, "limit") == 0) {
    const char* homed_str =
        (door_config::LIMIT_SWITCH_ACTIVE_LEVEL == HIGH) ? "HOMED (HIGH)"
                                                         : "HOMED (LOW)";
    const char* rel_str =
        (door_config::LIMIT_SWITCH_ACTIVE_LEVEL == HIGH) ? "RELEASED (LOW)"
                                                         : "RELEASED (HIGH)";
    handleWatchableInputCmd("limit", instr, c.watch_limit,
                            door_controllers::isLimitSwitchHomed(), homed_str,
                            rel_str);
  } else if (strcmp(component, "btn") == 0) {
    handleBtnCmd(instr);
  } else if (strcmp(component, "led") == 0) {
    handleLedCmd(instr);
  } else if (strcmp(component, "buzzer") == 0) {
    handleBuzzerCmd(instr);
  } else if (strcmp(component, "matrix") == 0) {
    handleMatrixCmd(instr);
  } else if (strcmp(component, "i2c") == 0 && strcmp(instr, "scan") == 0) {
    scanI2CBus(Wire, "I2C0", door_config::PIN_I2C0_SDA,
               door_config::PIN_I2C0_SCL);
    scanI2CBus(Wire1, "I2C1", door_config::PIN_I2C1_SDA,
               door_config::PIN_I2C1_SCL);
  } else if (strcmp(component, "sys") == 0) {
    if (strcmp(instr, "help") == 0) {
      printHelp();
    } else if (strcmp(instr, "status") == 0) {
      printSystemStatus();
    } else if (strcmp(instr, "stop") == 0) {
      emergencyStopAll();
    } else {
      Serial.println("Unknown sys instruction. Try: status, stop, help");
    }
  } else {
    Serial.printf("Unknown component `%s`. Type `help`.\n", component);
  }
}

inline void pollSerialCommands() {
  CliContext& c = ctx();
  while (Serial.available() > 0) {
    const int ch = Serial.read();
    if (ch < 0) {
      break;
    }
    if (ch == '\r' || ch == '\n') {
      if (c.cmd_len > 0) {
        c.cmd_buf[c.cmd_len] = '\0';
        executeCommandLine(c.cmd_buf);
        c.cmd_len = 0;
        Serial.print("> ");
      }
      continue;
    }
    if (c.cmd_len < (sizeof(c.cmd_buf) - 1)) {
      c.cmd_buf[c.cmd_len++] = static_cast<char>(ch);
    }
  }
}

inline void updateMotorSafetyAndRamp(uint32_t now_ms) {
  CliContext& c = ctx();
  if (c.motor_mode == TestMotorMode::STOPPED) {
    return;
  }

  if (door_controllers::isEmergencyAbortPressed() && !c.prev_s1_pressed) {
    if (c.motor_mode == TestMotorMode::CW &&
        !door_controllers::isLimitSwitchHomed()) {
      door_controllers::motorShortBrake();
      c.auto_closing_cycle = false;
      Serial.println("[SAFETY] S1 abort pressed -> retracting to home");
      startMotor(TestMotorMode::CCW, false);
    } else {
      stopMotorSafely("S1 emergency abort pressed", true);
    }
    return;
  }
  if (c.motor_mode == TestMotorMode::CW) {
    if (c.ir_seal_start_ms == 0) {
      if (door_controllers::isIrDoorClosed()) {
        c.ir_seal_start_ms = (now_ms == 0) ? 1 : now_ms;
        Serial.printf("[MOTOR] IR tripped -> sealing gasket for %lu ms\n",
                      static_cast<unsigned long>(
                          door_config::POST_IR_SEAL_DELAY_MS));
      }
    } else if ((now_ms - c.ir_seal_start_ms) >=
               door_config::POST_IR_SEAL_DELAY_MS) {
      c.ir_seal_start_ms = 0;
      if (c.auto_closing_cycle && !door_controllers::isLimitSwitchHomed()) {
        door_controllers::motorShortBrake();
        c.auto_closing_cycle = false;
        Serial.println("[MOTOR] Seal complete -> retracting arm to limit switch");
        startMotor(TestMotorMode::CCW, false);
      } else {
        stopMotorSafely("IR door-closed + seal delay", true);
      }
      return;
    }
  }
  if ((c.motor_mode == TestMotorMode::CCW ||
       c.motor_mode == TestMotorMode::HOME) &&
      door_controllers::isLimitSwitchHomed()) {
    stopMotorSafely("Limit switch homed", true);
    return;
  }

  const uint32_t elapsed_ms = now_ms - c.motor_start_ms;
  if (elapsed_ms >= door_config::DEFAULT_MOTION_TIMEOUT_MS) {
    stopMotorSafely("30s motion timeout reached", false);
    return;
  }

  if (c.ramping) {
    if (elapsed_ms >= door_config::PWM_SOFT_START_MS) {
      door_controllers::motorSetPwmDuty(door_config::PWM_DUTY_CLOSING);
      c.ramping = false;
    } else {
      const uint32_t duty =
          (static_cast<uint32_t>(door_config::PWM_DUTY_CLOSING) * elapsed_ms) /
          door_config::PWM_SOFT_START_MS;
      door_controllers::motorSetPwmDuty(static_cast<uint8_t>(duty));
    }
  }

  if (c.ina_ok) {
    uint16_t current_ma = 0;
    if (!door_controllers::readCurrentMa(c.ina, current_ma)) {
      stopMotorSafely("INA219 I2C read lost mid-motion", false);
      return;
    }
    if (elapsed_ms >= door_config::CURRENT_INRUSH_BLANKING_MS) {
      if (current_ma >= door_config::CURRENT_STALL_LIMIT_MA) {
        ++c.stall_sample_count;
        if (c.stall_sample_count >=
            door_config::CURRENT_STALL_CONSECUTIVE_SAMPLES) {
          if (c.motor_mode == TestMotorMode::CW &&
              !door_controllers::isLimitSwitchHomed()) {
            door_controllers::motorShortBrake();
            c.auto_closing_cycle = false;
            Serial.printf(
                "[SAFETY] Stall detected (%u mA >= %u mA) -> reversing to home\n",
                current_ma, door_config::CURRENT_STALL_LIMIT_MA);
            startMotor(TestMotorMode::CCW, false);
          } else {
            Serial.printf("[SAFETY] Stall detected: %u mA\n", current_ma);
            stopMotorSafely("Retraction mechanical jam cutoff", false);
          }
          return;
        }
      } else {
        c.stall_sample_count = 0;
      }
    }
    if (c.matrix_ok &&
        (now_ms - c.last_matrix_ms) >= door_config::LED_MATRIX_REFRESH_MS) {
      c.last_matrix_ms = now_ms;
      door_controllers::displayMatrixCurrentMa(c.matrix, current_ma);
    }
  }
}

inline void updateWatchersAndBuzzer(uint32_t now_ms) {
  CliContext& c        = ctx();
  const bool ir_now    = door_controllers::isIrDoorClosed();
  const bool limit_now = door_controllers::isLimitSwitchHomed();
  const bool s1_now    = door_controllers::isEmergencyAbortPressed();
  const bool s2_now    = door_controllers::isDebugClosePressed();

  if (c.watch_ir && (ir_now != c.prev_ir_closed)) {
    Serial.printf("[IR] -> %s\n", ir_now ? "CLOSED (LOW)" : "OPEN (HIGH)");
  }
  if (c.watch_limit && (limit_now != c.prev_limit_homed)) {
    const bool limit_high =
        (digitalRead(door_config::PIN_LIMIT_SWITCH) == HIGH);
    Serial.printf("[LIMIT] -> %s (%s)\n", limit_now ? "HOMED" : "RELEASED",
                  limit_high ? "HIGH" : "LOW");
  }
  if (c.watch_btns && (s1_now != c.prev_s1_pressed)) {
    Serial.printf("[BTN] S1 -> %s\n", s1_now ? "PRESSED" : "RELEASED");
  }
  if (c.watch_btns && (s2_now != c.prev_s2_pressed)) {
    Serial.printf("[BTN] S2 -> %s\n", s2_now ? "PRESSED" : "RELEASED");
  }

  const bool s1_rising_edge = (s1_now && !c.prev_s1_pressed);
  c.prev_ir_closed          = ir_now;
  c.prev_limit_homed        = limit_now;
  c.prev_s1_pressed         = s1_now;
  const bool s2_rising_edge = (s2_now && !c.prev_s2_pressed);
  c.prev_s2_pressed         = s2_now;

  if (s1_rising_edge && c.pending_close_after_warn) {
    c.pending_close_after_warn = false;
    c.auto_closing_cycle       = false;
    c.buzzer_pattern_active    = false;
    door_controllers::buzzerOff();
    Serial.println("[SAFETY] S1 abort during warning -> close cancelled");
  }

  if (s2_rising_edge) {
    Serial.println("[BTN] S2 pressed -> starting debug door-close cycle");
    startFullCloseCycle("S2 button");
  }

  if (c.stream_ina && (now_ms - c.last_stream_ms) >= 100) {
    c.last_stream_ms = now_ms;
    printInaSnapshot();
  }

  if (c.buzzer_pattern_active &&
      (now_ms - c.buzzer_step_ms) >= door_config::WARNING_BEEP_STEP_MS) {
    c.buzzer_step_ms = now_ms;
    ++c.buzzer_step;
    if (c.buzzer_step >= door_config::WARNING_BEEP_STEPS) {
      door_controllers::buzzerOff();
      c.buzzer_pattern_active = false;
      if (c.pending_close_after_warn) {
        c.pending_close_after_warn = false;
        startMotor(TestMotorMode::CW, true);
      }
    } else if ((c.buzzer_step % 2) == 1) {
      door_controllers::buzzerOff();
    } else {
      door_controllers::buzzerSetTone(door_config::WARNING_BEEP_FREQ_HZ);
    }
  }
}

inline void setup() {
  CliContext& c = ctx();
  Serial.begin(115200);
  delay(200);

  door_controllers::initAllHardware(c.ina, c.matrix, c.ina_ok, c.matrix_ok);
  if (c.matrix_ok) {
    door_controllers::displayMatrixText(c.matrix, "OK");
  }

  c.prev_ir_closed   = door_controllers::isIrDoorClosed();
  c.prev_limit_homed = door_controllers::isLimitSwitchHomed();
  c.prev_s1_pressed  = door_controllers::isEmergencyAbortPressed();
  c.prev_s2_pressed  = door_controllers::isDebugClosePressed();

  printHelp();
  printSystemStatus();
  Serial.print("> ");
}

inline void loop() {
  const uint32_t now_ms = millis();
  pollSerialCommands();
  updateMotorSafetyAndRamp(now_ms);
  updateWatchersAndBuzzer(now_ms);
  delay(10);
}

}  // namespace door_serial_cli

#endif  // DOOR_SERIAL_CLI_H_
