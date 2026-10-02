/**
 * Dense voxel volumes in the insole frame (a across, b along the foot, z up) for the implicit
 * shoe body: 3D distance transform, Gaussian blur, trilinear sampling and marching-tetrahedra
 * meshing of a level set.
 */
import { makeMesh, type MeshData } from '../types';
import { weldSoup } from '../mesh/weld';
import { edt1d } from './fields';

export interface Vol {
  a0: number;
  b0: number;
  z0: number;
  h: number;
  nx: number;
  ny: number;
  nz: number;
}

export const volIndex = (v: Vol, i: number, j: number, k: number) => i + v.nx * (j + v.ny * k);

/** Euclidean distance (mm) from every voxel to the nearest voxel where `mask` is set. */
export function edt3d(mask: Uint8Array, v: Vol): Float32Array {
  const { nx, ny, nz } = v;
  const INF = 1e10;
  const n = Math.max(nx, ny, nz);
  const f = new Float64Array(n), d = new Float64Array(n), zz = new Float64Array(n + 1);
  const w = new Int32Array(n);
  const out = new Float32Array(nx * ny * nz);
  for (let q = 0; q < out.length; q++) out[q] = mask[q] ? 0 : INF;
  // along x, y, z (squared distances in voxel units)
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++) {
      const o = nx * (j + ny * k);
      for (let i = 0; i < nx; i++) f[i] = out[o + i];
      edt1d(f, nx, d, w, zz);
      for (let i = 0; i < nx; i++) out[o + i] = d[i];
    }
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) f[j] = out[i + nx * (j + ny * k)];
      edt1d(f, ny, d, w, zz);
      for (let j = 0; j < ny; j++) out[i + nx * (j + ny * k)] = d[j];
    }
  const plane = nx * ny;
  for (let q = 0; q < plane; q++) {
    for (let k = 0; k < nz; k++) f[k] = out[q + plane * k];
    edt1d(f, nz, d, w, zz);
    for (let k = 0; k < nz; k++) out[q + plane * k] = Math.sqrt(d[k]) * v.h;
  }
  return out;
}

/** Separable Gaussian blur (sigma in mm), in place. */
export function blur3d(field: Float32Array, v: Vol, sigmaMm: number): void {
  const s = sigmaMm / v.h;
  if (s < 0.3) return;
  const R = Math.ceil(3 * s);
  const ker = Array.from({ length: 2 * R + 1 }, (_, q) => Math.exp(-((q - R) ** 2) / (2 * s * s)));
  const { nx, ny, nz } = v;
  const n = Math.max(nx, ny, nz);
  const line = new Float64Array(n);
  const pass = (count: number, len: number, idx: (c: number, t: number) => number) => {
    for (let c = 0; c < count; c++) {
      for (let t = 0; t < len; t++) line[t] = field[idx(c, t)];
      for (let t = 0; t < len; t++) {
        let acc = 0, wt = 0;
        for (let q = -R; q <= R; q++) {
          const u = Math.min(len - 1, Math.max(0, t + q));
          acc += line[u] * ker[q + R];
          wt += ker[q + R];
        }
        field[idx(c, t)] = acc / wt;
      }
    }
  };
  pass(ny * nz, nx, (c, t) => t + nx * c);
  pass(nx * nz, ny, (c, t) => (c % nx) + nx * (t + ny * Math.floor(c / nx)));
  pass(nx * ny, nz, (c, t) => c + nx * ny * t);
}

/** Trilinear sample (clamped to the volume). */
export function sampleVol(field: Float32Array, v: Vol, a: number, b: number, z: number): number {
  const x = Math.min(v.nx - 1.001, Math.max(0, (a - v.a0) / v.h));
  const y = Math.min(v.ny - 1.001, Math.max(0, (b - v.b0) / v.h));
  const w = Math.min(v.nz - 1.001, Math.max(0, (z - v.z0) / v.h));
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(w);
  const fx = x - i, fy = y - j, fz = w - k;
  const g = (di: number, dj: number, dk: number) => field[volIndex(v, i + di, j + dj, k + dk)];
  const c00 = g(0, 0, 0) * (1 - fx) + g(1, 0, 0) * fx, c10 = g(0, 1, 0) * (1 - fx) + g(1, 1, 0) * fx;
  const c01 = g(0, 0, 1) * (1 - fx) + g(1, 0, 1) * fx, c11 = g(0, 1, 1) * (1 - fx) + g(1, 1, 1) * fx;
  return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
}

/** Trilinear value and its (cell-wise exact) gradient at a point, in one lookup: [f, fa, fb, fz]. */
export function sampleGradVol(field: Float32Array, v: Vol, a: number, b: number, z: number, out: number[]): number[] {
  const x = Math.min(v.nx - 1.001, Math.max(0, (a - v.a0) / v.h));
  const y = Math.min(v.ny - 1.001, Math.max(0, (b - v.b0) / v.h));
  const w = Math.min(v.nz - 1.001, Math.max(0, (z - v.z0) / v.h));
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(w);
  const fx = x - i, fy = y - j, fz = w - k;
  const q = volIndex(v, i, j, k), sx = 1, sy = v.nx, sz = v.nx * v.ny;
  const g000 = field[q], g100 = field[q + sx], g010 = field[q + sy], g110 = field[q + sx + sy];
  const g001 = field[q + sz], g101 = field[q + sx + sz], g011 = field[q + sy + sz], g111 = field[q + sx + sy + sz];
  const c00 = g000 + (g100 - g000) * fx, c10 = g010 + (g110 - g010) * fx, c01 = g001 + (g101 - g001) * fx, c11 = g011 + (g111 - g011) * fx;
  const c0 = c00 + (c10 - c00) * fy, c1 = c01 + (c11 - c01) * fy;
  out[0] = c0 + (c1 - c0) * fz;
  const dx0 = (g100 - g000) * (1 - fy) + (g110 - g010) * fy, dx1 = (g101 - g001) * (1 - fy) + (g111 - g011) * fy;
  out[1] = (dx0 * (1 - fz) + dx1 * fz) / v.h;
  out[2] = ((c10 - c00) * (1 - fz) + (c11 - c01) * fz) / v.h;
  out[3] = (c1 - c0) / v.h;
  return out;
}

/** Gradient by central differences of the trilinear field. */
export function gradVol(field: Float32Array, v: Vol, a: number, b: number, z: number): [number, number, number] {
  const e = v.h * 0.5;
  return [
    (sampleVol(field, v, a + e, b, z) - sampleVol(field, v, a - e, b, z)) / (2 * e),
    (sampleVol(field, v, a, b + e, z) - sampleVol(field, v, a, b - e, z)) / (2 * e),
    (sampleVol(field, v, a, b, z + e) - sampleVol(field, v, a, b, z - e)) / (2 * e),
  ];
}

const CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const TETS = [
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
  [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
];
const TET_INV = TETS.map((tet) => {
  const e = [1, 2, 3].map((q) => [0, 1, 2].map((k) => CORNERS[tet[q]][k] - CORNERS[tet[0]][k]));
  const det = e[0][0] * (e[1][1] * e[2][2] - e[1][2] * e[2][1]) - e[0][1] * (e[1][0] * e[2][2] - e[1][2] * e[2][0]) + e[0][2] * (e[1][0] * e[2][1] - e[1][1] * e[2][0]);
  return [
    [(e[1][1] * e[2][2] - e[1][2] * e[2][1]) / det, (e[0][2] * e[2][1] - e[0][1] * e[2][2]) / det, (e[0][1] * e[1][2] - e[0][2] * e[1][1]) / det],
    [(e[1][2] * e[2][0] - e[1][0] * e[2][2]) / det, (e[0][0] * e[2][2] - e[0][2] * e[2][0]) / det, (e[0][2] * e[1][0] - e[0][0] * e[1][2]) / det],
    [(e[1][0] * e[2][1] - e[1][1] * e[2][0]) / det, (e[0][1] * e[2][0] - e[0][0] * e[2][1]) / det, (e[0][0] * e[1][1] - e[0][1] * e[1][0]) / det],
  ];
});

/**
 * Closed, outward-wound mesh of { field < level } (marching tetrahedra; the volume's border
 * is treated as outside, so the surface is always closed). `toWorld` maps frame → world.
 */
export function polygonizeVol(field: Float32Array, v: Vol, toWorld: (a: number, b: number, z: number) => [number, number, number], level = 0): MeshData {
  const { nx, ny, nz, h } = v;
  const val = (i: number, j: number, k: number) =>
    i <= 0 || j <= 0 || k <= 0 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1 ? Math.max(h, field[volIndex(v, i, j, k)] - level) : field[volIndex(v, i, j, k)] - level;
  let out = new Float32Array(1 << 20), used = 0;
  const push = (p: number[]) => {
    if (used + 3 > out.length) {
      const bigger = new Float32Array(out.length * 2);
      bigger.set(out);
      out = bigger;
    }
    const [x, y, z] = toWorld(p[0], p[1], p[2]);
    out[used++] = x;
    out[used++] = y;
    out[used++] = z;
  };
  const cv = new Float64Array(8), cp: number[][] = Array.from({ length: 8 }, () => [0, 0, 0]);
  const E = (a: number, b: number) => {
    let pa = cp[a], pb = cp[b], va = cv[a], vb = cv[b];
    if (pa[0] > pb[0] || (pa[0] === pb[0] && (pa[1] > pb[1] || (pa[1] === pb[1] && pa[2] > pb[2])))) [pa, pb, va, vb] = [pb, pa, vb, va];
    const t = Math.min(1 - 1e-3, Math.max(1e-3, va / (va - vb)));
    return [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1]), pa[2] + t * (pb[2] - pa[2])];
  };
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let neg = 0;
        for (let c = 0; c < 8; c++) {
          const [di, dj, dk] = CORNERS[c];
          cv[c] = val(i + di, j + dj, k + dk);
          if (cv[c] < 0) neg++;
        }
        if (neg === 0 || neg === 8) continue;
        for (let c = 0; c < 8; c++) {
          const [di, dj, dk] = CORNERS[c];
          cp[c][0] = v.a0 + (i + di) * h;
          cp[c][1] = v.b0 + (j + dj) * h;
          cp[c][2] = v.z0 + (k + dk) * h;
        }
        for (let t = 0; t < 6; t++) {
          const tet = TETS[t];
          const ins: number[] = [], outs: number[] = [];
          for (const c of tet) (cv[c] < 0 ? ins : outs).push(c);
          if (!ins.length || ins.length === 4) continue;
          const d1 = cv[tet[1]] - cv[tet[0]], d2 = cv[tet[2]] - cv[tet[0]], d3 = cv[tet[3]] - cv[tet[0]];
          const M = TET_INV[t];
          const gx = M[0][0] * d1 + M[0][1] * d2 + M[0][2] * d3, gy = M[1][0] * d1 + M[1][1] * d2 + M[1][2] * d3, gz = M[2][0] * d1 + M[2][1] * d2 + M[2][2] * d3;
          const emit = (a: number[], b: number[], c: number[]) => {
            const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
            // the frame → world map is a rotation about Z (+ translation): orientation is kept
            if ((uy * vz - uz * vy) * gx + (uz * vx - ux * vz) * gy + (ux * vy - uy * vx) * gz < 0) [b, c] = [c, b];
            push(a);
            push(b);
            push(c);
          };
          if (ins.length === 1 || ins.length === 3) {
            const lone = ins.length === 1 ? ins[0] : outs[0], o = ins.length === 1 ? outs : ins;
            emit(E(lone, o[0]), E(lone, o[1]), E(lone, o[2]));
          } else {
            const [a, b] = ins, [c, d] = outs;
            const p1 = E(a, c), p2 = E(a, d), p3 = E(b, d), p4 = E(b, c);
            emit(p1, p2, p3);
            emit(p1, p3, p4);
          }
        }
      }
  const m = weldSoup(out.subarray(0, used), 1e-5);
  return makeMesh(m.positions, m.indices);
}

/**
 * Finer mesh of a level set: each triangle is split into four (edge midpoints), then the
 * vertices are relaxed along the surface and projected back onto the zero level of `field`
 * (Newton steps on the trilinear field). `levels` splits → 4^levels × the triangles, smoother
 * than the voxel grid alone. Positions stay in the volume's (frame) coordinates.
 */
export function refineOnField(m: MeshData, field: Float32Array, v: Vol, levels = 1): MeshData {
  let P = m.positions, I = m.indices;
  for (let l = 0; l < levels; l++) {
    const n0 = P.length / 3, nt = I.length / 3;
    const mid = new Map<number, number>();
    const Q = new Float32Array((n0 + (3 * nt) / 2 + nt) * 3); // (≤ one new vertex per edge)
    Q.set(P);
    let nv = n0;
    const midOf = (a: number, b: number) => {
      const key = a < b ? a * n0 + b : b * n0 + a;
      let id = mid.get(key);
      if (id === undefined) {
        id = nv++;
        for (let d = 0; d < 3; d++) Q[3 * id + d] = (P[3 * a + d] + P[3 * b + d]) / 2;
        mid.set(key, id);
      }
      return id;
    };
    const J = new Uint32Array(I.length * 4);
    for (let t = 0, o = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const ab = midOf(a, b), bc = midOf(b, c), ca = midOf(c, a);
      J.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], o);
      o += 12;
    }
    P = Q.slice(0, nv * 3);
    I = J;
  }
  // neighbours (CSR)
  const n = P.length / 3;
  const deg = new Uint32Array(n + 1);
  for (let t = 0; t < I.length; t++) deg[I[t] + 1] += 2;
  for (let a = 0; a < n; a++) deg[a + 1] += deg[a];
  const adj = new Uint32Array(deg[n]), fill = deg.slice(0, n);
  for (let t = 0; t < I.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = I[t + e], b = I[t + ((e + 1) % 3)];
      adj[fill[a]++] = b;
      adj[fill[b]++] = a;
    }
  // relax (towards the neighbours' average; each neighbour counted twice, so plain mean) +
  // project onto the zero level, three times (irons out the voxel steps)
  const p = [0, 0, 0], fg = [0, 0, 0, 0];
  for (let it = 0; it < 3; it++) {
    const Q = P.slice();
    for (let a = 0; a < n; a++) {
      const k0 = deg[a], k1 = deg[a + 1];
      let ax = 0, ay = 0, az = 0;
      for (let k = k0; k < k1; k++) {
        const b = adj[k];
        ax += P[3 * b];
        ay += P[3 * b + 1];
        az += P[3 * b + 2];
      }
      const w = k1 > k0 ? 0.5 / (k1 - k0) : 0, s0 = k1 > k0 ? 0.5 : 1;
      p[0] = s0 * P[3 * a] + w * ax;
      p[1] = s0 * P[3 * a + 1] + w * ay;
      p[2] = s0 * P[3 * a + 2] + w * az;
      for (let s = 0; s < 3; s++) {
        const [f, ga, gb, gz] = sampleGradVol(field, v, p[0], p[1], p[2], fg);
        if (Math.abs(f) < 1e-3) break;
        const g2 = ga * ga + gb * gb + gz * gz;
        if (g2 < 1e-4) break;
        const k = Math.max(-0.5 * v.h, Math.min(0.5 * v.h, f / Math.sqrt(g2))) / Math.sqrt(g2);
        p[0] -= k * ga;
        p[1] -= k * gb;
        p[2] -= k * gz;
      }
      Q[3 * a] = p[0];
      Q[3 * a + 1] = p[1];
      Q[3 * a + 2] = p[2];
    }
    P = Q;
  }
  return makeMesh(P, I);
}
