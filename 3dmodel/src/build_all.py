"""
Master Build, Verification, Export & Rendering Script for FoodWarden Node D0 CAD.

Outputs:
  3dmodel/output/*.stl, *.step, *.3mf   -> Print-ready individual parts (flat on Z=0)
  3dmodel/output/d0_*_assembly.glb      -> Colored interactive 3D assemblies for 3dviewer.net
  3dmodel/renders/*.png                 -> Multi-angle verification renders & sweep clearance chart
"""

import math
import os
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import numpy as np
import trimesh

from build123d import (
    Color,
    Compound,
    Location,
    export_gltf,
    export_step,
    export_stl,
    Mesher,
)

import params as P
from part1a_motor_baseplate import build_part1a
from part1b_gearbox_top_cap import build_part1b
from part2_lever_arm import build_part2
from part3_ir_sensor_stand import build_part3
from hardware_ghosts import (
    build_ghost_drop_bolt_and_wheel,
    build_ghost_ir_pcb,
    build_ghost_limit_switch,
    build_ghost_magnet,
    build_ghost_motor,
)

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "output"
RENDER_DIR = ROOT / "renders"
OUT_DIR.mkdir(parents=True, exist_ok=True)
RENDER_DIR.mkdir(parents=True, exist_ok=True)


def export_part(part, name: str, material: str):
    """Export STL, STEP, and 3MF, then run trimesh manifold & mass checks."""
    stl_path = OUT_DIR / f"{name}.stl"
    step_path = OUT_DIR / f"{name}.step"
    threemf_path = OUT_DIR / f"{name}.3mf"

    export_stl(part, str(stl_path), tolerance=0.01, angular_tolerance=0.05)
    export_step(part, str(step_path))

    mesher = Mesher()
    mesher.add_shape(part)
    mesher.write(str(threemf_path))

    mesh = trimesh.load(str(stl_path), force="mesh")
    bbox = mesh.bounds
    dims = bbox[1] - bbox[0]
    vol_cm3 = mesh.volume / 1000.0

    # Estimate printed weight: solid walls + gyroid infill typically yields ~55-70% effective fill
    # on thin functional parts (higher for 5-wall arm ~78%, ~62% for 3-4 wall brackets)
    density = P.DENSITY_ABS if material == "ABS" else P.DENSITY_PETG
    fill_factor = 0.78 if "lever_arm" in name else 0.65
    solid_g = vol_cm3 * density
    est_print_g = solid_g * fill_factor

    print(
        f"  [{name:26s}] watertight={mesh.is_watertight!s:5s} | "
        f"Z_min={bbox[0][2]:+.2f} | size={dims[0]:.1f}x{dims[1]:.1f}x{dims[2]:.1f} mm | "
        f"vol={vol_cm3:5.2f} cm3 | est={est_print_g:5.1f} g ({material}, solid {solid_g:.1f} g)"
    )
    assert mesh.is_watertight, f"ERROR: {name} STL is not watertight!"
    assert abs(bbox[0][2]) < 0.05, f"ERROR: {name} bottom does not sit flat on Z=0 (Z_min={bbox[0][2]})!"
    return mesh, est_print_g


def check_collision(shape_a, shape_b, label: str, max_allowed_mm3: float = 0.05):
    """Exact OpenCASCADE B-Rep boolean intersection volume check."""
    common = shape_a & shape_b
    vol = common.volume if common is not None else 0.0
    status = "PASS" if vol <= max_allowed_mm3 else "COLLISION!"
    print(f"  [Collision Check] {label:42s}: {vol:7.3f} mm^3 -> {status}")
    return vol


def plot_mesh_on_ax(ax, mesh: trimesh.Trimesh, color: str, alpha: float = 1.0, edge_alpha: float = 0.08):
    """Shade a trimesh cleanly on a matplotlib 3D axis using Lambertian face shading."""
    verts = mesh.vertices[mesh.faces]
    normals = mesh.face_normals
    # Directional key light + fill light
    light1 = np.array([0.45, -0.55, 0.70])
    light1 /= np.linalg.norm(light1)
    light2 = np.array([-0.6, 0.4, 0.5])
    light2 /= np.linalg.norm(light2)
    intensity = np.clip(0.32 + 0.50 * np.maximum(0, normals @ light1) + 0.22 * np.maximum(0, normals @ light2), 0.15, 1.0)

    base_rgb = np.array(matplotlib.colors.to_rgb(color))
    face_colors = np.zeros((len(normals), 4))
    face_colors[:, :3] = np.clip(intensity[:, None] * base_rgb[None, :], 0, 1)
    face_colors[:, 3] = alpha

    poly = Poly3DCollection(verts, facecolors=face_colors, linewidths=0.12 if edge_alpha > 0 else 0, edgecolors=(0, 0, 0, edge_alpha))
    ax.add_collection3d(poly)


def set_equal_3d_limits(ax, bounds_list, pad: float = 0.08):
    mins = np.min([b[0] for b in bounds_list], axis=0)
    maxs = np.max([b[1] for b in bounds_list], axis=0)
    center = (mins + maxs) / 2.0
    half = np.max(maxs - mins) / 2.0 * (1.0 + pad)
    ax.set_xlim(center[0] - half, center[0] + half)
    ax.set_ylim(center[1] - half, center[1] + half)
    ax.set_zlim(center[2] - half, center[2] + half)
    ax.set_box_aspect([1, 1, 1])


def render_single_part(mesh: trimesh.Trimesh, title: str, color: str, out_path: Path):
    """Render 4-panel verification sheet: Isometric, Top (XY), Front (-Y), Side (+X)."""
    fig = plt.figure(figsize=(14, 10), dpi=140, facecolor="#f7f8fa")
    fig.suptitle(title, fontsize=14, fontweight="bold", y=0.97)
    views = [
        ("Isometric (Print Orientation)", 28, -55),
        ("Top View (XY)", 90, -90),
        ("Front View (looking +Y)", 0, -90),
        ("Right Side View (looking -X)", 0, 0),
    ]
    for idx, (vtitle, elev, azim) in enumerate(views, start=1):
        ax = fig.add_subplot(2, 2, idx, projection="3d", facecolor="#f7f8fa")
        plot_mesh_on_ax(ax, mesh, color=color, alpha=1.0, edge_alpha=0.05)
        set_equal_3d_limits(ax, [mesh.bounds])
        ax.view_init(elev=elev, azim=azim)
        ax.set_title(vtitle, fontsize=11, pad=6)
        ax.set_xlabel("X (mm)", fontsize=8)
        ax.set_ylabel("Y (mm)", fontsize=8)
        ax.set_zlabel("Z (mm)", fontsize=8)
        ax.tick_params(labelsize=7)
    plt.tight_layout(rect=[0, 0, 1, 0.94])
    plt.savefig(out_path, dpi=140)
    plt.close(fig)


def shape_to_trimesh(shape) -> trimesh.Trimesh:
    tmp = RENDER_DIR / "_tmp.stl"
    export_stl(shape, str(tmp), tolerance=0.03, angular_tolerance=0.1)
    m = trimesh.load(str(tmp), force="mesh")
    tmp.unlink(missing_ok=True)
    return m


def render_assembly(items, title: str, out_path: Path, views=None):
    """Render multi-part colored assembly (items = list of (trimesh, color, alpha, label))."""
    if views is None:
        views = [
            ("Isometric Front-Right", 26, -50),
            ("Isometric Rear-Left", 28, 130),
            ("Top View (XY)", 90, -90),
            ("Front Elevation (Z Stack-Up)", 4, -90),
        ]
    fig = plt.figure(figsize=(15, 11), dpi=140, facecolor="#f7f8fa")
    fig.suptitle(title, fontsize=14, fontweight="bold", y=0.97)
    all_bounds = [m.bounds for m, _, _, _ in items]

    for idx, (vtitle, elev, azim) in enumerate(views, start=1):
        ax = fig.add_subplot(2, 2, idx, projection="3d", facecolor="#f7f8fa")
        for m, col, alpha, _ in items:
            plot_mesh_on_ax(ax, m, color=col, alpha=alpha, edge_alpha=0.04)
        set_equal_3d_limits(ax, all_bounds, pad=0.05)
        ax.view_init(elev=elev, azim=azim)
        ax.set_title(vtitle, fontsize=11, pad=6)
        ax.set_xlabel("X (mm)", fontsize=8)
        ax.set_ylabel("Y (mm)", fontsize=8)
        ax.set_zlabel("Z (mm)", fontsize=8)
        ax.tick_params(labelsize=7)

    # Legend strip at bottom
    legend_handles = [patches.Patch(color=col, alpha=alpha, label=lbl) for _, col, alpha, lbl in items]
    fig.legend(handles=legend_handles, loc="lower center", ncol=min(4, len(items)), frameon=True, fontsize=9)
    plt.tight_layout(rect=[0, 0.05, 1, 0.94])
    plt.savefig(out_path, dpi=140)
    plt.close(fig)


def render_topdown_sweep_diagram(out_path: Path):
    """Annotated 2D engineering layout showing hinge cover, motor, limit switch, arm sweep & tall cabinet!"""
    fig, ax = plt.subplots(figsize=(12, 9), dpi=150, facecolor="white")
    ax.set_aspect("equal")

    # Fridge right edge at X = BASE_X_RIGHT + 3.0 = +41.0 mm
    fridge_right_x = P.BASE_X_RIGHT + 3.0            # +41.0 mm
    hinge_y_front = P.BASE_Y_FRONT - 3.5             # -21.5 mm
    hinge_y_back = hinge_y_front + P.HINGE_COVER_D   # +63.5 mm
    hinge_x_left = fridge_right_x - P.HINGE_COVER_W  # -69.0 mm

    # 1. Grey Hinge Cover (110 x 85 mm)
    ax.add_patch(patches.Rectangle(
        (hinge_x_left, hinge_y_front), P.HINGE_COVER_W, P.HINGE_COVER_D,
        facecolor="#d5d8dc", edgecolor="#566573", linewidth=1.8, label="Grey Hinge Cover (110 x 85 mm)"
    ))
    # Approximate recessed screw hole near front-left of hinge cover
    ax.add_patch(patches.Circle((hinge_x_left + 16, hinge_y_front + 16), 7.5, facecolor="#5d6d7e", alpha=0.6))
    ax.text(hinge_x_left + 16, hinge_y_front + 28, "Recessed\nscrew", fontsize=7.5, ha="center", color="#2c3e50")

    # 2. Tall Side Cabinet (32 mm right of fridge, extending 20 mm forward of hinge cover back edge)
    cab_x0 = fridge_right_x + P.CABINET_GAP_X        # +73.0 mm
    cab_y0 = hinge_y_back - P.CABINET_OVERLAP_Y      # +43.5 mm
    ax.add_patch(patches.Rectangle(
        (cab_x0, cab_y0), 150.0, 120.0,
        facecolor="#fadbd8", edgecolor="#c0392b", linewidth=2.0, hatch="///",
        label="Tall Side Cabinet (NO-GO ZONE!)"
    ))
    ax.text(cab_x0 + 75, cab_y0 + 35, "TALL SIDE CABINET\n(Higher than fridge!)\nGap ~32 mm, Overlap ~20 mm",
            ha="center", va="center", fontsize=9.5, fontweight="bold", color="#922b21",
            bbox=dict(boxstyle="round,pad=0.3", facecolor="white", alpha=0.9))

    # 3. Part 1A Baseplate (82 x 78 mm)
    ax.add_patch(patches.FancyBboxPatch(
        (P.BASE_X_LEFT, P.BASE_Y_FRONT),
        P.BASE_X_RIGHT - P.BASE_X_LEFT, P.BASE_Y_BACK - P.BASE_Y_FRONT,
        boxstyle="round,pad=0,rounding_size=4",
        facecolor="#aed6f1", edgecolor="#1f618d", linewidth=1.8, alpha=0.85,
        label="Part 1A Baseplate (82 x 78 mm)"
    ))

    # 4. Motor Gearbox + Barrel
    ax.add_patch(patches.Rectangle(
        (-P.GEARBOX_W / 2, P.GEARBOX_Y_FRONT), P.GEARBOX_W, P.GEARBOX_L,
        facecolor="#85929e", edgecolor="#2c3e50", linewidth=1.4, label="JGY-370 Motor"
    ))
    ax.add_patch(patches.Rectangle(
        (-P.BARREL_DIA / 2, P.GEARBOX_Y_BACK), P.BARREL_DIA, P.BARREL_L,
        facecolor="#aeb6bf", edgecolor="#2c3e50", linewidth=1.2
    ))
    ax.add_patch(patches.Circle((0, 0), 3.0, facecolor="#1b2631", zorder=10))

    # 5. Limit Switch on +X/+Y side
    sw_x0 = P.SW_EAR_X_INNER + P.SW_EAR_THICK
    ax.add_patch(patches.Rectangle(
        (sw_x0, P.SW_BODY_Y_FRONT), P.SW_BODY_W, P.SW_BODY_H,
        facecolor="#2c3e50", edgecolor="black", linewidth=1.2, label="KW11-3Z Limit Switch"
    ))
    ax.add_patch(patches.Circle(
        (sw_x0 + P.SW_BODY_W / 2, P.SW_BODY_Y_FRONT - P.SW_ROLLER_PROTRUSION + P.SW_ROLLER_DIA / 2),
        P.SW_ROLLER_DIA / 2, facecolor="#e74c3c", edgecolor="black", zorder=12
    ))

    # 6. Lever Arm Sweep Arc (~25 deg Closed Door Contact -> 90 deg -> ~183 deg Parked [+X])
    # In math angles: 0 deg = 180 deg math (-X); 25 deg = 205 deg math; 90 deg = 270 deg (-Y); 183 deg = 363 deg (+X)
    sweep_thetas = np.linspace(math.radians(205), math.radians(363), 120)
    ax.plot(P.ARM_LENGTH_C2C * np.cos(sweep_thetas), P.ARM_LENGTH_C2C * np.sin(sweep_thetas),
            linestyle="--", color="#27ae60", linewidth=1.6, label="160 mm Arm Sweep Arc (CW Close / CCW Retract)")

    # Draw arm at Closed Door Contact (~25 deg), Mid-Push (90 deg = -Y), and Parked (~183 deg)
    for door_deg, col, lbl, ls in [
        (25, "#2980b9", "Arm @ ~25° (Closed Door Contact)", "-"),
        (90, "#7f8c8d", "Arm @ 90° (Mid-Sweep)", ":"),
        (183, "#27ae60", "Arm @ ~183° (PARKED / Home Switch)", "-"),
    ]:
        math_rad = math.radians(180 + door_deg)
        tx = P.ARM_LENGTH_C2C * math.cos(math_rad)
        ty = P.ARM_LENGTH_C2C * math.sin(math_rad)
        ax.plot([0, tx], [0, ty], color=col, linewidth=5.5, linestyle=ls, solid_capstyle="round", alpha=0.85, label=lbl)
        ax.add_patch(patches.Circle((tx, ty), P.WHEEL_OD / 2.0, facecolor=col, edgecolor="black", alpha=0.45, linewidth=1.2))

    # Clearance dimension annotation between Parked Roller Wheel and Tall Cabinet!
    park_rad = math.radians(180 + 182)
    px = P.ARM_LENGTH_C2C * math.cos(park_rad)
    py = P.ARM_LENGTH_C2C * math.sin(park_rad)
    roller_top_y = py + P.WHEEL_OD / 2.0
    gap_to_cab = cab_y0 - roller_top_y
    ax.annotate(
        "", xy=(px, cab_y0), xytext=(px, roller_top_y),
        arrowprops=dict(arrowstyle="<->", color="#c0392b", lw=2.0)
    )
    ax.text(
        px - 5, (cab_y0 + roller_top_y) / 2,
        f"Cabinet Clearance:\n~{gap_to_cab:.1f} mm\n(Safe even w/ ±5 mm!)",
        ha="right", va="center", fontsize=9, fontweight="bold", color="#c0392b",
        bbox=dict(boxstyle="round,pad=0.25", facecolor="#fff5f5", edgecolor="#c0392b")
    )

    # Approximate Closed Fridge Door band in front (-Y)
    ax.add_patch(patches.Rectangle(
        (-210, hinge_y_front - 55), 255, 30,
        facecolor="#e5e8e8", edgecolor="#7f8c8d", linewidth=1.2, linestyle="--", alpha=0.55
    ))
    ax.text(-110, hinge_y_front - 40, "Closed Fridge Door (approx position, pushes front glass face)",
            ha="center", va="center", fontsize=8.5, color="#566573")

    ax.set_xlim(-200, 215)
    ax.set_ylim(-185, 130)
    ax.set_xlabel("X — Left (-) to Right (+) [mm]   |   Standing in front of fridge looking DOWN", fontsize=10)
    ax.set_ylabel("Y — Front / Door (-) to Back / Wall (+) [mm]", fontsize=10)
    ax.set_title("Node D0 Top-Down Layout, Arm Sweep & Tall Side Cabinet Clearance Check", fontsize=13, fontweight="bold")
    ax.grid(True, linestyle=":", alpha=0.5)
    ax.legend(loc="lower left", fontsize=8.2, framealpha=0.95)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150)
    plt.close(fig)


def main():
    print("=" * 80)
    print("Building FoodWarden Node D0 Parametric CAD Models (v1)")
    print("=" * 80)

    p1a = build_part1a()
    p1b = build_part1b()
    p2 = build_part2()
    p3 = build_part3()

    print("\n--- 1. Export & Mesh Verification (Flat on Z=0, Watertight) ---")
    m1a, g1a = export_part(p1a, "part1a_motor_baseplate", "PETG")
    m1b, g1b = export_part(p1b, "part1b_gearbox_top_cap", "PETG")
    m2, g2_abs = export_part(p2, "part2_lever_arm", "ABS")
    m3, g3 = export_part(p3, "part3_ir_sensor_stand", "PETG")

    g2_petg = g2_abs * (P.DENSITY_PETG / P.DENSITY_ABS)
    print(f"\n  Estimated Weights Summary:")
    print(f"    PETG parts (1A + 1B + 3):  {g1a + g1b + g3:.1f} g total")
    print(f"    Lever Arm (Part 2):        {g2_abs:.1f} g in ABS (~{g2_abs * P.COST_PER_GRAM_UNI_ABS_THB:.0f} THB at Uni Shop)  |  {g2_petg:.1f} g in PETG")

    # Assemble parts in world coordinates for collision checking & assembly rendering
    p1b_asm = p1b.moved(Location((0, 0, P.M3_BOSS_TOP_Z)))
    p2_asm_parked = p2.moved(Location((0, 0, P.ARM_BOTTOM_Z)))  # +X = 180 deg parked!
    g_motor = build_ghost_motor()
    g_switch = build_ghost_limit_switch()
    g_bolt = build_ghost_drop_bolt_and_wheel(arm_angle_deg=0.0)
    g_ir_pcb = build_ghost_ir_pcb()
    g_magnet = build_ghost_magnet()

    print("\n--- 2. Automated B-Rep Collision Checks (Printed Parts vs Ghost Hardware) ---")
    c1 = check_collision(p1a, g_motor, "Part 1A (Baseplate) vs JGY-370 Motor")
    c2 = check_collision(p1b_asm, g_motor, "Part 1B (Top Cap) vs JGY-370 Motor")
    c3 = check_collision(p1a, p1b_asm, "Part 1A (Baseplate) vs Part 1B (Top Cap)")
    c4 = check_collision(p2_asm_parked, p1b_asm, "Part 2 (Lever Arm) vs Part 1B (Top Cap)")
    c5 = check_collision(p2_asm_parked, g_motor, "Part 2 (Lever Arm) vs JGY-370 Motor")
    c6 = check_collision(p1a, g_switch, "Part 1A (Baseplate) vs Limit Switch")
    c7 = check_collision(p2_asm_parked, g_switch, "Part 2 (Arm @ 180 deg) vs Switch Roller")
    c8 = check_collision(p3, g_ir_pcb, "Part 3 (IR Stand) vs TCRT5000 PCB")
    c9 = check_collision(p3, g_magnet, "Part 3 (IR Stand) vs 15x4.4 Magnet")

    assert max(c1, c2, c3, c4, c5, c6, c7, c8, c9) <= 0.05, "Detected solid-body collision!"

    print("\n--- 3. Exporting Colored 3D Assemblies (GLB for 3dviewer.net + STEP) ---")
    import copy
    def colored(shape, rgba, label):
        s = copy.copy(shape)
        s.color = Color(*rgba)
        s.label = label
        return s

    motor_asm = Compound(label="D0_Motor_Assembly", children=[
        colored(p1a, (0.20, 0.55, 0.85, 1.0), "Part1A_Baseplate_PETG"),
        colored(p1b_asm, (0.15, 0.72, 0.65, 1.0), "Part1B_TopCap_PETG"),
        colored(p2_asm_parked, (0.92, 0.45, 0.15, 1.0), "Part2_LeverArm_ABS"),
        colored(g_motor, (0.55, 0.58, 0.62, 1.0), "Ghost_JGY370_Motor"),
        colored(g_switch, (0.18, 0.18, 0.20, 1.0), "Ghost_LimitSwitch"),
        colored(g_bolt, (0.78, 0.80, 0.82, 1.0), "Ghost_M5x100_And_Wheel"),
    ])
    export_gltf(motor_asm, str(OUT_DIR / "d0_motor_assembly.glb"), binary=True)
    export_step(motor_asm, str(OUT_DIR / "d0_motor_assembly.step"))

    ir_asm = Compound(label="D0_IR_Assembly", children=[
        colored(p3, (0.20, 0.55, 0.85, 1.0), "Part3_IR_Stand_PETG"),
        colored(g_ir_pcb, (0.12, 0.15, 0.18, 1.0), "Ghost_TCRT5000_PCB"),
        colored(g_magnet, (0.75, 0.78, 0.82, 1.0), "Ghost_Magnet_15x4.4"),
    ])
    export_gltf(ir_asm, str(OUT_DIR / "d0_ir_assembly.glb"), binary=True)
    export_step(ir_asm, str(OUT_DIR / "d0_ir_assembly.step"))

    print("\n--- 4. Generating Multi-Angle Verification Renders ---")
    render_single_part(m1a, f"Part 1A: Motor Baseplate + Cradle + Switch Mount (PETG, ~{g1a:.1f} g)", "#3498db", RENDER_DIR / "part1a_overview.png")
    render_single_part(m1b, f"Part 1B: Gearbox Top Hold-Down Cap (PETG, ~{g1b:.1f} g)", "#1abc9c", RENDER_DIR / "part1b_overview.png")
    render_single_part(m2, f"Part 2: 160 mm Flat Lever Arm (ABS ~{g2_abs:.1f} g / PETG ~{g2_petg:.1f} g)", "#e67e22", RENDER_DIR / "part2_overview.png")
    render_single_part(m3, f"Part 3: Magnetic TCRT5000 IR Stand (PETG, ~{g3:.1f} g)", "#9b59b6", RENDER_DIR / "part3_overview.png")

    render_assembly(
        [
            (shape_to_trimesh(p1a), "#3498db", 1.0, "Part 1A: Baseplate (PETG)"),
            (shape_to_trimesh(p1b_asm), "#1abc9c", 1.0, "Part 1B: Top Cap (PETG)"),
            (shape_to_trimesh(p2_asm_parked), "#e67e22", 1.0, "Part 2: Lever Arm @ 180° Parked"),
            (shape_to_trimesh(g_motor), "#7f8c8d", 0.9, "Ghost: JGY-370 Motor"),
            (shape_to_trimesh(g_switch), "#c0392b", 1.0, "Ghost: Limit Switch"),
            (shape_to_trimesh(g_bolt), "#95a5a6", 0.9, "Ghost: M5x100 Bolt + 625ZZ Wheel"),
        ],
        "Node D0 Motor + Switch + Lever Arm Assembly (Parked @ 180°)",
        RENDER_DIR / "assembly_motor_views.png",
    )

    render_assembly(
        [
            (shape_to_trimesh(p3), "#9b59b6", 1.0, "Part 3: IR Stand (PETG)"),
            (shape_to_trimesh(g_ir_pcb), "#2c3e50", 0.95, "Ghost: TCRT5000 PCB (41.8x10.5 mm)"),
            (shape_to_trimesh(g_magnet), "#bdc3c7", 1.0, "Ghost: Neodymium Magnet (Ø15x4.4 mm)"),
        ],
        "Node D0 Standalone Magnetic IR Sensor Stand Assembly",
        RENDER_DIR / "assembly_ir_views.png",
        views=[
            ("Isometric Front (Sensor Side)", 24, -125),
            ("Isometric Rear (Magnet Pocket Side)", 32, 48),
            ("Side Profile (2.0 mm Pin Clearance & Z=14 mm)", 0, 0),
            ("Top View (XY)", 90, -90),
        ],
    )

    render_topdown_sweep_diagram(RENDER_DIR / "topdown_sweep_clearance.png")
    print("\nALL BUILDS, CHECKS & RENDERS COMPLETED SUCCESSFULLY!")


if __name__ == "__main__":
    main()
