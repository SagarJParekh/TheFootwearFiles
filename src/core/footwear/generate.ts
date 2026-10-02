/**
 * Footwear generator (shoe / chappal) from the aligned foot scan.
 *
 * The outer shape is a standard product shape; only the footbed is contoured to the foot.
 * Sole (both kinds), in the insole frame on the 1 mm grid:
 *   - outline      = the insole spline shape, scaled to contain the foot + clearance + wall
 *   - footbed top  T = plantar surface − clearance (the only surface that follows the foot)
 *   - outsole      = solid plate on a flat base with a rounded bottom edge, toe spring, tread
 *   - midsole      = conformal tetrahedral lattice from the plate up to the footbed
 *                    (optionally under a smooth solid footbed skin)
 *   - rim          = solid wall around the outline with a level, smooth top line and a
 *                    rounded bead (or an open lattice cage)
 * Chappal: slide = a smooth arched band with pillow edges; thong = two rounded arms from a
 * toe post to the sides at the arch end (split-toe also slots the sole).
 * Shoe: a smooth last-like upper fitted around the foot, with a regular lattice and a collar.
 * Straps and uppers are standard shapes that clear the foot everywhere (see shape.ts).
 *
 * Design rules: strut diameter 1.2–1.8 mm; footbed clearance 1–2 mm; nothing closer than
 * 1 mm (checked on the result).
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { makeMesh, type MeshData } from '../types';
import { frameToWorld, worldToFrame } from '../insole/frame';
import { fillMissing, rasterizeLowestSurface, type Grid } from '../insole/heightfield';
import { buildSolid } from '../insole/solidMesh';
import type { PlantarSurface } from '../insole/generate';
import { signedVolume } from '../mesh/normals';
import { analyzeMesh } from '../mesh/analyze';
import { fillHoles } from '../mesh/fill/fillHoles';
import { rasterizeHighestSurface, signedDistance, sphericalDilate, sphericalErode } from './fields';
import { estimateDorsum } from './dorsum';
import { appendLattice, concatMeshes, conformalLattice, emptyLattice, latticeToMesh, sampleGrid, type Lattice } from './lattice';
import { archPanel, archSheet, fitArchHeight, rowExtent, sectionBetween, smoothAbove, smoothEnvelope, footprintOutline, sweepRounded, type Section } from './shape';
import { FOOTWEAR_RULES, type FootwearKind, type FootwearParams } from './params';
import { MESH_DETAIL } from '../detail';
import { fuseFootwear, type ImplicitSolid } from './fuse';
import { buildShoeBody, type ShoeBody } from './shoeBody';

/** Per-scan data that doesn't depend on the design parameters (cached by the caller). */
export interface FootData {
  surface: PlantarSurface;
  /** Highest surface (dorsum, scanned or estimated), NaN outside the silhouette. */
  top: Float32Array;
  /**
   * Surface the footbed is offset from: the smoothed plantar surface, but never above the raw
   * lowest scan surface (smoothing rounds off the toes and the edges of the sole).
   */
  bed: Float32Array;
  /** Signed distance to the silhouette (mm, negative inside). */
  silhouetteSdf: Float32Array;
  /** Signed distance to the lower part of the foot seen from above (up to 20 mm above the floor): the footprint. */
  lowSilhouetteSdf: Float32Array;
  /** The same up to 35 mm above the floor: the widest part of the foot, without the ankle or leg. */
  midSilhouetteSdf: Float32Array;
  /** Columns where the scan rises above 90 mm (ankle / leg): solid all the way up. */
  legColumn: Uint8Array;
  /** True when the scan itself has the top of the foot. */
  hasDorsum: boolean;
  /** True when the top of the foot was estimated from the footprint (plantar / low scans). */
  dorsumEstimated: boolean;
  /** Foot surface used for clearance checks (scan + estimated dorsum), outward-facing. */
  probePositions: Float32Array;
  probeIndices: Uint32Array;
  bvh: MeshBVH;
}

export function prepareFootData(surface: PlantarSurface, positions: Float32Array, indices: Uint32Array): FootData {
  const g = surface.grid;
  // Floor = lowest scanned sole height (≈ 0 once the base plane is set, but don't rely on it).
  const soleZ: number[] = [];
  for (let k = 0; k < surface.z.length; k++) if (surface.covered[k]) soleZ.push(surface.z[k]);
  soleZ.sort((x, y) => x - y);
  const floor = soleZ.length ? soleZ[Math.floor(soleZ.length * 0.01)] : 0;
  const top = rasterizeHighestSurface(positions, indices, surface.frame, g, floor + 90);
  // (columns of the ankle / leg reach above 90 mm: the capped raster finds the sole inside them)
  const topAll = rasterizeHighestSurface(positions, indices, surface.frame, g, floor + 2000);
  const legColumn = new Uint8Array(top.length);
  for (let k = 0; k < top.length; k++) legColumn[k] = Number.isFinite(topAll[k]) && topAll[k] > floor + 90 ? 1 : 0;
  const lowest = rasterizeLowestSurface(positions, indices, surface.frame, g, 90);
  const bed = surface.z.map((z, k) => (Number.isNaN(lowest[k]) ? z : Math.min(z, lowest[k])));
  // A hole in the scan's sole lets the plantar raster see the top of the foot through it: a spike.
  // Limit how steeply the plantar surface can rise (1.2 mm per mm, steeper than any real sole
  // under the foot) – a chamfer pass forwards and backwards.
  {
    const { nx, ny } = g, s1 = 1.2 * g.h, s2 = 1.2 * g.h * Math.SQRT2;
    const relax = (k: number, n: number, d: number) => {
      if (Number.isFinite(bed[n]) && bed[k] > bed[n] + d) bed[k] = bed[n] + d;
    };
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          if (i > 0) relax(k, k - 1, s1);
          if (j > 0) relax(k, k - nx, s1);
          if (i > 0 && j > 0) relax(k, k - nx - 1, s2);
          if (i < nx - 1 && j > 0) relax(k, k - nx + 1, s2);
        }
      for (let j = ny - 1; j >= 0; j--)
        for (let i = nx - 1; i >= 0; i--) {
          const k = j * nx + i;
          if (i < nx - 1) relax(k, k + 1, s1);
          if (j < ny - 1) relax(k, k + nx, s1);
          if (i < nx - 1 && j < ny - 1) relax(k, k + nx + 1, s2);
          if (i > 0 && j < ny - 1) relax(k, k + nx - 1, s2);
        }
    }
  }
  const mask = new Uint8Array(top.length);
  const heights: number[] = [];
  for (let k = 0; k < top.length; k++) {
    if (Number.isNaN(top[k])) continue;
    mask[k] = 1;
    // (only where the sole is sampled too: a NaN would break the sort and the median)
    if (surface.covered[k] && Number.isFinite(surface.z[k])) heights.push(top[k] - surface.z[k]);
  }
  heights.sort((x, y) => x - y);
  // A full scan rises well above the sole over most of the foot (the top and the sole only meet
  // round the edge and at the toes); a plantar / foam-box scan stays within ~20 mm of it.
  const hasDorsum = heights.length > 0 && heights[Math.floor(heights.length * 0.75)] > 35 && heights[Math.floor(heights.length / 2)] > 15;
  const silhouetteSdf = signedDistance(mask, g);
  // (scans open at the top of the leg: inside the leg the highest surface found is the sole itself)
  for (let k = 0; k < top.length; k++) {
    if (silhouetteSdf[k] < -6 && Number.isFinite(top[k]) && top[k] - bed[k] < 5) legColumn[k] = 1;
  }
  const low = rasterizeHighestSurface(positions, indices, surface.frame, g, floor + 20);
  const lowMask = new Uint8Array(low.length);
  for (let k = 0; k < low.length; k++) lowMask[k] = Number.isNaN(low[k]) ? 0 : 1;
  const lowSilhouetteSdf = signedDistance(lowMask, g);
  const mid = rasterizeHighestSurface(positions, indices, surface.frame, g, floor + 35);
  const midMask = new Uint8Array(mid.length);
  for (let k = 0; k < mid.length; k++) midMask[k] = Number.isNaN(mid[k]) ? 0 : 1;
  const midSilhouetteSdf = signedDistance(midMask, g);

  let probePositions = positions, probeIndices = indices;
  if (hasDorsum) {
    // Full scan. Inside/outside needs a closed surface, but real scans are often open (cut at
    // the ankle, scanner holes): next to an open edge the nearest-point test can put a point
    // 'inside' the foot when it is outside. Close the holes with flat caps for the checks.
    const scan = makeMesh(positions, indices);
    if (!analyzeMesh(scan).watertight) {
      const filled = fillHoles(scan, 'all');
      probePositions = filled.mesh.positions;
      probeIndices = filled.mesh.indices;
    }
    // … and orient it outward.
    if (signedVolume({ positions: probePositions, indices: probeIndices }) < 0) {
      probeIndices = probeIndices.slice();
      for (let t = 0; t < probeIndices.length; t += 3) [probeIndices[t + 1], probeIndices[t + 2]] = [probeIndices[t + 2], probeIndices[t + 1]];
    }
  } else {
    // Sole-only scan: estimate the top of the foot from the footprint; the scan still wins
    // where it reaches higher (e.g. scans that capture the sides).
    const est = estimateDorsum(mask, surface.z, g);
    for (let k = 0; k < top.length; k++) if (mask[k]) top[k] = Math.max(top[k], est[k]);
    // Clearance checks use one closed shell: the dome on top, the scanned sole below and side
    // walls along the footprint edge. The open scan itself would make inside/outside ambiguous
    // where its cut edge meets the dome.
    const combined = buildSolid(g, silhouetteSdf, fillMissing(top, g, 0), fillMissing(bed.map((z, k) => (mask[k] ? z : NaN)), g, 0), (a, b, z) => {
      const [x, y] = frameToWorld(surface.frame, a, b);
      return [x, y, z];
    });
    probePositions = combined.positions;
    probeIndices = combined.indices;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(probePositions, 3));
  geom.setIndex(new THREE.BufferAttribute(probeIndices, 1));
  return {
    surface, top, legColumn, silhouetteSdf, lowSilhouetteSdf, midSilhouetteSdf, bed, hasDorsum, dorsumEstimated: !hasDorsum,
    probePositions, probeIndices, bvh: new MeshBVH(geom),
  };
}

/**
 * Nearest point on the foot scan to (x, y, z): the point, the unit direction from it towards
 * the query (outward when the query is inside the foot) and the signed gap (negative inside).
 */
export function footProbe(foot: FootData) {
  const target = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const pt = new THREE.Vector3(), tmp = new THREE.Vector3(), fn = new THREE.Vector3(), sum = new THREE.Vector3();
  const P = foot.probePositions, I = foot.probeIndices;
  const faceNormal = (f: number, out: THREE.Vector3) => {
    const t = f * 3, A = I[t] * 3, B = I[t + 1] * 3, C = I[t + 2] * 3;
    const e1x = P[B] - P[A], e1y = P[B + 1] - P[A + 1], e1z = P[B + 2] - P[A + 2];
    const e2x = P[C] - P[A], e2y = P[C + 1] - P[A + 1], e2z = P[C + 2] - P[A + 2];
    return out.set(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x).normalize();
  };
  return (x: number, y: number, z: number) => {
    pt.set(x, y, z);
    foot.bvh.closestPointToPoint(pt, target as never);
    const q = target.point.clone();
    const d = target.distance;
    let dx = x - q.x, dy = y - q.y, dz = z - q.z;
    // Outward normal at the nearest point (the probe mesh is wound outward). When that point is
    // on an edge or corner, one face's normal can give the wrong side: average the normals of
    // all faces touching it instead (pseudo-normal).
    const n = faceNormal(target.faceIndex, fn).clone();
    if (d > 1e-6 && Math.abs(dx * n.x + dy * n.y + dz * n.z) < 0.9 * d) {
      sum.set(0, 0, 0);
      const eps = 1e-3 + d * 1e-4;
      foot.bvh.shapecast({
        intersectsBounds: (box: THREE.Box3) => box.distanceToPoint(pt) <= d + eps,
        intersectsTriangle: (tri: THREE.Triangle, i: number) => {
          if (tri.closestPointToPoint(pt, tmp).distanceTo(pt) <= d + eps) sum.add(faceNormal(i, fn));
          return false;
        },
      } as never);
      if (sum.lengthSq() > 1e-12) n.copy(sum.normalize());
    }
    const inside = dx * n.x + dy * n.y + dz * n.z < 0;
    if (d < 1e-6 || inside) [dx, dy, dz] = [n.x, n.y, n.z];
    else [dx, dy, dz] = [dx / d, dy / d, dz / d];
    return { x: q.x, y: q.y, z: q.z, dx, dy, dz, gap: inside ? -d : d };
  };
}

export interface RuleCheck {
  rule: string;
  value: string;
  ok: boolean;
}

export interface FootwearResult {
  mesh: MeshData;
  /** Closed solid parts + lattice (for merging into one watertight solid on export). */
  parts: { solids: MeshData[]; lattice: Lattice; heightSolids?: HeightSolid[] };
  kind: FootwearKind;
  length: number;
  width: number;
  strutCount: number;
  nodeCount: number;
  /** Lattice strut diameters (mm), excluding the solid collar rim. */
  strut: { min: number; max: number };
  /** Measured gap between the foot and the contoured footbed (mm). */
  clearance: { min: number; max: number };
  /** Smallest gap between the foot and any part (toe post excluded) (mm). */
  minGap: number;
  /** Gap range between the foot and the straps / upper (standard shapes, so it varies) (mm). */
  upperGap: { min: number; max: number } | null;
  /** Shoe: vertical gap from the top of the collar rim to each malleolus (mm; null = not placed / not over the opening). */
  ankle: { medial: number | null; lateral: number | null } | null;
  rules: RuleCheck[];
  warnings: string[];
  /** Toe post (thong / split-toe) in frame coordinates (a, b), else null. */
  toePost: [number, number] | null;
}

/** Measurement tolerance of the clearance rule (mm) – below FDM/TPU print accuracy. */
export const FOOTWEAR_CLEARANCE_TOLERANCE = 0.1;

/**
 * Pushes vertices of a closed part that are closer to the foot than `c` directly away from the
 * nearest foot point (positions only – the part stays closed). Returns the part.
 */
function keepClear(m: MeshData, probe: ReturnType<typeof footProbe>, c: number): MeshData {
  const P = m.positions;
  for (let i = 0; i < P.length; i += 3) {
    for (let it = 0; it < 4; it++) {
      const q = probe(P[i], P[i + 1], P[i + 2]);
      if (q.gap >= c - 0.02) break;
      const o = c + 0.02;
      P[i] = q.x + q.dx * o;
      P[i + 1] = q.y + q.dy * o;
      P[i + 2] = q.z + q.dz * o;
    }
  }
  return m;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Distance from p to segment ab. */
function segDist(pa: number, pb: number, a: [number, number], b: [number, number]): number {
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((pa - a[0]) * ex + (pb - a[1]) * ey) / (ex * ex + ey * ey || 1)));
  return Math.hypot(pa - a[0] - ex * t, pb - a[1] - ey * t);
}

/** Tread relief (0…1, 1 = groove centre) at frame point (a, b). */
function treadGroove(pattern: FootwearParams['tread'], a: number, b: number): number {
  const w = 1; // half groove width (mm)
  if (pattern === 'hexagon') {
    // Hex tiling with 9 mm cells: distance to the nearest cell border.
    const s = 9, hx = s * Math.sqrt(3);
    const cands: [number, number][] = [];
    const bi = Math.round(b / (1.5 * s));
    for (const j of [bi - 1, bi, bi + 1]) {
      const off = (((j % 2) + 2) % 2) * (hx / 2);
      const ai = Math.round((a - off) / hx);
      for (const i of [ai - 1, ai, ai + 1]) cands.push([i * hx + off, j * 1.5 * s]);
    }
    cands.sort((p, q) => Math.hypot(a - p[0], b - p[1]) - Math.hypot(a - q[0], b - q[1]));
    const [c1, c2] = cands;
    // distance to the bisector between the two nearest centres ≈ distance to the border
    const mx = (c1[0] + c2[0]) / 2, my = (c1[1] + c2[1]) / 2;
    const dx = c2[0] - c1[0], dy = c2[1] - c1[1], dl = Math.hypot(dx, dy);
    const d = Math.abs(((a - mx) * dx + (b - my) * dy) / dl);
    return smoothstep(w + 0.8, w - 0.3, d);
  }
  if (pattern === 'diamond') {
    const s = 8;
    const u = (a + b) / Math.SQRT2, v = (a - b) / Math.SQRT2;
    const d = Math.min(Math.abs(u - Math.round(u / s) * s), Math.abs(v - Math.round(v / s) * s));
    return smoothstep(w + 0.8, w - 0.3, d);
  }
  if (pattern === 'waves') {
    const s = 7, bb = b + 3 * Math.sin(a / 9);
    const d = Math.abs(bb - Math.round(bb / s) * s);
    return smoothstep(w + 1, w - 0.2, d);
  }
  return 0;
}

/**
 * Height-map interpolation error bound per node: a quarter of the largest second difference in
 * its 3×3 neighbourhood (the chord error of linear interpolation is ≤ h²·|f''|/8, and the
 * rasterised scan has an error of the same order), capped at 0.8 mm.
 */
function curvatureMargin(f: Float32Array, g: Grid): Float32Array {
  const { nx, ny } = g;
  const d2 = new Float32Array(f.length);
  for (let j = 1; j < ny - 1; j++)
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      const x = f[k - 1] + f[k + 1] - 2 * f[k], y = f[k - nx] + f[k + nx] - 2 * f[k];
      const v = Math.max(Number.isNaN(x) ? 0 : Math.abs(x), Number.isNaN(y) ? 0 : Math.abs(y));
      d2[k] = v;
    }
  const out = new Float32Array(f.length);
  for (let j = 1; j < ny - 1; j++)
    for (let i = 1; i < nx - 1; i++) {
      let m = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) m = Math.max(m, d2[(j + dj) * nx + i + di]);
      out[j * nx + i] = Math.min(0.8, m / 4);
    }
  return out;
}

/**
 * Triangulated cage along the outline (strut axes one radius inside it): rings at evenly
 * spaced heights between `lower` and `upper`, joined by alternating diagonals.
 */
function sideCage(
  g: Grid, sdf: Float32Array, lower: Float32Array, upper: Float32Array, cell: number, r: number,
  toWorld: (a: number, b: number, z: number) => [number, number, number],
): Lattice {
  // Centre of the region, then the contour by ray marching (the outline is star-shaped from it).
  let ca = 0, cb = 0, n = 0;
  for (let k = 0; k < sdf.length; k++) {
    if (sdf[k] >= 0) continue;
    ca += g.a0 + (k % g.nx) * g.h;
    cb += g.b0 + Math.floor(k / g.nx) * g.h;
    n++;
  }
  ca /= n;
  cb /= n;
  const raw: [number, number][] = [];
  for (let s = 0; s < 720; s++) {
    const th = (2 * Math.PI * s) / 720, da = Math.cos(th), db = Math.sin(th);
    let t = 0;
    while (t < 400 && sampleGrid(g, sdf, ca + da * t, cb + db * t) < -r) t += 0.5;
    let lo = Math.max(0, t - 0.5), hi = t;
    for (let it = 0; it < 12; it++) {
      const mid = (lo + hi) / 2;
      if (sampleGrid(g, sdf, ca + da * mid, cb + db * mid) < -r) lo = mid;
      else hi = mid;
    }
    raw.push([ca + da * lo, cb + db * lo]);
  }
  // Resample by arc length to about one cell per segment.
  const cum = [0];
  for (let i = 1; i <= raw.length; i++) {
    const [pa, pb] = raw[i - 1], [qa, qb] = raw[i % raw.length];
    cum.push(cum[i - 1] + Math.hypot(qa - pa, qb - pb));
  }
  const perimeter = cum[cum.length - 1];
  const m = Math.max(12, Math.round(perimeter / cell));
  const ring: [number, number][] = [];
  for (let i = 0, seg = 0; i < m; i++) {
    const target = (perimeter * i) / m;
    while (cum[seg + 1] < target) seg++;
    const f = (target - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
    const [pa, pb] = raw[seg], [qa, qb] = raw[(seg + 1) % raw.length];
    ring.push([pa + (qa - pa) * f, pb + (qb - pb) * f]);
  }
  const heights = ring.map(([a, b]) => sampleGrid(g, upper, a, b) - r - sampleGrid(g, lower, a, b));
  const levels = Math.max(1, Math.round(heights.reduce((x, y) => x + y, 0) / heights.length / (0.85 * cell)));
  const out = emptyLattice();
  const id = (i: number, k: number) => k * m + (((i % m) + m) % m);
  for (let k = 0; k <= levels; k++) {
    for (const [a, b] of ring) {
      const lo = sampleGrid(g, lower, a, b), hi = sampleGrid(g, upper, a, b) - r;
      out.nodes.push(...toWorld(a, b, lo + ((hi - lo) * k) / levels));
    }
  }
  const edge = (p: number, q: number) => {
    out.edges.push(p, q);
    out.radii.push(r);
  };
  for (let k = 0; k <= levels; k++) {
    for (let i = 0; i < m; i++) {
      if (k > 0) edge(id(i, k), id(i, k - 1)); // posts
      if (k === 0 || k === levels) edge(id(i, k), id(i + 1, k)); // bottom and top rings
      if (k < levels) edge((i + k) % 2 ? id(i, k) : id(i + 1, k), (i + k) % 2 ? id(i + 1, k + 1) : id(i, k + 1)); // diagonals
    }
  }
  return out;
}

/** A solid part that is a height field on the grid: inside where sdf < 0 and bottom < z < top. */
export interface HeightSolid {
  index: number;
  sdf: Float32Array;
  top: Float32Array;
  bottom: Float32Array;
}

/**
 * The solid parts smoothly fused into one watertight surface (fillets at every junction, like the
 * reference designs), with the clearance rule re-applied to it. The lattice stays separate
 * (it overlaps the fused solids, as before). Height-field parts (sole plate, rim) are fused from
 * their fields (fast and exact), the other parts from their meshes.
 */
export function fuseFootwearSolids(foot: FootData, r: FootwearResult, clearance: number, voxel: number, blend = 2.5): MeshData {
  const { frame, grid: g } = foot.surface;
  const hs = r.parts.heightSolids ?? [];
  const fieldIdx = new Set(hs.map((x) => x.index));
  const implicit: ImplicitSolid[] = hs.map((x) => {
    const m = r.parts.solids[x.index];
    const box = new THREE.Box3().setFromArray(m.positions);
    return {
      box,
      f: (px: number, py: number, pz: number) => {
        const [a, b] = worldToFrame(frame, px, py);
        return Math.max(sampleGrid(g, x.sdf, a, b), sampleGrid(g, x.bottom, a, b) - pz, pz - sampleGrid(g, x.top, a, b));
      },
    };
  });
  const meshes = r.parts.solids.filter((_, i) => !fieldIdx.has(i));
  const fused = fuseFootwear({ solids: meshes, implicit, lattice: emptyLattice() }, { voxel, blendSolids: blend, blendLattice: 0.9 });
  // fillets add a little material: keep the clearance to the foot
  const probe = footProbe(foot);
  let zLo = Infinity;
  for (let k = 0; k < foot.bed.length; k++) if (Number.isFinite(foot.bed[k])) zLo = Math.min(zLo, foot.bed[k]);
  const P = fused.positions;
  for (let i = 0; i < P.length; i += 3) {
    if (P[i + 2] < zLo - clearance - 1) continue;
    // only near the foot: over its silhouette (+ margin) and not well below the sole or above the top
    const [a, b] = worldToFrame(frame, P[i], P[i + 1]);
    if (sampleGrid(g, foot.silhouetteSdf, a, b) > clearance + 3) continue;
    // the toe post sits between the toes by design (it is not held to the clearance)
    if (r.toePost && Math.hypot(a - r.toePost[0], b - r.toePost[1]) < 10) continue;
    const zb = sampleGrid(g, foot.bed, a, b), zt = sampleGrid(g, foot.top, a, b);
    if (Number.isFinite(zb) && P[i + 2] < zb - clearance - 3) continue;
    if (Number.isFinite(zt) && P[i + 2] > zt + clearance + 3) continue;
    for (let it = 0; it < 3; it++) {
      const q = probe(P[i], P[i + 1], P[i + 2]);
      if (q.gap >= clearance - 0.02) break;
      P[i] = q.x + q.dx * (clearance + 0.02);
      P[i + 1] = q.y + q.dy * (clearance + 0.02);
      P[i + 2] = q.z + q.dz * (clearance + 0.02);
    }
  }
  return fused;
}

/**
 * keepClear for a big implicit mesh: only vertices near the foot (over its silhouette, between
 * just below the sole and just above the top) are checked against the scan.
 */
function keepClearNear(m: MeshData, foot: FootData, probe: ReturnType<typeof footProbe>, c: number): MeshData {
  const { frame, grid: g } = foot.surface;
  const P = m.positions;
  for (let i = 0; i < P.length; i += 3) {
    const [a, b] = worldToFrame(frame, P[i], P[i + 1]);
    if (sampleGrid(g, foot.silhouetteSdf, a, b) > c + 3) continue;
    const zb = sampleGrid(g, foot.bed, a, b), zt = sampleGrid(g, foot.top, a, b);
    if (Number.isFinite(zb) && P[i + 2] < zb - c - 3) continue;
    if (Number.isFinite(zt) && P[i + 2] > zt + c + 3) continue;
    for (let it = 0; it < 3; it++) {
      const q = probe(P[i], P[i + 1], P[i + 2]);
      if (q.gap >= c - 0.02) break;
      P[i] = q.x + q.dx * (c + 0.02);
      P[i + 1] = q.y + q.dy * (c + 0.02);
      P[i + 2] = q.z + q.dz * (c + 0.02);
    }
  }
  return m;
}

export function generateFootwear(foot: FootData, p: FootwearParams): FootwearResult {
  const { surface } = foot;
  const { frame, grid: g } = surface;
  const nodeCount = g.nx * g.ny;
  const c = p.clearance, r = p.strutDiameter / 2, wall = p.wallThickness;
  const det = MESH_DETAIL[p.detail];
  const warnings: string[] = [];
  const toWorld = (a: number, b: number, z: number): [number, number, number] => {
    const [x, y] = frameToWorld(frame, a, b);
    return [x, y, z];
  };
  const [a1, b1] = frame.met1, [a5, b5] = frame.met5;
  const bMT = (b1 + b5) / 2;
  const at = (f: Float32Array, a: number, b: number) => sampleGrid(g, f, a, b);

  // --- foot extent --------------------------------------------------------------------------
  let silBack = Infinity, silFront = -Infinity;
  const rowMin = new Float32Array(g.ny).fill(Infinity), rowMax = new Float32Array(g.ny).fill(-Infinity);
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      if (foot.silhouetteSdf[j * g.nx + i] >= 0) continue;
      const a = g.a0 + i * g.h, b = g.b0 + j * g.h;
      silBack = Math.min(silBack, b);
      silFront = Math.max(silFront, b);
      rowMin[j] = Math.min(rowMin[j], a);
      rowMax[j] = Math.max(rowMax[j], a);
    }
  if (!Number.isFinite(silBack)) throw new Error('The scan has no footprint – check the alignment and landmarks.');
  const footLen = silFront - silBack;

  // --- sole outline: the footprint grown, faired -------------------------------------------
  // Like the reference soles: the footprint plus the clearance, the rim wall and a little room
  // (more in front of the toes), and the widest part of the foot up to 35 mm above the floor plus
  // the clearance. The ankle and leg of a full scan don't count.
  const need = new Float32Array(nodeCount);
  const bToes = (b1 + b5) / 2;
  for (let j = 0; j < g.ny; j++) {
    const b = g.b0 + j * g.h;
    const extra = c + wall + 1.5 + p.toeAllowance * smoothstep(bToes, silFront, b);
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      need[k] = Math.min(foot.lowSilhouetteSdf[k] - extra, foot.midSilhouetteSdf[k] - c - 0.5);
    }
  }
  const { poly, sdf: stdSdf } = footprintOutline(g, need);
  const toePost = (): [number, number] => {
    // between the 1st and 2nd toes: 18 % across the MT line, ~9 % of the foot length distal of it
    const dA = a5 - a1, dB = b5 - b1, len = Math.hypot(dA, dB) || 1;
    let nA = -dB / len, nB = dA / len;
    if (nB < 0) [nA, nB] = [-nA, -nB];
    const d = 0.09 * footLen;
    return [a1 + 0.18 * dA + nA * d, b1 + 0.18 * dB + nB * d];
  };
  /**
   * The web between the big toe and the 2nd toe, found on the scan: going forward row by row
   * from the metatarsal heads, the first dip in the height of the top of the foot (or a gap in
   * it) lateral of the big toe. The web is the most proximal point of that cleft. Null when the
   * scan doesn't show it (toes pressed together, or a sole-only scan).
   */
  const toeWeb = (): [number, number] | null => {
    const m = frame.medialSign;
    const bStart = Math.min(b1, b5) - 5;
    const found: { b: number; a: number }[] = [];
    for (let b = bStart; b <= silFront - 8; b += 1) {
      // height profile from the medial edge towards the lateral side (gaps count as the floor)
      const prof: { a: number; h: number }[] = [];
      let started = false;
      for (let q = 0; q <= 70; q += 0.5) {
        const a = a1 + m * 25 - m * q; // from 25 mm medial of M1 across
        const h = at(foot.top, a, b), z0 = at(foot.bed, a, b);
        const hh = Number.isFinite(h) ? h - (Number.isFinite(z0) ? z0 : 0) : 0;
        if (!started && hh <= 2) continue;
        started = true;
        prof.push({ a, h: hh });
      }
      if (prof.length < 10) continue;
      // hallux crown: highest point in the first 35 mm; then the lowest point before the next rise
      let crown = 0;
      for (let k = 0; k < prof.length && k < 50; k++) if (prof[k].h > prof[crown].h) crown = k;
      let valley = crown;
      for (let k = crown; k < prof.length; k++) {
        if (prof[k].h < prof[valley].h) valley = k;
        if (prof[k].h > prof[valley].h + 4) break; // rising onto the 2nd toe
      }
      let next = 0;
      for (let k = valley; k < prof.length; k++) next = Math.max(next, prof[k].h);
      const depth = Math.min(prof[crown].h, next) - prof[valley].h;
      // the big toe is the medial ~quarter of the forefoot: the web lies 12–42 % across from the
      // medial edge (the clefts between the lesser toes, often further back, are further out)
      let last = prof.length - 1;
      while (last > 0 && prof[last].h <= 2) last--;
      const across = (valley * 0.5) / Math.max(1, last * 0.5);
      if (depth > 3 && valley > crown && prof[valley].h < prof[crown].h - 3 && across > 0.12 && across < 0.42) found.push({ b, a: prof[valley].a });
    }
    // the cleft must continue forward (8 mm) from its base
    for (let i = 0; i < found.length; i++) {
      const run = found.filter((f) => f.b >= found[i].b && f.b <= found[i].b + 8);
      if (run.length >= 7) {
        const as = run.map((f) => f.a).sort((x, y) => x - y);
        return [as[as.length >> 1], found[i].b + 5];
      }
    }
    return null;
  };
  const web = foot.hasDorsum ? toeWeb() : null;
  const post = web ?? toePost();
  const thong = p.kind === 'chappal' && p.chappalStyle !== 'slide';
  const splitToe = p.kind === 'chappal' && p.chappalStyle === 'splitToe';
  /** Distance to the split-toe slot axis (Infinity without a slot). */
  const slotDist = new Float32Array(nodeCount).fill(Infinity);
  const outlineSdf = stdSdf.slice();
  if (splitToe) {
    for (let k = 0; k < nodeCount; k++) {
      const a = g.a0 + (k % g.nx) * g.h, b = g.b0 + Math.floor(k / g.nx) * g.h;
      slotDist[k] = segDist(a, b, [post[0], post[1] + 4], [post[0] + (post[0] - a1) * 0.1, post[1] + 150]);
      outlineSdf[k] = Math.max(outlineSdf[k], -(slotDist[k] - 1.6));
    }
  }
  let outBack = Infinity, outFront = -Infinity, wMin = Infinity, wMax = -Infinity;
  for (const [a, b] of poly) {
    outBack = Math.min(outBack, b);
    outFront = Math.max(outFront, b);
    wMin = Math.min(wMin, a);
    wMax = Math.max(wMax, a);
  }
  const length = outFront - outBack;

  // --- footbed (the only part contoured to the foot), base, outsole ---------------------------
  // Footbed top: the plantar surface offset down by the clearance along its normal.
  const T = sphericalErode(foot.bed, g, c);
  let minT = Infinity;
  for (let k = 0; k < nodeCount; k++) if (outlineSdf[k] < 0) minT = Math.min(minT, T[k]);
  const baseZ = minT - p.soleThickness;
  const minStack = p.outsoleThickness + 2 * r + 1.5;
  /** Rounded-edge drop: how far a fillet of radius R lies below the flat, at distance x from the edge. */
  const drop = (x: number, R: number) => (x >= R || R <= 0 ? 0 : R - Math.sqrt(Math.max(0, R * R - (R - Math.max(0, x)) ** 2)));
  const Rbottom = 6;
  const B = new Float32Array(nodeCount); // flat base (+ toe spring)
  const Bwall = new Float32Array(nodeCount); // with the rounded bottom edge (the rim wall's underside)
  const Bround = new Float32Array(nodeCount); // the outsole's underside: the same, thinning out under the wall
  const Btread = new Float32Array(nodeCount);
  const plateTop = new Float32Array(nodeCount);
  for (let j = 0; j < g.ny; j++) {
    const b = g.b0 + j * g.h;
    const spring = p.toeSpring * Math.pow(smoothstep(bMT + 10, outFront, b), 1.5);
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const a = g.a0 + i * g.h;
      B[k] = Math.min(baseZ + spring, T[k] - minStack);
      plateTop[k] = B[k] + p.outsoleThickness;
      Bwall[k] = B[k] + drop(-stdSdf[k], Rbottom);
      Bround[k] = Math.min(Bwall[k], plateTop[k] - 0.4);
      const tread = p.tread !== 'none' && outlineSdf[k] < -4 ? treadGroove(p.tread, a, b) * smoothstep(-4, -7, outlineSdf[k]) : 0;
      Btread[k] = Bround[k] + Math.min(1, p.outsoleThickness * 0.45) * tread;
    }
  }
  const solids: MeshData[] = [];
  solids.push(buildSolid(g, outlineSdf, plateTop, Btread, toWorld));
  const heightSolids: HeightSolid[] = [{ index: 0, sdf: outlineSdf, top: plateTop, bottom: Btread }];
  const scanProbe = footProbe(foot); // exact checks against the scan (height maps are approximate)

  // --- rim: a level, smooth line around the footbed (not following the foot) ----------------
  // Per row, the highest footbed point a little inside the footprint's edge (not up the steep side
  // of the heel), then a smooth upper envelope along the foot.
  const rowEdge: number[] = [];
  for (let j = 0; j < g.ny; j++) {
    let m = -Infinity;
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      if (outlineSdf[k] < 0 && foot.lowSilhouetteSdf[k] < -6 && foot.lowSilhouetteSdf[k] > -11) m = Math.max(m, T[k]);
    }
    rowEdge.push(m);
  }
  let lastFinite = rowEdge.find(Number.isFinite) ?? minT;
  for (let j = 0; j < g.ny; j++) (Number.isFinite(rowEdge[j]) ? (lastFinite = rowEdge[j]) : (rowEdge[j] = lastFinite));
  const edgeLine = smoothEnvelope(rowEdge, Math.round(25 / g.h));
  const toeLip = p.kind === 'chappal' ? 0.6 * p.rimHeight : 0;
  const rimZ = (b: number) => {
    const j = Math.min(g.ny - 1, Math.max(0, Math.round((b - g.b0) / g.h)));
    const sLen = (b - outBack) / (length || 1);
    // highest round the heel, lower along the sides, and (chappals) a toe bumper that turns up
    // round the front like the reference slides
    return edgeLine[j] + p.rimHeight * (0.7 + 0.3 * smoothstep(0.65, 0.2, sLen)) + toeLip * smoothstep(0.86, 1, sLen);
  };
  // Outside the area the foot rests on, the footbed curves up to the rim but never over it (the
  // scan's sides rise steeply near the edge). Under the foot it keeps following the sole exactly.
  for (let j = 0; j < g.ny; j++) {
    const cap = rimZ(g.b0 + j * g.h) - 1.5;
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const f = smoothstep(-6, -2, foot.lowSilhouetteSdf[k]); // 0 under the foot, 1 outside it
      if (f > 0 && T[k] > cap) T[k] -= (T[k] - cap) * f;
    }
  }
  const ringSdf = new Float32Array(nodeCount);
  const rimTop = new Float32Array(nodeCount);
  const Ro = Math.min(2.5, 0.45 * wall), Ri = Math.min(2, 0.4 * wall);
  for (let j = 0; j < g.ny; j++) {
    const b = g.b0 + j * g.h;
    const z = rimZ(b);
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const d = -outlineSdf[k]; // distance in from the outer edge
      ringSdf[k] = Math.max(outlineSdf[k], -outlineSdf[k] - wall);
      // rounded bead: fillets on the outer and the inner top edge
      const top = z - drop(d, Ro) - drop(wall - d, Ri);
      // no rim along the split-toe slot (it would rise between the toes): flush with the footbed
      rimTop[k] = T[k] + 0.5 + (Math.max(top, T[k] + 0.5) - T[k] - 0.5) * smoothstep(1.6 + wall, 1.6 + wall + 6, slotDist[k]);
    }
  }
  if (p.sideWall === 'solid') {
    heightSolids.push({ index: solids.length, sdf: ringSdf, top: rimTop, bottom: Bwall });
    solids.push(keepClear(buildSolid(g, ringSdf, rimTop, Bwall, toWorld), scanProbe, c));
  }

  // Optional smooth footbed skin (solid) on the contoured footbed, over the lattice.
  const SKIN = 1.2;
  // (shoes: the solid finish has its own footbed; the lattice finish may have the skin)
  const skinOn = p.footbedSkin && (p.kind !== 'shoe' || p.shoe.finish === 'lattice');
  let skinSolid = -1;
  if (skinOn) {
    const inner = outlineSdf.map((d) => d + wall - 0.3);
    const under = T.map((z) => z - SKIN);
    const skin = buildSolid(g, inner, T, under, toWorld);
    // Check the skin's top against the scan (as for the lattice nodes): under the foot it sits
    // exactly at the clearance; anywhere else it is only pushed down if too close. Top and
    // bottom copies move together (buildSolid: top vertices first, then the bottom copies).
    const P = skin.positions, nTop = P.length / 6;
    for (let v = 0; v < nTop; v++) {
      const [a, b] = worldToFrame(frame, P[3 * v], P[3 * v + 1]);
      const under = at(foot.lowSilhouetteSdf, a, b) < -4;
      for (let it = 0; it < 5; it++) {
        const gap = scanProbe(P[3 * v], P[3 * v + 1], P[3 * v + 2]).gap;
        const tooClose = gap < c - 0.02, tooFar = under && gap > c + 0.05;
        if (!tooClose && !tooFar) break;
        const dz = (gap - c) * (tooClose ? 1.05 : 0.9);
        P[3 * v + 2] += dz;
        P[3 * (v + nTop) + 2] += dz;
      }
    }
    skinSolid = solids.length;
    solids.push(skin);
  }

  // --- midsole lattice ----------------------------------------------------------------------
  const topSurface = skinOn ? T.map((z) => z - SKIN + 0.3) : T;
  const stacks: number[] = [];
  for (let k = 0; k < nodeCount; k++) if (outlineSdf[k] < -wall) stacks.push(topSurface[k] - plateTop[k]);
  stacks.sort((x, y) => x - y);
  const medianStack = stacks[Math.floor(stacks.length / 2)] ?? p.soleThickness;
  const layers = Math.max(1, Math.min(6, Math.round(medianStack / (0.82 * p.cellSize))));
  const lattice = emptyLattice();
  const midsole = conformalLattice({
    // strut centres one radius below the footbed along its normal (exact on its steep edges)
    grid: g, lower: plateTop, upper: sphericalErode(topSurface, g, r), cell: p.cellSize, radius: r, layers, toWorld,
    inside: (a, b) => sampleGrid(g, outlineSdf, a, b) < -0.3,
  });
  // Check the footbed against the scan itself: nodes too close move straight down; under the foot
  // the (open) top layer also moves up where smoothing left it further than the clearance.
  const underFoot = new Set(midsole.topNodes.filter((v) => {
    const [a, b] = worldToFrame(frame, midsole.nodes[3 * v], midsole.nodes[3 * v + 1]);
    return sampleGrid(g, foot.lowSilhouetteSdf, a, b) < -4; // on the footprint (the foot rests here), not the toe allowance / edge
  }));
  {
    const Nn = midsole.nodes;
    const target = skinOn ? c + SKIN - 0.3 : c;
    for (let v = 0; v < Nn.length / 3; v++) {
      const [a, b] = worldToFrame(frame, Nn[3 * v], Nn[3 * v + 1]);
      const floor = sampleGrid(g, plateTop, a, b);
      for (let it = 0; it < 6; it++) {
        const gap = scanProbe(Nn[3 * v], Nn[3 * v + 1], Nn[3 * v + 2]).gap - r;
        const tooClose = gap < target - 0.02 && Nn[3 * v + 2] > floor;
        const tooFar = !skinOn && underFoot.has(v) && gap > c + 0.05;
        if (!tooClose && !tooFar) break;
        Nn[3 * v + 2] = Math.max(floor, Nn[3 * v + 2] + (gap - target) * (tooClose ? 1.05 : 0.9));
      }
    }
  }
  appendLattice(lattice, midsole); // first: node ids unchanged

  // Lattice side wall option: a triangulated cage just inside the outline (anchored in the plate).
  let cageStart = lattice.nodes.length / 3;
  if (p.sideWall === 'lattice' && p.kind !== 'shoe') appendLattice(lattice, sideCage(g, outlineSdf, plateTop, rimTop, p.cellSize, r, toWorld));

  if (foot.dorsumEstimated) {
    warnings.push(
      `The scan has no top of the foot, so the ${p.kind === 'shoe' ? 'upper is' : 'straps are'} fitted around an estimated foot shape (from the footprint and foot length). Check the fit, or use a full foot scan.`,
    );
  }

  // --- straps / upper: standard shapes fitted around the foot ------------------------------
  // Required surface height = top of the foot + clearance (+ a margin where the dorsum curves
  // sharply, which the 1 mm height map under-represents).
  const Hc = sphericalDilate(foot.top, g, c);
  const curv = curvatureMargin(Hc, g);
  for (let k = 0; k < nodeCount; k++) if (!Number.isNaN(Hc[k])) Hc[k] += curv[k];
  const hcAt = (a: number, b: number) => at(Hc, a, b); // NaN outside the foot
  const extentAt = (b: number, inset: number) => {
    const e = rowExtent(poly, b);
    if (!e) return null;
    const ac = (e[0] + e[1]) / 2, hw = (e[1] - e[0]) / 2 - inset;
    return hw > 2 ? { ac, hw } : null;
  };
  /** Half width the section must reach above its base to go round the foot at b. */
  const footHalfAt = (b: number, ac: number) => {
    const j = Math.min(g.ny - 1, Math.max(0, Math.round((b - g.b0) / g.h)));
    return Number.isFinite(rowMin[j]) ? Math.max(ac - rowMin[j], rowMax[j] - ac) : 0;
  };
  /** Points (a, z) the section must enclose at b: top of the foot + clearance + extra. */
  const reqPts = (b: number, extra: number, zMax = Infinity) => {
    const pts: [number, number][] = [];
    for (let a = g.a0; a <= g.a0 + (g.nx - 1) * g.h; a += 1) {
      const v = hcAt(a, b);
      if (Number.isFinite(v) && v <= zMax) pts.push([a, v + extra]);
    }
    return pts;
  };
  const strapSolids: number[] = [];
  let postSolid = -1;
  let upperStart = -1, upperEnd = Infinity;
  let shoeFootbed: number[] | null = null;
  const collarEdges = new Set<number>();

  /**
   * Arch sections every 1 mm from b0 to b1, standing on the rim (inset `inset` from the outline),
   * each just high enough to clear the foot, then smoothed along the foot (one flowing top line
   * and side bulge, not a copy of the foot).
   */
  const archRows = (b0: number, b1: number, inset: number, extra: number, pExp: number, bFit = b0, taper = 0.12): Section[] => {
    // Only rows from bFit on are fitted around the foot; behind it the sheet only exists low down
    // at the sides, so those rows keep the first fitted row's arch (a full scan's ankle and leg
    // would otherwise blow them up).
    const raw: { b: number; ac: number; hw: number; bulge: number; zBase: number }[] = [];
    for (let b = b0; b <= b1 + 1e-6; b += 1) {
      const e = extentAt(b, inset);
      if (e) raw.push({ b, ...e, bulge: Math.max(0, footHalfAt(Math.max(b, bFit), e.ac) + c + 0.8 - e.hw), zBase: rimZ(b) - 2 });
    }
    const bulge = smoothEnvelope(raw.map((row) => row.bulge), 12);
    // crown over the highest part of the foot (the instep is medial of the middle), smoothed
    const crownRaw = raw.map((row) => {
      const pts = reqPts(Math.max(row.b, bFit), 0);
      if (!pts.length) return row.ac;
      const zMax = Math.max(...pts.map(([, z]) => z));
      const hi = pts.filter(([, z]) => z > zMax - 6);
      return hi.reduce((acc, [a]) => acc + a, 0) / hi.length;
    });
    const crown = crownRaw.map((_, i) => {
      let acc = 0, wt = 0;
      for (let q = -15; q <= 15; q++) {
        const v = crownRaw[Math.min(raw.length - 1, Math.max(0, i + q))], w = Math.exp(-(q * q) / 50);
        acc += v * w;
        wt += w;
      }
      const row = raw[i];
      return Math.min(row.ac + 0.35 * row.hw, Math.max(row.ac - 0.35 * row.hw, acc / wt));
    });
    const req = raw.map((row, i) => (row.b < bFit ? 0 : fitArchHeight({ b: row.b, ac: row.ac, hw: row.hw, hwMax: row.hw + bulge[i], zBase: row.zBase, p: pExp, aTop: crown[i], taper }, reqPts(row.b, extra), 12)));
    const first = req.findIndex((_, i) => raw[i].b >= bFit);
    for (let i = 0; i < first; i++) req[i] = req[first];
    const hs = smoothAbove(req, 8);
    return raw.map((row, i) => ({ b: row.b, ac: row.ac, hw: row.hw, hwMax: row.hw + bulge[i], zBase: row.zBase, hs: hs[i], p: pExp, aTop: crown[i], taper }));
  };
  /** Pillow edges: full thickness in the middle of the sheet, rounded off towards both edges. */
  const pillow = (t: number) => (s: number) => Math.max(0.7, t * Math.pow(Math.max(0, 1 - Math.abs(2 * s - 1) ** 6), 0.3));
  /** A strap / wing sheet: smooth and solid, or an open lattice panel with a solid border. */
  const addSheet = (rows: Section[], back: (u: number) => number, front: (u: number) => number, t: number) => {
    if (p.strapPattern === 'lattice') {
      const panel = archPanel({ rows, back, front, thickness: t, border: 7, cell: Math.max(7, p.cellSize * 1.4), radius: r, toWorld, detail: det.surface });
      for (const m of panel.solids) {
        strapSolids.push(solids.length);
        solids.push(m);
      }
      appendLattice(lattice, panel.lattice);
    } else {
      strapSolids.push(solids.length);
      solids.push(archSheet({ rows, back, front, thickness: pillow(t), toWorld, M: 56 * det.surface, N: 40 * det.surface }));
    }
  };

  if (p.kind === 'chappal' && !thong) {
    // Slide (like the reference slides): one wide vamp that grows out of the side walls. Its
    // front edge runs straight across over the toe joints; its back edge sweeps from the top of
    // the instep down and back to the rim, so from the side the strap is a long diagonal.
    const t = p.strap.thickness, w = p.strap.width;
    const bFront = Math.min(silBack + p.strap.position * footLen + w / 2, silFront - 18);
    const bBackTop = bFront - w;
    const bBackSide = Math.max(silBack + 0.22 * footLen, bBackTop - 0.9 * w);
    const rows = archRows(bBackSide - 2, bFront + 2, wall / 2, 0.3, 2.3, bBackTop - 4);
    if (rows.length > 4) addSheet(rows, (u) => bBackTop - (bBackTop - bBackSide) * Math.pow(1 - Math.sin(Math.PI * u), 0.7), () => bFront, t);
  }

  if (thong) {
    // Thong (like the reference thongs): two wide wings grow out of the side walls and meet over
    // the instep, leaving a window above the sole on each side; from where they meet a rounded
    // ridge runs forward and down onto the toe post between the big toe and the others.
    const t = p.strap.thickness, wing = p.thongArmWidth;
    const bArchEnd = frame.archEnd ? frame.archEnd[1] : b1 - 0.1 * footLen;
    // The wings come down onto the sole along the arch and end there at the arch end (the
    // window in front of them starts at the arch end); on top they run on towards the toe post.
    const bJ = Math.min(post[1] - 22, Math.max(bArchEnd + 20, silBack + 0.62 * footLen)); // front of the wings on top
    const bWin = Math.min(bArchEnd, bJ - 15); // front of the wings at the sole
    const bBackSide = Math.max(silBack + 0.2 * footLen, bWin - wing); // back of the wings at the sole
    const bBackTop = Math.min(bJ - 20, Math.max(bBackSide + 20, silBack + 0.5 * footLen)); // back of the wings on top
    const rows = archRows(bBackSide - 2, bJ + 2, wall / 2, t / 2 + 0.3, 2.3, bBackTop - 4);
    if (rows.length > 4) {
      addSheet(rows, (u) => bBackTop - (bBackTop - bBackSide) * Math.pow(1 - Math.sin(Math.PI * u), 0.7), (u) => bWin + (bJ - bWin) * Math.pow(Math.sin(Math.PI * u), 1.4), t);
      // ridge: from the top of the wings forward and down to the post, above the foot
      const top = sectionBetween(rows, bJ - 3);
      const start: [number, number, number] = [top.ac, bJ - 3, top.zBase + top.hs + t / 2];
      const zT = at(T, post[0], post[1]);
      const n = 24 * det.surface;
      const path: [number, number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const f = i / n, e = f * f * (3 - 2 * f);
        const a = start[0] + (post[0] - start[0]) * e, b = start[1] + (post[1] - start[1]) * f;
        // clear of the foot across the ridge's whole width (it passes over the toes near the post)
        const w = 20 - 10 * f, da = post[0] - start[0], db = post[1] - start[1], dl = Math.hypot(da, db) || 1;
        let need = -Infinity;
        for (let q = -0.5; q <= 0.5; q += 0.1) {
          const v = hcAt(a + (-db / dl) * q * (w + 2), b + (da / dl) * q * (w + 2));
          if (Number.isFinite(v)) need = Math.max(need, v);
        }
        const zLine = start[2] + (zT + 9 - start[2]) * Math.pow(f, 1.4);
        path.push([a, b, Math.max(zLine, need + t / 2 + 0.6)]);
      }
      // (keep it a smooth, falling line)
      for (let i = n - 1; i >= 0; i--) path[i][2] = Math.max(path[i][2], path[i + 1][2]);
      const zEnd = path[n][2];
      strapSolids.push(solids.length);
      solids.push(sweepRounded(path, path.map(() => [0, 0, 1]), path.map((_, i) => 20 - 10 * (i / n)), path.map((_, i) => t + 1.5 * (i / n)), toWorld, 24 * det.surface, 3));
      // post: rounded, longer along the foot than across, flaring into the footbed and tapering up
      const zPost0 = at(plateTop, post[0], post[1]);
      postSolid = solids.length;
      solids.push(sweepRounded(
        [[post[0], post[1], zPost0], [post[0], post[1], zT + 1], [post[0], post[1], (zT + zEnd) / 2], [post[0], post[1], zEnd + 1]],
        [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]], [7, 6, 5.5, 5.5], [14, 12, 10, 9], toWorld, 24 * det.surface, 3,
      ));
    }
  }

  let shoeBody: ShoeBody | null = null;
  if (p.kind === 'shoe') {
    // Shoe: one smooth implicit solid around the foot (see shoeBody.ts) – upper, midsole and sole
    // blended into one piece, cut by a smooth collar line; lattice only as the finish.
    const bThroat = silBack + p.shoe.throat * footLen;
    const malls = [frame.medialMalleolus, frame.lateralMalleolus].filter((m): m is [number, number, number] => !!m);
    const bAnkle = malls.length ? malls.reduce((acc, m) => acc + m[1], 0) / malls.length : silBack + 0.2 * footLen;
    /**
     * Highest the collar line may be at b so the top of the collar stays `malleolusGap` below each
     * malleolus: flat under the ankle bone (±18 mm along the foot), then rising smoothly.
     */
    const capFor = (m: [number, number, number] | null, b: number) => {
      if (!m) return Infinity;
      const d = Math.max(0, Math.abs(b - m[1]) - 18) / 40;
      return m[2] - p.shoe.malleolusGap - 0.3 + 30 * d * d;
    };
    /**
     * Each side of the collar follows its own malleolus (the medial one is usually higher); across
     * the back of the heel and the front of the opening the two sides blend.
     */
    const ankleCap = (a: number, b: number) => {
      const cm = capFor(frame.medialMalleolus, b), cl = capFor(frame.lateralMalleolus, b);
      if (!Number.isFinite(cm) || !Number.isFinite(cl)) return Math.min(cm, cl);
      const ext = rowExtent(poly, b), mid = ext ? (ext[0] + ext[1]) / 2 : 0, hw = ext ? (ext[1] - ext[0]) / 2 : 40;
      const wMed = smoothstep(-0.5 * hw, 0.5 * hw, (a - mid) * frame.medialSign);
      // (never above the lower cap by more than the blend allows at the centre)
      return cl + (cm - cl) * wMed;
    };
    // highest point of the foot across each row (the throat closes above it)
    const rowTop = new Float32Array(g.ny).fill(-Infinity);
    for (let jj = 0; jj < g.ny; jj++)
      for (let ii = 0; ii < g.nx; ii++) {
        const k = jj * g.nx + ii;
        // (the dorsum, not the ankle / leg)
        if (foot.silhouetteSdf[k] < 0 && !foot.legColumn[k] && Number.isFinite(foot.top[k])) rowTop[jj] = Math.max(rowTop[jj], foot.top[k]);
      }
    // (smooth along the foot, so the throat's top edge is a clean line)
    {
      const filled = Array.from(rowTop, (v) => (Number.isFinite(v) ? v : -Infinity));
      const sm = smoothEnvelope(filled.map((v) => (Number.isFinite(v) ? v : 0)), Math.round(12 / g.h));
      filled.forEach((v, jj) => (rowTop[jj] = Number.isFinite(v) ? sm[jj] : -Infinity));
    }
    const rowTopAt = (b: number) => rowTop[Math.min(g.ny - 1, Math.max(0, Math.round((b - g.b0) / g.h)))];
    // smooth collar line: heel tab at the back, a dip under the ankle bones, then a round U rising
    // to the throat, where the vamp closes
    // in front of the throat the shoe is closed over the dorsum; nothing stands above it (the
    // leg's front may reach forward of the throat)
    const closedAt = (b: number) => (Number.isFinite(rowTopAt(b)) ? rowTopAt(b) + c + p.shoe.wall + 3 : Infinity);
    const collarZ = (a: number, b: number) => {
      if (b >= bThroat) return closedAt(b);
      const line = rimZ(b) + p.shoe.collarHeight * (1 - 0.15 * Math.exp(-(((b - bAnkle) / 25) ** 2))) + 3 * smoothstep(silBack + 45, silBack, b);
      const s = smoothstep(bThroat - 55, bThroat, b);
      const closed = Math.max(line, closedAt(b));
      return Math.min(line + (closed - line) * s * s, ankleCap(a, b));
    };
    shoeBody = buildShoeBody({
      g, silhouetteSdf: foot.silhouetteSdf, bed: foot.bed, top: foot.top, legColumn: foot.legColumn, T, bottom: Btread, plateTop, outlineSdf,
      collarZ, sideTop: rimZ, clearance: c, wall: p.shoe.wall, toeAllowance: p.toeAllowance, bBall: bMT,
      voxel: Math.max(det.fuseVoxel, p.detail === 'standard' ? 1 : 0.7), finish: p.shoe.finish, sideWall: p.sideWall, collarBand: p.shoe.collarDiameter,
      soleWall: wall, cell: p.cellSize, radius: r, pattern: p.upperPattern, skins: p.shoe.skins, toWorld,
      footbedTop: topSurface, midsoleCell: p.shoe.midsoleCell, midsoleRadius: p.shoe.midsoleStrut / 2,
    });
    // the body replaces the separate sole plate and rim
    const skinMesh = skinSolid >= 0 ? solids[skinSolid] : null;
    solids.length = 0;
    heightSolids.length = 0;
    solids.push(keepClearNear(shoeBody.solid, foot, scanProbe, c));
    if (skinMesh) {
      skinSolid = solids.length;
      solids.push(skinMesh);
    }
    // (the shoe's lattice – continuous shell + its own midsole – replaces the generic midsole)
    lattice.nodes.length = 0;
    lattice.edges.length = 0;
    lattice.radii.length = 0;
    cageStart = 0;
    if (p.shoe.finish === 'lattice') {
      upperStart = 0;
      upperEnd = shoeBody.midsoleStart;
      appendLattice(lattice, shoeBody.lattice);
      shoeFootbed = shoeBody.footbedNodes;
      // footbed struts against the scan itself (as for the midsole above): under the foot the top
      // nodes sit exactly at the clearance, elsewhere they only move down if too close; the
      // node below (the sheet's underside, next in the list) moves with them
      const Nn = lattice.nodes, rr = p.strutDiameter / 2;
      const target = skinOn ? c + SKIN - 0.3 : c;
      for (const v of shoeFootbed) {
        const [a, b] = worldToFrame(frame, Nn[3 * v], Nn[3 * v + 1]);
        const under = at(foot.lowSilhouetteSdf, a, b) < -4;
        for (let it = 0; it < 6; it++) {
          const gap = scanProbe(Nn[3 * v], Nn[3 * v + 1], Nn[3 * v + 2]).gap - rr;
          const tooClose = gap < target - 0.02, tooFar = !skinOn && under && gap > c + 0.05;
          if (!tooClose && !tooFar) break;
          const dz = Math.max(-3, Math.min(3, (gap - target) * (tooClose ? 1.05 : 0.9)));
          Nn[3 * v + 2] += dz;
          Nn[3 * v + 5] += dz;
        }
      }
    }
  }

  // Safety pass for the side cage and the upper: any node still closer than the clearance is
  // pushed out (e.g. where the heel of the scan rises steeply over the rim).
  {
    const Nn = lattice.nodes;
    const rad = new Float32Array(Nn.length / 3);
    lattice.edges.forEach((v, e) => (rad[v] = Math.max(rad[v], lattice.radii[e >> 1])));
    for (let v = cageStart; v < Nn.length / 3; v++) {
      for (let it = 0; it < 4 && rad[v]; it++) {
        const q = scanProbe(Nn[3 * v], Nn[3 * v + 1], Nn[3 * v + 2]);
        if (q.gap - rad[v] >= c - 0.03) break;
        Nn[3 * v] = q.x + q.dx * (c + rad[v]);
        Nn[3 * v + 1] = q.y + q.dy * (c + rad[v]);
        Nn[3 * v + 2] = q.z + q.dz * (c + rad[v]);
      }
    }
  }
  for (const si of strapSolids) keepClear(solids[si], scanProbe, c);

  // --- checks ------------------------------------------------------------------------------
  let sMin = Infinity, sMax = -Infinity;
  lattice.radii.forEach((rad, e) => {
    if (collarEdges.has(e)) return; // solid collar rim, not lattice
    sMin = Math.min(sMin, 2 * rad);
    sMax = Math.max(sMax, 2 * rad);
  });
  const nodeR = new Float32Array(lattice.nodes.length / 3);
  lattice.edges.forEach((v, i) => (nodeR[v] = Math.max(nodeR[v], lattice.radii[i >> 1])));
  const nodeGap = (v: number) => scanProbe(lattice.nodes[3 * v], lattice.nodes[3 * v + 1], lattice.nodes[3 * v + 2]).gap - nodeR[v];
  // Footbed (the contoured part): must be within the clearance band.
  let fMin = Infinity, fMax = -Infinity;
  if (skinOn) {
    const m = solids[skinSolid], P = m.positions;
    for (let i = 0; i < P.length / 2; i += 6) {
      const [a, b] = worldToFrame(frame, P[i], P[i + 1]);
      if (at(foot.lowSilhouetteSdf, a, b) >= -4) continue;
      const gap = scanProbe(P[i], P[i + 1], P[i + 2]).gap;
      fMin = Math.min(fMin, gap);
      fMax = Math.max(fMax, gap);
    }
  } else if (p.kind === 'shoe' && p.shoe.finish === 'solid') {
    // solid shoe: the footbed is the cavity floor of the body (vertices on the top of the sole)
    const P = solids[0].positions;
    for (let i = 0; i < P.length; i += 3) {
      const [a, b] = worldToFrame(frame, P[i], P[i + 1]);
      if (at(foot.lowSilhouetteSdf, a, b) >= -8 || Math.abs(P[i + 2] - at(T, a, b)) > 0.3) continue;
      const gap = scanProbe(P[i], P[i + 1], P[i + 2]).gap;
      fMin = Math.min(fMin, gap);
      fMax = Math.max(fMax, gap);
    }
  } else {
    for (const v of shoeFootbed ?? underFoot) {
      if (shoeFootbed) {
        const [a, b] = worldToFrame(frame, lattice.nodes[3 * v], lattice.nodes[3 * v + 1]);
        if (at(foot.lowSilhouetteSdf, a, b) >= -8) continue; // (where the foot rests)
      }
      if (!nodeR[v]) continue;
      const gap = nodeGap(v);
      fMin = Math.min(fMin, gap);
      fMax = Math.max(fMax, gap);
    }
  }
  // Everything (except the toe post, which sits between the toes by design) must stay clear.
  let gMin = fMin;
  for (let v = 0; v < nodeR.length; v++) if (nodeR[v] > 0) gMin = Math.min(gMin, nodeGap(v));
  let uMin = Infinity, uMax = -Infinity;
  if (upperStart >= 0) {
    for (let v = upperStart; v < Math.min(upperEnd, nodeR.length); v++) {
      if (!nodeR[v]) continue;
      const gap = nodeGap(v);
      uMin = Math.min(uMin, gap);
      uMax = Math.max(uMax, gap);
    }
  }
  solids.forEach((m, si) => {
    if (si === postSolid) return;
    const strap = strapSolids.includes(si);
    for (let i = 0; i < m.positions.length; i += strap ? 3 : 9) {
      if (m.positions[i + 2] < minT - 3) continue;
      const gap = scanProbe(m.positions[i], m.positions[i + 1], m.positions[i + 2]).gap;
      gMin = Math.min(gMin, gap);
      if (strap) {
        uMin = Math.min(uMin, gap);
        uMax = Math.max(uMax, gap);
      }
    }
  });
  if (postSolid >= 0) {
    const pz0 = sampleGrid(g, T, post[0], post[1]);
    let worst = Infinity;
    for (let z = pz0; z < pz0 + 25; z += 1) {
      const [x, y] = frameToWorld(frame, post[0], post[1]);
      worst = Math.min(worst, scanProbe(x, y, z).gap - 2.75);
    }
    if (!web) {
      warnings.push(foot.hasDorsum
        ? 'The web between the 1st and 2nd toes isn\'t visible on this scan (toes pressed together?), so the toe post is placed from the M1/M5 landmarks. Check where it sits.'
        : 'This scan has no top of the foot, so the toe post is placed from the M1/M5 landmarks, not from the web between the 1st and 2nd toes. Check where it sits.');
    } else if (worst < -1) {
      warnings.push(`The toe post sits in the web between the 1st and 2nd toes, but the gap there is narrower than the post: it presses about ${(-worst).toFixed(1)} mm into the toes.`);
    }
  }
  // Shoe collar vs the malleoli: the top of the collar rim on each malleolus' side, under it.
  let ankle: { medial: number | null; lateral: number | null } | null = null;
  if (p.kind === 'shoe' && (frame.medialMalleolus || frame.lateralMalleolus)) {
    const gapUnder = (m: [number, number, number] | null) => {
      if (!m) return null;
      const [ma, mb, mz] = m;
      // top of the shoe body on the malleolus' side, under it
      let top = -Infinity;
      const P = solids[0].positions;
      for (let i = 0; i < P.length; i += 3) {
        const [a, b] = worldToFrame(frame, P[i], P[i + 1]);
        if (Math.abs(b - mb) > 10) continue;
        const ext = rowExtent(poly, b), mid = ext ? (ext[0] + ext[1]) / 2 : 0;
        if (Math.sign(a - mid) !== Math.sign(ma - mid)) continue; // the other side of the shoe
        top = Math.max(top, P[i + 2]);
      }
      return Number.isFinite(top) ? mz - top : null;
    };
    ankle = { medial: gapUnder(frame.medialMalleolus), lateral: gapUnder(frame.lateralMalleolus) };
    for (const [name, gap] of [['medial', ankle.medial], ['lateral', ankle.lateral]] as const) {
      if (gap === null && (name === 'medial' ? frame.medialMalleolus : frame.lateralMalleolus)) {
        warnings.push(`The ${name} malleolus is in front of the shoe opening (throat), so the collar can't be kept below it – move the throat forward or check the landmark.`);
      }
    }
  }
  const R = FOOTWEAR_RULES;
  const eps = FOOTWEAR_CLEARANCE_TOLERANCE;
  const range = (lo: number, hi: number) => (lo.toFixed(1) === hi.toFixed(1) ? `${lo.toFixed(1)} mm` : `${lo.toFixed(1)}–${hi.toFixed(1)} mm`);
  const rules: RuleCheck[] = [
    {
      rule: `Lattice strut ${R.strutDiameter.min}–${R.strutDiameter.max} mm`,
      value: !Number.isFinite(sMin) ? 'no lattice (solid)' : sMin === sMax ? `${sMin.toFixed(2)} mm` : `${sMin.toFixed(2)}–${sMax.toFixed(2)} mm`,
      ok: !Number.isFinite(sMin) || (sMin >= R.strutDiameter.min - 1e-6 && sMax <= R.strutDiameter.max + 1e-6),
    },
    {
      rule: `Footbed clearance to the foot ${R.clearance.min}–${R.clearance.max} mm (±${eps})`,
      value: range(fMin, fMax),
      ok: fMin >= R.clearance.min - eps && fMax <= R.clearance.max + eps,
    },
    {
      rule: `Nothing closer to the foot than ${R.clearance.min} mm (±${eps})`,
      value: `${gMin.toFixed(1)} mm`,
      ok: gMin >= R.clearance.min - eps,
    },
  ];
  if (ankle && (ankle.medial !== null || ankle.lateral !== null)) {
    const parts = [ankle.medial !== null && `MM ${ankle.medial.toFixed(1)} mm`, ankle.lateral !== null && `LM ${ankle.lateral.toFixed(1)} mm`].filter(Boolean);
    const lo = Math.min(ankle.medial ?? Infinity, ankle.lateral ?? Infinity);
    rules.push({ rule: `Collar rim at least ${p.shoe.malleolusGap} mm below the malleoli`, value: parts.join(', '), ok: lo >= p.shoe.malleolusGap - eps });
  }

  const latticeMesh = latticeToMesh(lattice, det.strutSides);
  const mesh = concatMeshes([...solids, latticeMesh]);
  return {
    mesh: makeMesh(mesh.positions, mesh.indices),
    parts: { solids, lattice, heightSolids },
    kind: p.kind,
    length,
    width: wMax - wMin,
    strutCount: lattice.edges.length / 2,
    nodeCount: lattice.nodes.length / 3,
    strut: { min: sMin, max: sMax },
    clearance: { min: fMin, max: fMax },
    minGap: gMin,
    upperGap: Number.isFinite(uMin) ? { min: uMin, max: uMax } : null,
    ankle,
    rules,
    warnings,
    toePost: thong ? post : null,
  };
}
