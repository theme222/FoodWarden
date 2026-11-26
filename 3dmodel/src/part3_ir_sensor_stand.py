"""
Part 3: Standalone TCRT5000 IR Sensor Magnetic L-Stand.

Material: PETG (zero supports, prints 100% upright flat on Z=0 bottom face!).
Local orientation:
  - Base sits on flat steel fridge roof (Z = 0).
  - Front wall faces -Y (toward the closed fridge door lip, 25 mm tall).
  - PCB mounts horizontally on the -Y face so the 3-pin header exits freely to +X (toward control box).
Features:
  - Top-drop-in circular magnet pocket (15.4 mm dia x 4.4 mm deep) on the base top, leaving a
    0.8 mm solid PETG bottom floor -> zero overhangs, protects fridge paint from scratches,
    and lets you slide/aim the sensor freely + detach in 1 second for demo day!
  - Optical center of TCRT5000 positioned at Z = 14.0 mm (aims dead-center at 25 mm door lip).
  - 2.0 mm raised PCB standoff bosses with 45-deg self-supporting undersides (clears the 1.8 mm
    rear solder spikes on the PCB with zero supports!).
  - Forgiving 12.2 mm c2c hole pattern: one 3.45 mm round hole + one 3.45 x 5.0 mm horizontal slot
    for 2x M3x10 screws + M3 locknuts (1.4 PCB + 2.0 standoff + 2.5 wall + 4.0 nut = 9.9 mm!).
"""

from build123d import (
    Align,
    Box,
    BuildLine,
    BuildPart,
    BuildSketch,
    Circle,
    Cylinder,
    Locations,
    Mode,
    Plane,
    Polyline,
    Rectangle,
    RectangleRounded,
    SlotCenterToCenter,
    extrude,
    make_face,
)
import params as P


def build_part3():
    base_w = P.IR_BASE_W             # 30.0 mm along X
    base_d = P.IR_BASE_D             # 26.0 mm along Y (Y = 0 front wall to Y = +26 back)
    base_h = P.IR_BASE_H             # 5.2 mm
    wall_t = P.IR_WALL_T             # 2.5 mm
    wall_h = P.IR_WALL_H             # 20.75 mm
    standoff_h = P.IR_STANDOFF_H     # 2.0 mm

    # Center the TCRT5000 optical sensor at X = -2.0 mm (so the long 41.8 mm PCB extends toward +X
    # with the trimpot & 3-pin header overhanging cleanly to the right, away from the door gap)
    sensor_x = -2.0
    hole1_x = sensor_x - P.IR_HOLE_C2C / 2.0   # -8.1 mm (round hole, near short end of PCB)
    hole2_x = sensor_x + P.IR_HOLE_C2C / 2.0   # +4.1 mm (horizontal slot, toward trimpot)
    hole_z = P.IR_OPTICAL_Z                    # 14.0 mm

    m3_r = (3.0 + P.CLEARANCE_HOLE_M3) / 2.0   # 1.725 mm

    with BuildPart() as part:
        # 1. Flat magnetic base (Y = 0 to base_d, centered on X = 0)
        with BuildSketch(Plane.XY):
            with Locations((0, base_d / 2.0)):
                RectangleRounded(base_w, base_d, 3.0)
        extrude(amount=base_h)

        # 2. Vertical front mounting wall (Y = 0 to wall_t, Z = 0 to wall_h)
        with Locations((0, wall_t / 2.0, 0)):
            Box(
                base_w,
                wall_t,
                wall_h,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
            )

        # 3. Twin triangular side gussets (Y = wall_t to base_d - 3, Z = base_h to wall_h - 2)
        # Keep clear of the central magnet pocket (X = +-7.7 mm) -> place at outer edges X = +-13.5 mm!
        gusset_t = 2.5
        for sx in (-1, 1):
            gx = sx * (base_w / 2.0 - gusset_t / 2.0) - gusset_t / 2.0
            with BuildSketch(Plane.YZ.offset(gx)):
                with BuildLine():
                    Polyline(
                        (wall_t, base_h),
                        (base_d - 4.0, base_h),
                        (wall_t, wall_h - 1.5),
                        close=True,
                    )
                make_face()
            extrude(amount=gusset_t)

        # 4. Top-drop-in Neodymium Magnet Pocket (15.4 mm dia x 4.4 mm deep, leaving 0.8 mm bottom floor!)
        # Centered behind the wall at Y = wall_t + (base_d - wall_t) / 2 = 2.5 + 11.75 = 14.25 mm
        mag_y = wall_t + (base_d - wall_t) / 2.0  # 14.25 mm (leaves ~4 mm PETG rim on front & back!)
        with Locations((0, mag_y, P.IR_MAGNET_FLOOR_T)):
            Cylinder(
                radius=(P.MAGNET_DIA + P.CLEARANCE_MAGNET) / 2.0,
                height=P.MAGNET_H + 1.0,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
                mode=Mode.SUBTRACT,
            )

        # 5. Self-supporting 2.0 mm raised PCB standoff bosses on the front (-Y) face!
        # Instead of circular overhang cylinders, each boss has a 45-deg sloped teardrop/ramp underside
        # so it prints 100% cleanly upright with ZERO supports!
        boss_r = 3.4  # 6.8 mm wide flat pad for PCB seating
        for bx, extra_x in ((hole1_x, 0.0), (hole2_x, 1.6)):
            half_w = boss_r + extra_x / 2.0
            # Profile in YZ plane extruded along X -> 45-deg bottom ramp from Y=0 to Y=-standoff_h!
            with BuildSketch(Plane.YZ.offset(bx - half_w)):
                with BuildLine():
                    Polyline(
                        (0.0, hole_z - boss_r - standoff_h),   # 45 deg start at Y=0
                        (-standoff_h, hole_z - boss_r),        # Front face bottom
                        (-standoff_h, hole_z + boss_r),        # Front face top
                        (0.0, hole_z + boss_r),                # Flush top back to wall
                        close=True,
                    )
                make_face()
            extrude(amount=2.0 * half_w)

        # 6. Round M3 hole at hole1_x (along Y, cutting through standoff + wall)
        with Locations((hole1_x, 0, hole_z)):
            Cylinder(
                radius=m3_r,
                height=wall_t + standoff_h + 6.0,
                rotation=(90, 0, 0),
                mode=Mode.SUBTRACT,
            )

        # 7. Horizontal forgiving M3 slot (3.45 x 5.0 mm) at hole2_x (along Y, cutting through standoff + wall)
        # Note: Plane.XZ normal points in -Y, so Plane.XZ.offset(standoff_h + 1.0) is at Y = -(standoff_h + 1.0),
        # and extrude(amount=-(...)) cuts in +Y straight through both standoff and wall!
        with BuildSketch(Plane.XZ.offset(standoff_h + 1.0)):
            with Locations((hole2_x, hole_z)):
                SlotCenterToCenter(5.0 - 2.0 * m3_r, 2.0 * m3_r)
        extrude(amount=-(wall_t + standoff_h + 4.0), mode=Mode.SUBTRACT)

    return part.part


if __name__ == "__main__":
    p = build_part3()
    print("Part 3 volume (cm^3):", round(p.volume / 1000.0, 2))
    print("Part 3 bbox:", p.bounding_box())
