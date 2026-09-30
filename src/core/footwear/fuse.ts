/**
 * Smooth fusion of the footwear parts into ONE watertight surface, the way the reference designs
 * are modelled (implicitly): every closed solid part and every lattice strut becomes a signed
 * distance field, the fields are joined by a smooth union (a fillet of radius ~k at every
 * junction – strap into rim, ridge into wings, post into footbed, struts into each other at the
 * nodes) and the zero level set is meshed with marching tetrahedra on a fine grid.
 *
 * Sparse: space is split into blocks of 8³ voxels; only blocks within reach of a surface are
 * evaluated (everything else is far inside or far outside and holds no surface).
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { makeMesh, type MeshData } from '../types';
import { weldSoup } from '../mesh/weld';
import { findBoundaryLoops } from '../mesh/holes';
import { fillLoops } from '../mesh/fill/fillHoles';
import type { Lattice } from './lattice';

export interface FuseOptions {
  /** Voxel size (mm). */
  voxel: number;
  /** Fillet between solid parts (mm). */
  blendSolids: number;
  /** Fillet between lattice struts at the nodes, and between struts and solids (mm). */
  blendLattice: number;
}

/** Polynomial smooth minimum (fillet of about k). */
function smin(a: number, b: number, k: number): number {
  if (a === Infinity) return b;
  if (b === Infinity) return a;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Signed distance to a closed, outward-wound triangle mesh (negative inside), within `max`. */
function meshDistance(mesh: MeshData) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  const bvh = new MeshBVH(geom);
  const P = mesh.positions, I = mesh.indices;
  const target = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const pt = new THREE.Vector3(), tmp = new THREE.Vector3(), sum = new THREE.Vector3(), fn = new THREE.Vector3();
  const faceNormal = (f: number, out: THREE.Vector3) => {
    const t = f * 3, A = I[t] * 3, B = I[t + 1] * 3, C = I[t + 2] * 3;
    const e1x = P[B] - P[A], e1y = P[B + 1] - P[A + 1], e1z = P[B + 2] - P[A + 2];
    const e2x = P[C] - P[A], e2y = P[C + 1] - P[A + 1], e2z = P[C + 2] - P[A + 2];
    return out.set(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x).normalize();
  };
  const box = new THREE.Box3();
  geom.computeBoundingBox();
  box.copy(geom.boundingBox!);
  return {
    box,
    /** Unsigned distance, or Infinity beyond `max`. */
    near(x: number, y: number, z: number, max: number): number {
      pt.set(x, y, z);
      const r = bvh.closestPointToPoint(pt, target as never, 0, max) as unknown;
      return r ? target.distance : Infinity;
    },
    /**
     * Signed distance, clamped to ±`max` beyond it (the same value whichever block asks, so
     * shared grid corners agree and the surface stays closed).
     */
    signed(x: number, y: number, z: number, max: number): number {
      pt.set(x, y, z);
      let clamp = false;
      if (!bvh.closestPointToPoint(pt, target as never, 0, max)) {
        // beyond the cutoff: only the side matters
        bvh.closestPointToPoint(pt, target as never);
        clamp = true;
      }
      const d = target.distance;
      const q = target.point;
      const dx = x - q.x, dy = y - q.y, dz = z - q.z;
      const n = faceNormal(target.faceIndex, fn);
      let s = dx * n.x + dy * n.y + dz * n.z;
      if (d > 1e-7 && Math.abs(s) < 0.9 * d) {
        // nearest point on an edge / corner: average the normals of all faces touching it
        sum.set(0, 0, 0);
        const eps = 1e-4 + d * 1e-4;
        bvh.shapecast({
          intersectsBounds: (b: THREE.Box3) => b.distanceToPoint(pt) <= d + eps,
          intersectsTriangle: (tri: THREE.Triangle, i: number) => {
            if (tri.closestPointToPoint(pt, tmp).distanceTo(pt) <= d + eps) sum.add(faceNormal(i, fn));
            return false;
          },
        } as never);
        s = dx * sum.x + dy * sum.y + dz * sum.z;
      }
      const v = clamp ? Math.max(d, max) : d;
      return s < 0 ? -v : v;
    },
  };
}

/** A solid given directly as a (conservative, sign-exact) distance function, with its bounds. */
export interface ImplicitSolid {
  box: THREE.Box3;
  f: (x: number, y: number, z: number) => number;
}

const CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const TETS = [
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
  [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
];

export function fuseFootwear(parts: { solids: MeshData[]; implicit?: ImplicitSolid[]; lattice: Lattice }, opts: FuseOptions): MeshData {
  const { voxel: h, blendSolids: kS, blendLattice: kL } = opts;
  const solids = parts.solids.map(meshDistance);
  const implicit = parts.implicit ?? [];
  // struts as capsules, in a spatial hash
  const L = parts.lattice, N = L.nodes;
  const nStruts = L.edges.length / 2;
  const cap = new Float32Array(nStruts * 7);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let e = 0; e < nStruts; e++) {
    const p = L.edges[2 * e], q = L.edges[2 * e + 1];
    for (let k = 0; k < 3; k++) {
      cap[7 * e + k] = N[3 * p + k];
      cap[7 * e + 3 + k] = N[3 * q + k];
      lo[k] = Math.min(lo[k], N[3 * p + k], N[3 * q + k]);
      hi[k] = Math.max(hi[k], N[3 * p + k], N[3 * q + k]);
    }
    cap[7 * e + 6] = L.radii[e];
  }
  for (const s of [...solids, ...implicit]) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], s.box.min.getComponent(k));
      hi[k] = Math.max(hi[k], s.box.max.getComponent(k));
    }
  }
  const pad = Math.max(kS, kL) + 3 * h;
  for (let k = 0; k < 3; k++) {
    lo[k] -= pad;
    hi[k] += pad;
  }
  const HC = 4; // hash cell (mm)
  const hash = new Map<number, number[]>();
  const hkey = (i: number, j: number, k: number) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  const reachL = kL + 2 * h;
  for (let e = 0; e < nStruts; e++) {
    const r = cap[7 * e + 6] + reachL;
    const i0 = Math.floor((Math.min(cap[7 * e], cap[7 * e + 3]) - r) / HC), i1 = Math.floor((Math.max(cap[7 * e], cap[7 * e + 3]) + r) / HC);
    const j0 = Math.floor((Math.min(cap[7 * e + 1], cap[7 * e + 4]) - r) / HC), j1 = Math.floor((Math.max(cap[7 * e + 1], cap[7 * e + 4]) + r) / HC);
    const k0 = Math.floor((Math.min(cap[7 * e + 2], cap[7 * e + 5]) - r) / HC), k1 = Math.floor((Math.max(cap[7 * e + 2], cap[7 * e + 5]) + r) / HC);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        for (let k = k0; k <= k1; k++) {
          const key = hkey(i, j, k);
          let list = hash.get(key);
          if (!list) hash.set(key, (list = []));
          list.push(e);
        }
  }
  const capsule = (e: number, x: number, y: number, z: number) => {
    const ax = cap[7 * e], ay = cap[7 * e + 1], az = cap[7 * e + 2];
    const bx = cap[7 * e + 3] - ax, by = cap[7 * e + 4] - ay, bz = cap[7 * e + 5] - az;
    const px = x - ax, py = y - ay, pz = z - az;
    const t = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz || 1)));
    return Math.hypot(px - bx * t, py - by * t, pz - bz * t) - cap[7 * e + 6];
  };

  const B = 4; // block size (voxels)
  const nx = Math.ceil((hi[0] - lo[0]) / h), ny = Math.ceil((hi[1] - lo[1]) / h), nz = Math.ceil((hi[2] - lo[2]) / h);
  const bx = Math.ceil(nx / B), by = Math.ceil(ny / B), bz = Math.ceil(nz / B);
  const half = (B * h * Math.sqrt(3)) / 2;
  // beyond `cut`, values are clamped (the same in every block); it must exceed the skip threshold
  const cut = Math.max(kS + 2 * h, 4 * half + 0.5);
  const reachS = half + cut;
  let out = new Float32Array(1 << 20), used = 0;
  const pushTri = (ax: number, ay: number, az: number, bx2: number, by2: number, bz2: number, cx2: number, cy2: number, cz2: number) => {
    if (used + 9 > out.length) {
      const bigger = new Float32Array(out.length * 2);
      bigger.set(out);
      out = bigger;
    }
    out[used++] = ax; out[used++] = ay; out[used++] = az;
    out[used++] = bx2; out[used++] = by2; out[used++] = bz2;
    out[used++] = cx2; out[used++] = cy2; out[used++] = cz2;
  };
  const S1 = B + 1;
  const vals = new Float64Array(S1 * S1 * S1);
  const cand = new Set<number>();
  const centre = new THREE.Vector3();
  const activeS: number[] = [], activeL: number[] = [];
  const field = (x: number, y: number, z: number) => {
    let f = Infinity;
    for (const sI of implicit) f = smin(f, Math.max(-cut, Math.min(cut, sI.f(x, y, z))), kS);
    for (const si of activeS) f = smin(f, solids[si].signed(x, y, z, cut), kS);
    if (activeL.length) {
      let g = Infinity;
      for (const e of activeL) g = smin(g, Math.min(cut, capsule(e, x, y, z)), kL);
      f = smin(f, g, kL);
    }
    return f === Infinity ? cut : f;
  };
  // tetrahedron edge interpolation, canonical endpoint order (shared edges give identical points)
  const E = new Float64Array(3);
  const edgePoint = (ax: number, ay: number, az: number, va: number, bx2: number, by2: number, bz2: number, vb: number) => {
    if (ax > bx2 || (ax === bx2 && (ay > by2 || (ay === by2 && az > bz2)))) {
      [ax, ay, az, va, bx2, by2, bz2, vb] = [bx2, by2, bz2, vb, ax, ay, az, va];
    }
    // (kept just off the grid corners, so points from different edges never coincide)
    const t = Math.min(1 - 1e-3, Math.max(1e-3, va / (va - vb)));
    E[0] = ax + t * (bx2 - ax);
    E[1] = ay + t * (by2 - ay);
    E[2] = az + t * (bz2 - az);
  };
  const cx8 = new Float64Array(8), cy8 = new Float64Array(8), cz8 = new Float64Array(8), cv8 = new Float64Array(8);
  const tri = new Float64Array(12);
  // gradient of the linear field in each of the 6 tets (edge matrices are fixed): precompute inverses
  const tetInv = TETS.map((tet) => {
    const e = [1, 2, 3].map((q) => [0, 1, 2].map((k) => CORNERS[tet[q]][k] - CORNERS[tet[0]][k]));
    const det = e[0][0] * (e[1][1] * e[2][2] - e[1][2] * e[2][1]) - e[0][1] * (e[1][0] * e[2][2] - e[1][2] * e[2][0]) + e[0][2] * (e[1][0] * e[2][1] - e[1][1] * e[2][0]);
    // inverse of e (rows = edges): g = inv * dv
    const inv = [
      [(e[1][1] * e[2][2] - e[1][2] * e[2][1]) / det, (e[0][2] * e[2][1] - e[0][1] * e[2][2]) / det, (e[0][1] * e[1][2] - e[0][2] * e[1][1]) / det],
      [(e[1][2] * e[2][0] - e[1][0] * e[2][2]) / det, (e[0][0] * e[2][2] - e[0][2] * e[2][0]) / det, (e[0][2] * e[1][0] - e[0][0] * e[1][2]) / det],
      [(e[1][0] * e[2][1] - e[1][1] * e[2][0]) / det, (e[0][1] * e[2][0] - e[0][0] * e[2][1]) / det, (e[0][0] * e[1][1] - e[0][1] * e[1][0]) / det],
    ];
    return inv;
  });
  for (let BK = 0; BK < bz; BK++)
    for (let BJ = 0; BJ < by; BJ++)
      for (let BI = 0; BI < bx; BI++) {
        const ox = lo[0] + BI * B * h, oy = lo[1] + BJ * B * h, oz = lo[2] + BK * B * h;
        const cx = ox + (B * h) / 2, cy = oy + (B * h) / 2, cz = oz + (B * h) / 2;
        centre.set(cx, cy, cz);
        // mesh parts within reach of this block (or containing it)
        activeS.length = 0;
        solids.forEach((sM, i) => {
          if (sM.box.distanceToPoint(centre) > reachS) return;
          if (sM.near(cx, cy, cz, reachS) <= reachS || (sM.box.containsPoint(centre) && sM.signed(cx, cy, cz, reachS) < 0)) activeS.push(i);
        });
        cand.clear();
        const i0 = Math.floor((cx - half) / HC), i1 = Math.floor((cx + half) / HC);
        const j0 = Math.floor((cy - half) / HC), j1 = Math.floor((cy + half) / HC);
        const k0 = Math.floor((cz - half) / HC), k1 = Math.floor((cz + half) / HC);
        for (let i = i0; i <= i1; i++)
          for (let j = j0; j <= j1; j++)
            for (let k = k0; k <= k1; k++) for (const e of hash.get(hkey(i, j, k)) ?? []) cand.add(e);
        activeL.length = 0;
        for (const e of cand) if (capsule(e, cx, cy, cz) <= half + reachL) activeL.push(e);
        activeL.sort((x, y) => x - y);
        if (!activeS.length && !activeL.length && !implicit.some((sI) => sI.box.distanceToPoint(centre) <= reachS)) continue;
        // the fused surface can only pass through the block if the field at its centre is small
        // (factor 4: the height-field parts are not exact distances where they are steep)
        if (Math.abs(field(cx, cy, cz)) > 4 * half) continue;
        for (let k = 0; k <= B; k++)
          for (let j = 0; j <= B; j++)
            for (let i = 0; i <= B; i++) vals[i + S1 * (j + S1 * k)] = field(ox + i * h, oy + j * h, oz + k * h);
        for (let k = 0; k < B; k++)
          for (let j = 0; j < B; j++)
            for (let i = 0; i < B; i++) {
              if (BI * B + i >= nx || BJ * B + j >= ny || BK * B + k >= nz) continue;
              let neg = 0;
              for (let c = 0; c < 8; c++) {
                const [di, dj, dk] = CORNERS[c];
                const v = vals[i + di + S1 * (j + dj + S1 * (k + dk))];
                cv8[c] = v;
                cx8[c] = ox + (i + di) * h;
                cy8[c] = oy + (j + dj) * h;
                cz8[c] = oz + (k + dk) * h;
                if (v < 0) neg++;
              }
              if (neg === 0 || neg === 8) continue;
              for (let t = 0; t < 6; t++) {
                const tet = TETS[t];
                let nIn = 0;
                for (const c of tet) if (cv8[c] < 0) nIn++;
                if (nIn === 0 || nIn === 4) continue;
                // gradient of the field in this tet (outward = increasing field)
                const d1 = cv8[tet[1]] - cv8[tet[0]], d2 = cv8[tet[2]] - cv8[tet[0]], d3 = cv8[tet[3]] - cv8[tet[0]];
                const inv = tetInv[t];
                const gx = inv[0][0] * d1 + inv[0][1] * d2 + inv[0][2] * d3;
                const gy = inv[1][0] * d1 + inv[1][1] * d2 + inv[1][2] * d3;
                const gz = inv[2][0] * d1 + inv[2][1] * d2 + inv[2][2] * d3;
                const ins: number[] = [], outs: number[] = [];
                for (const c of tet) (cv8[c] < 0 ? ins : outs).push(c);
                const P = (a: number, b: number, o: number) => {
                  edgePoint(cx8[a], cy8[a], cz8[a], cv8[a], cx8[b], cy8[b], cz8[b], cv8[b]);
                  tri[o] = E[0];
                  tri[o + 1] = E[1];
                  tri[o + 2] = E[2];
                };
                const emit = (o1: number, o2: number, o3: number) => {
                  const ux = tri[o2] - tri[o1], uy = tri[o2 + 1] - tri[o1 + 1], uz = tri[o2 + 2] - tri[o1 + 2];
                  const vx = tri[o3] - tri[o1], vy = tri[o3 + 1] - tri[o1 + 1], vz = tri[o3 + 2] - tri[o1 + 2];
                  const nn = (uy * vz - uz * vy) * gx + (uz * vx - ux * vz) * gy + (ux * vy - uy * vx) * gz;
                  if (nn < 0) pushTri(tri[o1], tri[o1 + 1], tri[o1 + 2], tri[o3], tri[o3 + 1], tri[o3 + 2], tri[o2], tri[o2 + 1], tri[o2 + 2]);
                  else pushTri(tri[o1], tri[o1 + 1], tri[o1 + 2], tri[o2], tri[o2 + 1], tri[o2 + 2], tri[o3], tri[o3 + 1], tri[o3 + 2]);
                };
                if (nIn === 1 || nIn === 3) {
                  const lone = nIn === 1 ? ins[0] : outs[0];
                  const others = nIn === 1 ? outs : ins;
                  P(lone, others[0], 0);
                  P(lone, others[1], 3);
                  P(lone, others[2], 6);
                  emit(0, 3, 6);
                } else {
                  const [a, b] = ins, [c, d] = outs;
                  P(a, c, 0);
                  P(a, d, 3);
                  P(b, d, 6);
                  P(b, c, 9);
                  emit(0, 3, 6);
                  emit(0, 6, 9);
                }
              }
            }
      }
  const welded = weldSoup(out.subarray(0, used), 1e-5);
  let m = makeMesh(welded.positions, welded.indices);
  // safety net: a pinhole of a cell or two (a block skipped where a steep height field fooled the
  // skip test) is closed with a flat patch, so the result is always watertight
  const loops = findBoundaryLoops(m).filter((l) => l.edgeCount <= 64);
  if (loops.length) m = fillLoops(m, loops, { refine: false, fair: false }).mesh;
  return m;
}
