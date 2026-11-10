# D0 external door closer

[Hardware diagram](../diagrams/door-closer.mmd) · [MQTT contract](../../interface/CBD.md)

## Power and mechanics

The wall adapter and barrel jack supply 12 V DC. The buck converter supplies the KidBright32 logic side. The INA219 is in series with the motor-side 12 V supply before the TB6612FNG. The driver powers the JGY-370 worm gear motor (12 V, 18 RPM in the drawing). The arm pushes the door using a rolling end and retracts to free the door. The source photo locates the actuator on top of the fridge. Use the current door branch pinout for physical wiring.

| Input or control | Source drawing | Door implementation branch documentation |
| --- | --- | --- |
| TB6612FNG | PWMA 26, AIN1 27, AIN2 25 | PWMA 26, AIN1 27, AIN2 18, STBY pulled to 3.3 V |
| INA219 | I2C GPIO 21/22, address `0x40`, 100 Hz | External GPIO 4/5 or vertical header GPIO 21/22, at least 50 Hz in the pin table |
| Optical IR | GPIO 32 at door seam | TCRT5000 detects physical closure and stops forward motion |
| Roller limit switch | GPIO 33 ISR | Falling-edge home interrupt with pull-up stops reverse motion |
| Local hardware abort | Four fail-safes listed in the drawing | Door architecture also documents S1 on GPIO 16 and a movement buzzer on GPIO 13 |

## Safety and observation

Boot homes the arm before normal commands. A close command drives forward until IR confirms closure or a fail-safe interrupts motion. The design uses four independent protections from the drawing. The limit switch stops reverse travel at home, INA219 cuts off stall current at 1200 mA, a motion timeout caps travel and MQTT abort handles an approaching person detected by C0. The drawing specifies an 8 s timeout. Confirm actual firmware settings during hardware validation.

Commands and discrete events use QoS 1 with command IDs for acknowledgement and deduplication. Periodic motor, limit and IR telemetry uses QoS 0 at 1 Hz. The retained lifecycle topic carries online status and last-will offline information. The dashboard displays the last contact passed through C0 under PR #5. The underlying IR closed/open state is a different observation from connectivity.

[Door implementation pinout](https://github.com/theme222/FoodWarden/blob/c5d4b7e/door/ARCHITECTURE.md) · [Project safety constraints](../../AGENTS.md)
