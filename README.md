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
- **Landmarks:** heel centre, 1st and 5th metatarsal heads, medial arch peak. Lower-limb scans also get the medial and lateral malleoli.
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

## Insole designer (right sidebar → "Insole designer")

This replicates the reference orthotic-design workflow step by step. Every control and range matches the reference tool, and every change can be undone.

**1 · Align & set up**

| Control | What it does |
| --- | --- |
| Align the scan (base plane) | Set automatically from the heel centre, M1 and M5 (see [Base plane](#base-plane-heel-centre--1st-mt-head--5th-mt-head)); the model is then locked |
| **Toes aligned in the arrow direction** | Shows the green toe arrow (+Y); the base plane always points the toes along it |
| Which side is model | Left or right (set in Scan setup) |
| Landmarks | Heel centre, 1st and 5th metatarsal heads are required; the arch peak is optional (it positions the arch-pressure bump) |
| **Shoe Size** | UK2–UK13 in half sizes. Insole length = (size + 25) barleycorns − 5 mm, so UK8 = 274 mm. A size is suggested from the scan's footprint length |
| **Create the insole** | Generates the insole |

**2 · Insole settings (soft, full length)**

| Control | Range | Effect |
| --- | --- | --- |
| Narrow insole profile | on/off | Outline 10 % narrower |
| Padding thickness | 1.5–4 mm | Shell thickness; the insole follows the plantar surface up to the metatarsal heads. **From the M1–M5 line forward it is completely flat**: no toe contours are traced, with a 12 mm blend just behind the line |
| Medial Arch pressure | −25…25 mm | Pushes the insole up into (+) or away from (−) the medial arch |
| Add Wedge | type Heel / Forefoot / Full; side Medial / Lateral; angle 0–7° | Posting: added material tilted about the opposite border |
| Add MT Pad | height 0–7 mm | Dome just proximal to the 2nd–4th metatarsal heads |
| Plantar fascia groove | depth 0–4 mm | Channel from the heel to the 1st/2nd ray |
| Heel cup height | 6–30 mm | Height of the rim around the heel and rearfoot |
| MT Bar | thickness 2–5 mm | Transverse ridge just proximal to the metatarsal line |

**Add thickness → rigid orthosis (3/4 length)**

The orthosis ends 6 mm before the metatarsal line. The underside is filled flat through the rearfoot and midfoot.

| Control | Range | Effect |
| --- | --- | --- |
| Heel raise | 0–20 mm | Heel lift, tapering to zero at the metatarsals |
| Heel height | 0–10 mm | Heel post below the shell |
| Morton's extension | none / Morton's / Reverse Morton's | Extends the plate under the 1st ray, or under rays 2–5 |
| Heel base width | Narrow / Normal / Wide | Width of the heel post |
| choose offloads | MT-1…MT-5 | Metatarsal heads to offload; **Provide offloads** cuts an aperture under each one |
| Footplate thickness | 2–5 mm | Minimum shell thickness |
| Hole in heel | on/off | 20 mm through-hole at the heel centre |

**Also:**
- **Foot: Visible / Transparent / Hidden** controls how the scan is drawn. It is in the designer panel and also floats at the top left of the viewport once an insole exists. The foot switches to Transparent automatically when the insole is created.
- **Finalise and download** exports a watertight STL in world coordinates.
- The design is saved with the project.

**How it works (`src/core/insole/`):**
1. The aligned scan's sole is rasterised into a 1 mm height map in the heel → metatarsal frame. Steep faces (the sides of the foot) are skipped, gaps are filled and the result is smoothed. This step is cached, because only it depends on the scan.
2. The outline is fitted to the shoe size and the M1/M5 landmarks.
3. Each modification is either:
   - a *shape* change, which the soft shell follows (arch pressure, heel cup, heel raise), or
   - *added material*, which only thickens the insole (pads, bar, wedge, groove).
   - Cut-outs are signed-distance operations: 3/4 length, Morton's extensions, offload apertures and the heel hole.
4. Marching squares over the outline builds a closed solid, so the edges are smooth rather than stair-stepped.

Regenerating takes about 0.5 s and runs in the worker whenever a setting changes.

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

- `npm test`: 80 unit tests covering:
  - STL round-trips (binary and ASCII, the "solid"-header binary edge case, malformed input), welding, watertight and non-manifold detection
  - transform maths
  - hole detection: counts, perimeters, pinch splitting, rim suggestion
  - triangulation orientation
  - filling: watertight, correct volume, curvature-following vs flat, selective fill, leg rim preserved
  - cutting: hemisphere volume, either side, open rim, plane through vertices, ring caps, leg stump, open sections, manifold-3d path
  - landmark JSON/CSV serialisation and import fallback
  - measurements, including arch height to a tilted plane
  - project round-trip and corrupt-file rejection
  - insole designer: shoe-size length, padding thickness, narrow profile, arch pressure, MT pad/bar, fascia groove, wedges, heel cup, orthosis (3/4 length, heel post, heel raise, Morton's extension, offloads, heel hole), open plantar scans, landmark alignment and the base-plane lock (set, follow moved points, release on delete)
  - file formats: OBJ (quads, negative indices), PLY (ASCII, binary, point-cloud rejection), OFF, 3DM, STEP/IGES (including metre and inch files), unit guessing, Y-up conversion and re-interpretation
- `npm run e2e`: browser smoke test of the main workflow, the insole designer (create → modifications → orthosis → undo → download), the base plane (auto-set on a tilted scan, rotation refused, re-align, release, undo), plus an import test of every format fixture (3MF, AMF, glTF/GLB, DAE, VRML, 3DM, STEP, IGES, …).

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
  - Arch pressure is a smooth bump centred on the arch landmark, or estimated if that isn't placed.
  - The orthosis walls are vertical; there is no flare or bevel yet.
- **Undo memory:** history is capped at 600 MB of mesh data. On very large meshes only the last few mesh edits can be undone.
