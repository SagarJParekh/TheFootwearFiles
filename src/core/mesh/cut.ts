import earcut from 'earcut';
import { planeBasis } from '../math/plane';
import type { MeshData, Plane } from '../types';
import { findBoundaryLoops } from './holes';
import { compactMesh } from './weld';

export interface CutOptions {
  /** Keep the side the plane normal points to (true) or the opposite side (false). */
  keepPositive: boolean;
  /** Close the cut with a flat cap. */
  cap: boolean;
}

export interface CutResult {
  mesh: MeshData;
  /** Number of cap loops that were triangulated. */
  cappedLoops: number;
  /** Cut loops that could not be capped (open cross-sections of an open scan). */
  openCutLoops: number;
  method: 'manifold' | 'split';
}

/**
 * Splits the mesh by a plane and keeps one side. Works on open (non-watertight) meshes.
 * Vertices within `eps` of the plane are snapped onto it to avoid slivers.
 * If `cap` is set, every boundary loop lying in the plane is triangulated (earcut with
 * nesting, so a ring-shaped section gets a ring-shaped cap).
 */
export function cutMeshByPlane(mesh: MeshData, planeIn: Plane, options: CutOptions): CutResult {
  const plane: Plane = options.keepPositive
    ? planeIn
    : { normal: [-planeIn.normal[0], -planeIn.normal[1], -planeIn.normal[2]], constant: -planeIn.constant };
  const [nx, ny, nz] = plane.normal;
  const { positions: p, indices: idx } = mesh;
  const vertCount = p.length / 3;

  // Scale-aware epsilon
  let extent = 0;
  for (let i = 0; i < p.length; i++) extent = Math.max(extent, Math.abs(p[i]));
  const eps = Math.max(extent, 1) * 1e-6;

  const d = new Float64Array(vertCount);
  for (let v = 0; v < vertCount; v++) {
    const dist = nx * p[3 * v] + ny * p[3 * v + 1] + nz * p[3 * v + 2] - plane.constant;
    d[v] = Math.abs(dist) < eps ? 0 : dist;
  }

  const outPos: number[] = Array.from(p);
  const onPlane = new Uint8Array(vertCount); // grows below via `onPlaneExtra`
  const onPlaneExtra: number[] = [];
  for (let v = 0; v < vertCount; v++) if (d[v] === 0) onPlane[v] = 1;
  const edgeVertex = new Map<number, number>();
  const intersect = (a: number, b: number): number => {
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const key = lo * vertCount + hi;
    const hit = edgeVertex.get(key);
    if (hit !== undefined) return hit;
    // interpolate from lo to hi (canonical direction → identical result for both triangles)
    const t = d[lo] / (d[lo] - d[hi]);
    const nv = outPos.length / 3;
    outPos.push(
      p[3 * lo] + t * (p[3 * hi] - p[3 * lo]),
      p[3 * lo + 1] + t * (p[3 * hi + 1] - p[3 * lo + 1]),
      p[3 * lo + 2] + t * (p[3 * hi + 2] - p[3 * lo + 2]),
    );
    onPlaneExtra.push(nv);
    edgeVertex.set(key, nv);
    return nv;
  };

  const outIdx: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]];
    const ds = [d[tri[0]], d[tri[1]], d[tri[2]]];
    const anyPos = ds[0] > 0 || ds[1] > 0 || ds[2] > 0;
    const anyNeg = ds[0] < 0 || ds[1] < 0 || ds[2] < 0;
    if (!anyPos) continue; // entirely on the removed side (or coplanar)
    if (!anyNeg) {
      outIdx.push(tri[0], tri[1], tri[2]);
      continue;
    }
    // Clip the triangle polygon against the plane (Sutherland–Hodgman), keeping winding.
    const poly: number[] = [];
    for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3];
      const da = ds[i], db = ds[(i + 1) % 3];
      if (da >= 0) poly.push(a);
      if ((da > 0 && db < 0) || (da < 0 && db > 0)) poly.push(intersect(a, b));
    }
    for (let i = 1; i + 1 < poly.length; i++) {
      if (poly[0] !== poly[i] && poly[i] !== poly[i + 1] && poly[0] !== poly[i + 1]) {
        outIdx.push(poly[0], poly[i], poly[i + 1]);
      }
    }
  }

  const allOnPlane = new Uint8Array(outPos.length / 3);
  allOnPlane.set(onPlane);
  for (const v of onPlaneExtra) allOnPlane[v] = 1;

  const positions = Float32Array.from(outPos);
  let indices = Uint32Array.from(outIdx);
  let cappedLoops = 0;
  let openCutLoops = 0;

  if (options.cap && indices.length > 0) {
    const cap = capPlanarLoops(positions, indices, allOnPlane, plane);
    cappedLoops = cap.cappedLoops;
    openCutLoops = cap.openCutLoops;
    if (cap.triangles.length) {
      const merged = new Uint32Array(indices.length + cap.triangles.length);
      merged.set(indices);
      merged.set(cap.triangles, indices.length);
      indices = merged;
    }
  }
  const compact = compactMesh(positions, indices);
  return { mesh: compact, cappedLoops, openCutLoops, method: 'split' };
}

/**
 * Triangulates boundary loops whose vertices all lie on the plane. The cap faces
 * point along −normal (out of the kept half-space).
 */
export function capPlanarLoops(
  positions: Float32Array,
  indices: Uint32Array,
  onPlane: Uint8Array,
  plane: Plane,
): { triangles: number[]; cappedLoops: number; openCutLoops: number } {
  const loops = findBoundaryLoops({ positions, indices });
  const planar = loops.filter((l) => l.vertices.every((v) => onPlane[v]));
  const openCutLoops = loops.filter((l) => !l.vertices.every((v) => onPlane[v]) && l.vertices.some((v) => onPlane[v])).length;
  if (!planar.length) return { triangles: [], cappedLoops: 0, openCutLoops };

  const [u, w] = planeBasis(plane.normal);
  const proj = (v: number): [number, number] => {
    const x = positions[3 * v], y = positions[3 * v + 1], z = positions[3 * v + 2];
    return [x * u[0] + y * u[1] + z * u[2], x * w[0] + y * w[1] + z * w[2]];
  };
  const polys = planar.map((l) => {
    const pts = l.vertices.map(proj);
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      area += x1 * y2 - x2 * y1;
    }
    return { loop: l, pts, area: Math.abs(area / 2) };
  });

  // Nesting depth by point-in-polygon (even depth → outer boundary, odd → hole).
  const inside = (pt: [number, number], poly: [number, number][]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const containers = polys.map((a, i) =>
    polys.map((b, j) => (i !== j && b.area > a.area && inside(a.pts[0], b.pts) ? j : -1)).filter((j) => j >= 0),
  );
  const depth = containers.map((c) => c.length);

  const triangles: number[] = [];
  let cappedLoops = 0;
  polys.forEach((outer, i) => {
    if (depth[i] % 2 !== 0) return;
    // holes: loops at depth+1 whose smallest container is this loop
    const holes = polys
      .map((h, j) => ({ h, j }))
      .filter(({ j }) => depth[j] === depth[i] + 1 && containers[j].includes(i));
    const verts = [...outer.loop.vertices];
    const coords: number[] = outer.pts.flat();
    const holeIdx: number[] = [];
    for (const { h } of holes) {
      holeIdx.push(verts.length);
      verts.push(...h.loop.vertices);
      coords.push(...h.pts.flat());
    }
    const tri = restoreDroppedVertices(earcut(coords, holeIdx.length ? holeIdx : undefined, 2), coords);
    for (let t = 0; t < tri.length; t += 3) {
      let a = verts[tri[t]], b = verts[tri[t + 1]], c = verts[tri[t + 2]];
      // orient so the normal points along -plane.normal
      const ax = positions[3 * a], ay = positions[3 * a + 1], az = positions[3 * a + 2];
      const e1 = [positions[3 * b] - ax, positions[3 * b + 1] - ay, positions[3 * b + 2] - az];
      const e2 = [positions[3 * c] - ax, positions[3 * c + 1] - ay, positions[3 * c + 2] - az];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (n[0] * plane.normal[0] + n[1] * plane.normal[1] + n[2] * plane.normal[2] > 0) [b, c] = [c, b];
      if (a !== b && b !== c && a !== c) triangles.push(a, b, c);
    }
    cappedLoops += 1 + holes.length;
  });
  return { triangles, cappedLoops, openCutLoops };
}

/**
 * earcut discards collinear / duplicate outline points, which would leave T-junctions
 * (the cap no longer shares those boundary vertices with the mesh). Re-insert each
 * dropped point by splitting the triangle whose edge passes through it.
 */
function restoreDroppedVertices(tri: number[], coords: number[]): number[] {
  const n = coords.length / 2;
  const used = new Uint8Array(n);
  for (const i of tri) used[i] = 1;
  const out = [...tri];
  for (let v = 0; v < n; v++) {
    if (used[v]) continue;
    const px = coords[2 * v], py = coords[2 * v + 1];
    let best = -1, bestEdge = 0, bestDist = Infinity;
    for (let t = 0; t < out.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = out[t + e], b = out[t + ((e + 1) % 3)];
        const ax = coords[2 * a], ay = coords[2 * a + 1], bx = coords[2 * b], by = coords[2 * b + 1];
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) continue;
        const s = ((px - ax) * dx + (py - ay) * dy) / len2;
        if (s <= 0 || s >= 1) continue;
        const dist = Math.abs((px - ax) * dy - (py - ay) * dx) / Math.sqrt(len2);
        if (dist < bestDist) {
          bestDist = dist;
          best = t;
          bestEdge = e;
        }
      }
    }
    if (best < 0) continue;
    const a = out[best + bestEdge], b = out[best + ((bestEdge + 1) % 3)], c = out[best + ((bestEdge + 2) % 3)];
    out.splice(best, 3, a, v, c, v, b, c);
    used[v] = 1;
  }
  return out;
}
