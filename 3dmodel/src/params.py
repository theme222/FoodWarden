"""
Single Source of Truth for Node D0 (Door Actuator) CAD Parameters.

Coordinate Convention (Top-Down View standing in front of fridge):
  +X : Right (toward right edge of fridge and tall side cabinet)
  -X : Left  (toward center of fridge / freezer)
  +Y : Back  (toward back wall of fridge)
  -Y : Front (toward fridge door / user)
  +Z : Up    (away from fridge roof / grey hinge cover top)

Origin (0, 0, 0) for Motor Assembly:
  X = 0, Y = 0 : Center of JGY-370 6 mm D-shaft
  Z = 0        : Top flat surface of grey plastic hinge cover
"""

from dataclasses import dataclass


# =============================================================================
# 1. Printing & Tolerance Parameters (PETG for housings/stand, ABS or PETG arm)
# =============================================================================
CLEARANCE_POCKET = 0.5       # Gearbox pocket width & length clearance (mm)
CLEARANCE_HOLE_PETG = 0.4    # Through-hole diametral clearance for PETG/ABS (mm)
CLEARANCE_HOLE_M2 = 0.4      # M2 -> 2.4 mm
CLEARANCE_HOLE_M3 = 0.45     # M3 -> 3.45 mm (fits both PETG & ABS cleanly)
CLEARANCE_HOLE_M5 = 0.45     # M5 -> 5.45 mm
CLEARANCE_MAGNET = 0.4       # Magnet pocket diametral clearance (15.0 -> 15.4 mm)

# ABS D-hub split clamp bore (spec: 6.3 mm OD / 5.8 mm flat + 2.0 mm flex slit)
DHUB_BORE_DIA = 6.3
DHUB_BORE_FLAT = 5.8         # Distance from circular side to flat face
DHUB_SLIT_W = 2.0

# Filament densities (g/cm^3) for weight/cost estimation
DENSITY_PETG = 1.27
DENSITY_ABS = 1.04
COST_PER_GRAM_UNI_ABS_THB = 10.0

# =============================================================================
# 2. Fridge & Environment Geometry (Tape measure: approx +-5 mm)
# =============================================================================
HINGE_COVER_W = 110.0        # Left-to-right (X), perpendicular to front view
HINGE_COVER_D = 85.0         # Front-to-back (Y), parallel to front view
HINGE_COVER_BEVEL = 2.5      # Rounded edge bevel on hinge cover
DOOR_LIP_H = 25.0            # Flat steel fridge top to top edge of closed door lip
DOOR_PUSH_DROP_X = 40.0      # Hinge cover top down to door-pushing contact point

# Tall side cabinet (right of fridge, much taller than fridge)
CABINET_GAP_X = 32.0         # Gap between fridge right side and tall cabinet
CABINET_OVERLAP_Y = 20.0     # Cabinet extends ~20 mm forward of hinge cover back edge

# =============================================================================
# 3. Measured Hardware: JGY-370 Worm Gear Motor (Caliper: +-0.2 / approx +-0.5)
# =============================================================================
MOTOR_TOTAL_L = 76.8
GEARBOX_L = 46.0             # Along Y (front-to-back)
GEARBOX_W = 32.0             # Along X (left-to-right)
GEARBOX_H = 21.8             # Along Z

BARREL_DIA = 24.0
BARREL_L = MOTOR_TOTAL_L - GEARBOX_L  # 30.8 mm
BARREL_OVERHANG_Z = 2.2      # Barrel hangs 2.2 mm below gearbox bottom

# Top gearbox features (relative to shaft center at X=0, Y=0)
SHAFT_FROM_FRONT = 14.5      # Caliper approx: distance from front gearbox edge to shaft
GEARBOX_Y_FRONT = -SHAFT_FROM_FRONT                # -14.5 mm
GEARBOX_Y_BACK = GEARBOX_Y_FRONT + GEARBOX_L       # +31.5 mm
GEARBOX_Y_CENTER = (GEARBOX_Y_FRONT + GEARBOX_Y_BACK) / 2.0  # +8.5 mm

M3_PATTERN_X = 18.0          # c2c across width (X = +-9.0 mm)
M3_PATTERN_Y = 33.0          # c2c along length (Y = 8.5 +- 16.5 -> -8.0, +25.0)
M3_BOSS_H = 2.0              # Caliper approx: 4 raised circular M3 bosses
M3_BOSS_DIA = 6.2            # Approx OD of raised M3 bosses

SHAFT_DIA = 6.0
SHAFT_FLAT = 5.5             # Across flat
SHAFT_TOTAL_H = 16.0         # Caliper approx: total height above flat gearbox face
SHAFT_COLLAR_H = 1.5         # Caliper approx: raised metal collar at base of shaft
SHAFT_COLLAR_DIA = 11.5      # Approx collar OD

# =============================================================================
# 4. Measured Hardware: Micro Limit Switch (KW11-3Z Roller Lever)
# =============================================================================
SW_BODY_L = 20.0
SW_BODY_H = 9.2
SW_BODY_W = 6.1
SW_HOLE_DIA = 2.0
SW_HOLE_C2C = 9.0
SW_HOLE_FROM_BASE = 3.9 + SW_HOLE_DIA / 2.0  # 4.9 mm from terminal/base side
SW_ROLLER_PROTRUSION = 10.0  # Caliper verified: top of red roller is 10 mm above top of black body
SW_ROLLER_DIA = 4.8

# =============================================================================
# 5. Measured Hardware: Close-Range IR Sensor (TCRT5000 Slim KY-033)
# =============================================================================
IR_PCB_W = 10.5              # Width (vertical when mounted horizontally)
IR_PCB_L = 41.8              # Length (horizontal)
IR_PCB_T = 1.4               # PCB thickness
IR_REAR_PINS_H = 1.8         # Max solder pin protrusion on back of PCB
IR_FRONT_MAX_H = 8.0         # Trimpot height on front
IR_SENSOR_FROM_END = 9.8     # Distance from top short end to center of TCRT5000 block
IR_HOLE_C2C = 12.2           # Mounting holes flanking TCRT5000 block
IR_HOLE_DIA = 3.2
IR_OPTICAL_Z = 14.0          # Target optical center above fridge roof (door lip = 25 mm)

# Neodymium magnet for IR stand
MAGNET_DIA = 15.0
MAGNET_H = 4.4

# =============================================================================
# 6. Fasteners & Wheel (Procured)
# =============================================================================
M3_HEAD_DIA = 5.6
M3_HEAD_H = 2.4
M3_NUT_AF = 5.5              # Across flats
M3_NUT_H = 4.0               # M3 nylon locknut height
M3_WASHER_OD = 9.0
M3_WASHER_T = 0.8

M5_BOLT_L = 100.0
M5_WASHER_OD = 10.0
M5_WASHER_T = 1.0
WHEEL_OD = 24.0
WHEEL_H = 10.2

# =============================================================================
# 7. Derived Vertical Stack-Up (Z Coordinates from Grey Hinge Cover Top = 0)
# =============================================================================
BASE_BARREL_FLOOR_Z = 2.0                        # Solid bottom under barrel (flat for tape)
BASE_GEARBOX_FLOOR_Z = BASE_BARREL_FLOOR_Z + 3.0 # 5.0 mm (3.0 mm step > 2.2 mm overhang)

GEARBOX_TOP_Z = BASE_GEARBOX_FLOOR_Z + GEARBOX_H         # 26.8 mm
M3_BOSS_TOP_Z = GEARBOX_TOP_Z + M3_BOSS_H                # 28.8 mm
SHAFT_TIP_Z = GEARBOX_TOP_Z + SHAFT_TOTAL_H              # 42.8 mm

# Part 1B (Top Hold-Down Cap) sits on M3_BOSS_TOP_Z (28.8 mm)
# 4.0 mm thickness under screw heads -> M3x10 engages 6.0 mm (2.0 mm boss + 4.0 mm casing)
# 2.5 mm counterbore keeps 2.4 mm pan heads 100% flush below lever arm!
CAP_FLOOR_UNDER_HEAD = 4.0
CAP_CBORE_DEPTH = 2.5
CAP_THICKNESS = CAP_FLOOR_UNDER_HEAD + CAP_CBORE_DEPTH   # 6.5 mm
CAP_TOP_Z = M3_BOSS_TOP_Z + CAP_THICKNESS                # 35.3 mm
CAP_SHAFT_CUTOUT_DIA = 16.0                              # Clears 6 mm shaft by 5 mm/side!

# Part 2 (Lever Arm)
ARM_CLEARANCE_Z = 0.5                                    # Running air gap above Top Cap
ARM_BOTTOM_Z = CAP_TOP_Z + ARM_CLEARANCE_Z               # 35.8 mm
ARM_HUB_H = 10.0                                         # Z = 35.8 to 45.8 mm
ARM_TOP_Z = ARM_BOTTOM_Z + ARM_HUB_H                     # 45.8 mm
# Shaft engagement inside D-hub: 42.8 - 35.8 = 7.0 mm; top retention cap = 3.0 mm
ARM_LENGTH_C2C = 160.0

# =============================================================================
# 8. Part 1A Footprint & Feature Layout (Relative to Shaft X=0, Y=0)
# =============================================================================
BASE_Y_FRONT = -18.0                                     # 3.5 mm wall in front of gearbox
BASE_Y_BACK = 60.0                                       # Total Y = 78.0 mm (<= 78 mm safe!)
BASE_X_LEFT = -44.0                                      # Wide flat wing for tape + zip ties
BASE_X_RIGHT = 38.0                                      # Total X = 82.0 mm (<= 100 mm safe!)
BASE_CORNER_R = 4.0

# Twin Hold-Down Towers on Part 1A (bolts Part 1B down using 2x spare M3x20 + M3 locknuts)
TOWER_Y_CENTER = GEARBOX_Y_CENTER                        # +8.5 mm (centered on gearbox)
TOWER_L = 16.0                                           # Along Y (Y = +0.5 to +16.5)
TOWER_W = 11.0                                           # Along X outside pocket
TOWER_HOLE_X = GEARBOX_W / 2.0 + CLEARANCE_POCKET / 2.0 + TOWER_W / 2.0  # 16.25 + 5.5 = 21.75 mm
TOWER_TOP_Z = M3_BOSS_TOP_Z                              # 28.8 mm (flush with M3 bosses)
# M3x20 screw stack: 4.0 mm cap floor + 11.0 mm tower top-to-nut + 4.0 mm locknut = 19.0 mm (1 mm spare!)
TOWER_NUT_SLOT_TOP_Z = TOWER_TOP_Z - 11.0                # 17.8 mm
TOWER_NUT_SLOT_H = 4.8                                   # Fits 4.0 mm M3 locknut easily

# Limit Switch Vertical Mounting Ear on Part 1A (+X right side, +Y behind parked 180° arm)
# Switch mounts with 20 mm length along Z, roller facing -Y (forward), wires exiting +Y (back)!
SW_EAR_X_INNER = 28.5                                    # Outer face of ear at X = 32.0
SW_EAR_THICK = 3.5                                       # M2x16: 6.1 switch + 3.5 ear + 2.0 nut = 11.6 mm
SW_BODY_Y_FRONT = 18.5                                   # Unpressed roller tip @ Y=8.5 (18.5-10) -> clicks @ ~183-185 deg!
SW_CENTER_Z = (ARM_BOTTOM_Z + ARM_TOP_Z) / 2.0           # 40.8 mm (dead-center on Lever Arm!)
# Place switch body so roller aligns with ARM centerline (Z = 40.8 mm)
# On KW11-3Z, roller sits ~5 mm toward the lever-tip end from body center
SW_BODY_Z_CENTER = SW_CENTER_Z - 4.0                     # 36.8 mm -> body Z = [26.8, 46.8]

# =============================================================================
# 9. Part 3 (IR Sensor Magnetic Stand) Layout
# =============================================================================
IR_BASE_W = 30.0             # Along X (parallel to door lip)
IR_BASE_D = 26.0             # Along Y (front-to-back)
IR_BASE_H = 5.2              # 0.8 mm solid bottom skin + 4.4 mm top-drop-in magnet pocket
IR_MAGNET_FLOOR_T = 0.8      # Scratch shield + zero-support bottom skin
IR_WALL_T = 2.5              # Wall thickness (M3x10: 1.4 PCB + 2.0 standoff + 2.5 wall + 4.0 nut = 9.9 mm!)
IR_STANDOFF_H = 2.0          # Clears 1.8 mm rear solder spikes
IR_WALL_H = IR_OPTICAL_Z + IR_PCB_W / 2.0 + 1.5          # 14.0 + 5.25 + 1.5 = 20.75 mm
