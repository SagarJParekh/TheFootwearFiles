/**
 * Standard (product) shapes for footwear: the outer shape is not a copy of the foot but a
 * smooth, conventional form that is fitted around it.
 *
 *  - Outline: a sole spline (rounded heel, gentle waist, ball from the landmarks, rounded toe)
 *    grown until it contains the lower part of the foot plus the clearance and the rim wall.
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
import type { InsoleFrame } from '../insole/frame';
import type { Grid } from '../insole/heightfield';
import { catmullRomClosed, polygonSdf, type Pt } from '../insole/outline';
import { signedVolume } from '../mesh/normals';
import { emptyLattice, type Lattice } from './lattice';

export type ToWorld = (a: number, b: number, z: number) => [number, number, number];

// ---------------------------------------------------------------------------------------------
// Outline
// ---------------------------------------------------------------------------------------------

/**
 * Standard sole outline (sandal / last-bottom proportions): a closed spline through a rounded
 * heel, a gentle waist (much fuller than an insole's arch cut-in), the ball widths from the M1/M5
 * landmarks and a rounded toe leaning towards the big toe.
 */
export function soleOutline(frame: InsoleFrame, length: number, heelBack: number): Pt[] {
  const m = frame.medialSign, lat = -m, L = length;
  const [a1, b1] = frame.met1, [a5, b5] = frame.met5;
  const medBall = Math.abs(a1) + 10, latBall = Math.abs(a5) + 10;
  const hw = 0.14 * L; // heel half width
  const bToe = heelBack + L;
  const ctrl: Pt[] = [
    [0, heelBack],
    [lat * hw * 0.82, heelBack + 0.045 * L],
    [lat * hw, heelBack + 0.15 * L],
    [lat * (0.35 * hw + 0.65 * latBall) * 0.98, heelBack + 0.45 * L],
    [lat * latBall, b5],
    [lat * latBall * 0.88, b5 + 0.45 * (bToe - b5)],
    [lat * latBall * 0.5, bToe - 0.045 * L],
    [m * 0.2 * medBall, bToe],
    [m * medBall * 0.95, b1 + 0.55 * (bToe - b1)],
    [m * medBall, b1],
    [m * (0.3 * hw + 0.7 * medBall) * 0.94, heelBack + 0.45 * L],
    [m * hw, heelBack + 0.15 * L],
    [m * hw * 0.82, heelBack + 0.045 * L],
  ];
  return catmullRomClosed(ctrl, 14);
}

/**
 * Standard outline (sole spline from heel back to toe tip) grown until every node for which
 * `contain(k)` holds is inside. Returns the polygon and its signed distance field.
 */
export function standardOutline(frame: InsoleFrame, g: Grid, heelBack: number, length: number, contain: Uint8Array): { poly: Pt[]; sdf: Float32Array } {
  // Only the border of the region matters for containment.
  const border: [number, number][] = [];
  for (let j = 1; j < g.ny - 1; j++)
    for (let i = 1; i < g.nx - 1; i++) {
      const k = j * g.nx + i;
      if (contain[k] && (!contain[k - 1] || !contain[k + 1] || !contain[k - g.nx] || !contain[k + g.nx])) border.push([g.a0 + i * g.h, g.b0 + j * g.h]);
    }
  // Grow the spline where the region sticks out: longer at the heel or the toes, wider at
  // the sides (the spline keeps its standard proportions otherwise).
  let back = heelBack, len = length, scale = 1;
  let poly: Pt[] = [];
  for (let it = 0; it < 40; it++) {
    poly = soleOutline(frame, len, back).map(([a, b]) => [a * scale, b] as Pt);
    let worst = -Infinity, wb = 0;
    for (const [a, b] of border) {
      const d = polygonSdf(poly, a, b);
      if (d > worst) {
        worst = d;
        wb = b;
      }
    }
    if (worst <= -0.3) break;
    const step = Math.min(4, worst + 0.5);
    const f = (wb - back) / len;
    if (f < 0.12) {
      back -= step;
      len += step;
    } else if (f > 0.85) len += step;
    else scale *= 1 + Math.min(0.05, step / 45);
  }
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
}

/** Point of a section at θ ∈ [0, π] (0 = medial or lateral base, π = the other base). */
export function sectionAt(s: Section, th: number): [number, number] {
  const c = Math.cos(th), sn = Math.max(0, Math.sin(th));
  const w = s.hw + ((s.hwMax ?? s.hw) - s.hw) * Math.pow(sn, 0.35);
  return [s.ac - w * Math.sign(c) * Math.pow(Math.abs(c), 2 / s.p), s.zBase + s.hs * Math.pow(sn, 2 / s.p)];
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
  const pos: number[] = [];
  const R = 2 * (M + 1);
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const th = evenThetas(s, M);
    const outer: number[][] = [], inner: number[][] = [];
    for (const t of th) {
      const [a, z] = sectionAt(s, t);
      const [na, nz] = sectionNormal(s, t);
      inner.push(toWorld(a, s.b, z));
      outer.push(toWorld(a + na * thickness[i], s.b, z + nz * thickness[i]));
    }
    for (const p of outer) pos.push(...p);
    for (let j = M; j >= 0; j--) pos.push(...inner[j]);
  }
  const idx: number[] = [];
  for (let i = 0; i + 1 < sections.length; i++)
    for (let v = 0; v < R; v++) {
      const p = i * R + v, q = i * R + ((v + 1) % R), u = (i + 1) * R + ((v + 1) % R), w = (i + 1) * R + v;
      idx.push(p, q, u, p, u, w);
    }
  // end caps: the two ends face opposite ways, so the far one is wound the other way round
  for (const i of [0, sections.length - 1]) {
    const flip = i === 0;
    for (let j = 0; j < M; j++) {
      const o0 = i * R + j, o1 = i * R + j + 1, i1 = i * R + (R - 1 - (j + 1)), i0 = i * R + (R - 1 - j);
      if (flip) idx.push(o0, i1, o1, o0, i0, i1);
      else idx.push(o0, o1, i1, o0, i1, i0);
    }
  }
  return orientOutward(pos, idx);
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
}): Lattice & { collarEdges: Set<number>; nodeCount: number } {
  const { sections, cell, radius: r, collarR, opening, collarZ, toWorld } = opts;
  const out = { ...emptyLattice(), collarEdges: new Set<number>(), nodeCount: 0 };
  const node = (s: Section, th: number, extra = 0) => {
    const [a, z] = sectionAt(s, th);
    const [na, nz] = sectionNormal(s, th);
    out.nodes.push(...toWorld(a + na * extra, s.b, z + nz * extra));
    return out.nodes.length / 3 - 1;
  };
  const edge = (p: number, q: number, rad = r) => {
    if (p < 0 || q < 0 || p === q) return;
    out.edges.push(p, q);
    out.radii.push(rad);
  };
  type Row = { ids: number[]; ts: number[]; cutM: number; cutL: number; collarM: number; collarL: number };
  const rows: Row[] = [];
  for (const s of sections) {
    const n = Math.max(2, Math.round(sectionLength(s) / cell));
    const ths = evenThetas(s, n);
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
    for (let j = 0; j + 1 < R0.ids.length; j++) edge(R0.ids[j], R0.ids[j + 1]);
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
