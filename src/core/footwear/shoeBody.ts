/**
 * The shoe as ONE smooth implicit solid (designed solid first, lattice applied at the end):
 *
 *  - cavity: the foot (scan voxelised, plus room in front of the toes) offset by the clearance and
 *    smoothed by a morphological closing (radius `closing`): it follows the foot – a snug heel –
 *    but bridges the toes and small hollows like a last; its floor is the contoured footbed T
 *  - outer: the cavity thickened by the upper wall, smoothly blended with the sole block
 *    (outline × ground…footbed), so upper, midsole and sole are one continuous piece
 *  - opening: everything above the collar line is cut away with a rounded edge (the collar line
 *    is a smooth function along the foot, kept below the malleoli)
 *
 * Finish 'solid': the solid is meshed as is. Finish 'lattice': only the outsole plate and the
 * collar rim stay solid (and the sole side wall, if chosen); the outer shell – upper, footbed and
 * sole side wall – becomes ONE continuous strut lattice on the shell's mid-surface, and the space
 * between footbed, side wall and outsole is filled by a separate midsole lattice with its own
 * density (see shellLattice).
 */
import type { Grid } from '../insole/heightfield';
import type { MeshData } from '../types';
import { conformalLattice, emptyLattice, sampleGrid, type Lattice } from './lattice';
import { gaussianBlur } from '../insole/heightfield';
import { blur3d, edt3d, polygonizeVol, sampleVol, volIndex, type Vol } from './volume';

export interface ShoeBodyInput {
  g: Grid;
  /** foot rasters (frame grid): silhouette sdf, lowest (plantar) and highest surfaces */
  silhouetteSdf: Float32Array;
  bed: Float32Array;
  top: Float32Array;
  /** columns of the ankle / leg (the foot is solid up to the top of the volume there) */
  legColumn: Uint8Array;
  /** contoured footbed (top of the sole under the foot) */
  T: Float32Array;
  /** underside of the sole (flat base + toe spring + tread) */
  bottom: Float32Array;
  /** top of the solid outsole plate (lattice finish) */
  plateTop: Float32Array;
  /** sole outline signed distance (negative inside) */
  outlineSdf: Float32Array;
  /** collar line at (a, b): the shoe is cut away above it (Infinity = closed) */
  collarZ: (a: number, b: number) => number;
  /** top of the solid sole side wall (lattice finish, solid side wall) */
  sideTop: (b: number) => number;
  clearance: number;
  wall: number;
  toeAllowance: number;
  /** b of the metatarsal heads (toe room is added in front of them) */
  bBall: number;
  voxel: number;
  finish: 'solid' | 'lattice';
  sideWall: 'solid' | 'lattice';
  /** footbed surface the foot rests on (lattice finish: the top of the footbed struts) */
  footbedTop: Float32Array;
  /** midsole lattice (lattice finish): cell size and strut radius */
  midsoleCell: number;
  midsoleRadius: number;
  /** solid collar rim band (lattice finish), mm below the collar line */
  collarBand: number;
  /** sole wall thickness (inset of the midsole lattice) */
  soleWall: number;
  cell: number;
  radius: number;
  pattern: 'grid' | 'diamond';
  /** double: inner + outer skin braced by diagonals; single: one layer on the wall's mid-surface */
  skins: 'double' | 'single';
  toWorld: (a: number, b: number, z: number) => [number, number, number];
}

export interface ShoeBody {
  solid: MeshData;
  /** shell + midsole lattice (lattice finish), world coordinates */
  lattice: Lattice;
  /** lattice nodes on the footbed facing the foot (for the clearance check) */
  footbedNodes: number[];
  /** first node of the midsole lattice (the shell's nodes come before it) */
  midsoleStart: number;
  /** final solid field (negative inside) for checks */
  field: Float32Array;
  vol: Vol;
}

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

export function buildShoeBody(I: ShoeBodyInput): ShoeBody {
  const { g, clearance: c, wall: t, voxel: h } = I;
  const at = (f: Float32Array, a: number, b: number) => sampleGrid(g, f, a, b);
  const closing = 16; // bridges the toes and hollows like a last (mm)
  // --- volume extent -------------------------------------------------------------------------
  let aLo = Infinity, aHi = -Infinity, bLo = Infinity, bHi = -Infinity, zLo = Infinity, zFootTop = -Infinity, zBedLo = Infinity;
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const a = g.a0 + i * g.h, b = g.b0 + j * g.h;
      if (I.outlineSdf[k] < 0) {
        aLo = Math.min(aLo, a);
        aHi = Math.max(aHi, a);
        bLo = Math.min(bLo, b);
        bHi = Math.max(bHi, b);
        zLo = Math.min(zLo, I.bottom[k]);
      }
      if (I.silhouetteSdf[k] < 0 && Number.isFinite(I.top[k])) zFootTop = Math.max(zFootTop, I.top[k]);
      if (I.silhouetteSdf[k] < 0 && Number.isFinite(I.bed[k])) zBedLo = Math.min(zBedLo, I.bed[k]);
    }
  // the dilated foot (clearance + closing radius) must not reach the volume's border, or the
  // closing would leak out through it
  const pad = Math.max(t + 4, c + closing + 3);
  const zHi = zFootTop + c + closing + 3;
  const vol: Vol = { a0: aLo - pad, b0: bLo - pad, z0: Math.min(zLo - 2, zBedLo - c - closing - 3), h, nx: 0, ny: 0, nz: 0 };
  vol.nx = Math.ceil((aHi + pad - vol.a0) / h) + 1;
  vol.ny = Math.ceil((bHi + pad - vol.b0) / h) + 1;
  vol.nz = Math.ceil((zHi - vol.z0) / h) + 1;
  const { nx, ny, nz } = vol;
  const N = nx * ny * nz;
  const A = (i: number) => vol.a0 + i * h, B = (j: number) => vol.b0 + j * h, Z = (k: number) => vol.z0 + k * h;

  // --- foot occupancy (+ toe room) ----------------------------------------------------------
  const occ = new Uint8Array(N);
  const room = Math.round(I.toeAllowance / h);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = A(i), b = B(j);
      if (at(I.silhouetteSdf, a, b) >= 0) continue;
      const gi = Math.round((a - g.a0) / g.h), gj = Math.round((b - g.b0) / g.h);
      const leg = gi >= 0 && gj >= 0 && gi < g.nx && gj < g.ny && I.legColumn[gj * g.nx + gi] === 1;
      const lo = at(I.bed, a, b), hi = leg ? Infinity : at(I.top, a, b);
      if (!Number.isFinite(lo) || Number.isNaN(hi)) continue;
      for (let k = Math.max(0, Math.floor((lo - vol.z0) / h)); k < nz && Z(k) <= hi; k++) occ[volIndex(vol, i, j, k)] = 1;
    }
  // toe room: the forefoot extended forward along +b
  if (room > 0)
    for (let k = 0; k < nz; k++)
      for (let i = 0; i < nx; i++) {
        let run = 0;
        for (let j = 0; j < ny; j++) {
          const q = volIndex(vol, i, j, k);
          if (occ[q] === 1) run = room;
          else if (run > 0 && B(j) > I.bBall) {
            occ[q] = 2;
            run--;
          } else run = 0;
        }
      }

  // --- cavity: closing of (foot ⊕ clearance) ------------------------------------------------
  const dOut = edt3d(occ, vol);
  const inA = new Uint8Array(N);
  const cr = c + 0.3; // (+ margin for the smoothing)
  for (let q = 0; q < N; q++) inA[q] = dOut[q] <= cr + closing ? 0 : 1; // complement of the dilated set
  // (outside the volume counts as outside the dilated set)
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) inA[volIndex(vol, i, j, k)] = 1;
  const e = edt3d(inA, vol);
  const phi = new Float32Array(N);
  for (let q = 0; q < N; q++) phi[q] = inA[q] ? dOut[q] - cr : closing - e[q];
  // smooth like a last (toes, small bumps), then make sure the foot + clearance is still inside
  // (a stronger blur rounds the toe box; a little extra room there, little at the heel)
  blur3d(phi, vol, 4.5);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++) {
      const extra = 0.4 + 1.6 * Math.min(1, Math.max(0, (B(j) - (I.bBall - 40)) / 50));
      for (let i = 0; i < nx; i++) {
        const q = volIndex(vol, i, j, k);
        phi[q] = Math.min(phi[q] - extra, dOut[q] - cr);
      }
    }

  // --- solid -------------------------------------------------------------------------------
  // the sole block's top: the footbed, smoothed a lot (a smooth seam line with the upper)
  const Tsmooth = gaussianBlur(I.T, g, 12);
  const field = new Float32Array(N);
  const kSole = Math.max(6, 1.5 * t); // blend between upper and sole (one continuous side)
  for (let j = 0; j < ny; j++) {
    const b = B(j);
    const side = I.sideTop(b);
    for (let i = 0; i < nx; i++) {
      const a = A(i);
      const cz = I.collarZ(a, b);
      const os = at(I.outlineSdf, a, b), Tz = at(I.T, a, b), Bz = at(I.bottom, a, b), Pz = at(I.plateTop, a, b);
      for (let k = 0; k < nz; k++) {
        const z = Z(k), q = volIndex(vol, i, j, k);
        const ph = phi[q];
        // sole block: just inside the outline (so its sides run into the upper without a ledge),
        // with a rounded bottom edge
        // (its top stays low and smooth – the shell carries the arch support – so the seam where
        // it meets the upper is a smooth line, not a copy of the arch)
        const sole = Math.max(smax(os + 2.5, Bz - z, 4), z - (at(Tsmooth, a, b) + 2));
        let f = smin(ph - t, sole, kSole); // outer body
        const cavity = Math.max(ph, Tz - z); // above the footbed
        f = smax(f, -cavity, 1.2);
        if (Number.isFinite(cz)) f = smax(f, z - cz, Math.min(2.5, t * 0.6)); // the opening, rounded edge
        if (I.finish === 'lattice') {
          // keep only the solid bands: outsole plate, sole side wall, collar rim
          const plate = z - Pz;
          const sideBand = I.sideWall === 'solid' ? Math.max(z - side, os < -I.soleWall && z > Pz ? 1 : -1) : 1;
          const collar = Number.isFinite(cz) ? cz - I.collarBand - z : 1;
          f = Math.max(f, Math.min(plate, sideBand, collar));
        }
        field[q] = f;
      }
    }
  }
  blur3d(field, vol, 0.6); // (removes sampling streaks; edges stay crisp at this scale)
  const solid = polygonizeVol(field, vol, I.toWorld);

  // --- shell + midsole lattice (lattice finish) ----------------------------------------------
  const outer = (a: number, b: number, z: number) => {
    const os = at(I.outlineSdf, a, b);
    const sole = Math.max(smax(os + 2.5, at(I.bottom, a, b) - z, 4), z - (at(Tsmooth, a, b) + 2));
    return smin(sampleVol(phi, vol, a, b, z) - t, sole, kSole);
  };
  const out = I.finish === 'lattice' ? shellLattice(I, vol, outer) : { lattice: emptyLattice(), footbedNodes: [], midsoleStart: 0 };
  return { solid, lattice: out.lattice, footbedNodes: out.footbedNodes, midsoleStart: out.midsoleStart, field, vol };
}

type Field = (a: number, b: number, z: number) => number;
const gradOf = (f: Field, p: number[], e = 0.35): number[] => [
  (f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2])) / (2 * e),
  (f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2])) / (2 * e),
  (f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e)) / (2 * e),
];

/** A coarse strut net on the zero set of `f`: ≈ one cell per edge, welded and relaxed on the surface. */
function surfaceNet(f: Field, vol: Vol, s: number, pattern: 'grid' | 'diamond') {
  const cv: Vol = { a0: vol.a0, b0: vol.b0, z0: vol.z0, h: s, nx: Math.ceil(((vol.nx - 1) * vol.h) / s) + 1, ny: Math.ceil(((vol.ny - 1) * vol.h) / s) + 1, nz: Math.ceil(((vol.nz - 1) * vol.h) / s) + 1 };
  const coarse = new Float32Array(cv.nx * cv.ny * cv.nz);
  for (let k = 0; k < cv.nz; k++)
    for (let j = 0; j < cv.ny; j++) for (let i = 0; i < cv.nx; i++) coarse[volIndex(cv, i, j, k)] = f(cv.a0 + i * s, cv.b0 + j * s, cv.z0 + k * s);
  const m = polygonizeVol(coarse, cv, (a, b, z) => [a, b, z]);
  // weld close vertices (no slivers), then relax on the surface
  const P = Array.from({ length: m.positions.length / 3 }, (_, v) => [m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]]);
  const rep = new Int32Array(P.length).map((_, v) => v);
  const find = (v: number): number => (rep[v] === v ? v : (rep[v] = find(rep[v])));
  const tris: number[][] = [];
  for (let q = 0; q < m.indices.length; q += 3) tris.push([m.indices[q], m.indices[q + 1], m.indices[q + 2]]);
  for (const tr of tris)
    for (let e = 0; e < 3; e++) {
      const p = find(tr[e]), q = find(tr[(e + 1) % 3]);
      if (p !== q && Math.hypot(P[p][0] - P[q][0], P[p][1] - P[q][1], P[p][2] - P[q][2]) < 0.4 * s) rep[q] = p;
    }
  const edges = new Map<string, { p: number; q: number; tris: number }>();
  const keyOf = (p: number, q: number) => (p < q ? `${p},${q}` : `${q},${p}`);
  const triEdges: string[][] = [];
  for (const tr of tris) {
    const v = tr.map(find);
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    const ks: string[] = [];
    for (let e = 0; e < 3; e++) {
      const p = v[e], q = v[(e + 1) % 3], key = keyOf(p, q);
      const ed = edges.get(key) ?? { p: Math.min(p, q), q: Math.max(p, q), tris: 0 };
      ed.tris++;
      edges.set(key, ed);
      ks.push(key);
    }
    triEdges.push(ks);
  }
  const nbr = new Map<number, number[]>();
  for (const ed of edges.values()) {
    (nbr.get(ed.p) ?? nbr.set(ed.p, []).get(ed.p)!).push(ed.q);
    (nbr.get(ed.q) ?? nbr.set(ed.q, []).get(ed.q)!).push(ed.p);
  }
  const project = (p: number[]) => {
    for (let it = 0; it < 4; it++) {
      const v = f(p[0], p[1], p[2]);
      const gr = gradOf(f, p);
      const g2 = gr[0] ** 2 + gr[1] ** 2 + gr[2] ** 2;
      if (g2 < 0.05) break; // (flat field: leave the point)
      // step towards the level set, at most half a cell
      const k = Math.max(-0.5 * s, Math.min(0.5 * s, v / Math.sqrt(g2))) / Math.sqrt(g2);
      p[0] -= k * gr[0];
      p[1] -= k * gr[1];
      p[2] -= k * gr[2];
    }
  };
  for (let it = 0; it < 4; it++) {
    const next = new Map<number, number[]>();
    for (const [v, ns] of nbr) {
      const avg = [0, 0, 0];
      for (const n of ns) for (let k = 0; k < 3; k++) avg[k] += P[n][k] / ns.length;
      const p = [0.5 * P[v][0] + 0.5 * avg[0], 0.5 * P[v][1] + 0.5 * avg[1], 0.5 * P[v][2] + 0.5 * avg[2]];
      project(p);
      next.set(v, p);
    }
    for (const [v, p] of next) P[v] = p;
  }
  // diamond: drop the longest edge of each triangle (pairs of triangles become quads)
  const drop = new Set<string>();
  if (pattern === 'diamond') {
    for (const ks of triEdges) {
      let best = ks[0], bl = -1;
      for (const k of ks) {
        const ed = edges.get(k)!;
        const l = Math.hypot(P[ed.p][0] - P[ed.q][0], P[ed.p][1] - P[ed.q][1], P[ed.p][2] - P[ed.q][2]);
        if (l > bl) [bl, best] = [l, k];
      }
      if (edges.get(best)!.tris === 2) drop.add(best);
    }
  }
  return { P, edges: [...edges].filter(([k]) => !drop.has(k)).map(([, e]) => [e.p, e.q] as [number, number]) };
}

/** Nearest-point lookup on a uniform hash (frame coordinates). */
function pointHash(pts: number[][], cell: number) {
  const key = (i: number, j: number, k: number) => `${i},${j},${k}`;
  const map = new Map<string, number[]>();
  pts.forEach((p, n) => {
    const kk = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell));
    (map.get(kk) ?? map.set(kk, []).get(kk)!).push(n);
  });
  return (p: number[], maxD: number, ok: (n: number) => boolean = () => true) => {
    let best = -1, bd = maxD;
    const ci = Math.floor(p[0] / cell), cj = Math.floor(p[1] / cell), ck = Math.floor(p[2] / cell), R = Math.ceil(maxD / cell);
    for (let i = ci - R; i <= ci + R; i++)
      for (let j = cj - R; j <= cj + R; j++)
        for (let k = ck - R; k <= ck + R; k++)
          for (const n of map.get(key(i, j, k)) ?? []) {
            const d = Math.hypot(pts[n][0] - p[0], pts[n][1] - p[1], pts[n][2] - p[2]);
            if (d < bd && ok(n)) [bd, best] = [d, n];
          }
    return best;
  };
}

/**
 * Lattice finish, two separate strut networks joined into one piece:
 *
 *  - outer shell: ONE continuous lattice over the upper, the sole side wall and the footbed. Upper
 *    and side wall are a single net on the shell's mid-surface, from the collar down to the
 *    outsole (no seam on the outside); the footbed is a sheet across the inside, its edge anchored
 *    in the shell's inner face. Double skin: inner + outer struts (flush with the shell's faces)
 *    braced by diagonals.
 *  - midsole: a conformal tetrahedral lattice filling the space between the footbed, the side wall
 *    and the outsole, with its own cell size and strut, stitched to the shell all round.
 */
function shellLattice(I: ShoeBodyInput, vol: Vol, outer: Field): { lattice: Lattice; footbedNodes: number[]; midsoleStart: number } {
  const t = I.wall, r = I.radius, s = I.cell;
  const at = (f: Float32Array, a: number, b: number) => sampleGrid(I.g, f, a, b);
  const mid = t / 2;
  // double: strut surfaces flush with the shell's two faces; single: one layer in the middle
  const off = I.skins === 'single' ? 0 : Math.max(0, mid - r - 0.05);
  // footbed sheet: its top struts touch the footbed surface (the foot's clearance)
  const Fz = new Float32Array(I.footbedTop.length);
  for (let k = 0; k < Fz.length; k++) Fz[k] = I.footbedTop[k] - off - r - 0.05;
  const fz = (a: number, b: number) => at(Fz, a, b);
  const shell: Field = (a, b, z) => outer(a, b, z) + mid;
  const collarOk = (p: number[]) => {
    const cz = I.collarZ(p[0], p[1]);
    return !(Number.isFinite(cz) && p[2] > cz - I.collarBand + 1.5);
  };
  const floorZ = (a: number, b: number) => (I.sideWall === 'solid' ? I.sideTop(b) - 1.5 : at(I.plateTop, a, b) - 0.5);

  const pts: number[][] = []; // all lattice nodes, frame coordinates
  const out = emptyLattice();
  const strut = (p: number, q: number, rad = r) => {
    out.edges.push(p, q);
    out.radii.push(rad);
  };
  type Skin = { c: number[]; inner: number; outer: number };
  /** Lays a net's struts (inner + outer skin, diagonals) where `keep` allows; returns the skin nodes per vertex. */
  const layNet = (f: Field, keep: (p: number[]) => boolean) => {
    const net = surfaceNet(f, vol, s, I.pattern);
    const skins = new Map<number, Skin>();
    const nodeOf = (v: number) => {
      let sk = skins.get(v);
      if (!sk) {
        const p = net.P[v];
        const gr = gradOf(f, p);
        const gl = Math.hypot(gr[0], gr[1], gr[2]) || 1;
        const n = [gr[0] / gl, gr[1] / gl, gr[2] / gl]; // (outward of the region; inner = towards the foot / midsole)
        pts.push([p[0] - n[0] * off, p[1] - n[1] * off, p[2] - n[2] * off]);
        pts.push([p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off]);
        sk = { c: p, inner: pts.length - 2, outer: pts.length - 1 };
        skins.set(v, sk);
      }
      return sk;
    };
    const cut = new Set<number>(); // vertices with a struts removed by `keep` (the net's open edges)
    for (const [p, q] of net.edges) {
      if (!keep(net.P[p]) || !keep(net.P[q])) {
        if (keep(net.P[p])) cut.add(p);
        if (keep(net.P[q])) cut.add(q);
        continue;
      }
      const a = nodeOf(p), b = nodeOf(q);
      strut(a.inner, b.inner);
      if (off > 0.5) {
        strut(a.outer, b.outer);
        strut(a.inner, b.outer);
        strut(b.inner, a.outer);
      }
    }
    return { skins, cut };
  };

  // 1. outer shell: upper + sole side wall – ONE net on the shell's mid-surface, collar to outsole
  //    (no seam anywhere on the outside)
  const keepOuter = (p: number[]) => {
    const [a, b, z] = p;
    if (!collarOk(p) || z < floorZ(a, b)) return false;
    // (not the shell's underside, which lies in the outsole plate)
    return z > fz(a, b) || at(I.outlineSdf, a, b) > -2.5 - mid - 0.6 * s;
  };
  const outerNet = layNet(shell, keepOuter);
  const outerSkins = [...outerNet.skins.values()];
  // 2. footbed: a sheet across the inside of the shell, its edge anchored in the shell's inner face
  const bed = layNet((a, b, z) => fz(a, b) - z, (p) => Math.abs(p[2] - fz(p[0], p[1])) < 0.5 * s && shell(p[0], p[1], p[2]) < -0.35 * s);
  // (only the sheet: the volume's border closes the plane's level set elsewhere)
  const nearOuter = pointHash(outerSkins.map((k) => k.c), s);
  for (const v of bed.cut) {
    const sk = bed.skins.get(v);
    if (!sk) continue;
    const n = nearOuter(sk.c, 1.4 * s);
    if (n < 0) continue;
    const o = outerSkins[n];
    strut(sk.inner, o.inner);
    if (off > 0.5) {
      strut(sk.outer, o.inner);
      strut(sk.inner, o.outer);
      strut(sk.outer, o.outer);
    }
  }
  const footbedNodes: number[] = [], bedFacing: number[] = [], sideFacing: number[] = [];
  for (const sk of bed.skins.values()) {
    footbedNodes.push(sk.inner); // (top: faces the foot)
    bedFacing.push(sk.outer); // (underside: faces the midsole)
  }
  for (const sk of outerSkins) if (sk.c[2] < fz(sk.c[0], sk.c[1])) sideFacing.push(sk.inner);

  // 3. midsole: its own lattice between the outsole plate and the footbed sheet, inside the side wall
  const rm = I.midsoleRadius, sm = I.midsoleCell;
  const g = I.g;
  const upper = new Float32Array(Fz.length), lower = I.plateTop;
  const stacks: number[] = [];
  for (let k = 0; k < Fz.length; k++) {
    upper[k] = Fz[k] - off - r - rm;
    if (I.outlineSdf[k] < -2.5 - t - sm) stacks.push(upper[k] - lower[k]);
  }
  stacks.sort((x, y) => x - y);
  const stack = stacks[stacks.length >> 1] ?? 0;
  const layers = Math.max(1, Math.min(8, Math.round(stack / (0.82 * sm))));
  const inset = I.sideWall === 'lattice' ? 2.5 + mid + off + r + rm + 0.3 : I.soleWall + rm;
  const ms = conformalLattice({ grid: g, lower, upper, cell: sm, radius: rm, layers, toWorld: (a, b, z) => [a, b, z], inside: (a, b) => at(I.outlineSdf, a, b) < -inset });
  const m0 = pts.length;
  for (let v = 0; v < ms.nodes.length / 3; v++) pts.push([ms.nodes[3 * v], ms.nodes[3 * v + 1], ms.nodes[3 * v + 2]]);
  for (let e = 0; e < ms.edges.length; e += 2) strut(m0 + ms.edges[e], m0 + ms.edges[e + 1], rm);
  // stitch: top layer up to the footbed's underside, the outermost nodes out to the side wall
  const facing = [...bedFacing, ...sideFacing];
  const nearF = pointHash(facing.map((n) => pts[n]), Math.max(s, sm));
  const reach = 0.85 * Math.max(s, sm);
  const linked = new Set<number>();
  const top = new Set(ms.topNodes);
  for (let v = 0; v < ms.nodes.length / 3; v++) {
    const p = pts[m0 + v];
    const outline = at(I.outlineSdf, p[0], p[1]);
    if (!top.has(v) && outline < -inset - 0.75 * sm) continue; // (interior nodes)
    const n = nearF(p, reach, (k) => !linked.has(facing[k]) || top.has(v));
    if (n < 0) continue;
    linked.add(facing[n]);
    strut(m0 + v, facing[n], rm);
  }

  // → world coordinates
  for (const p of pts) out.nodes.push(...I.toWorld(p[0], p[1], p[2]));
  const kept = dropSmallPieces(out, 30);
  const used = new Set(kept.edges);
  return { lattice: kept, footbedNodes: footbedNodes.filter((n) => used.has(n)), midsoleStart: m0 };
}

/** Removes lattice pieces with fewer than `min` struts (loose fragments that would print as debris). */
function dropSmallPieces(l: Lattice, min: number): Lattice {
  const n = l.nodes.length / 3;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (v: number): number => (parent[v] === v ? v : (parent[v] = find(parent[v])));
  for (let e = 0; e < l.edges.length; e += 2) parent[find(l.edges[e])] = find(l.edges[e + 1]);
  const count = new Map<number, number>();
  for (let e = 0; e < l.edges.length; e += 2) count.set(find(l.edges[e]), (count.get(find(l.edges[e])) ?? 0) + 1);
  const out = emptyLattice();
  out.nodes = l.nodes;
  for (let e = 0; e < l.edges.length; e += 2) {
    if ((count.get(find(l.edges[e])) ?? 0) < min) continue;
    out.edges.push(l.edges[e], l.edges[e + 1]);
    out.radii.push(l.radii[e >> 1]);
  }
  return out;
}
