/**
 * Footwear generator (shoe / chappal) from the aligned foot scan.
 *
 * Sole (both kinds), in the insole frame on the 1 mm grid:
 *   - footbed top  T = plantar surface − clearance (follows the foot, toes included)
 *   - outline      = foot silhouette grown by clearance + wall (+ toe allowance at the front)
 *   - outsole      = solid plate on a flat base (toe spring at the front, optional tread)
 *   - midsole      = conformal tetrahedral lattice from the plate up to T (top layer = footbed)
 *   - rim          = solid wall around the outline, rising above the footbed (heel cup)
 * Chappal: solid strap(s) over the dorsum, offset from the foot by the clearance (slide band,
 * or thong Y-strap with a toe post; split-toe also slots the sole between the 1st/2nd toes).
 * Shoe: a lattice upper on the foot surface offset by clearance + strut radius, with a collar
 * opening and a solid collar rim, tied down into the sole.
 *
 * Design rules: strut diameter 1.2–1.8 mm, clearance 1–2 mm (checked on the result).
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { makeMesh, type MeshData } from '../types';
import { frameToWorld, worldToFrame } from '../insole/frame';
import { fillMissing, gaussianBlur, rasterizeLowestSurface, type Grid } from '../insole/heightfield';
import { buildSolid } from '../insole/solidMesh';
import type { PlantarSurface } from '../insole/generate';
import { computeVertexNormals, signedVolume } from '../mesh/normals';
import { rasterizeHighestSurface, signedDistance, sphericalDilate, sphericalErode } from './fields';
import { estimateDorsum, loftDorsum } from './dorsum';
import { appendLattice, concatMeshes, conformalLattice, emptyLattice, latticeToMesh, sampleGrid, surfaceLattice, type Lattice } from './lattice';
import { FOOTWEAR_RULES, type FootwearKind, type FootwearParams } from './params';

/** Per-scan data that doesn't depend on the design parameters (cached by the caller). */
export interface FootData {
  surface: PlantarSurface;
  /** Surface the shoe upper is laid over (world): the scan, or the estimated dorsum dome. */
  positions: Float32Array;
  indices: Uint32Array;
  /** Outward vertex normals of that surface (world). */
  normals: Float32Array;
  /** Highest surface (dorsum, scanned or estimated), NaN outside the silhouette. */
  top: Float32Array;
  /**
   * Surface the footbed is offset from: the smoothed plantar surface, but never above the raw
   * lowest scan surface (smoothing rounds off the toes and the edges of the sole).
   */
  bed: Float32Array;
  /** Signed distance to the silhouette (mm, negative inside). */
  silhouetteSdf: Float32Array;
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
  const lowest = rasterizeLowestSurface(positions, indices, surface.frame, g, 90);
  const bed = surface.z.map((z, k) => (Number.isNaN(lowest[k]) ? z : Math.min(z, lowest[k])));
  const mask = new Uint8Array(top.length);
  const heights: number[] = [];
  for (let k = 0; k < top.length; k++) {
    if (Number.isNaN(top[k])) continue;
    mask[k] = 1;
    heights.push(top[k] - surface.z[k]);
  }
  heights.sort((x, y) => x - y);
  const hasDorsum = heights.length > 0 && heights[Math.floor(heights.length / 2)] > 25;
  const silhouetteSdf = signedDistance(mask, g);

  let upper: { positions: Float32Array; indices: Uint32Array; normals: Float32Array };
  let probePositions = positions, probeIndices = indices;
  if (hasDorsum) {
    // Closed / full scan: orient it outward and use it for everything.
    if (signedVolume({ positions, indices }) < 0) {
      probeIndices = indices.slice();
      for (let t = 0; t < probeIndices.length; t += 3) [probeIndices[t + 1], probeIndices[t + 2]] = [probeIndices[t + 2], probeIndices[t + 1]];
    }
    upper = { positions, indices: probeIndices, normals: computeVertexNormals({ positions, indices: probeIndices }) };
  } else {
    // Sole-only scan: estimate the top of the foot from the footprint; the scan still wins
    // where it reaches higher (e.g. scans that capture the sides).
    const est = estimateDorsum(mask, surface.z, g);
    for (let k = 0; k < top.length; k++) if (mask[k]) top[k] = Math.max(top[k], est[k]);
    const dome = loftDorsum(mask, surface.z, g, surface.frame);
    upper = { positions: dome.positions, indices: dome.indices, normals: computeVertexNormals(dome) };
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
    surface, ...upper, top, silhouetteSdf, bed, hasDorsum, dorsumEstimated: !hasDorsum,
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
  parts: { solids: MeshData[]; lattice: Lattice };
  kind: FootwearKind;
  length: number;
  width: number;
  strutCount: number;
  nodeCount: number;
  /** Lattice strut diameters (mm), excluding the solid collar rim. */
  strut: { min: number; max: number };
  /** Measured gap between the foot and the footwear (mm). */
  clearance: { min: number; max: number };
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

export function generateFootwear(foot: FootData, p: FootwearParams): FootwearResult {
  const { surface } = foot;
  const { frame, grid: g } = surface;
  const nodeCount = g.nx * g.ny;
  const c = p.clearance, r = p.strutDiameter / 2;
  const warnings: string[] = [];
  const toWorld = (a: number, b: number, z: number): [number, number, number] => {
    const [x, y] = frameToWorld(frame, a, b);
    return [x, y, z];
  };
  const [a1, b1] = frame.met1, [a5, b5] = frame.met5;
  const bMT = (b1 + b5) / 2;

  // --- silhouette extent -----------------------------------------------------------------
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

  // --- outline -----------------------------------------------------------------------------
  const silSmooth = gaussianBlur(foot.silhouetteSdf, g, 2);
  const outlineSdf = new Float32Array(nodeCount);
  const toePost = (): [number, number] => {
    // between the 1st and 2nd toes: 18 % across the MT line, ~9 % of the foot length distal of it
    const dA = a5 - a1, dB = b5 - b1, len = Math.hypot(dA, dB) || 1;
    let nA = -dB / len, nB = dA / len;
    if (nB < 0) [nA, nB] = [-nA, -nB];
    const d = 0.09 * footLen;
    return [a1 + 0.18 * dA + nA * d, b1 + 0.18 * dB + nB * d];
  };
  const post = toePost();
  const thong = p.kind === 'chappal' && p.chappalStyle !== 'slide';
  const splitToe = p.kind === 'chappal' && p.chappalStyle === 'splitToe';
  /** Distance to the split-toe slot axis (Infinity without a slot). */
  const slotDist = new Float32Array(nodeCount).fill(Infinity);
  for (let j = 0; j < g.ny; j++) {
    const b = g.b0 + j * g.h;
    const extra = p.toeAllowance * smoothstep(silFront - 40, silFront, b);
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      let d = silSmooth[k] - (c + p.wallThickness + extra);
      if (splitToe) {
        const a = g.a0 + i * g.h;
        slotDist[k] = segDist(a, b, [post[0], post[1] + 4], [post[0] + (post[0] - a1) * 0.1, post[1] + 150]);
        d = Math.max(d, -(slotDist[k] - 1.6));
      }
      outlineSdf[k] = d;
    }
  }
  let outBack = Infinity, outFront = -Infinity, wMin = Infinity, wMax = -Infinity;
  for (let k = 0; k < nodeCount; k++) {
    if (outlineSdf[k] >= 0) continue;
    const a = g.a0 + (k % g.nx) * g.h, b = g.b0 + Math.floor(k / g.nx) * g.h;
    outBack = Math.min(outBack, b);
    outFront = Math.max(outFront, b);
    wMin = Math.min(wMin, a);
    wMax = Math.max(wMax, a);
  }
  const length = outFront - outBack;

  // --- footbed, base, outsole ----------------------------------------------------------------
  // Footbed top: the plantar surface offset down by the clearance along its normal (exact on the
  // steep edges of the foot bed, where a vertical shift would come closer than the clearance).
  const T = sphericalErode(foot.bed, g, c);
  let minT = Infinity;
  for (let k = 0; k < nodeCount; k++) if (outlineSdf[k] < 0) minT = Math.min(minT, T[k]);
  const baseZ = minT - p.soleThickness;
  const minStack = p.outsoleThickness + 2 * r + 1.5;
  const B = new Float32Array(nodeCount); // outsole bottom without tread
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
      const tread = p.tread !== 'none' && outlineSdf[k] < -4 ? treadGroove(p.tread, a, b) * smoothstep(-4, -7, outlineSdf[k]) : 0;
      Btread[k] = B[k] + Math.min(1, p.outsoleThickness * 0.45) * tread;
    }
  }
  const solids: MeshData[] = [];
  solids.push(buildSolid(g, outlineSdf, plateTop, Btread, toWorld));
  const scanProbe = footProbe(foot); // exact checks against the scan (height maps are approximate)

  // Rim wall (ring of width wallThickness inside the outline), higher at the heel.
  const ringSdf = new Float32Array(nodeCount);
  const rimTop = new Float32Array(nodeCount);
  for (let j = 0; j < g.ny; j++) {
    const b = g.b0 + j * g.h;
    const sLen = (b - outBack) / (length || 1);
    const rim = p.rimHeight * (0.35 + 0.65 * smoothstep(0.7, 0.25, sLen));
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      ringSdf[k] = Math.max(outlineSdf[k], -outlineSdf[k] - p.wallThickness);
      // No rim along the split-toe slot: it would rise between (or into) the toes.
      rimTop[k] = T[k] + Math.max(0.5, rim) * smoothstep(1.6 + p.wallThickness, 1.6 + p.wallThickness + 6, slotDist[k]);
    }
  }
  if (p.sideWall === 'solid') solids.push(keepClear(buildSolid(g, ringSdf, rimTop, B, toWorld), scanProbe, c));

  // --- midsole lattice ----------------------------------------------------------------------
  const stacks: number[] = [];
  for (let k = 0; k < nodeCount; k++) if (outlineSdf[k] < -p.wallThickness) stacks.push(T[k] - plateTop[k]);
  stacks.sort((x, y) => x - y);
  const medianStack = stacks[Math.floor(stacks.length / 2)] ?? p.soleThickness;
  const layers = Math.max(1, Math.min(6, Math.round(medianStack / (0.82 * p.cellSize))));
  const lattice = emptyLattice();
  const midsole = conformalLattice({
    // strut centres one radius below the footbed along its normal (exact on its steep edges)
    grid: g, lower: plateTop, upper: sphericalErode(T, g, r), cell: p.cellSize, radius: r, layers, toWorld,
    inside: (a, b) => sampleGrid(g, outlineSdf, a, b) < -0.3,
  });
  // Check the footbed against the scan itself: where the foot's rounded edge overhangs the
  // footbed the height map can't see it, so nodes that are too close move straight down; under
  // the foot the top layer also moves up where smoothing left it further than the clearance.
  const underFoot = new Set(midsole.topNodes.filter((v) => {
    const [a, b] = worldToFrame(frame, midsole.nodes[3 * v], midsole.nodes[3 * v + 1]);
    return sampleGrid(g, foot.silhouetteSdf, a, b) < -4; // under the foot, not the toe allowance / edge
  }));
  {
    const probe = footProbe(foot);
    const Nn = midsole.nodes;
    for (let v = 0; v < Nn.length / 3; v++) {
      const [a, b] = worldToFrame(frame, Nn[3 * v], Nn[3 * v + 1]);
      const floor = sampleGrid(g, plateTop, a, b);
      for (let it = 0; it < 6; it++) {
        const gap = probe(Nn[3 * v], Nn[3 * v + 1], Nn[3 * v + 2]).gap - r;
        const tooClose = gap < c - 0.02 && Nn[3 * v + 2] > floor;
        const tooFar = underFoot.has(v) && gap > c + 0.05;
        if (!tooClose && !tooFar) break;
        Nn[3 * v + 2] = Math.max(floor, Nn[3 * v + 2] + (gap - c) * (tooClose ? 1.05 : 0.9));
      }
    }
  }
  appendLattice(lattice, midsole); // first: node ids unchanged
  /** Nodes that fit the foot (footbed top layer, shoe upper) – for the clearance maximum. */
  const fittedNodes: number[] = [...underFoot];
  let postSolid = -1;

  // Lattice side wall: a triangulated cage just inside the outline, from the outsole up to the
  // rim height (the lattice-shoe look); anchored in the outsole plate like the midsole.
  if (p.sideWall === 'lattice') appendLattice(lattice, sideCage(g, outlineSdf, plateTop, rimTop, p.cellSize, r, toWorld));

  // --- chappal straps --------------------------------------------------------------------
  let upperClearance: { min: number; max: number } | null = null;
  /** Measures the upper's strut midpoints (set by the shoe; run after the final node pass). */
  let measureUpper: (() => void) | null = null;
  /** Lattice edges that are the solid collar rim (not lattice struts). */
  const collarEdges = new Set<number>();
  if (foot.dorsumEstimated) {
    warnings.push(
      `The scan has no top of the foot, so the ${p.kind === 'shoe' ? 'upper is' : 'straps are'} fitted to an estimated foot shape (from the footprint and foot length). Check the fit, or use a full foot scan.`,
    );
  }
  if (p.kind === 'chappal') {
    const t = p.strap.thickness;
    // Inner face of the strap: the dorsum offset by the clearance, plus a small margin where the
    // dorsum curves sharply (the 1 mm height map under-represents curved steep sides there).
    const Hc = sphericalDilate(foot.top, g, c);
    const curv = curvatureMargin(Hc, g);
    for (let k = 0; k < nodeCount; k++) if (!Number.isNaN(Hc[k])) Hc[k] += curv[k];
    const O = sphericalDilate(Hc, g, t); // outer face
    const support = new Uint8Array(nodeCount);
    for (let k = 0; k < nodeCount; k++) support[k] = Number.isNaN(O[k]) ? 0 : 1;
    const supportSdf = signedDistance(support, g);
    const Ofill = fillMissing(O, g, 0);
    const strapSdf = new Float32Array(nodeCount);
    const strapBottom = new Float32Array(nodeCount);
    let medialSide: [number, number] = [0, 0], lateralSide: [number, number] = [0, 0];
    if (thong) {
      // The two arms come down to the medial and lateral sides at the level of the arch end
      // (AE landmark; estimated just behind the 1st metatarsal head if it isn't placed).
      const bArchEnd = frame.archEnd ? frame.archEnd[1] : b1 - 0.1 * footLen;
      const side = (b: number, medial: boolean): [number, number] => {
        const j = Math.round((b - g.b0) / g.h);
        const lo = rowMin[j], hi = rowMax[j];
        const edge = frame.medialSign < 0 === medial ? lo : hi;
        return [edge + (edge < (lo + hi) / 2 ? -6 : 6), b];
      };
      medialSide = side(bArchEnd, true);
      lateralSide = side(bArchEnd, false);
    }
    const bc = silBack + p.strap.position * footLen;
    for (let j = 0; j < g.ny; j++) {
      const b = g.b0 + j * g.h;
      for (let i = 0; i < g.nx; i++) {
        const k = j * g.nx + i;
        const a = g.a0 + i * g.h;
        const region = thong
          ? Math.min(segDist(a, b, post, medialSide), segDist(a, b, post, lateralSide)) - p.thongArmWidth / 2
          : Math.abs(b - bc) - p.strap.width / 2;
        strapSdf[k] = Math.max(region, supportSdf[k], outlineSdf[k] - 0.5);
        strapBottom[k] = Number.isNaN(Hc[k]) ? B[k] : Math.max(Hc[k], T[k] + 1);
      }
    }
    solids.push(keepClear(buildSolid(g, strapSdf, Ofill, strapBottom, toWorld), scanProbe, c));
    if (thong) {
      // Toe post between the 1st and 2nd toes, from the sole up into the strap junction.
      const postSdf = new Float32Array(nodeCount);
      const postTop = sampleGrid(g, Ofill, post[0], post[1]);
      const postTopF = new Float32Array(nodeCount).fill(postTop);
      for (let k = 0; k < nodeCount; k++) {
        const a = g.a0 + (k % g.nx) * g.h, b = g.b0 + Math.floor(k / g.nx) * g.h;
        postSdf[k] = Math.hypot(a - post[0], b - post[1]) - 3.5;
      }
      postSolid = solids.length;
      solids.push(buildSolid(g, postSdf, postTopF, plateTop, toWorld));
    }
  }

  // --- shoe upper ----------------------------------------------------------------------------
  if (p.kind === 'shoe') {
    const bThroat = silBack + p.shoe.throat * footLen;
    const cut = (x: number, y: number) => {
      const [a, b] = worldToFrame(frame, x, y);
      return { a, b, t: sampleGrid(g, T, a, b), rim: sampleGrid(g, rimTop, a, b) };
    };
    const up = surfaceLattice({
      positions: foot.positions, normals: foot.normals, indices: foot.indices,
      offset: c + r, cell: p.cellSize, radius: r,
      keep: (x, y, z) => {
        const q = cut(x, y);
        if (z < q.rim - 3 || z > q.t + 110) return false;
        const open = q.t + p.shoe.collarHeight + 90 * smoothstep(bThroat - 30, bThroat, q.b) ** 2;
        return !(q.b < bThroat && z > open);
      },
    });
    // Put every node exactly at the clearance from the foot (nearest point on the scan, not the
    // noisy vertex normal), then split struts whose middle strays from it (chords across
    // curved areas such as the toes and the heel).
    const probeFoot = footProbe(foot);
    const place = (x: number, y: number, z: number): [number, number, number] => {
      const q = probeFoot(x, y, z);
      const o = c + r;
      return [q.x + q.dx * o, q.y + q.dy * o, q.z + q.dz * o];
    };
    const upNodes = up.nodes;
    for (let v = 0; v < upNodes.length / 3; v++) {
      const [x, y, z] = place(upNodes[3 * v], upNodes[3 * v + 1], upNodes[3 * v + 2]);
      upNodes[3 * v] = x;
      upNodes[3 * v + 1] = y;
      upNodes[3 * v + 2] = z;
    }
    let upEdges: [number, number, boolean][] = [];
    const isBoundary = new Set(up.boundaryEdges);
    for (let e = 0; e < up.edges.length / 2; e++) upEdges.push([up.edges[2 * e], up.edges[2 * e + 1], isBoundary.has(e)]);
    for (let pass = 0; pass < 6; pass++) {
      const next: typeof upEdges = [];
      let split = 0;
      for (const [pI, qI, bnd] of upEdges) {
        const mx = (upNodes[3 * pI] + upNodes[3 * qI]) / 2, my = (upNodes[3 * pI + 1] + upNodes[3 * qI + 1]) / 2, mz = (upNodes[3 * pI + 2] + upNodes[3 * qI + 2]) / 2;
        const len = Math.hypot(upNodes[3 * pI] - upNodes[3 * qI], upNodes[3 * pI + 1] - upNodes[3 * qI + 1], upNodes[3 * pI + 2] - upNodes[3 * qI + 2]);
        const gap = probeFoot(mx, my, mz).gap - r;
        if ((gap < c - 0.07 || gap > c + 0.07) && len > 1.2) {
          const m = upNodes.length / 3;
          upNodes.push(...place(mx, my, mz));
          next.push([pI, m, bnd], [m, qI, bnd]);
          split++;
        } else next.push([pI, qI, bnd]);
      }
      upEdges = next;
      if (!split) break;
    }
    // Collar rim (upper edge) = thicker solid-looking strut; lower edge tied down into the sole.
    const base = lattice.nodes.length / 3;
    const N = lattice.nodes;
    N.push(...upNodes);
    for (let v = 0; v < upNodes.length / 3; v++) fittedNodes.push(base + v);
    const nodeInfo = (v: number) => cut(N[3 * v], N[3 * v + 1]);
    const low = (v: number) => N[3 * v + 2] < nodeInfo(v).rim + 1.2 * p.cellSize;
    const tied = new Set<number>();
    const upperEdgeStart = lattice.radii.length;
    const tieDown = new Set<number>();
    const collarNodes = new Set<number>();
    for (const [pL, qL, bnd] of upEdges) {
      const pI = base + pL, qI = base + qL;
      lattice.edges.push(pI, qI);
      if (bnd && !low(pI) && !low(qI)) {
        lattice.radii.push(p.shoe.collarDiameter / 2);
        collarEdges.add(lattice.radii.length - 1);
        collarNodes.add(pI).add(qI);
        continue;
      }
      lattice.radii.push(r);
      if (!bnd) continue;
      for (const v of [pI, qI]) {
        if (tied.has(v) || !low(v)) continue;
        tied.add(v);
        // Tie down into the outsole: straight down, or leaning out towards the sole's edge
        // where the foot bulges below the node (e.g. the front of the toes); skipped if
        // neither keeps the clearance.
        const [x, y, z] = [N[3 * v], N[3 * v + 1], N[3 * v + 2]];
        const q = nodeInfo(v);
        const out = probeFoot(x, y, z);
        const hl = Math.hypot(out.dx, out.dy) || 1;
        const [oa, ob] = worldToFrame(frame, x + out.dx / hl, y + out.dy / hl);
        const da = oa - q.a, db = ob - q.b;
        let ea = q.a, eb = q.b;
        for (let s2 = 1; s2 <= 20 && sampleGrid(g, outlineSdf, q.a + da * s2, q.b + db * s2) < -(0.5 * p.wallThickness + r); s2++) {
          ea = q.a + da * s2;
          eb = q.b + db * s2;
        }
        const clears = (bx: number, by: number, bz: number) => {
          for (const t of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) {
            if (probeFoot(x + (bx - x) * t, y + (by - y) * t, z + (bz - z) * t).gap - r < c - 0.03) return false;
          }
          return true;
        };
        for (const [a2, b2] of [[q.a, q.b], [ea, eb]]) {
          const zDown = sampleGrid(g, plateTop, a2, b2) + r;
          if (z - zDown < 1) break;
          const [bx, by] = frameToWorld(frame, a2, b2);
          if (!clears(bx, by, zDown)) continue;
          N.push(bx, by, zDown);
          lattice.edges.push(v, N.length / 3 - 1);
          lattice.radii.push(r);
          tieDown.add(lattice.radii.length - 1);
          break;
        }
      }
    }
    // The collar rim is thicker than the lattice: keep its surface at the clearance too, and
    // split its struts where they sag towards the foot between nodes.
    const collarR = p.shoe.collarDiameter / 2;
    const placeAt = (x: number, y: number, z: number, rad: number): [number, number, number] => {
      const q = probeFoot(x, y, z);
      return [q.x + q.dx * (c + rad), q.y + q.dy * (c + rad), q.z + q.dz * (c + rad)];
    };
    // Smooth the collar line along itself (it follows the lattice cells, so it zig-zags).
    const collarNb = new Map<number, number[]>();
    for (const e of collarEdges) {
      const P = lattice.edges[2 * e], Q = lattice.edges[2 * e + 1];
      collarNb.set(P, [...(collarNb.get(P) ?? []), Q]);
      collarNb.set(Q, [...(collarNb.get(Q) ?? []), P]);
    }
    for (let it = 0; it < 8; it++) {
      const next = new Map<number, [number, number, number]>();
      for (const [v, nb] of collarNb) {
        if (nb.length !== 2) continue;
        const [m, n] = nb;
        next.set(v, [0, 1, 2].map((k) => 0.5 * N[3 * v + k] + 0.25 * (N[3 * m + k] + N[3 * n + k])) as [number, number, number]);
      }
      for (const [v, pnt] of next) N.splice(3 * v, 3, ...pnt);
    }
    for (const v of collarNodes) {
      const [x, y, z] = placeAt(N[3 * v], N[3 * v + 1], N[3 * v + 2], collarR);
      N[3 * v] = x;
      N[3 * v + 1] = y;
      N[3 * v + 2] = z;
    }
    const midGap = (e: number) => {
      const P = lattice.edges[2 * e], Q = lattice.edges[2 * e + 1];
      return probeFoot((N[3 * P] + N[3 * Q]) / 2, (N[3 * P + 1] + N[3 * Q + 1]) / 2, (N[3 * P + 2] + N[3 * Q + 2]) / 2).gap - lattice.radii[e];
    };
    let pending = [...collarEdges];
    for (let pass = 0; pass < 4 && pending.length; pass++) {
      const next: number[] = [];
      for (const e of pending) {
        const P = lattice.edges[2 * e], Q = lattice.edges[2 * e + 1];
        const len = Math.hypot(N[3 * P] - N[3 * Q], N[3 * P + 1] - N[3 * Q + 1], N[3 * P + 2] - N[3 * Q + 2]);
        const gap = midGap(e);
        if ((gap > c - 0.07 && gap < c + 0.07) || len < 1.2) continue;
        const m = N.length / 3;
        N.push(...placeAt((N[3 * P] + N[3 * Q]) / 2, (N[3 * P + 1] + N[3 * Q + 1]) / 2, (N[3 * P + 2] + N[3 * Q + 2]) / 2, collarR));
        lattice.edges[2 * e + 1] = m;
        lattice.edges.push(m, Q);
        lattice.radii.push(collarR);
        const e2 = lattice.radii.length - 1;
        collarEdges.add(e2);
        collarNodes.add(m);
        next.push(e, e2);
      }
      pending = next;
    }
    // Measured clearance at the strut midpoints of the upper (nodes are measured with the rest
    // below). Struts joining the thicker collar flare away from the foot by design: they count
    // for the minimum only, like the tie-down struts.
    measureUpper = () => {
      // Split struts whose middle strays from the clearance (after the final node pass).
      for (let pass = 0; pass < 4; pass++) {
        let split = 0;
        const count = lattice.radii.length;
        for (let e = upperEdgeStart; e < count; e++) {
          if (tieDown.has(e)) continue;
          const P = lattice.edges[2 * e], Q = lattice.edges[2 * e + 1];
          const len = Math.hypot(N[3 * P] - N[3 * Q], N[3 * P + 1] - N[3 * Q + 1], N[3 * P + 2] - N[3 * Q + 2]);
          const gap = midGap(e);
          const flare = !collarEdges.has(e) && (collarNodes.has(P) || collarNodes.has(Q));
          if (len < 1.2 || (gap >= c - 0.07 && (gap <= c + 0.07 || flare))) continue;
          const m = N.length / 3;
          N.push(...placeAt((N[3 * P] + N[3 * Q]) / 2, (N[3 * P + 1] + N[3 * Q + 1]) / 2, (N[3 * P + 2] + N[3 * Q + 2]) / 2, lattice.radii[e]));
          lattice.edges[2 * e + 1] = m;
          lattice.edges.push(m, Q);
          lattice.radii.push(lattice.radii[e]);
          if (collarEdges.has(e)) {
            collarEdges.add(lattice.radii.length - 1);
            collarNodes.add(m);
          }
          split++;
        }
        if (!split) break;
      }
      let lo = Infinity, hi = -Infinity;
      for (let e = upperEdgeStart; e < lattice.radii.length; e++) {
        const P = lattice.edges[2 * e], Q = lattice.edges[2 * e + 1];
        const gap = midGap(e);
        lo = Math.min(lo, gap);
        const flare = !collarEdges.has(e) && (collarNodes.has(P) || collarNodes.has(Q));
        if (!flare && !tieDown.has(e)) hi = Math.max(hi, gap);
      }
      if (Number.isFinite(lo)) upperClearance = { min: lo, max: hi };
    };
  }

  // Final pass for everything above the footbed (upper, collar, side cage, tie-downs): push any
  // node that is still closer than the clearance straight out again. Near sharp features of
  // the foot surface, placing one node can change which surface is nearest to another.
  {
    const probe = footProbe(foot);
    const Nn = lattice.nodes;
    const rad = new Float32Array(Nn.length / 3);
    lattice.edges.forEach((v, e) => (rad[v] = Math.max(rad[v], lattice.radii[e >> 1])));
    for (let v = midsole.nodes.length / 3; v < Nn.length / 3; v++) {
      if (!rad[v]) continue;
      for (let it = 0; it < 4; it++) {
        const q = probe(Nn[3 * v], Nn[3 * v + 1], Nn[3 * v + 2]);
        if (q.gap - rad[v] >= c - 0.03) break;
        Nn[3 * v] = q.x + q.dx * (c + rad[v]);
        Nn[3 * v + 1] = q.y + q.dy * (c + rad[v]);
        Nn[3 * v + 2] = q.z + q.dz * (c + rad[v]);
      }
    }
  }

  (measureUpper as (() => void) | null)?.();

  // --- checks ------------------------------------------------------------------------------
  let sMin = Infinity, sMax = -Infinity;
  lattice.radii.forEach((rad, e) => {
    if (collarEdges.has(e)) return; // solid collar rim, not lattice
    sMin = Math.min(sMin, 2 * rad);
    sMax = Math.max(sMax, 2 * rad);
  });
  // Measured clearance: every lattice node (minus its strut radius) and the solid parts' vertices
  // near the foot, against the scan surface. The toe post sits between the toes by design and is
  // reported separately. The maximum is taken over the surfaces that fit the foot.
  const probe = footProbe(foot);
  const nodeR = new Float32Array(lattice.nodes.length / 3);
  lattice.edges.forEach((v, i) => (nodeR[v] = Math.max(nodeR[v], lattice.radii[i >> 1])));
  const uc = upperClearance as { min: number; max: number } | null;
  let gMin = uc?.min ?? Infinity, gMax = uc?.max ?? -Infinity;

  const nodeGap = (v: number) => probe(lattice.nodes[3 * v], lattice.nodes[3 * v + 1], lattice.nodes[3 * v + 2]).gap - nodeR[v];
  for (let v = 0; v < nodeR.length; v++) if (nodeR[v] > 0) gMin = Math.min(gMin, nodeGap(v));
  for (const v of fittedNodes) if (nodeR[v] > 0) gMax = Math.max(gMax, nodeGap(v)); // unconnected nodes make no geometry
  solids.forEach((m, si) => {
    if (si === postSolid) return;
    for (let i = 0; i < m.positions.length; i += 9) {
      if (m.positions[i + 2] < minT - 3) continue;
      gMin = Math.min(gMin, probe(m.positions[i], m.positions[i + 1], m.positions[i + 2]).gap);
    }
  });
  if (postSolid >= 0) {
    const pz0 = sampleGrid(g, T, post[0], post[1]);
    let worst = Infinity;
    for (let z = pz0; z < pz0 + 25; z += 1) {
      const [x, y] = frameToWorld(frame, post[0], post[1]);
      worst = Math.min(worst, probe(x, y, z).gap - 3.5);
    }
    if (worst < FOOTWEAR_RULES.clearance.min) {
      warnings.push('The toe post overlaps the toes on this scan (the 1st and 2nd toes are not separated in the scan). It is meant to sit in the web between them.');
    }
  }
  const clearance = { min: gMin, max: Math.max(gMax, gMin) };
  const R = FOOTWEAR_RULES;
  const eps = FOOTWEAR_CLEARANCE_TOLERANCE;
  const rules: RuleCheck[] = [
    {
      rule: `Lattice strut ${R.strutDiameter.min}–${R.strutDiameter.max} mm`,
      value: sMin === sMax ? `${sMin.toFixed(2)} mm` : `${sMin.toFixed(2)}–${sMax.toFixed(2)} mm`,
      ok: sMin >= R.strutDiameter.min - 1e-6 && sMax <= R.strutDiameter.max + 1e-6,
    },
    {
      rule: `Clearance to the foot ${R.clearance.min}–${R.clearance.max} mm (±${FOOTWEAR_CLEARANCE_TOLERANCE})`,
      value: clearance.min.toFixed(1) === clearance.max.toFixed(1) ? `${clearance.min.toFixed(1)} mm` : `${clearance.min.toFixed(1)}–${clearance.max.toFixed(1)} mm`,
      ok: clearance.min >= R.clearance.min - eps && clearance.max <= R.clearance.max + eps,
    },
  ];
  if (upperClearance && !rules[1].ok) {
    warnings.push('Parts of the upper are outside the 1–2 mm clearance (tight curves such as the toes). A smaller lattice cell follows the foot more closely.');
  }

  const latticeMesh = latticeToMesh(lattice);
  const mesh = concatMeshes([...solids, latticeMesh]);
  return {
    mesh: makeMesh(mesh.positions, mesh.indices),
    parts: { solids, lattice },
    kind: p.kind,
    length,
    width: wMax - wMin,
    strutCount: lattice.edges.length / 2,
    nodeCount: lattice.nodes.length / 3,
    strut: { min: sMin, max: sMax },
    clearance,
    rules,
    warnings,
    toePost: thong ? post : null,
  };
}
