"""
Part 1B: Gearbox Top Hold-Down Cap / Clamping Bridge.

Material: PETG (zero supports, prints 100% flat on Z=0).
Features:
  - Sits flush on the JGY-370's 4 raised M3 bosses AND Part 1A's twin hold-down towers (Z = 28.8 mm).
  - 6.5 mm total thickness with 2.5 mm deep counterbores on all 6 M3 screw holes:
      * 4.0 mm solid floor under screw heads -> M3x10 screws engage 6.0 mm (2.0 mm boss + 4.0 mm casing).
      * All 6 pan-head screws (2.4 mm tall) sit completely recessed below the top face (Z = 35.3 mm),
        giving the sweeping Lever Arm (Z = 35.8 mm) 100% unobstructed clearance!
  - Generous 16.0 mm circular shaft cutout around the 6 mm D-shaft (5.0 mm radial margin to absorb
    measurement variance while keeping sturdy walls to the front M3 holes).
  - Outer clamping ears align with Part 1A's twin towers for 2x spare M3x20 screws + M3 locknuts,
    locking the motor down rigidly in all 6 degrees of freedom!
"""

from build123d import (
    Align,
    Box,
    BuildPart,
    BuildSketch,
    Cylinder,
    Locations,
    Mode,
    Plane,
    RectangleRounded,
    extrude,
)
import params as P


def build_part1b():
    cap_w = P.GEARBOX_W  # 32.0 mm main gearbox body width
    cap_l = P.GEARBOX_L  # 46.0 mm main gearbox body length
    # Outer wings reach across the twin hold-down towers on Part 1A
    wing_span_x = 2.0 * (P.TOWER_HOLE_X + P.TOWER_W / 2.0)  # 2 * 27.25 = 54.5 mm
    wing_l = P.TOWER_L                                       # 16.0 mm

    m3_clear_r = (3.0 + P.CLEARANCE_HOLE_M3) / 2.0           # 1.725 mm
    cbore_r = (P.M3_HEAD_DIA + 1.0) / 2.0                    # 3.3 mm (fits 5.6 mm head + screwdriver clearance)

    with BuildPart() as part:
        # 1. Main gearbox cap body (Z = 0 to CAP_THICKNESS in local print frame)
        with BuildSketch(Plane.XY):
            with Locations((0, P.GEARBOX_Y_CENTER)):
                RectangleRounded(cap_w, cap_l, 2.5)
            # Twin side clamping ears connecting to Part 1A's hold-down towers
            with Locations((0, P.TOWER_Y_CENTER)):
                RectangleRounded(wing_span_x, wing_l, 2.5)
        extrude(amount=P.CAP_THICKNESS)

        # 2. Oversized circular shaft clearance hole at (0, 0)
        with Locations((0, 0, -0.5)):
            Cylinder(
                radius=P.CAP_SHAFT_CUTOUT_DIA / 2.0,
                height=P.CAP_THICKNESS + 1.0,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
                mode=Mode.SUBTRACT,
            )

        # 3. 4x Gearbox M3 through-holes + top counterbores
        gearbox_holes = [
            (sx * P.M3_PATTERN_X / 2.0, P.GEARBOX_Y_CENTER + sy * P.M3_PATTERN_Y / 2.0)
            for sx in (-1, 1)
            for sy in (-1, 1)
        ]
        # 4. 2x Outer hold-down tower M3 through-holes + top counterbores
        tower_holes = [
            (sx * P.TOWER_HOLE_X, P.TOWER_Y_CENTER)
            for sx in (-1, 1)
        ]

        for hx, hy in gearbox_holes + tower_holes:
            with Locations((hx, hy, -0.5)):
                Cylinder(
                    radius=m3_clear_r,
                    height=P.CAP_THICKNESS + 1.0,
                    align=(Align.CENTER, Align.CENTER, Align.MIN),
                    mode=Mode.SUBTRACT,
                )
            with Locations((hx, hy, P.CAP_FLOOR_UNDER_HEAD)):
                Cylinder(
                    radius=cbore_r,
                    height=P.CAP_CBORE_DEPTH + 1.0,
                    align=(Align.CENTER, Align.CENTER, Align.MIN),
                    mode=Mode.SUBTRACT,
                )

    return part.part


if __name__ == "__main__":
    p = build_part1b()
    print("Part 1B volume (cm^3):", round(p.volume / 1000.0, 2))
    print("Part 1B bbox:", p.bounding_box())
