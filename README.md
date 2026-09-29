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
| `npm run e2e` | End-to-end smoke test: headless Chromium via Playwright, runs load → landmark → fill → cut → undo/redo → export |
| `npm run fixtures` | Regenerates the sample STLs in `public/samples/` (`-- --large` also writes a 1.3M-triangle sphere) |

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
- STL loading:
  - Binary and ASCII STL, from the file picker or by drag-and-drop anywhere in the window.
  - Parsing, vertex welding, analysis and normals all run in a Web Worker.
  - The file buffer is transferred to the worker, not copied.
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

- `npm test`: 48 unit tests covering:
  - STL round-trips (binary and ASCII, the "solid"-header binary edge case, malformed input), welding, watertight and non-manifold detection
  - transform maths
  - hole detection: counts, perimeters, pinch splitting, rim suggestion
  - triangulation orientation
  - filling: watertight, correct volume, curvature-following vs flat, selective fill, leg rim preserved
  - cutting: hemisphere volume, either side, open rim, plane through vertices, ring caps, leg stump, open sections, manifold-3d path
  - landmark JSON/CSV serialisation and import fallback
  - measurements, including arch height to a tilted plane
  - project round-trip and corrupt-file rejection
- `npm run e2e`: browser smoke test of the main workflow.

## Known limitations

- **Scale:** the pipeline was checked with a synthetic 5.2M-triangle mesh in headless Chromium with software GL. Parsing and analysis took about 5 s in the worker, and a capped cut took about 2 s. It has not been profiled on a real GPU with real 3M-triangle scans; wireframe on more than 1M triangles will be slow.
- **Transforms:** the transform is rigid; there is no scaling. Units are assumed to be mm, with no unit detection.
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
- **Undo memory:** history is capped at 600 MB of mesh data. On very large meshes only the last few mesh edits can be undone.
