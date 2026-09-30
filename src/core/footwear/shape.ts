/**
 * Standard (product) shapes for footwear: the outer shape is not a copy of the foot but a
 * smooth, conventional form that is fitted around it.
 *
 *  - Outline: the footprint grown by the clearance, the rim wall and the toe allowance, then
 *    faired (so the sole lines up with the foot, like the reference soles).
 *  - Sections: across the foot, a rounded arch (superellipse) standing on the rim. Its height is
 *    the smallest that clears the foot (+ clearance) at every point of the section, then
 *    smoothed along the foot, so straps and uppers are smooth envelopes of the foot.
 *  - Slide strap: a band lofted through the sections, with rounded (pillow) edges.
 *  - Thong: two rounded arms swept from the toe post over the foot to the sides.
 *  - Shoe upper: a regular triangulated lattice laid out along the sections (by arc length),
 *    with a smooth collar around the ankle opening.
 *
 * Everything is built in frame coordinates (a across, b along the foot, z up) and mapped to
 * world coordinates with `toWorld` (a rotation about Z plus a translation).
 */
import { makeMesh, type MeshData } from '../types';
import type { Grid } from '../insole/heightfield';
import { polygonSdf, type Pt } from '../insole/outline';
import { signedVolume } from '../mesh/normals';
import { emptyLattice, type Lattice } from './lattice';

export type ToWorld = (a: number, b: number, z: number) => [number, number, number];

// ---------------------------------------------------------------------------------------------
// Outline
// ---------------------------------------------------------------------------------------------

/**
 * Sole outline that follows the foot, like the reference soles: the boundary of the region
 * `need < 0` (the footprint grown by the clearance, the rim wall and the toe allowance), traced by
 * rays from its centre and then faired – smoothed along the curve, but never cut back inside
 * the region. Returns the polygon and its signed distance field.
 */
export function footprintOutline(g: Grid, need: Float32Array, sigma = 7): { poly: Pt[]; sdf: Float32Array } {
  let ca = 0, cb = 0, n = 0;
  for (let k = 0; k < need.length; k++) {
    if (need[k] >= 0) continue;
    ca += g.a0 + (k % g.nx) * g.h;
    cb += g.b0 + Math.floor(k / g.nx) * g.h;
    n++;
  }
  if (!n) throw new Error('The scan has no footprint – check the alignment and landmarks.');
  ca /= n;
  cb /= n;
  const at = (a: number, b: number) => {
    const x = (a - g.a0) / g.h, y = (b - g.b0) / g.h;
    const i = Math.min(g.nx - 2, Math.max(0, Math.floor(x))), j = Math.min(g.ny - 2, Math.max(0, Math.floor(y)));
    const fx = Math.min(1, Math.max(0, x - i)), fy = Math.min(1, Math.max(0, y - j));
    const k = j * g.nx + i;
    return (need[k] * (1 - fx) + need[k + 1] * fx) * (1 - fy) + (need[k + g.nx] * (1 - fx) + need[k + g.nx + 1] * fx) * fy;
  };
  const K = 720;
  const dirs: Pt[] = Array.from({ length: K }, (_, s) => [Math.cos((2 * Math.PI * s) / K), Math.sin((2 * Math.PI * s) / K)]);
  // outermost boundary crossing along each ray
  const rMin = dirs.map(([da, db]) => {
    let last = 0;
    for (let t = 0; t < 400; t += 0.5) if (at(ca + da * t, cb + db * t) < 0) last = t;
    let lo = last, hi = last + 0.5;
    for (let it = 0; it < 12; it++) {
      const mid = (lo + hi) / 2;
      if (at(ca + da * mid, cb + db * mid) < 0) lo = mid;
      else hi = mid;
    }
    return hi + 0.3;
  });
  // fair: smooth the radius along the curve (Gaussian over arc length), never below the need
  let r = rMin.slice();
  for (let pass = 0; pass < 4; pass++) {
    const next = r.map((_, s) => {
      let acc = 0, wt = 0;
      const ds = (2 * Math.PI * r[s]) / K; // arc length per step
      const R = Math.min(K / 4, Math.ceil((3 * sigma) / Math.max(0.2, ds)));
      for (let q = -R; q <= R; q++) {
        const w = Math.exp(-((q * ds) ** 2) / (2 * sigma * sigma));
        acc += r[(s + q + K) % K] * w;
        wt += w;
      }
      return acc / wt;
    });
    r = next.map((v, s) => Math.max(v, rMin[s]));
  }
  const poly: Pt[] = r.map((v, s) => [ca + dirs[s][0] * v, cb + dirs[s][1] * v]);
  const sdf = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) sdf[j * g.nx + i] = polygonSdf(poly, g.a0 + i * g.h, g.b0 + j * g.h);
  return { poly, sdf };
}

/** Width of the region `sdf < 0` on the line b = const (interpolated), or null. */
export function rowExtent(poly: Pt[], b: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a1, b1] = poly[j], [a2, b2] = poly[i];
    if (b1 > b === b2 > b) continue;
    const a = a1 + ((b - b1) / (b2 - b1)) * (a2 - a1);
    lo = Math.min(lo, a);
    hi = Math.max(hi, a);
  }
  return Number.isFinite(lo) && hi - lo > 0.5 ? [lo, hi] : null;
}

// ---------------------------------------------------------------------------------------------
// 1D helpers
// ---------------------------------------------------------------------------------------------

/** Smooth upper envelope: never below `v` (max filter over ±w samples, then a Gaussian of sigma w/3). */
export function smoothEnvelope(v: number[], w: number): number[] {
  const n = v.length;
  const m = v.map((_, i) => {
    let x = -Infinity;
    for (let k = Math.max(0, i - w); k <= Math.min(n - 1, i + w); k++) x = Math.max(x, v[k]);
    return x;
  });
  const s = Math.max(0.5, w / 3), R = Math.ceil(3 * s);
  return m.map((_, i) => {
    let a = 0, wt = 0;
    for (let k = -R; k <= R; k++) {
      const q = Math.min(n - 1, Math.max(0, i + k));
      const e = Math.exp(-(k * k) / (2 * s * s));
      a += m[q] * e;
      wt += e;
    }
    return a / wt;
  });
}

/**
 * Smooth curve that never dips below `v` but hugs it: repeatedly smooth (Gaussian, `sigma`
 * samples) and lift back to `v`. Unlike a max filter it doesn't raise a whole slope to its top.
 */
export function smoothAbove(v: number[], sigma: number, iterations = 40): number[] {
  const n = v.length, R = Math.ceil(3 * sigma);
  const wts = Array.from({ length: 2 * R + 1 }, (_, q) => Math.exp(-((q - R) ** 2) / (2 * sigma * sigma)));
  const blur = (h: number[]) =>
    h.map((_, i) => {
      let acc = 0, wt = 0;
      for (let q = -R; q <= R; q++) {
        acc += h[Math.min(n - 1, Math.max(0, i + q))] * wts[q + R];
        wt += wts[q + R];
      }
      return acc / wt;
    });
  let h = v.slice();
  for (let it = 0; it < iterations; it++) h = blur(h).map((x, i) => Math.max(x, v[i]));
  // one last light blur, lifted by the largest shortfall it causes locally
  const b = blur(h);
  const short = smoothEnvelope(v.map((x, i) => Math.max(0, x - b[i])), Math.ceil(sigma));
  return b.map((x, i) => x + short[i]);
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

/**
 * Cross-section at b: an arch standing on (ac ± hw, zBase), rising to zBase + hs. Just above
 * the base it may bulge out to ±hwMax to go round a foot that is wider than the sole there
 * (like the sides of a slide strap).
 */
export interface Section {
  b: number;
  ac: number;
  hw: number;
  /** Half width above the base (≥ hw); defaults to hw. */
  hwMax?: number;
  zBase: number;
  hs: number;
  /** Superellipse exponent (2 = ellipse, larger = boxier). */
  p: number;
  /** Across-position of the crown (defaults to ac): off-centre for an asymmetric arch that follows the instep. */
  aTop?: number;
  /** How much the sides lean in towards the top (0 = upright). */
  taper?: number;
}

/** Point of a section at θ ∈ [0, π] (0 = medial or lateral base, π = the other base). */
export function sectionAt(s: Section, th: number): [number, number] {
  const c = Math.cos(th), sn = Math.max(0, Math.sin(th));
  const bulge = ((s.hwMax ?? s.hw) - s.hw) * Math.pow(sn, 0.35);
  const top = s.aTop ?? s.ac;
  // each half runs from its base to the crown; the sides lean in by `taper` towards the top
  const half = c >= 0 ? top - (s.ac - s.hw) : s.ac + s.hw - top;
  const w = (half + bulge) * (1 - (s.taper ?? 0) * Math.pow(sn, 2 / s.p));
  return [top - w * Math.sign(c) * Math.pow(Math.abs(c), 2 / s.p), s.zBase + s.hs * Math.pow(sn, 2 / s.p)];
}

/** Outward unit normal of the section curve at θ (in the a–z plane). */
export function sectionNormal(s: Section, th: number): [number, number] {
  const e = 1e-3;
  const [a0, z0] = sectionAt(s, Math.max(0, th - e)), [a1, z1] = sectionAt(s, Math.min(Math.PI, th + e));
  let na = z1 - z0, nz = -(a1 - a0);
  const l = Math.hypot(na, nz) || 1;
  na /= l;
  nz /= l;
  // outward = away from the arch's inside (below the top, towards the middle)
  const [pa, pz] = sectionAt(s, th);
  if (na * (pa - s.ac) + nz * (pz - (s.zBase + 0.3 * s.hs)) < 0) [na, nz] = [-na, -nz];
  return [na, nz];
}

/**
 * Smallest arch height (hs) for which every point of `pts` (a, z) lies inside the section
 * (the arch is star-shaped around the middle of its base, so containment is a polar test).
 */
export function fitArchHeight(s: Omit<Section, 'hs'>, pts: [number, number][], min = 5): number {
  const inside = (hs: number) => {
    const sec = { ...s, hs };
    const K = 120;
    const phis: number[] = [], rhos: number[] = [];
    for (let i = 0; i <= K; i++) {
      const [a, z] = sectionAt(sec, (Math.PI * i) / K);
      phis.push(Math.atan2(z - s.zBase, a - s.ac));
      rhos.push(Math.hypot(a - s.ac, z - s.zBase));
    }
    for (const [a, z] of pts) {
      if (z <= s.zBase) continue;
      const phi = Math.atan2(z - s.zBase, a - s.ac), rho = Math.hypot(a - s.ac, z - s.zBase);
      // phis runs from π (θ = 0) down to 0 (θ = π)
      let i = 0;
      while (i < K - 1 && phis[i + 1] > phi) i++;
      const f = (phis[i] - phi) / (phis[i] - phis[i + 1] || 1);
      if (rho > rhos[i] + (rhos[i + 1] - rhos[i]) * Math.min(1, Math.max(0, f))) return false;
    }
    return true;
  };
  let lo = min, hi = 250;
  if (inside(lo)) return lo;
  for (let it = 0; it < 24; it++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** θ values of `n` + 1 points spaced evenly by arc length along the section. */
export function evenThetas(s: Section, n: number): number[] {
  const K = 180;
  const cum = [0];
  let [pa, pz] = sectionAt(s, 0);
  for (let i = 1; i <= K; i++) {
    const [a, z] = sectionAt(s, (Math.PI * i) / K);
    cum.push(cum[i - 1] + Math.hypot(a - pa, z - pz));
    [pa, pz] = [a, z];
  }
  const total = cum[K];
  const out: number[] = [];
  for (let j = 0, seg = 0; j <= n; j++) {
    const target = (total * j) / n;
    while (seg < K - 1 && cum[seg + 1] < target) seg++;
    const f = (target - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
    out.push((Math.PI * (seg + Math.min(1, Math.max(0, f)))) / K);
  }
  return out;
}

export function sectionLength(s: Section): number {
  let L = 0;
  let [pa, pz] = sectionAt(s, 0);
  for (let i = 1; i <= 90; i++) {
    const [a, z] = sectionAt(s, (Math.PI * i) / 90);
    L += Math.hypot(a - pa, z - pz);
    [pa, pz] = [a, z];
  }
  return L;
}

// ---------------------------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------------------------

function orientOutward(positions: number[], idx: number[]): MeshData {
  const m = makeMesh(Float32Array.from(positions), Uint32Array.from(idx));
  if (signedVolume(m) < 0) for (let t = 0; t < m.indices.length; t += 3) [m.indices[t + 1], m.indices[t + 2]] = [m.indices[t + 2], m.indices[t + 1]];
  return m;
}

/**
 * Closed band through `sections` (ordered along b): the inner face is the section arch, the
 * outer face is offset outward by `thickness[i]`. The two ends are closed between the inner and
 * outer curves; the feet (θ = 0, π) are closed by the ring itself.
 */
export function loftBand(sections: Section[], thickness: number[], toWorld: ToWorld, M = 48): MeshData {
  const outerRows: P3[][] = [], innerRows: P3[][] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const outer: P3[] = [], inner: P3[] = [];
    for (const t of evenThetas(s, M)) {
      const [a, z] = sectionAt(s, t);
      const [na, nz] = sectionNormal(s, t);
      inner.push([a, s.b, z]);
      outer.push([a + na * thickness[i], s.b, z + nz * thickness[i]]);
    }
    outerRows.push(outer);
    innerRows.push(inner);
  }
  return loftRows(outerRows, innerRows, toWorld);
}

type P3 = [number, number, number];

/**
 * Closed solid between two grids of points (frame coordinates, rows × columns, same shape):
 * each row's outer curve and reversed inner curve form a ring; consecutive rings are joined
 * and the first and last rings are capped.
 */
export function loftRows(outerRows: P3[][], innerRows: P3[][], toWorld: ToWorld): MeshData {
  const pos: number[] = [];
  const M = outerRows[0].length - 1, R = 2 * (M + 1), n = outerRows.length;
  for (let i = 0; i < n; i++) {
    for (const [a, b, z] of outerRows[i]) pos.push(...toWorld(a, b, z));
    for (let j = M; j >= 0; j--) pos.push(...toWorld(...innerRows[i][j]));
  }
  const idx: number[] = [];
  for (let i = 0; i + 1 < n; i++)
    for (let v = 0; v < R; v++) {
      const p = i * R + v, q = i * R + ((v + 1) % R), u = (i + 1) * R + ((v + 1) % R), w = (i + 1) * R + v;
      idx.push(p, q, u, p, u, w);
    }
  // end caps: the two ends face opposite ways, so the far one is wound the other way round
  for (const i of [0, n - 1]) {
    const flip = i === 0;
    for (let j = 0; j < M; j++) {
      const o0 = i * R + j, o1 = i * R + j + 1, i1 = i * R + (R - 1 - (j + 1)), i0 = i * R + (R - 1 - j);
      if (flip) idx.push(o0, i1, o1, o0, i0, i1);
      else idx.push(o0, o1, i1, o0, i1, i0);
    }
  }
  return orientOutward(pos, idx);
}

/** Section at any b, interpolated linearly between `rows` (sorted by b, 1 mm or finer apart). */
export function sectionBetween(rows: Section[], b: number): Section {
  if (b <= rows[0].b) return { ...rows[0], b };
  const last = rows[rows.length - 1];
  if (b >= last.b) return { ...last, b };
  let i = 0;
  while (i < rows.length - 2 && rows[i + 1].b < b) i++;
  const s0 = rows[i], s1 = rows[i + 1], f = (b - s0.b) / (s1.b - s0.b || 1);
  const mix = (x: number, y: number) => x + (y - x) * f;
  return {
    b, ac: mix(s0.ac, s1.ac), hw: mix(s0.hw, s1.hw), hwMax: mix(s0.hwMax ?? s0.hw, s1.hwMax ?? s1.hw), zBase: mix(s0.zBase, s1.zBase), hs: mix(s0.hs, s1.hs), p: s0.p,
    aTop: mix(s0.aTop ?? s0.ac, s1.aTop ?? s1.ac), taper: mix(s0.taper ?? 0, s1.taper ?? 0),
  };
}

/**
 * A sheet on the arch surface through `rows` (like the vamp of a slide or the wings of a thong),
 * cut out along the arch by two edges: at arch parameter u ∈ [0, 1] (0 and 1 = the two bases,
 * 0.5 = the top) it runs from b = back(u) to b = front(u). Its inner face is the arch; it is
 * `thickness(s)` thick outward (s ∈ [0, 1] from the back edge to the front edge, so the edges can
 * be rounded off).
 */
export function archSheet(opts: {
  rows: Section[];
  back: (u: number) => number;
  front: (u: number) => number;
  thickness: (s: number) => number;
  toWorld: ToWorld;
  M?: number;
  N?: number;
  /** Part of the arch covered (0–1, from one base to the other); default all of it. */
  uRange?: [number, number];
}): MeshData {
  const { rows, back, front, thickness, toWorld, M = 56, N = 40, uRange = [0, 1] } = opts;
  // arch parameter spaced by arc length on a representative section
  const mid = sectionBetween(rows, (back(0.5) + front(0.5)) / 2);
  const all = evenThetas(mid, 720);
  const thetaAt = (u: number) => all[Math.min(720, Math.max(0, Math.round(u * 720)))];
  const thetas = Array.from({ length: M + 1 }, (_, j) => thetaAt(uRange[0] + ((uRange[1] - uRange[0]) * j) / M));
  const inner: P3[][] = [];
  for (let i = 0; i <= N; i++) {
    const s = 0.5 - 0.5 * Math.cos((Math.PI * i) / N); // denser at the (rounded) edges
    const row: P3[] = [];
    for (const th of thetas) {
      const u = th / Math.PI;
      const b = back(u) + (front(u) - back(u)) * s;
      const sec = sectionBetween(rows, b);
      const [a, z] = sectionAt(sec, th);
      row.push([a, b, z]);
    }
    inner.push(row);
  }
  // outward normals from the grid (across the arch × along the sheet)
  const outer: P3[][] = inner.map((row, i) =>
    row.map((pt, j) => {
      const i0 = Math.max(0, i - 1), i1 = Math.min(N, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(M, j + 1);
      const d1 = inner[i1][j].map((v, k) => v - inner[i0][j][k]), d2 = row[j1].map((v, k) => v - row[j0][k]);
      let nx = d1[1] * d2[2] - d1[2] * d2[1], ny = d1[2] * d2[0] - d1[0] * d2[2], nz = d1[0] * d2[1] - d1[1] * d2[0];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const sec = sectionBetween(rows, pt[1]);
      if (nx * (pt[0] - sec.ac) + nz * (pt[2] - (sec.zBase + 0.3 * sec.hs)) < 0) [nx, ny, nz] = [-nx, -ny, -nz];
      const t = thickness(0.5 - 0.5 * Math.cos((Math.PI * i) / N));
      return [pt[0] + nx * t, pt[1] + ny * t, pt[2] + nz * t] as P3;
    }),
  );
  return loftRows(outer, inner, toWorld);
}

/**
 * The same sheet as an open panel (like the lattice vamps and wings of the reference designs): a
 * solid border band `border` wide round the edge, filled with a triangulated lattice (strut centres
 * in the middle of the sheet's thickness, about one `cell` apart). Returns the border solids and
 * the lattice.
 */
export function archPanel(opts: {
  rows: Section[];
  back: (u: number) => number;
  front: (u: number) => number;
  thickness: number;
  border: number;
  cell: number;
  radius: number;
  toWorld: ToWorld;
  /** Sampling density multiplier of the border sheets (mesh detail). */
  detail?: number;
}): { solids: MeshData[]; lattice: Lattice } {
  const { rows, back, front, thickness: t, border, cell, radius, toWorld, detail = 1 } = opts;
  const mid = sectionBetween(rows, (back(0.5) + front(0.5)) / 2);
  const Ltot = sectionLength(mid);
  const all = evenThetas(mid, 720);
  const thetaAt = (u: number) => all[Math.min(720, Math.max(0, Math.round(u * 720)))];
  const uB = Math.min(0.2, border / Ltot);
  const edge = (s: number) => Math.max(0.7, t * Math.pow(Math.max(0, 1 - Math.abs(2 * s - 1) ** 6), 0.3));
  const solids = [
    archSheet({ rows, back, front: (u) => Math.min(front(u), back(u) + border), thickness: edge, toWorld, M: 56 * detail, N: 12 * detail }),
    archSheet({ rows, back: (u) => Math.max(back(u), front(u) - border), front, thickness: edge, toWorld, M: 56 * detail, N: 12 * detail }),
    archSheet({ rows, back, front, thickness: () => t, toWorld, uRange: [0, uB], M: 8 * detail, N: 40 * detail }),
    archSheet({ rows, back, front, thickness: () => t, toWorld, uRange: [1 - uB, 1], M: 8 * detail, N: 40 * detail }),
  ];
  // triangular lattice in (arc length across the arch, b along the foot)
  const lattice = emptyLattice();
  const ids = new Map<string, number>();
  let bLo = Infinity, bHi = -Infinity;
  for (let q = 0; q <= 40; q++) {
    bLo = Math.min(bLo, back(q / 40));
    bHi = Math.max(bHi, front(q / 40));
  }
  const dv = cell * 0.866;
  for (let i = 0; bLo + i * dv <= bHi; i++) {
    const V = bLo + i * dv;
    for (let j = 0; j * cell <= Ltot; j++) {
      const U = j * cell + (i % 2 ? cell / 2 : 0);
      const u = U / Ltot;
      if (u < 0.5 * uB || u > 1 - 0.5 * uB || V < back(u) + 0.5 * border || V > front(u) - 0.5 * border) continue;
      const sec = sectionBetween(rows, V), th = thetaAt(u);
      const [a, z] = sectionAt(sec, th), [na, nz] = sectionNormal(sec, th);
      lattice.nodes.push(...toWorld(a + (na * t) / 2, V, z + (nz * t) / 2));
      ids.set(`${i},${j}`, lattice.nodes.length / 3 - 1);
    }
  }
  const link = (p: number | undefined, q: number | undefined) => {
    if (p === undefined || q === undefined) return;
    lattice.edges.push(p, q);
    lattice.radii.push(radius);
  };
  for (const [key, id] of ids) {
    const [i, j] = key.split(',').map(Number);
    link(id, ids.get(`${i},${j + 1}`));
    // the next row is shifted half a cell: its neighbours are j and j±1
    const k = i % 2 ? j + 1 : j - 1;
    link(id, ids.get(`${i + 1},${j}`));
    link(id, ids.get(`${i + 1},${k}`));
  }
  return { solids, lattice };
}

/**
 * Closed tube swept along `path` (frame coordinates) with a rounded-rectangle section:
 * `width[i]` along the binormal, `thickness[i]` along `up[i]` (made perpendicular to the path).
 */
export function sweepRounded(path: [number, number, number][], up: [number, number, number][], width: number[], thickness: number[], toWorld: ToWorld, K = 24, p = 4): MeshData {
  const n = path.length;
  const pos: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    let [ux, uy, uz] = up[i];
    const d = ux * tx + uy * ty + uz * tz;
    ux -= d * tx; uy -= d * ty; uz -= d * tz;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const bx = ty * uz - tz * uy, by = tz * ux - tx * uz, bz = tx * uy - ty * ux;
    for (let k = 0; k < K; k++) {
      const ph = (2 * Math.PI * k) / K, c = Math.cos(ph), s = Math.sin(ph);
      const wx = (width[i] / 2) * Math.sign(c) * Math.pow(Math.abs(c), 2 / p);
      const hz = (thickness[i] / 2) * Math.sign(s) * Math.pow(Math.abs(s), 2 / p);
      pos.push(...toWorld(path[i][0] + bx * wx + ux * hz, path[i][1] + by * wx + uy * hz, path[i][2] + bz * wx + uz * hz));
    }
  }
  const idx: number[] = [];
  for (let i = 0; i + 1 < n; i++)
    for (let k = 0; k < K; k++) {
      const p0 = i * K + k, p1 = i * K + ((k + 1) % K), q1 = (i + 1) * K + ((k + 1) % K), q0 = (i + 1) * K + k;
      idx.push(p0, p1, q1, p0, q1, q0);
    }
  for (const i of [0, n - 1]) {
    const c = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < K; k++) {
      cx += pos[3 * (i * K + k)] / K;
      cy += pos[3 * (i * K + k) + 1] / K;
      cz += pos[3 * (i * K + k) + 2] / K;
    }
    pos.push(cx, cy, cz);
    // the two end caps face opposite ways
    for (let k = 0; k < K; k++) {
      if (i === 0) idx.push(c, i * K + ((k + 1) % K), i * K + k);
      else idx.push(c, i * K + k, i * K + ((k + 1) % K));
    }
  }
  return orientOutward(pos, idx);
}

// ---------------------------------------------------------------------------------------------
// Shoe upper lattice
// ---------------------------------------------------------------------------------------------

/**
 * Regular triangulated lattice over the sections (strut centres on the section surface):
 * each section gets nodes evenly spaced by arc length (about one cell apart); consecutive
 * sections are zipped into triangles. Nodes where `opening(b, z)` holds are removed; the edge of
 * the opening gets exact collar nodes (on the section where z = collarZ(b)) joined into a
 * smooth closed collar line of radius `collarR`.
 */
export function sectionLattice(opts: {
  sections: Section[];
  cell: number;
  radius: number;
  collarR: number;
  opening: (b: number, z: number) => boolean;
  collarZ: (b: number) => number;
  toWorld: ToWorld;
  /**
   * Double skin (like the reference lattice shoes): a second, outer copy of the lattice this far
   * out along the surface normal, braced to the inner one by crossing diagonals (an X in section).
   */
  shell?: number;
  /**
   * 'grid': rows of nodes along the sections zipped into triangles; 'diamond': every other row
   * shifted half a cell and no struts along the rows, so the struts form diamonds (a knit look).
   */
  pattern?: 'grid' | 'diamond';
}): Lattice & { collarEdges: Set<number>; nodeCount: number } {
  const { sections, cell, radius: r, collarR, opening, collarZ, toWorld, shell = 0, pattern = 'grid' } = opts;
  const out = { ...emptyLattice(), collarEdges: new Set<number>(), nodeCount: 0 };
  const outerOf = new Map<number, [number, number, number]>(); // node → its outer copy's position
  const node = (s: Section, th: number, extra = 0) => {
    const [a, z] = sectionAt(s, th);
    const [na, nz] = sectionNormal(s, th);
    out.nodes.push(...toWorld(a + na * extra, s.b, z + nz * extra));
    const id = out.nodes.length / 3 - 1;
    if (shell > 0 && extra === 0) outerOf.set(id, toWorld(a + na * shell, s.b, z + nz * shell));
    return id;
  };
  const edge = (p: number, q: number, rad = r) => {
    if (p < 0 || q < 0 || p === q) return;
    out.edges.push(p, q);
    out.radii.push(rad);
  };
  type Row = { ids: number[]; ts: number[]; cutM: number; cutL: number; collarM: number; collarL: number };
  const rows: Row[] = [];
  for (const [si, s] of sections.entries()) {
    const n = Math.max(2, Math.round(sectionLength(s) / cell));
    const ths = pattern === 'diamond' && si % 2 ? evenThetas(s, 2 * n).filter((_, k) => k % 2 === 1 || k === 0 || k === 2 * n) : evenThetas(s, n);
    const ts = ths.map((t) => t / Math.PI);
    const ids = ths.map((t) => (opening(s.b, sectionAt(s, t)[1]) ? -1 : node(s, t)));
    // exact collar points where the section crosses the collar height (both sides)
    let cutM = -1, cutL = -1, collarM = -1, collarL = -1;
    const zc = collarZ(s.b);
    if (opening(s.b, s.zBase + s.hs + 1) && s.zBase + s.hs > zc) {
      const solve = (from: number, to: number) => {
        let lo = from, hi = to; // z(lo) < zc ≤ z(hi)
        for (let it = 0; it < 30; it++) {
          const mid = (lo + hi) / 2;
          if (sectionAt(s, mid)[1] < zc) lo = mid;
          else hi = mid;
        }
        return (lo + hi) / 2;
      };
      const tm = solve(0, Math.PI / 2), tl = solve(Math.PI, Math.PI / 2);
      cutM = tm / Math.PI;
      cutL = tl / Math.PI;
      collarM = node(s, tm, collarR - r);
      collarL = node(s, tl, collarR - r);
    }
    rows.push({ ids, ts, cutM, cutL, collarM, collarL });
  }
  // rows: edges along each section and zipped diagonals between sections
  for (let i = 0; i < rows.length; i++) {
    const R0 = rows[i];
    if (pattern === 'grid') for (let j = 0; j + 1 < R0.ids.length; j++) edge(R0.ids[j], R0.ids[j + 1]);
    if (i + 1 >= rows.length) continue;
    const R1 = rows[i + 1];
    let j = 0, k = 0;
    edge(R0.ids[0], R1.ids[0]);
    while (j < R0.ids.length - 1 || k < R1.ids.length - 1) {
      if (k >= R1.ids.length - 1 || (j < R0.ids.length - 1 && R0.ts[j + 1] <= R1.ts[k + 1])) j++;
      else k++;
      edge(R0.ids[j], R1.ids[k]);
    }
  }
  if (shell > 0) {
    // outer skin with the same layout, and each inner strut crossed by two diagonals to the outer skin
    const outerId = new Map<number, number>();
    for (const [id, pos] of outerOf) {
      out.nodes.push(...pos);
      outerId.set(id, out.nodes.length / 3 - 1);
    }
    const inner = out.edges.length / 2;
    for (let e = 0; e < inner; e++) {
      const p = out.edges[2 * e], q = out.edges[2 * e + 1];
      const po = outerId.get(p), qo = outerId.get(q);
      if (po === undefined || qo === undefined) continue;
      edge(po, qo);
      edge(p, qo);
      edge(q, po);
    }
  }
  // collar: medial side front to back… around the heel … lateral side back to front, plus the
  // throat edge over the top of the first uncut section.
  const cut = rows.map((R, i) => (R.collarM >= 0 ? i : -1)).filter((i) => i >= 0);
  if (cut.length) {
    const cEdge = (p: number, q: number) => {
      if (p < 0 || q < 0) return;
      edge(p, q, collarR);
      out.collarEdges.add(out.radii.length - 1);
    };
    for (let c = 0; c + 1 < cut.length; c++) {
      cEdge(rows[cut[c]].collarM, rows[cut[c + 1]].collarM);
      cEdge(rows[cut[c]].collarL, rows[cut[c + 1]].collarL);
    }
    const first = rows[cut[0]], last = cut[cut.length - 1];
    cEdge(first.collarM, first.collarL); // across the back of the heel
    // throat: over the top of the last cut section, between its two collar points
    const sLast = sections[last];
    const tm = rows[last].cutM * Math.PI, tl = rows[last].cutL * Math.PI;
    const steps = Math.max(2, Math.round((sectionLength(sLast) * (tl - tm)) / Math.PI / cell));
    let prev = rows[last].collarM;
    const throatNodes: number[] = [];
    for (let q = 1; q < steps; q++) {
      const id = node(sLast, tm + ((tl - tm) * q) / steps, collarR - r);
      throatNodes.push(id);
      cEdge(prev, id);
      prev = id;
    }
    cEdge(prev, rows[last].collarL);
    // tie the throat edge to the first full section in front of it
    const next = rows[last + 1];
    if (next) {
      for (const [q, id] of throatNodes.entries()) {
        const t = (tm + ((tl - tm) * (q + 1)) / steps) / Math.PI;
        let best = 0;
        next.ts.forEach((u, k) => { if (Math.abs(u - t) < Math.abs(next.ts[best] - t)) best = k; });
        edge(id, next.ids[best]);
      }
    }
    // tie each section's lattice to its collar points (and the next section's)
    for (const i of cut) {
      const R0 = rows[i];
      const lastM = R0.ts.reduce((acc, t, k) => (t < R0.cutM && R0.ids[k] >= 0 ? k : acc), -1);
      const firstL = R0.ts.reduce((acc, t, k) => (acc < 0 && t > R0.cutL && R0.ids[k] >= 0 ? k : acc), -1);
      if (lastM >= 0) edge(R0.ids[lastM], R0.collarM);
      if (firstL >= 0) edge(R0.ids[firstL], R0.collarL);
      const R1 = rows[i + 1];
      if (R1 && R1.collarM >= 0 && lastM >= 0) edge(R0.ids[lastM], R1.collarM);
      if (R1 && R1.collarL >= 0 && firstL >= 0) edge(R0.ids[firstL], R1.collarL);
    }
  }
  out.nodeCount = out.nodes.length / 3;
  return out;
}
