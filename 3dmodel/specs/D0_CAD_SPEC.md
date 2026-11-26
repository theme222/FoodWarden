# Node D0 (Door Actuator) — Mechanical & 3D Printing Specification

## 1. Overview & System Architecture
Node `D0` is the automated fridge door-closing subsystem. It is split into **three physically separate components** for clean mounting, demo-day transport, and accurate sensing:
1. **Motor + Limit Switch + Lever Arm Assembly (3D-printed ABS):** Mounts via mounting tape onto the fridge's grey plastic hinge cover.
2. **Standalone Close-Range IR Sensor Stand (3D-printed ABS):** Mounts separately on the flat steel fridge top, away from the hinge axis, so small door gaps at the handle end are reliably detected.
3. **Main Control Box (Off-the-shelf clear-lid ABS box, ~120 × 90 × 50 mm):** Houses KidBright32, TB6612FNG motor driver, INA219 current sensor, and buck converter (connects to the motor/switch and IR sensor via detachable JST-XH plugs).

---

## 2. 3D Printing Constraints (University Print Shop)
- **Printers:** Creality K1 and Creality K2 Plus (enclosed, actively heated chamber).
- **Max Build Volume:** `300 × 300 × 300 mm`.
- **Material:** ABS only.
- **Pricing:** `THB 10 / gram` (calculated on **model + Snug support weight combined**).
- **Mandatory Design Rules:**
  - **Zero supports:** Every part MUST be designed to print 100% flat on the build plate with no overhangs requiring supports.
  - **Anti-warping:** Round all sharp 90° outer bottom corners (`R 3–5 mm`) and avoid massive solid blocks; use ribs/pockets to keep weight (and cost) low.
  - **Explicit Slicer Overrides (do NOT use the shop's default 10 walls):**
    - *Lever Arm:* Print **flat** on broad face, **5 walls**, **35–40% gyroid infill**, `0.2 mm` layer height, no supports.
    - *Motor Baseplate, Top Cap, IR Stand:* Print **flat** on bottom face, **3–4 walls**, **20–25% gyroid infill**, `0.2 mm` layer height, no supports.
- **ABS Dimensional Clearances (Shop baseline: `0.5 mm`):**
  - Screw through-holes: `+0.5 mm` (`M2 → 2.5 mm`, `M3 → 3.5 mm`, `M5 → 5.5 mm`).
  - Gearbox pocket: `+0.5 mm` clearance on width and length.
  - Split D-hub bore: `+0.3 mm` (`6.3 mm` OD / `5.8 mm` flat) paired with a `2.0 mm` flex slit so it slides on easily and clamps tight with zero play.

---

## 3. Physical Environment & Fridge Geometry (mm)
- **Fridge Door (Hitachi glass-front):** `1730 H × 515 W × 25 T mm`.
- **Closing Motion (top-down view):**
  - **Close:** Clockwise (CW).
  - **Retract / Home:** Counter-clockwise (CCW). The arm must **never** sweep back over the fridge roof.
- **Grey Plastic Hinge Cover (Motor Base Mounting Surface):**
  - Total area: `~85 × 110 mm` (includes a recessed screw hole near the bottom-left corner and `~2.5 mm` rounded outer bevels).
  - **Safe flat baseplate footprint:** Keep max baseplate within `~78 × 100 mm` so it sits dead-flat without rocking on the rounded edges. Bottom face must be 100% flat for `19 mm` 3M mounting tape / Command strips.
- **Vertical Clearances:**
  - Flat steel fridge top to top edge of closed door lip: **`25 mm`** (for IR sensor).
  - Top of grey hinge cover down to desired door-pushing contact point (`X`): **`~40 mm`**.

---

## 4. Measured Hardware Components (Tolerance ±0.2 mm unless noted)

### 4.1 JGY-370 Worm Gear Motor
- **Total length (excluding rear wires):** `76.8 mm`
- **Gearbox rectangle:** `46.0 mm (L) × 32.0 mm (W) × 21.8 mm (H)`
- **Cylindrical motor barrel:** `24.0 mm` diameter (`~30.8 mm` length).
  - **CRITICAL OVERHANG:** The `24.0 mm` barrel overhangs downward by **`~2.2 mm`** below the `21.8 mm` gearbox bottom. The motor will NOT sit flush on a flat plate unless the baseplate has a **`3.0 mm` raised cradle** under the gearbox (or a `3.0 mm` cutout under the barrel).
- **Top Gearbox Face (Shaft Side):**
  - 4× threaded `M3` mounting holes on raised circular bosses: **`18.0 mm (W) × 33.0 mm (L)`** center-to-center.
  - Center oblong raised ridge between the mounting holes (top cap should clear or rest only on the 4 M3 bosses).
  - 6 mm D-Shaft:
    - Diameter: **`6.0 mm`**; across flat: **`5.5 mm`**.
    - Exposed shaft height: **`~13.5 mm`** (eyeballed).
    - Center tapped hole in shaft tip: **`M3`**.
    - Shaft position: Centered across `32 mm` width (`~16 mm`), approx. **`14 mm`** from the far/front gearbox edge (rough measurement—top cap shaft cutout must be oversized to `~18 mm` diameter or an open U-slot to absorb ±1–2 mm variance).
- **Wires:** Bare soldered red/black leads exit the rear of the cylinder; require zip-tie strain-relief slots on the baseplate.

### 4.2 Micro Limit Switch (KW11-3Z / KW12-3 style, roller lever)
- **Body dimensions (excluding lever/pins):** `20.0 mm (L) × 9.2 mm (H) × 6.1 mm (W/thickness)`
- **Mounting holes:** 2× smooth unthreaded `2.0 mm` through-holes, **`9.0 mm`** center-to-center (bolts through the `6.1 mm` thickness).
- **Wiring:** Soldered wires exit **straight downward** from the bottom metal terminals—the ABS mount must include a bottom clearance slot/channel so wires are not crushed.

### 4.3 Close-Range IR Sensor (TCRT5000 on slim KY-033 module)
- **Layout:** Slim rectangular PCB with front-facing TCRT5000 sensor, blue `103` trimpot, `D1` LED, and 3-pin header (`GND/OUT/VCC`) exiting straight out one short end.
- **Mounting holes:** 2× plated holes flanking the black sensor block.
  - Hole diameter: **`~3.2 mm`** (approx.).
  - Edge-to-edge gap between holes: `9.0 mm` → **Center-to-center spacing: `12.2 mm`**.

---

## 5. Procured Fasteners & Mechanical Hardware (Locked In)
All screws are **304 Stainless Steel Pan Head Phillips (`P+`)** unless noted:
- **`M3 × 10 mm` pan-head screws (10 pcs):**
  - 4× bolt the ABS top hold-down cap into the JGY-370 gearbox threads. *(Cap thickness must be `5–6 mm` so screws only engage `4–5 mm` into the gearbox and never bottom out on internal gears.)*
  - 1× threads into the `M3` hole at the tip of the 6 mm shaft (with an `M3×9×0.8` washer) to prevent vertical slip.
  - 2× mount the TCRT5000 IR PCB onto the standalone L-stand.
- **`M3 × 20 mm` pan-head screws (10 pcs):** 1× runs horizontally through the split pinch-clamp ears of the ABS D-hub.
- **`M3 × 9 × 0.8 mm` flat washers (10 pcs):** Under the shaft-tip screw, D-hub clamp bolt/nut, and as emergency spacers if `M3×10` is slightly long.
- **`M3` nylon locknuts (5 pcs):** 1× for the D-hub clamp bolt; 2× for the IR sensor stand.
- **`M2 × 16 mm` pan-head screws (10 pcs) + `M2` nylon locknuts (4 pcs):** 2× bolt the `6.1 mm` limit switch through a `~3.5 mm` ABS mounting wall (`6.1 + 3.5 + 1.6 = 11.2 mm` min).
- **`M5 × 100 mm` fully-threaded pan-head bolt (1 pc):** Acts as the vertical steel drop axle at the end of the flat ABS arm (`~42.5 mm` motor/base/shaft height + `~40 mm` drop `X` + `~15 mm` wheel/nut stack ≈ `97.5 mm`).
- **`M5` nylon locknuts (5 pcs):** 1× clamps under the ABS arm tip; 2× lock the roller wheel at the exact vertical height on the bolt without crushing the bearing.
- **`M5 × 10 × 1 mm` flat washers (10 pcs):** Clamping washers on top and bottom of the ABS arm tip.
- **`M5 × 7 × 0.5 mm` flat washers (10 pcs):** Seated directly against the `625ZZ` bearing's `7.7 mm` inner steel race (stack 2 per side for `1.0 mm` clearance if needed) so nuts never rub the bearing shields.
- **POM 625ZZ Pulley Wheel (`PRINT3DPRO`, 1 pc):** `24 mm` OD × `5 mm` ID × `10.2 mm` H Delrin wheel with dual `625ZZ` bearings. Glides silently across the glass door without scratching or causing drag that could falsely trip the INA219 current sensor.
- **Mounting & Strain Relief:** `19 mm` 3M Scotch Extreme tape (or 3M Command strips) + `100 mm` cable ties.

---

## 6. 3D Printable Parts to Design (Zero-Support ABS)

### Part 1A: Motor Baseplate + Cradle + Limit Switch Mount
- Flat bottom (`~3.5–4.0 mm` thick, rounded outer corners, max `~78 × 100 mm`).
- Recessed pocket (`46.5 × 32.5 mm`) with a **`3.0 mm` raised floor under the gearbox** (and open cutout under the `24 mm` barrel) to eliminate the `2.2 mm` barrel overhang.
- Two zip-tie anchor slots behind the motor barrel for wire strain relief.
- Integrated vertical mounting ear on the **CCW side** of the shaft sweep for the limit switch:
  - `3.5 mm` wall thickness, 2× `2.5 mm` through-holes spaced `9.0 mm` c2c.
  - Bottom cutout/channel under the switch body for the downward-exiting soldered wires.
  - Positioned so the retracting arm (or a small hub striker tab) trips the roller lever cleanly *before* the arm crosses over the fridge roof.

### Part 1B: Gearbox Top Hold-Down Cap
- Flat plate (`5.0–6.0 mm` thick) sitting over the `46 × 32 mm` gearbox face.
- 4× `3.5 mm` through-holes matching the `18.0 × 33.0 mm` gearbox M3 pattern.
- Oversized `~18 mm` circular clearance cutout (or open U-slot) around the shaft (`C ≈ 14 mm`, centered on `32 mm` width) so it clears the shaft bearing boss and absorbs measurement variance.

### Part 2: 160 mm Flat Door-Pushing Lever Arm
- **100% flat print orientation** (no printed L-bend; vertical drop is handled by the `M5×100` steel bolt).
- **Length:** **`160.0 mm`** center-to-center from the 6 mm D-shaft to the M5 drop bolt.
- **Cross-section:** `~10–12 mm` thick at the hubs/bosses, stiffened along the beam (`~6–8 mm` thick or ribbed I-beam/channel profile) with filleted transitions to prevent layer splitting under torque.
- **Motor End (Split Pinch-Clamp D-Hub):**
  - Outer boss `~20–22 mm` diameter, `~12 mm` tall.
  - Inner D-bore: `6.3 mm` diameter / `5.8 mm` flat (`+0.3 mm` ABS clearance).
  - `2.0 mm` full-height flex slit on one side flanked by two clamping ears with a horizontal `3.5 mm` through-hole for the `M3 × 20 mm` pinch bolt + `M3` locknut (with flat faces for `M3×9×0.8` washers).
  - Top face retains the arm axially using the `M3 × 10 mm` screw + `M3×9×0.8` washer threading into the shaft's center `M3` hole.
- **Door End (M5 Drop Axle Boss):**
  - `~10–12 mm` tall, `~18–20 mm` OD cylindrical boss with a vertical `5.5 mm` through-hole so the `M5 × 100 mm` bolt stays rigid without tilting under side load.

### Part 3: Standalone TCRT5000 IR Sensor L-Stand
- Prints flat on its side with zero supports (`~4–6 g` estimated).
- Flat base (`~25 × 30 mm`) for mounting tape or a thin magnet on the flat steel fridge top.
- Vertical wall (`3.5 mm` thick) mounting the slim PCB **horizontally** so the 3-pin header exits cleanly to the side and the front sensor/trimpot/LED remain exposed.
- Sensor optical center positioned at **`13–15 mm`** above the fridge top (aims dead-center at the `25 mm` tall door lip).
- Forgiving hole pattern (`12.2 mm` c2c): one **`3.5 mm` round hole** + one **`3.5 × 5.0 mm` horizontal slot** for the spare `M3 × 10 mm` screws + `M3` locknuts.
- Include `~2 mm` raised standoff rings around the holes on the PCB-facing side so rear solder pins clear the flat ABS wall.
