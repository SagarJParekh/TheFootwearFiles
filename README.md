# Footwear Files – Phase 1: STL viewer, editor & landmarking

A browser app for viewing, cleaning up and landmarking 3D scans of the foot and lower
limb (STL, millimetres). Phase 1 of a larger pipeline. Later phases will add automatic
alignment, automated mesh modification, and insole and footwear design.

## Running it

Requires Node 20+.

```bash
npm install
npm run dev          # http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build into `dist/` |
| `npm test` | Unit tests (Vitest) for the mesh / IO / landmark logic |
| `npm run e2e` | Browser tests in headless Chromium via Playwright. `e2e/smoke.mjs` runs load → landmark → fill → cut → undo/redo → export. `e2e/formats.mjs` imports the same foot in every format and checks size, orientation and units |
| `npm run fixtures` | Regenerates the sample STLs in `public/samples/` and the per-format fixtures in `fixtures/formats/` (`-- --large` also writes a 1.3M-triangle sphere) |
| `npx tsx scripts/footwear-preview.ts <dir> [slide thong splitToe shoe]` | Writes the generated footwear for the synthetic foot as STL files (for checking designs outside the app) |
| `npx tsx scripts/scan-preview.ts <scan.obj/.stl> <dir> [turnDeg] [styles…]` | The same for a real scan lying on the floor (heel and metatarsal landmarks picked automatically from the sole) |

To try the app without a real scan, use the **Samples** menu:

| Sample | Good for testing |
| --- | --- |
| `foot-plantar.stl` | A plantar-surface scan: an open sheet with one big rim |
| `leg-open-top.stl` | A lower-limb scan with an open top and two small scanner holes |
| `foot-closed.stl` | A watertight foot, which uses the manifold-3d cut path |
| `sphere-with-holes.stl` | Three holes of different sizes |
| `cube-ascii.stl` | ASCII STL parsing |

## Features

**Load, view, transform**
- Model loading from the file picker or by drag-and-drop anywhere in the window. See [Supported file formats](#supported-file-formats) for the list.
  - Parsing, vertex welding, analysis and normals run in a Web Worker for most formats; the file buffer is transferred to the worker, not copied.
  - Everything is converted to millimetres, Z up. Units and up axis are read from the file where the format defines them, otherwise guessed from the model size, and can be corrected in **Scan setup**.
  - If the units a file states would make the model impossibly large (over 2.5 m), the size-based guess is used instead and Scan setup says why. This happens with glTF/GLB scans exported in millimetres, although glTF means metres.
- Camera:
  - Orbit, pan and zoom; fit to view (`F`).
  - Preset views: top, plantar, medial, lateral, front, back, iso. Medial and lateral follow the Left/Right choice.
- Transform:
  - Gizmo to move (`G`) and rotate (`R`). Rotation pivots about the model's bounding-box centre.
  - Numeric position and rotation (Euler XYZ, degrees), quick ±90° rotations, "Centre on floor", Reset.
- Model info: triangle and vertex count, bounding box (mm), and watertight status (open and non-manifold edge counts).
- Display toggles: wireframe, flat/smooth shading, grid, axes, labels. Back faces are drawn in red, so the inside of open scans is easy to see.

**Clip, cut, fill holes**
- **Clipping plane (non-destructive).**
  - Snap it to ±X/±Y/±Z through the model centre, flip it, move it with the offset slider, or drag and rotate it freely with a gizmo.
  - Landmark picking ignores the clipped-away surface.
- **Cut (destructive).**
  - Uses the clipping plane. You can keep the visible or the hidden side, and cap the cut or leave it open.
  - Hybrid engine:
    - **manifold-3d** (WASM, runs in the worker) for watertight meshes up to 1.5M triangles.
    - Above that size, or for open scans, a custom plane split plus planar cap is used. It handles nested sections (ring caps) and collinear points.
    - If manifold rejects a mesh, the custom split is used instead. For large watertight meshes, the split result is checked for watertightness, and manifold is tried if it isn't closed.
- **Holes.**
  - Every boundary loop is detected, drawn in its own colour and listed with its perimeter (mm) and edge count.
  - Hovering over a hole in the list highlights it.
  - Fill a single hole, or use "Fill all". The largest loop is excluded from "Fill all" automatically when it looks like the scan's open rim (at least 3× the perimeter of the next largest loop). You can also toggle each loop or set a perimeter threshold.
  - Patches follow the surrounding curvature (see Algorithms below). On a 50 mm-radius sphere with a ~50 mm hole, the mean error is 0.4 mm, versus 3.1 mm for a flat patch.
- **Undo/redo** for every edit (`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`), including moves, rotations, landmark placement and drags, cuts and fills.

**Anatomical landmarks**
- **Scan setup** (asked on load, and changeable later):
  - Scan type: *Plantar surface* or *Lower limb*.
  - Side: *Left* or *Right*.
  - On **OK** after loading, a foot lying on the floor with its toes pointing another way (−Y or ±X) is turned about Z so the toes point forward (+Y). The toes are found from the ankle, which is over the heel, or, on low plantar scans, from the wider forefoot. The status bar says so, and it can be changed with Quick rotate. Scans standing on end are left alone: rotate them by hand, then set the base plane.
- **Landmarks:** heel centre, 1st and 5th metatarsal heads, medial arch start, medial arch peak, medial arch end. Lower-limb scans also get the medial and lateral malleoli.
- **Placing and editing:**
  - Select a landmark in the side panel, then click the mesh. The point snaps to the surface using a BVH raycast, and selection moves on to the next missing landmark.
  - Drag a marker to slide it along the surface, or delete it.
  - The panel shows each landmark's status (placed / missing / *off surface*) and its world X/Y/Z.
- **Coordinates:** landmarks are stored in **mesh-local coordinates**, so they follow any move or rotation. After a cut or fill, any landmark more than 0.5 mm from the new surface is flagged *off surface*.
- **Measurements:**
  - Forefoot width (M1–M5).
  - Heel centre to M1, and heel centre to M5.
  - **Arch height:** the perpendicular distance from the arch peak to the *plantar plane* through the heel centre, M1 and M5.
  - Inter-malleolar distance.

**Export and save**
- **STL export:** binary STL. The *apply transform* toggle is on by default and writes the vertices in world coordinates; turn it off to keep the original scan frame.
- **Landmarks:** export as **JSON** or **CSV**, and import from JSON.
- **Project file:** save and open a whole session (mesh, transform, landmarks, scan info) as a `.tffproj` file.
- Files can also be opened by dropping `.stl`, `.tffproj` or landmark `.json` files onto the window.

## Base plane (heel centre · 1st MT head · 5th MT head)

As soon as the **heel centre**, **1st metatarsal head** and **5th metatarsal head** are all placed, the plane through those three points becomes the **base plane**:

- **Alignment:** the model is moved so the base plane is the floor (Z = 0), with the heel centre at the origin and heel → toes along +Y. The foot always ends up above the plane; the arch peak, or else the scan's centroid, decides which side is "up".
- **Lock:** the model's position and rotation are then **locked**. The Move/Rotate tools, the numeric position and rotation fields, quick-rotate, Centre on floor and Reset are **removed** from the Transform panel. The G/R shortcuts and changing units or up axis in Scan setup are disabled, and any other attempt to rotate is refused with a message. The camera can still orbit around the model.
- **Moving a point:** dragging or re-placing one of the three landmarks recalculates the plane from the new positions. The lock stays on.
- **Deleting a point:** deleting one of the three releases the lock, because the plane is no longer defined.
- **Display:** the plane is drawn as a green triangle through the three points (grey and dashed when not set). The Transform panel and the Insole designer show the lock status.
- **Releasing:** **Release base plane** unlocks the model on purpose.
- The lock can be undone like any other edit and is saved in project files.

## Insole designer (right sidebar → "Insole & footwear")

This follows the reference orthotic-design workflow step by step, built around how the insole will be **manufactured**. Every change can be undone.

The padding is added externally after printing. So **padding clearance** is a gap left between the foot and the printed insole, not material: the insole top is the foot surface minus the clearance, plus any features.

**1 · Align & set up**

| Control | What it does |
| --- | --- |
| Align the scan (base plane) | Set automatically from the heel centre, M1 and M5 (see [Base plane](#base-plane-heel-centre--1st-mt-head--5th-mt-head)); the model is then locked |
| **Toes aligned in the arrow direction** | Shows the green toe arrow (+Y); the base plane always points the toes along it |
| Which side is model | Left or right (set in Scan setup) |
| Landmarks | Heel centre, 1st and 5th metatarsal heads are required for the insole. For the arch adjustment, place the **medial arch start (AS)**, where the arch starts rising in front of the heel, and the **medial arch end (AE)**, where it meets the ground behind the 1st MT head. The arch peak (AR) is optional. |
| **Foot arch adjustment** | −15…+15 mm. Raises (+) or lowers (−) the medial arch **of the foot scan itself** (not the insole), so the insole then follows the corrected foot. The change is made **only between AS and AE**: zero at and beyond both points, largest at AR (or 45 % of the way from AS if AR isn't placed), and fading towards the lateral side. Needs the base plane and AS/AE. The value is cumulative, undoable and saved with the project. The sole is never pushed below the floor. |

**2 · Insole type** (chosen before designing, and can be changed later)

| Type | Printing | Result |
| --- | --- | --- |
| **Full length** | FDM | Follows the foot up to the metatarsal heads. **Completely flat from the M1–M5 line forward**, at the height of the metatarsal heads, with a smooth blend behind the line (see *Metatarsal smoothing*). Finished with a **flat base** for printing. |
| **3/4 length** | Powder bed | Ends 6 mm before the metatarsal line. The part is a **shell of uniform thickness, 2–4 mm (default 2.5 mm)**. |

**Shoe Size** is UK2–UK13 in half sizes. Insole length = (size + 25) barleycorns − 5 mm, so UK8 = 274 mm. A size is suggested from the scan's footprint length. **Create the insole** generates it.

**3 · Design** (both types)

| Control | Range | Effect |
| --- | --- | --- |
| Padding clearance | 0–4 mm (default 2.5) | Gap between the foot and the insole top, left for the padding |
| Narrow insole profile | on/off | Outline 10 % narrower |
| Add Wedge | type Heel / Forefoot / Full; side Medial / Lateral; angle 0–7° | Posting: added material tilted about the opposite border |
| Add MT Pad | height 0–7 mm | Dome just proximal to the 2nd–4th metatarsal heads |
| Plantar fascia groove | depth 0–4 mm | Channel from the heel to the 1st/2nd ray |
| Heel cup height | 6–30 mm | Height of the rim around the heel and rearfoot |
| Metatarsal smoothing | 0–10 (default 5) | Evens out the metatarsal head area and lengthens the blend into the flat forefoot (12 mm at 0, 37 mm at 10), so there is no bump at the metatarsals |
| MT Bar | see below | A complete bar just behind the metatarsal heads |

**MT bar types.** A metatarsal bar is a raised strip placed just proximal to the metatarsal heads. It takes load off the heads and spreads it onto the shafts. It must never sit under the heads: studies find the best pressure relief with the peak about 6–11 mm behind the head line. An oblique bar, parallel to the head line, relieved the 2nd MT head better than one placed straight across. Options:

| Control | Options / range | Effect |
| --- | --- | --- |
| Bar type | **Oblique** (default), **Straight**, **Anatomical** | Oblique runs parallel to the M1–M5 line. Straight runs square to the foot axis, behind the most proximal head. Anatomical is curved to follow the metatarsal parabola (further forward under the 2nd–3rd heads) |
| Coverage | **Full width (MT 1–5)**, **MT 2–5**, **MT 2–4** | Full width runs edge to edge. MT 2–5 spares the 1st ray. MT 2–4 is central and spares the 1st and 5th |
| Bar height | 2–5 mm | Height of the bar's flat top |
| Bar width | 15–35 mm (default 25) | Front-to-back size: a short bevel at the front, a flat top, and a long ramp at the back |
| Front edge behind the MT heads | 3–15 mm (default 7) | Gap between the heads and the front of the bar |

On a 3/4 insole the bar is moved back just enough to fit completely in front of the 3/4 edge.

**4 · Finish**

*Full length (FDM):* once all the features are set, the underside is one completely flat plane. **Base thickness** (1–6 mm, default 2 mm) is the material under the lowest point of the top surface.

*3/4 length (powder):*

| Control | Range | Effect |
| --- | --- | --- |
| Thickness | 2–4 mm (default 2.5) | Uniform shell thickness |
| Heel raise | 0–20 mm | Heel lift, tapering to zero at the metatarsals |
| Heel height | 0–10 mm | Heel post below the shell |
| Heel base width | Narrow / Normal / Wide | Width of the heel post |
| Morton's extension | none / Morton's / Reverse Morton's | Extends the shell under the 1st ray, or under rays 2–5 |
| choose offloads | MT-1…MT-5 | Metatarsal heads to offload; **Provide offloads** cuts an aperture under each one |
| Hole in heel | on/off | 20 mm through-hole at the heel centre |

**Also:**
- **Foot: Visible / Transparent / Hidden** controls how the scan is drawn. It is in the designer panel and also floats at the top left of the viewport once an insole exists. The foot switches to Transparent automatically when the insole is created.
- **Mesh detail:** *Standard* (1 mm surface grid), *High* (0.5 mm, about 4× the triangles) or *Ultra* (0.35 mm, about 8×, slower). The panel shows the triangle count.
- **Finalise and download** exports a watertight STL in world coordinates, named `<scan>-full-UK8.stl` or `<scan>-threeQuarter-UK8.stl`.
- The design is saved with the project.

**How it works (`src/core/insole/`):**
1. The aligned scan's sole is rasterised into a 1 mm height map in the heel → metatarsal frame. Steep faces (the sides of the foot) are skipped, gaps are filled and the result is smoothed. This step is cached, because only it depends on the scan.
2. The outline is fitted to the shoe size and the M1/M5 landmarks.
3. The top surface is the foot (flattened distal to M1–M5, with the heel cup and heel raise) minus the padding clearance, plus *added material* (pads, bar, wedge; the groove removes material). The bottom is either one flat plane (full length) or the shape offset down by the shell thickness (3/4 length).
   - Cut-outs are signed-distance operations: 3/4 length, Morton's extensions, offload apertures and the heel hole.
4. Marching squares over the outline builds a closed solid, so the edges are smooth rather than stair-stepped.

Regenerating takes about 0.5 s and runs in the worker whenever a setting changes.

## Footwear designer (same tab → "2 · What to design" → **Footwear**)

Footwear is the third category, after the full length and 3/4 insoles. It uses the same scan, landmarks, base plane and foot arch adjustment. Choose **Chappal** or **Shoe**, then **Create**. Every change can be undone and is saved with the project.

**Only the footbed follows the foot.** The footbed is the insole part, contoured at the clearance. Everything else is a **standard product shape fitted around the foot**:
- a smooth sole outline
- a level rim with rounded edges
- smooth straps and uppers

The shapes follow the reference designs (the team's slides, thongs and lattice shoes, measured from their STL files), not the foot's contours:
- sole: a thin shell tray around a lattice core, with a foot-shaped outline and a toe bumper
- slide: a wide vamp growing out of the side walls
- thong: wide wings with a window in front of them, a ridge and a toe post
- shoe: a slip-on with a double-skin lattice upper

**Design rules** (enforced and checked):

| Rule | How it is enforced | How it is checked |
| --- | --- | --- |
| Lattice strut diameter **1.2–1.8 mm** | The slider cannot leave this range; saved projects are clamped into it | Every strut of the generated lattice (the solid collar rim of a shoe is not lattice) |
| Footbed clearance to the foot **1–2 mm** | The slider cannot leave this range; the footbed is built at this distance from the foot | Measured against the scan (BVH nearest point) on the footbed under the foot. Nodes or skin that end up off target are moved onto it. Shown as ✔/✘, ±0.1 mm. |
| Nothing closer to the foot than **1 mm** | Straps and uppers are fitted so they clear the foot by at least the clearance | Measured on every lattice node and the solid parts near the foot (the toe post, which sits between the toes by design, is reported separately) |

The panel also shows how far the straps or upper are from the foot. As standard shapes, they are close at the tightest point and further elsewhere.

**Sole (both kinds):**
- **Outline:** follows the foot, like the reference soles. It is the footprint (the foot up to 20 mm above the floor) grown by the clearance, the rim wall and 1.5 mm, with the toe allowance added towards the toes. It also contains the widest part of the foot up to 35 mm above the floor, plus the clearance. The ankle and leg of a full scan don't count. The boundary is traced by rays from the footprint's centre and faired: smoothed along the curve, but never cut back inside that region.
- **Outsole:** a solid plate on a flat base, with a rounded bottom edge, toe spring and an optional tread (hexagon / diamond / waves).
- **Rim:** a thin solid wall (2.5 mm by default) with a **level, smooth top line** (not following the foot). It is measured from the footbed 6–11 mm inside the footprint's edge, not up the steep side of the heel, and is highest round the heel. It has a rounded bead on top and a 6 mm rounded bottom edge, and on chappals it turns up round the toes (toe bumper). It can be switched to an open lattice cage (the default for shoes). Outside the footprint the footbed curves up to the rim but never over it.
- **Footbed:** the top of a conformal tetrahedral lattice, contoured to the foot at the clearance. Optionally it gets a **smooth solid skin** (1.2 mm) over the lattice, like the reference slides.

**Reference designs** (the first choice in the design panel): parameter sets modelled on the team's reference STLs. They were measured from them: sole and rim heights, strap coverage and thickness, strap and upper lattice, tread. Choosing one sets the style and those parameters, and everything can be adjusted afterwards (undoable).

| Design | Like | Style |
| --- | --- | --- |
| Classic slide | Parth, Atit | slide, smooth solid vamp, hexagon tread |
| Lattice-vamp slide | Rushik, Atheka, Anmol | slide, lattice panel vamp, diamond tread |
| Sleek low slide | Jigar | slide, thin sole and vamp |
| Split-toe lattice thong | Aashay | split-toe, wide lattice wings |
| Lattice thong | Saagr | thong, lattice wings, wave tread |
| Lattice sneaker | Shoes, Sagar_Shoes_red | shoe, grid double-skin upper, lattice sole wall |
| Knit slip-on | Left/Right shoe_v1, sagar shoes | shoe, diamond (knit-look) double-skin upper |

Straps and wings can be **solid** (smooth, pillow edges) or a **lattice panel**: a 7 mm solid border round the edge filled with a triangulated lattice (struts in the rules' range). Shoe uppers use a **grid** (triangles, braced) or **diamond** lattice.

**Chappal** (styles from the reference photos):

| Style | Shape |
| --- | --- |
| **Slide** | One wide vamp that grows out of the side walls, 3 mm thick with pillow-rounded edges. Its front edge runs straight across over the toe joints. Its back edge sweeps from the top of the instep down and back to the rim, so from the side the strap is a long diagonal. Its cross-sections are arches standing on the rim, with the crown over the highest part of the foot (medial of the middle, so the arch is asymmetric like the reference vamps) and sides leaning in a little. Each is just high enough to clear the foot, then smoothed along the foot so that it hugs the instep, never dipping below what the foot needs. Rows behind the top of the vamp only exist low down at the sides, so they keep the first fitted arch and aren't raised round the ankle or leg. You can set its length on top of the foot, position and thickness. |
| **Thong** | Two wide wings grow out of the side walls along the arch and meet over the instep. On the sole they end at the level of the arch end (AE landmark, or just behind the 1st metatarsal head), leaving a window above the sole in front of them. From where they meet, a rounded ridge runs forward and down onto the toe post, a slim tapered column (5.5 mm across) between the big toe and the other toes. The ridge is kept clear of the toes across its whole width. You can set the wing width at the sole and the thickness. |
| **Split-toe thong** | The same, with the sole split between the big toe and the others. |

**Toe post position:** on full scans the post goes in the web between the 1st and 2nd toes, **found on the scan**. The app works forward row by row from the metatarsal heads, looking for the first dip (or gap) in the height of the top of the foot lateral of the big toe, 12–42 % across the forefoot from the medial edge. The post sits 5 mm in front of the base of that cleft. If the cleft isn't visible (toes pressed together, or a sole-only scan), the post is placed from the M1/M5 landmarks and a warning says so. If the gap between the toes is narrower than the post, the warning says how far the post presses into them.

**Shoe:** the same sole (with a lattice side wall by default), plus a **smooth last-like upper**, a slip-on like the reference lattice shoes.
- Its cross-sections stand on the rim and are fitted around the foot, then smoothed along it.
- It carries a **double-skin lattice**: a regular triangulated lattice (nodes spaced evenly along each section and zipped between sections), a second copy of it 0.6 × the cell size further out, and crossing diagonals between the two (an X in section).
- It is fully enclosed: toes, dorsum, sides and heel counter. The only opening is at the ankle, with a clean solid collar rim.
- **Collar below the ankle bones:** the **medial (MM) and lateral (LM) malleolus** landmarks are listed on every scan type. When you choose **Footwear** and they are missing, the app asks for them straight away: a banner over the 3D view says which one to click, placing MM moves on to LM, and then it stops. *Later* skips this. The Footwear panel shows their status, with a **Place MM and LM now** button. With them placed, the collar line is capped so the top of the collar rim stays **5 mm below each malleolus** (setting: *Collar rim below the malleoli*, 3–15 mm). The cap is flat under each bone (±18 mm along the foot) and then rises smoothly, so the rim doesn't pinch the skin. It is checked on the result as a design rule (*Collar rim at least 5 mm below the malleoli*, the vertical gap on each bone's side). Until they are placed, the panel asks for them. The top line has a heel tab, dips under the ankle bones and rises in a rounded curve to the throat (45 % of the length by default).

**Full scans that are open** (cut above the ankle, scanner holes): the straps and upper use the scanned top of the foot. For the clearance checks the holes are closed with smooth patches first, because next to an open edge the inside/outside test is unreliable.

**Scans without the top of the foot** (plantar / foam-box scans, or scans that stop low on the sides): the straps and the upper are fitted around an **estimated dorsum**, and a warning says so.
- The estimate is modelled from the scanned footprint: a typical adult dorsal height profile along the foot, and a rounded section across it. Where the scan reaches higher, the scan wins.
- The clearance checks then use a closed shell of the scanned sole plus the estimated dorsum.
- Check the fit on the patient, or use a full foot scan.

| Setting | Range | Default |
| --- | --- | --- |
| Footbed clearance to the foot | 1–2 mm | 1.5 |
| Lattice strut diameter | 1.2–1.8 mm | 1.5 |
| Lattice cell size | 4–10 mm | 6 |
| Smooth footbed skin | on/off | off |
| Sole thickness (thinnest point) / outsole | 8–35 / 1.5–4 mm | 12 (chappal), 10 (shoe) / 2.5 |
| Rim height (heel) / rim wall | 0–25 / 1.5–8 mm | 10 (chappal), 8 (shoe) / 2.5 |
| Sole side wall | solid / lattice | solid (chappal), lattice (shoe) |
| Toe spring, toe allowance | 0–15, 0–20 mm | kind-specific |
| Strap length on top / position / thickness (slide), wing width at the sole (thong) | 30–100 mm / 45–80 % / 2–8 mm, 25–80 mm | 70 / 66 % / 3, 55 |
| Collar height / throat / collar rim (shoe) | 25–90 mm / 40–75 % / 2–4 mm | 45 / 45 % / 3 |

**Smooth fused joins** (Finish & download): the reference designs are modelled as one continuous surface, with the straps growing out of the sole wall through rounded fillets. With this on, the solid parts (sole plate, rim, straps or wings, ridge, toe post) are fused the same way (`footwear/fuse.ts`):
- Each part becomes a signed distance field. The sole plate and rim come straight from their height fields; the other parts use distance to their meshes, found with a BVH.
- The parts are joined by a smooth union, which puts a 2.5 mm fillet at every junction.
- The result is meshed with marching tetrahedra on a sparse grid, using a 0.8 / 0.5 / 0.35 mm voxel depending on the mesh detail.
- It is always one watertight, consistently wound surface. The clearance rule is re-applied afterwards (fillets add a little material), and the toe post is excluded because it sits between the toes by design.

The lattice (footbed, panels, upper) stays as struts. On a real scan it takes about 20–60 s and gives 1.5–4 million triangles, so switch it on when the design is final.

**Mesh detail** (Finish & download): *Standard*, *High* or *Ultra*. It sets the surface grid of the sole, rim and footbed (1 / 0.5 / 0.35 mm), the roundness of the lattice struts (6 / 10 / 14 sides, also in the merged export) and the sampling of straps, wings and tubes (×1 / ×2 / ×3). On a real scan, *High* gives about 0.9–1.2 million triangles for the footwear and takes a few seconds longer.

**Download:**

- The default export is the parts as overlapping closed shells. It is fast, and slicers union overlapping shells when they slice.
- **Merge into one watertight solid** unions everything with manifold-3d instead. This takes from a few seconds to about a minute, depending on the strut count.
- File names look like `<scan>-chappal-slide-UK8.stl`, `<scan>-shoe-UK8-merged.stl`.

**How it works (`src/core/footwear/`):**

1. `generate.ts` builds the footbed from the lower of the smoothed plantar map and the raw lowest scan surface, offset down by the clearance along its normal (spherical erosion), and then checks it against the scan.
2. `shape.ts` holds the standard shapes:
   - the sole outline and its growth
   - arch sections: a superellipse on the rim with an optional bulge, and the smallest height that encloses the foot, found with a polar containment test
   - the arch sheet (vamp and wings: a sheet on the arch surface cut out between a back and a front edge, thickened outward), the rounded sweep for the ridge and post, and the section lattice (single or double skin) with its collar
3. The top of the foot (highest-surface raster) is spherically dilated by the clearance. That gives the surface the straps and upper must stay outside of.
4. The clearance checks use the nearest point on the foot. Where that point is on an edge or corner, inside/outside is decided from the averaged normals of all faces touching it (pseudo-normal).

## Supported file formats

| Format | Extensions | Parsed by | Units | Up axis |
| --- | --- | --- | --- | --- |
| STL (binary / ASCII) | `.stl` | own parser (worker) | none → assumed mm¹ | Z |
| Wavefront OBJ | `.obj` | Three.js OBJLoader (worker) | none → assumed mm¹ | Z² |
| Stanford PLY (ASCII / binary) | `.ply` | Three.js PLYLoader (worker) | none → assumed mm¹ | Z² |
| OFF | `.off` | own parser (worker) | none → assumed mm¹ | Z² |
| 3MF | `.3mf` | Three.js 3MFLoader (main thread) | from the file's `unit` attribute | Z |
| AMF | `.amf` | Three.js AMFLoader (main thread) | from the file's `unit` attribute | Z |
| glTF / GLB (incl. Draco & meshopt compression) | `.gltf`, `.glb` | Three.js GLTFLoader (main thread) | metres (spec) | Y → converted |
| COLLADA | `.dae` | Three.js ColladaLoader (main thread) | from `<unit meter>` | from `<up_axis>` |
| FBX | `.fbx` | Three.js FBXLoader (main thread) | from `UnitScaleFactor` | Y → converted |
| 3DS | `.3ds` | Three.js TDSLoader (main thread) | none → guessed¹ | Z |
| VRML 97 | `.wrl`, `.vrml` | Three.js VRMLLoader (main thread) | metres (spec) | Y → converted |
| STEP | `.step`, `.stp` | OpenCASCADE via occt-import-js (WASM, worker) | from the file | Z |
| IGES | `.iges`, `.igs` | OpenCASCADE (WASM, worker) | from the file | Z |
| OpenCASCADE BREP | `.brep`, `.brp` | OpenCASCADE (WASM, worker) | none → guessed¹ | Z |
| Rhino | `.3dm` | rhino3dm (WASM, worker) | from the model unit system | Z |

¹ Formats without units are taken as millimetres unless the model would be implausibly small for a foot. Under 2.5 units across it's treated as metres; under 70 as centimetres. The Scan setup dialog shows the guess and the resulting size so you can correct it.
² These formats have no fixed up axis. Choose **Y up** in Scan setup if the scan arrives lying on its side.

**How some formats are handled**
- **STEP / IGES:** curved CAD surfaces are tessellated with 0.05 mm chordal and 0.1 rad angular deflection.
- **3DM:** Rhino files use the render meshes stored in the file. rhino3dm cannot tessellate NURBS itself, so files saved with "Save Small" have nothing to show; the app says so.
- **Multi-part files:** all parts are merged into one mesh, with node transforms applied. Colours, textures, points and curves are ignored.
- **Point clouds** (PLY without faces, `.xyz`, `.pcd`) are rejected with a message to mesh them first.
- **Not readable:** Fusion 360 `.f3d`, SolidWorks, Inventor, CATIA, Creo/NX, Parasolid and SketchUp native files are proprietary, and no browser library can open them. Opening one shows which export to use instead (e.g. in Fusion 360: *File → Export → STEP* or *STL*).
- **WASM loading:** the large WASM libraries (OpenCASCADE 7.6 MB, rhino3dm 2.7 MB) are only downloaded the first time a file of that type is opened.

## Conventions

- **Units:** millimetres.
- **Axes:** **Z up, +Y anterior (heel → toe), +X to the patient's right.**
  - For a right foot, +X is lateral. For a left foot, +X is medial.
  - The grid is the XY plane at Z = 0.
- **Transform:** rigid only (translate + rotate, no scale), so measurements are the same in local and world coordinates. `world = R · local + t`, with R stored as a quaternion `[x, y, z, w]`.
- **Orientation:** scans load in whatever orientation they were saved in. Align them manually with the transform tools; Phase 2 will automate this.

## File formats

**Landmarks JSON** (`format: "footwear-files/landmarks"`):

```json
{
  "format": "footwear-files/landmarks", "version": 1, "units": "mm",
  "sourceFileName": "scan.stl", "scanType": "lowerLimb", "side": "right",
  "exportedAt": "2026-09-29T09:00:00.000Z",
  "transform": { "position": [0, 0, 0], "quaternion": [0, 0, 0, 1] },
  "landmarks": [
    { "id": "heelCentre", "name": "Heel centre", "local": { "x": 1.2, "y": 30.5, "z": 0.4 }, "world": { "x": 1.2, "y": 30.5, "z": 0.4 } }
  ],
  "measurements": [ { "id": "forefootWidth", "label": "Forefoot width (M1–M5)", "valueMm": 92.4 } ]
}
```

- On import, local coordinates are used. If a record has only world coordinates, they are mapped back to local space with the current transform.
- **CSV:** one row per landmark. Columns: `id,name,local_x,local_y,local_z,world_x,world_y,world_z,scan_type,side,source_file`.

**Project (`.tffproj`)**: a zip containing:
- `project.json`: meta, scan info, transform, landmarks (local).
- `mesh/positions.bin`: Float32 LE xyz.
- `mesh/indices.bin`: Uint32 LE, 3 per triangle.

## Architecture

```
src/
  core/        Pure TypeScript: no React, no DOM. Unit-tested in Node.
    types.ts, document.ts          serialisable document model (MeshData, RigidTransform, landmarks)
    math/                          vectors, quaternions/Euler, planes
    mesh/                          weld, topology, analysis, normals, holes, cut (+ manifold adapter),
                                   closest-point, fill/ (triangulate, refine, fair)
    io/                            STL read/write, landmarks JSON/CSV, project zip
    landmarks/                     definitions, measurements
    fixtures/                      procedural test shapes (icosphere, marching-tetrahedra foot/leg)
  workers/     mesh.worker.ts: Comlink API over core/ (+ manifold-3d WASM),
               with a small mesh cache so calls can pass `{ id }` instead of cloning large arrays
  state/       Zustand store (document, history, view/UI state) and actions
  viewer/      React Three Fiber scene: model, landmarks, clipping plane, hole overlay, camera
  ui/          Panels, toolbar, dialogs
```

- **Document model.** The whole editable state is one plain `ProjectDocument`: `{ meta, scan, mesh, transform, landmarks }`. It contains no Three.js objects.
  - Meshes are immutable: every edit returns a new `MeshData`.
  - History stores document snapshots, which share mesh references, under a memory budget (600 MB by default). The oldest mesh versions are dropped first.
  - Later phases fit in the same way: alignment produces a `RigidTransform`, and mesh modifications are new `core/` functions of the form `(MeshData, params) → MeshData` exposed through the worker.
- **Rendering.** Render geometry holds its own copies of the arrays. The three-mesh-bvh BVH is built in its own worker and reorders the index buffer, which must not touch the document's data.

## Algorithms

| Step | Approach |
| --- | --- |
| Welding | Quantised-grid hash (1e-4 mm) using an open-addressing table; degenerate triangles are dropped |
| Topology / watertight | CSR edge buckets. Watertight = no boundary edges and no edges shared by more than 2 triangles |
| Hole loops | Chains of boundary half-edges. Pinch vertices split the walk into simple loops |
| Hole triangulation | Minimum-area triangulation (O(n³) dynamic programming) for loops of ≤300 edges. Larger loops: Newell-plane projection + earcut |
| Refinement | Liepa-style centroid splitting until the surrounding edge-length scale is reached, then edge relaxation (Delaunay flips) |
| Fairing | Least-squares umbrella Laplacian over the patch *and* its boundary ring (a discrete bi-Laplacian / thin-plate energy), solved with conjugate gradients |
| Cut | Signed-distance split with ε-snapping and shared edge-intersection vertices. The cap is earcut on boundary loops that lie in the plane, with nesting by point-in-polygon and T-junction repair |
| Surface snapping | three-mesh-bvh raycast; clipped-away hits are skipped |

## Tests

- `npm test`: 105 unit tests covering:
  - STL round-trips (binary and ASCII, the "solid"-header binary edge case, malformed input), welding, watertight and non-manifold detection
  - transform maths
  - hole detection: counts, perimeters, pinch splitting, rim suggestion
  - triangulation orientation
  - filling: watertight, correct volume, curvature-following vs flat, selective fill, leg rim preserved
  - cutting: hemisphere volume, either side, open rim, plane through vertices, ring caps, leg stump, open sections, manifold-3d path
  - landmark JSON/CSV serialisation and import fallback
  - measurements, including arch height to a tilted plane
  - project round-trip and corrupt-file rejection
  - insole designer: shoe-size length, padding clearance, full-length flat base, narrow profile, MT pad/bar, fascia groove, wedges, heel cup, 3/4 shell (uniform thickness, heel post, heel raise, Morton's extension, offloads, heel hole), foot arch adjustment limited to the AS–AE span, no ridge at the metatarsals, MT bar types and coverage (complete on both insole types), legacy project upgrade, open plantar scans, landmark alignment and the base-plane lock (set, follow moved points, release on delete)
  - footwear designer: standard-shape sole, straps and upper (outline contains the foot, thong wings land inside the sole, enclosed shoe with ankle opening), smooth footbed skin, consistent winding of every solid part (for manifold-3d), estimated dorsum on plantar scans, thong wings down to the sole at the arch end, spherical dilation/erosion and signed distance fields, the conformal lattice, the design rules (parameters clamped to 1.2–1.8 mm struts and 1–2 mm clearance, and measured on the result at both ends of the ranges), slide / thong / split-toe chappals (watertight solid parts, thong window in front of the wings, toe-post warning, sole slot), the shoe upper (fits the dorsum, collar opening over the ankle, double skin), side wall and tread options, sole-only output for scans without the top of the foot, open full scans (cut at the leg, scanner holes: the real top of the foot is used and the clearance checks run against the scan with its holes closed), and project round-trip
  - file formats: OBJ (quads, negative indices), PLY (ASCII, binary, point-cloud rejection), OFF, 3DM, STEP/IGES (including metre and inch files), unit guessing (and the fallback when a file's stated units give an impossible size), toe direction detection, Y-up conversion and re-interpretation
- `npm run e2e`: browser smoke test of the main workflow, the insole designer (full length flat base → clearance → features → MT bar type → foot arch between AS/AE → undo → 3/4 shell → download), the base plane (auto-set on a tilted scan, rotation refused, re-align, release, undo), the footwear designer (chappal → rule checks → sliders held to the rule ranges → thong / split-toe → shoe → undo → download, including the merged watertight STL; then a plantar scan with estimated dorsum: slide, thong and enclosed shoe), plus an import test of every format fixture (3MF, AMF, glTF/GLB, DAE, VRML, 3DM, STEP, IGES, …).

## Known limitations

- **Scale:** the pipeline was checked with a synthetic 5.2M-triangle mesh in headless Chromium with software GL. Parsing and analysis took about 5 s in the worker, and a capped cut took about 2 s. It has not been profiled on a real GPU with real 3M-triangle scans; wireframe on more than 1M triangles will be slow.
- **Transforms:** the transform is rigid; there is no scaling. File units are converted on import; unit-less formats are guessed from size, so check the size shown in Scan setup.
- **Formats:**
  - 3MF, AMF, glTF, DAE, FBX, 3DS and VRML are parsed on the main thread (their loaders need the browser's XML parser), so a very large file in these formats freezes the UI while it loads. Large scans are normally STL, OBJ or PLY, which parse in the worker.
  - A `.gltf` whose data is in a separate `.bin` file can't be opened on its own; use `.glb` or an embedded `.gltf`.
  - FBX, 3DS and BREP import use standard loaders but have no automated fixture tests.
  - Only STL is exported.
  - occt-import-js is LGPL-2.1; it is loaded as a separate, unmodified WASM module.
- **Cut caps:**
  - Caps are flat triangulations of the section loop with no interior vertices, so large caps have long, thin triangles.
  - Where the plane crosses an existing open boundary, the section is an open curve and cannot be capped. The app reports this.
- **manifold-3d:** it needs a closed 2-manifold. Scans with self-intersections may be rejected (the split fallback is then used). It is only used up to 1.5M triangles, because it is slow on larger meshes (about 23 s at 5M).
- **Hole filling:**
  - Uniform (umbrella) Laplacian weights.
  - No self-intersection check between the patch and the surrounding mesh.
  - Very large, strongly non-planar loops (beyond 300 edges) are triangulated by projection and may fold before fairing.
  - Non-manifold edges are reported but not repaired.
- **Clipping view:** it shows the interior as red back faces; there is no solid cross-section fill.
- **Landmarks after edits:** landmarks are not re-projected onto the surface after a cut or fill. They are flagged *off surface* instead, and you can drag them back.
- **Labels:** landmark labels are always drawn on top, even when the point is behind the model.
- **ASCII STL:** parsed in memory with a regular expression, which is fine for typical files but not for multi-GB ASCII scans.
- **Insole designer:**
  - The insole shape comes from simple rules, not a clinical template. The outline is a spline fitted to the shoe size and M1/M5, and the feature positions are fixed offsets from the landmarks (MT pad 12 mm behind the metatarsal line, fascia groove heel → 1st/2nd ray, and so on).
  - The foot arch adjustment is a smooth bump on the medial arch of the scan between the AS and AE landmarks. It fades out laterally over about 40 % of the forefoot width.
  - Heads 2–4 are not landmarked: the anatomical MT bar estimates the metatarsal parabola from M1 and M5.
  - The insole walls are vertical; there is no flare or bevel yet.
- **Footwear designer:**
  - The standard shapes are parametric (a sole spline, superellipse arches, swept arms), not a library of lasts. Strap and collar positions are fractions of the foot length. There is no heel height or drop yet; the sole is a flat base with toe spring.
  - The lattice is a regular tetrahedral midsole plus a regular triangle net on the shoe upper. There are no Voronoi or graded patterns yet, and struts have a uniform diameter.
  - The toe post of the thong styles assumes the 1st and 2nd toes are separated in the scan.
  - For sole-only scans the top of the foot is an estimate from typical proportions, not the patient's dorsum.
  - Names or logos embossed on the side wall (as in the photos) aren't supported yet.
  - The merged export can take about a minute for fine lattices (small cell size) on dense scans.
- **Undo memory:** history is capped at 600 MB of mesh data. On very large meshes only the last few mesh edits can be undone.
