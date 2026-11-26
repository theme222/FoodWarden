"""
Digital Ghost Hardware Models for Assembly Fit & Collision Verification.
These are NOT 3D-printed — they represent the measured off-the-shelf hardware.
"""

from build123d import (
    Align,
    Box,
    BuildPart,
    BuildSketch,
    Circle,
    Cylinder,
    Locations,
    Mode,
    Plane,
    Rectangle,
    extrude,
)
import params as P


def build_ghost_motor():
    """JGY-370 Worm Gear Motor in assembled Motor-Assembly coordinates (shaft at X=0, Y=0)."""
    with BuildPart() as motor:
        # 1. Gearbox rectangular housing (Z = BASE_GEARBOX_FLOOR_Z to GEARBOX_TOP_Z)
        with Locations((0, P.GEARBOX_Y_CENTER, P.BASE_GEARBOX_FLOOR_Z)):
            Box(
                P.GEARBOX_W,
                P.GEARBOX_L,
                P.GEARBOX_H,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
            )
        # 2. Cylindrical motor barrel (24 mm dia, overhangs 2.2 mm below gearbox bottom!)
        barrel_center_z = P.BASE_GEARBOX_FLOOR_Z - P.BARREL_OVERHANG_Z + P.BARREL_DIA / 2.0
        with Locations((0, P.GEARBOX_Y_BACK, barrel_center_z)):
            Cylinder(
                radius=P.BARREL_DIA / 2.0,
                height=P.BARREL_L,
                rotation=(-90, 0, 0),
                align=(Align.CENTER, Align.CENTER, Align.MIN),
            )
        # 3. Four raised circular M3 bosses (2.0 mm tall above gearbox top)
        for sx in (-1, 1):
            for sy in (-1, 1):
                hx = sx * P.M3_PATTERN_X / 2.0
                hy = P.GEARBOX_Y_CENTER + sy * P.M3_PATTERN_Y / 2.0
                with Locations((hx, hy, P.GEARBOX_TOP_Z)):
                    Cylinder(
                        radius=P.M3_BOSS_DIA / 2.0,
                        height=P.M3_BOSS_H,
                        align=(Align.CENTER, Align.CENTER, Align.MIN),
                    )
        # 4. Raised metal collar around shaft base (1.5 mm tall)
        with Locations((0, 0, P.GEARBOX_TOP_Z)):
            Cylinder(
                radius=P.SHAFT_COLLAR_DIA / 2.0,
                height=P.SHAFT_COLLAR_H,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
            )
        # 5. 6 mm D-Shaft (total 16.0 mm above gearbox top)
        d_r = P.SHAFT_DIA / 2.0
        flat_x = P.SHAFT_FLAT - d_r  # +2.5 mm
        with BuildSketch(Plane.XY.offset(P.GEARBOX_TOP_Z)):
            Circle(d_r)
            with Locations((flat_x + 5.0, 0)):
                Rectangle(10.0, 10.0, mode=Mode.SUBTRACT)
        extrude(amount=P.SHAFT_TOTAL_H)
    return motor.part


def build_ghost_limit_switch():
    """KW11-3Z micro limit switch mounted vertically on Part 1A's +X ear (roller facing -Y)."""
    # Mounted on +X outer face of ear (X = 32.0 to 38.1 mm)
    sw_x0 = P.SW_EAR_X_INNER + P.SW_EAR_THICK  # 32.0 mm
    sw_cx = sw_x0 + P.SW_BODY_W / 2.0          # 35.05 mm
    sw_cy = P.SW_BODY_Y_FRONT + P.SW_BODY_H / 2.0  # 18.6 mm
    sw_cz = P.SW_BODY_Z_CENTER                 # 36.8 mm

    with BuildPart() as sw:
        # Switch black body
        with Locations((sw_cx, sw_cy, sw_cz)):
            Box(P.SW_BODY_W, P.SW_BODY_H, P.SW_BODY_L)
        # Roller wheel projecting forward (-Y) at ARM centerline Z = 40.8 mm
        roller_y = P.SW_BODY_Y_FRONT - P.SW_ROLLER_PROTRUSION + P.SW_ROLLER_DIA / 2.0
        with Locations((sw_cx, roller_y, P.SW_CENTER_Z)):
            Cylinder(
                radius=P.SW_ROLLER_DIA / 2.0,
                height=4.0,
                rotation=(0, 90, 0),
            )
    return sw.part


def build_ghost_drop_bolt_and_wheel(arm_angle_deg: float = 0.0):
    """M5x100 drop bolt + POM 625ZZ roller wheel at door end of Lever Arm."""
    import math
    rad = math.radians(arm_angle_deg)
    bx = P.ARM_LENGTH_C2C * math.cos(rad)
    by = P.ARM_LENGTH_C2C * math.sin(rad)

    with BuildPart() as hw:
        # M5x100 bolt shank from Z = ARM_TOP_Z + 1 down 100 mm
        bolt_top_z = P.ARM_TOP_Z + P.M5_WASHER_T
        with Locations((bx, by, bolt_top_z - P.M5_BOLT_L)):
            Cylinder(
                radius=2.5,
                height=P.M5_BOLT_L,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
            )
        # Pan head on top
        with Locations((bx, by, bolt_top_z)):
            Cylinder(
                radius=4.5,
                height=3.5,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
            )
        # POM 625ZZ roller wheel centered at Z = -DOOR_PUSH_DROP_X (-40 mm)
        with Locations((bx, by, -P.DOOR_PUSH_DROP_X)):
            Cylinder(
                radius=P.WHEEL_OD / 2.0,
                height=P.WHEEL_H,
            )
    return hw.part


def build_ghost_ir_pcb():
    """TCRT5000 slim PCB mounted horizontally on Part 3's -Y standoffs."""
    # PCB back face sits at Y = -IR_STANDOFF_H (-2.0 mm); front face at Y = -3.4 mm
    sensor_x = -2.0
    pcb_x0 = sensor_x - P.IR_SENSOR_FROM_END       # -11.8 mm (short end near hole 1)
    pcb_cx = pcb_x0 + P.IR_PCB_L / 2.0             # +9.1 mm (extends to +30.0 mm)
    pcb_y_back = -P.IR_STANDOFF_H                  # -2.0 mm
    pcb_cy = pcb_y_back - P.IR_PCB_T / 2.0         # -2.7 mm

    with BuildPart() as pcb:
        # Main PCB board
        with Locations((pcb_cx, pcb_cy, P.IR_OPTICAL_Z)):
            Box(P.IR_PCB_L, P.IR_PCB_T, P.IR_PCB_W)
        # Black TCRT5000 sensor block projecting -Y toward door
        with Locations((sensor_x, pcb_y_back - P.IR_PCB_T - 3.0, P.IR_OPTICAL_Z)):
            Box(5.8, 6.0, 10.2)
        # Blue trimpot projecting -Y (8 mm tall from PCB front)
        with Locations((sensor_x + 12.5, pcb_y_back - P.IR_PCB_T - 4.0, P.IR_OPTICAL_Z)):
            Box(7.0, 8.0, 7.0)
        # 3-pin header exiting +X end
        with Locations((pcb_x0 + P.IR_PCB_L + 5.0, pcb_cy, P.IR_OPTICAL_Z)):
            Box(10.0, 2.6, 7.6)
    return pcb.part


def build_ghost_magnet():
    """15 mm dia x 4.4 mm thick neodymium disc magnet dropped into Part 3's top pocket."""
    mag_y = P.IR_WALL_T + (P.IR_BASE_D - P.IR_WALL_T) / 2.0
    with BuildPart() as mag:
        with Locations((0, mag_y, P.IR_MAGNET_FLOOR_T)):
            Cylinder(
                radius=P.MAGNET_DIA / 2.0,
                height=P.MAGNET_H,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
            )
    return mag.part
