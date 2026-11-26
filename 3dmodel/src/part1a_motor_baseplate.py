"""
Part 1A: Motor Baseplate + Raised Gearbox Cradle + Twin Hold-Down Towers + Limit Switch Mount.

Material: PETG (zero supports, prints 100% flat on Z=0 bottom face).
Features:
  - Dead-flat bottom (82 x 78 mm, R4 corners) fitting safely inside 110 x 85 mm hinge cover.
  - 3.0 mm raised gearbox cradle floor (Z=5.0 mm) over a 2.0 mm solid barrel floor to absorb
    the JGY-370's 2.2 mm cylindrical barrel overhang with zero rocking.
  - Pocket side walls cradling the 46.5 x 32.5 mm gearbox against rotation.
  - Twin hold-down towers flanking the gearbox (at X = +-21.75 mm) with captive M3 locknut slots
    so Part 1B bolts the motor rigidly to Part 1A using 2x spare M3x20 screws + 2x spare M3 locknuts.
  - Two zip-tie strain-relief anchor tunnels on the -X wing (toward control box) for motor & switch leads.
  - Integrated vertical gusseted limit switch mounting ear on the +X/+Y CCW side so the switch roller
    faces -Y directly into the retracting arm at ~180-183 deg, while soldered wires exit freely toward +Y.
"""

from build123d import (
    Align,
    Axis,
    Box,
    BuildLine,
    BuildPart,
    BuildSketch,
    Cylinder,
    Locations,
    Mode,
    Plane,
    Polyline,
    Rectangle,
    RectangleRounded,
    extrude,
    fillet,
    make_face,
)
import params as P


def build_part1a():
    base_w = P.BASE_X_RIGHT - P.BASE_X_LEFT   # 82.0 mm
    base_d = P.BASE_Y_BACK - P.BASE_Y_FRONT   # 78.0 mm
    base_cx = (P.BASE_X_LEFT + P.BASE_X_RIGHT) / 2.0  # -3.0 mm
    base_cy = (P.BASE_Y_FRONT + P.BASE_Y_BACK) / 2.0  # +21.0 mm

    pocket_w = P.GEARBOX_W + P.CLEARANCE_POCKET  # 32.5 mm
    pocket_l = P.GEARBOX_L + P.CLEARANCE_POCKET  # 46.5 mm
    wall_t = 3.0
    cradle_wall_h = 13.0  # Wall top at Z = 5.0 + 13.0 = 18.0 mm (cradles gearbox sides)

    with BuildPart() as part:
        # 1. Flat baseplate floor (Z = 0 to 5.0 mm initially; barrel channel recessed down to Z = 2.0 mm)
        with BuildSketch(Plane.XY):
            with Locations((base_cx, base_cy)):
                RectangleRounded(base_w, base_d, P.BASE_CORNER_R)
        extrude(amount=P.BASE_GEARBOX_FLOOR_Z)

        # 2. Barrel overhang relief channel (cuts down from Z = 5.0 to Z = 2.0 mm under the 24 mm barrel)
        # Generous 28 mm width absorbs any lateral barrel offset
        barrel_cut_w = P.BARREL_DIA + 4.0  # 28.0 mm
        barrel_cut_y0 = P.GEARBOX_Y_BACK - 0.5
        barrel_cut_y1 = P.BASE_Y_BACK + 1.0  # Open to back edge
        barrel_cut_l = barrel_cut_y1 - barrel_cut_y0
        barrel_cut_cy = (barrel_cut_y0 + barrel_cut_y1) / 2.0
        with Locations((0, barrel_cut_cy, P.BASE_BARREL_FLOOR_Z)):
            Box(
                barrel_cut_w,
                barrel_cut_l,
                P.BASE_GEARBOX_FLOOR_Z - P.BASE_BARREL_FLOOR_Z + 1.0,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
                mode=Mode.SUBTRACT,
            )

        # 3. Gearbox perimeter cradle walls (Z = 5.0 to 18.0 mm)
        # Front wall (at -Y edge of gearbox)
        with Locations((0, P.GEARBOX_Y_FRONT - P.CLEARANCE_POCKET / 2.0 - wall_t / 2.0, P.BASE_GEARBOX_FLOOR_Z)):
            Box(
                pocket_w + 2 * wall_t,
                wall_t,
                cradle_wall_h,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
            )
        # Left & Right gearbox side walls
        for sx in (-1, 1):
            wx = sx * (pocket_w / 2.0 + wall_t / 2.0)
            with Locations((wx, P.GEARBOX_Y_CENTER, P.BASE_GEARBOX_FLOOR_Z)):
                Box(
                    wall_t,
                    pocket_l,
                    cradle_wall_h,
                    align=(Align.CENTER, Align.CENTER, Align.MIN),
                )
        # Rear corner stops (left & right of barrel cutout, keeps gearbox from sliding back)
        stop_w = (pocket_w + 2 * wall_t - barrel_cut_w) / 2.0  # (38.5 - 28.0)/2 = 5.25 mm
        for sx in (-1, 1):
            st_x = sx * (barrel_cut_w / 2.0 + stop_w / 2.0)
            with Locations((st_x, P.GEARBOX_Y_BACK + P.CLEARANCE_POCKET / 2.0 + wall_t / 2.0, P.BASE_GEARBOX_FLOOR_Z)):
                Box(
                    stop_w,
                    wall_t,
                    cradle_wall_h,
                    align=(Align.CENTER, Align.CENTER, Align.MIN),
                )

        # 4. Twin Hold-Down Towers (X = +-21.75 mm, Z = 5.0 to 28.8 mm)
        # Flush with gearbox's raised M3 bosses so Part 1B bolts solidly onto BOTH motor & baseplate!
        for sx in (-1, 1):
            tx = sx * P.TOWER_HOLE_X
            with Locations((tx, P.TOWER_Y_CENTER, P.BASE_GEARBOX_FLOOR_Z)):
                Box(
                    P.TOWER_W,
                    P.TOWER_L,
                    P.TOWER_TOP_Z - P.BASE_GEARBOX_FLOOR_Z,
                    align=(Align.CENTER, Align.CENTER, Align.MIN),
                )
            # Vertical M3 clearance bolt hole through tower (down to nut slot bottom)
            with Locations((tx, P.TOWER_Y_CENTER, P.TOWER_NUT_SLOT_TOP_Z - P.TOWER_NUT_SLOT_H - 3.0)):
                Cylinder(
                    radius=(3.0 + P.CLEARANCE_HOLE_M3) / 2.0,
                    height=P.TOWER_TOP_Z - (P.TOWER_NUT_SLOT_TOP_Z - P.TOWER_NUT_SLOT_H - 3.0) + 1.0,
                    align=(Align.CENTER, Align.CENTER, Align.MIN),
                    mode=Mode.SUBTRACT,
                )
            # Side-entry captive M3 nylon locknut slot (opens outward on +-X side, zero supports)
            # Width along Y = 6.0 mm (fits 5.5 mm AF M3 locknut snugly so it won't spin while tightening!)
            nut_slot_y = 6.0
            nut_slot_x_len = P.TOWER_W * 0.85  # Deep enough to center nut on bolt axis + exit outside
            nut_slot_cx = sx * (P.TOWER_HOLE_X + 1.2)
            with Locations((nut_slot_cx, P.TOWER_Y_CENTER, P.TOWER_NUT_SLOT_TOP_Z - P.TOWER_NUT_SLOT_H)):
                Box(
                    nut_slot_x_len,
                    nut_slot_y,
                    P.TOWER_NUT_SLOT_H,
                    align=(Align.CENTER, Align.CENTER, Align.MIN),
                    mode=Mode.SUBTRACT,
                )

        # 5. Limit Switch Vertical Mounting Ear (+X/+Y side, zero overhangs)
        # Vertical fin at X = [28.5, 32.0], Y = [14.0, 26.5], Z = [5.0, 48.0]
        ear_y0 = P.SW_BODY_Y_FRONT
        ear_y1 = P.SW_BODY_Y_FRONT + P.SW_BODY_H + 3.0  # 14.0 + 9.2 + 3.0 = 26.2 mm
        ear_l = ear_y1 - ear_y0  # 12.2 mm
        ear_cy = (ear_y0 + ear_y1) / 2.0
        ear_cx = P.SW_EAR_X_INNER + P.SW_EAR_THICK / 2.0  # 30.25 mm
        ear_top_z = P.SW_BODY_Z_CENTER + P.SW_BODY_L / 2.0 + 1.5  # 48.3 mm

        with Locations((ear_cx, ear_cy, P.BASE_GEARBOX_FLOOR_Z)):
            Box(
                P.SW_EAR_THICK,
                ear_l,
                ear_top_z - P.BASE_GEARBOX_FLOOR_Z,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
            )

        # Triangular stiffening gusset behind the limit switch ear (+Y side, completely clear of switch & arm)
        gusset_thick = P.SW_EAR_THICK
        gusset_y_base = ear_y1 + 18.0  # Extends 18 mm backward along baseplate
        with BuildSketch(Plane.YZ.offset(P.SW_EAR_X_INNER)):
            with BuildLine():
                Polyline(
                    (ear_y1, P.BASE_GEARBOX_FLOOR_Z),
                    (gusset_y_base, P.BASE_GEARBOX_FLOOR_Z),
                    (ear_y1, ear_top_z - 8.0),
                    close=True,
                )
            make_face()
        extrude(amount=gusset_thick)

        # Tie-in rib connecting the rear of the right hold-down tower (Y=14..16.5) to the switch ear (Y>=18.5)
        # Stays below Z = 28.8 mm (below Top Cap) and well behind the M3 nut slot (Y=5.5..11.5)
        bridge_x0 = P.TOWER_HOLE_X + P.TOWER_W / 2.0 - 2.0  # 25.25
        bridge_x1 = P.SW_EAR_X_INNER + 1.5                  # 30.0
        bridge_y0 = P.TOWER_Y_CENTER + P.TOWER_L / 2.0 - 2.5  # 14.0
        bridge_y1 = ear_y0 + 2.5                              # 21.0
        with Locations(((bridge_x0 + bridge_x1) / 2.0, (bridge_y0 + bridge_y1) / 2.0, P.BASE_GEARBOX_FLOOR_Z)):
            Box(
                bridge_x1 - bridge_x0,
                bridge_y1 - bridge_y0,
                P.TOWER_TOP_Z - P.BASE_GEARBOX_FLOOR_Z,
                align=(Align.CENTER, Align.CENTER, Align.MIN),
            )

        # Two horizontal M2 mounting holes through the limit switch ear (along X)
        # Hole centers: Y = SW_BODY_Y_FRONT + (SW_BODY_H - SW_HOLE_FROM_BASE)
        # Wait: SW_HOLE_FROM_BASE = 4.9 mm from terminal/back (+Y) side -> 4.3 mm from front (-Y) side!
        sw_hole_y = P.SW_BODY_Y_FRONT + (P.SW_BODY_H - P.SW_HOLE_FROM_BASE)  # 14.0 + 4.3 = 18.3 mm
        for sz in (-1, 1):
            hz = P.SW_BODY_Z_CENTER + sz * (P.SW_HOLE_C2C / 2.0)  # 36.8 +- 4.5 -> 32.3, 41.3 mm
            with Locations((ear_cx, sw_hole_y, hz)):
                Cylinder(
                    radius=(P.SW_HOLE_DIA + P.CLEARANCE_HOLE_M2) / 2.0,
                    height=P.SW_EAR_THICK + 4.0,
                    rotation=(0, 90, 0),
                    mode=Mode.SUBTRACT,
                )

        # 6. Zip-Tie Strain-Relief Anchor Posts (2x pairs of vertical through-slots on -X wing)
        # Located near rear-left of barrel where motor & limit switch wires route toward control box!
        # Using raised U-bridge loops would create tiny overhangs, OR clean paired through-slots
        # in a raised 6 mm pad (recessed channel underneath? No, keep bottom 100% flat -> use raised
        # side-entry tie-down bollards with 45 deg overhang or simple vertical through-holes on a
        # raised 5 mm boss? Wait: easiest zero-support cable tie anchor on a flat plate is a
        # pair of 2.5 x 5.0 mm slots flanking a 4 mm bridge raised 3 mm off Z=0 with a small
        # 2.5 mm bottom cable-tie pass-through channel! Since the channel is only 5 mm wide, it
        # doesn't hurt 3M tape adhesion AND keeps the bottom 98% flat!).
        for ty in (36.0, 50.0):
            # Two vertical slots at X = -34.0 and X = -27.0 (5.0 mm along Y x 2.5 mm along X)
            for tx in (-35.0, -27.0):
                with Locations((tx, ty, -0.5)):
                    Box(2.5, 5.5, P.BASE_GEARBOX_FLOOR_Z + 1.5, align=(Align.CENTER, Align.CENTER, Align.MIN), mode=Mode.SUBTRACT)
            # Shallow 2.0 mm bottom groove connecting each slot pair so the 1.2 mm zip-tie sits flush inside!
            with Locations((-31.0, ty, -0.1)):
                Box(10.5, 5.5, 2.1, align=(Align.CENTER, Align.CENTER, Align.MIN), mode=Mode.SUBTRACT)

        # 7. Weight-reduction shallow pocket on front-left wing (saves ~2-3 g while keeping full tape area)
        with Locations((-33.0, -6.0, 2.5)):
            Box(14.0, 16.0, P.BASE_GEARBOX_FLOOR_Z - 2.5 + 1.0, align=(Align.CENTER, Align.CENTER, Align.MIN), mode=Mode.SUBTRACT)

    return part.part


if __name__ == "__main__":
    p = build_part1a()
    print("Part 1A volume (cm^3):", round(p.volume / 1000.0, 2))
    print("Part 1A bbox:", p.bounding_box())
