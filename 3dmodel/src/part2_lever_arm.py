"""
Part 2: 160 mm Flat Door-Pushing Lever Arm (Split Pinch-Clamp D-Hub + M5 Drop Axle Boss).

Material: ABS (Uni Shop) or PETG (PrintJai backup). Zero supports, prints 100% flat on Z=0.
Local orientation:
  - D-shaft center at (0, 0), arm extends along +X to M5 drop bolt at (160.0, 0).
  - Height: 10.0 mm uniform top & bottom (Z = 0 to 10.0 mm in print frame; Z = 35.8 to 45.8 mm assembled).
Features:
  - Motor End (Split Pinch-Clamp D-Hub):
      * 22 mm OD boss, 10.0 mm tall.
      * 7.2 mm deep D-bore from bottom (6.3 mm OD / 5.8 mm across flat, +0.3 mm clearance)
        + 2.8 mm solid top cap with 3.45 mm hole for M3x10 axial shaft-tip screw + M3x9x0.8 washer!
      * 2.0 mm full-height flex slit on the -X (back) side flanked by clamping ears with a
        horizontal 3.45 mm through-hole for the M3x20 pinch bolt + M3 locknut + flat washer seats.
  - Stiffened Tapered Beam:
      * Tapers smoothly from 18 mm wide near the D-hub to 14 mm wide at the M5 boss (high bending
        resistance near the motor where torque is highest!).
      * Top-open lightweighting truss pockets (leaving a 3.2 mm bottom web + 3.2 mm side rails +
        diagonal/cross ribs) -> huge stiffness-to-weight ratio, zero supports, low THB/g cost!
  - Door End (M5 Drop Axle Boss):
      * 19 mm OD x 10.0 mm tall solid boss with 5.45 mm vertical through-hole for M5x100 bolt.
"""

from build123d import (
    Align,
    Axis,
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
    SlotCenterToCenter,
    extrude,
    fillet,
    make_face,
)
import params as P


def build_part2():
    hub_r = 11.0                 # 22 mm OD D-hub
    tip_r = 9.5                  # 19 mm OD M5 boss
    arm_h = P.ARM_HUB_H          # 10.0 mm
    d_bore_depth = 7.2           # Fits 7.0 mm exposed D-shaft + 0.2 mm clearance (leaves 2.8 mm top cap!)

    # Pinch-clamp ears extending on the -X side (away from the beam)
    ear_x_end = -22.0            # Extends 11 mm past hub perimeter (plenty of room for M3 bolt + washer)
    ear_total_y = 13.0           # Two 5.5 mm ears + 2.0 mm slit = 13.0 mm (+ 2x0.8 washer + 4.0 nut = 18.6 mm on M3x20!)
    clamp_bolt_x = -16.5         # Bolt center 5.5 mm outside hub perimeter (clears 22 mm boss cleanly)
    clamp_bolt_z = arm_h / 2.0   # 5.0 mm (centered vertically on the 10 mm hub -> fits 9 mm washer!)

    # Beam taper widths
    w_root = 17.0                # Width near D-hub
    w_tip = 13.0                 # Width near M5 boss

    with BuildPart() as part:
        # 1. Main 2D profile: D-hub + tapered beam + M5 tip boss + pinch-clamp ears
        with BuildSketch(Plane.XY):
            # D-hub circle
            Circle(hub_r)
            # M5 tip boss circle
            with Locations((P.ARM_LENGTH_C2C, 0)):
                Circle(tip_r)
            # Tapered beam connecting hub and tip
            with BuildLine():
                Polyline(
                    (0, w_root / 2.0),
                    (P.ARM_LENGTH_C2C, w_tip / 2.0),
                    (P.ARM_LENGTH_C2C, -w_tip / 2.0),
                    (0, -w_root / 2.0),
                    close=True,
                )
            make_face()
            # Pinch-clamp ear block on -X side of D-hub
            with Locations((ear_x_end / 2.0, 0)):
                Rectangle(abs(ear_x_end), ear_total_y)
        extrude(amount=arm_h)

        # Round vertical outer corners of the pinch-clamp ears slightly? Keep flat outer +-Y faces
        # for M3x9x0.8 washers! Only fillet the -X end vertical edges (safe & clean).

        # 2. Top-side lightweighting pockets along the beam (keeps 3.4 mm bottom web + 3.0 mm side walls)
        # 4 clean pockets between X = 24 mm and X = 142 mm separated by 4.0 mm cross-ribs
        pocket_depth = 6.6       # Leaves 3.4 mm solid floor web (10.0 - 6.6 = 3.4 mm)
        pocket_segments = [
            (24.0, 50.0),
            (55.0, 81.0),
            (86.0, 112.0),
            (117.0, 141.0),
        ]
        wall_side = 3.2
        for x0, x1 in pocket_segments:
            # Interpolate local beam width at x0 and x1
            w0 = w_root + (w_tip - w_root) * (x0 / P.ARM_LENGTH_C2C) - 2 * wall_side
            w1 = w_root + (w_tip - w_root) * (x1 / P.ARM_LENGTH_C2C) - 2 * wall_side
            with BuildSketch(Plane.XY.offset(arm_h)):
                with BuildLine():
                    Polyline(
                        (x0, w0 / 2.0),
                        (x1, w1 / 2.0),
                        (x1, -w1 / 2.0),
                        (x0, -w0 / 2.0),
                        close=True,
                    )
                f = make_face()
                fillet(f.vertices(), radius=1.8)
            extrude(amount=-pocket_depth, mode=Mode.SUBTRACT)

        # 3. Split D-Hub Bore from bottom (Z = 0 to d_bore_depth = 7.2 mm)
        # D-bore: 6.3 mm diameter circle clipped by a flat at 5.8 mm from opposite side
        # Radius = 3.15 mm; flat sits at X = +(5.8 - 3.15) = +2.65 mm (facing the beam side,
        # opposite the pinch slit on -X, so clamping squeezes the circular side onto the flat!)
        d_r = P.DHUB_BORE_DIA / 2.0          # 3.15 mm
        flat_x = P.DHUB_BORE_FLAT - d_r      # 5.8 - 3.15 = 2.65 mm
        with BuildSketch(Plane.XY):
            Circle(d_r)
            # Clip the +X arc beyond flat_x
            with Locations((flat_x + 5.0, 0)):
                Rectangle(10.0, 10.0, mode=Mode.SUBTRACT)
        extrude(amount=d_bore_depth, mode=Mode.SUBTRACT)

        # 4. Axial M3x10 retention hole through the 2.8 mm top cap (at X=0, Y=0)
        with Locations((0, 0, -0.5)):
            Cylinder(
                radius=(3.0 + P.CLEARANCE_HOLE_M3) / 2.0,
                height=arm_h + 1.0,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
                mode=Mode.SUBTRACT,
            )

        # 5. 2.0 mm full-height flex slit on -X side (from shaft bore out through ear end)
        # Note: Slit runs from X = 0 to X = ear_x_end - 1, height = full arm_h (so ears flex easily!)
        # Wait: keep top axial washer seat intact right around the M3 hole?
        # Even with a 2.0 mm slit on the -X side, the M3x9x0.8 washer bridges across the top
        # cleanly and clamps down on >270 deg of the 22 mm hub!
        slit_len = abs(ear_x_end) + 2.0
        with Locations((-slit_len / 2.0, 0, -0.5)):
            Box(
                slit_len,
                P.DHUB_SLIT_W,
                arm_h + 1.0,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
                mode=Mode.SUBTRACT,
            )

        # 6. Horizontal M3x20 pinch-clamp bolt hole through both ears (along Y axis)
        with Locations((clamp_bolt_x, 0, clamp_bolt_z)):
            Cylinder(
                radius=(3.0 + P.CLEARANCE_HOLE_M3) / 2.0,
                height=ear_total_y + 4.0,
                rotation=(90, 0, 0),
                mode=Mode.SUBTRACT,
            )

        # 7. Vertical M5x100 drop-axle through-hole at door end (X = 160.0, Y = 0)
        with Locations((P.ARM_LENGTH_C2C, 0, -0.5)):
            Cylinder(
                radius=(5.0 + P.CLEARANCE_HOLE_M5) / 2.0,
                height=arm_h + 1.0,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
                mode=Mode.SUBTRACT,
            )

    return part.part


if __name__ == "__main__":
    p = build_part2()
    print("Part 2 volume (cm^3):", round(p.volume / 1000.0, 2))
    print("Part 2 bbox:", p.bounding_box())
