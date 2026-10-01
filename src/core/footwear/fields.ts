/**
 * Grid fields used by the footwear generator (same 1 mm grid / insole frame as the insole):
 * the highest surface of the foot (dorsum), the foot silhouette with its signed distance, and
 * spherical dilation of height fields (exact offset of a height field by a radius).
 */
import type { InsoleFrame } from '../insole/frame';
import type { Grid } from '../insole/heightfield';

/**
 * Highest surface of the mesh per grid node (NaN where no triangle covers the node). Triangles
 * whose centroid is above `maxZ` are ignored (so the leg of a lower-limb scan doesn't count).
 */
export function rasterizeHighestSurface(worldPositions: Float32Array, indices: Uint32Array, frame: InsoleFrame, g: Grid, maxZ: number): Float32Array {
  const z = new Float32Array(g.nx * g.ny).fill(-Infinity);
  const n = worldPositions.length / 3;
  const pa = new Float32Array(n), pb = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const dx = worldPositions[3 * k] - frame.origin[0], dy = worldPositions[3 * k + 1] - frame.origin[1];
    pa[k] = (dx * frame.u[0] + dy * frame.u[1] - g.a0) / g.h;
    pb[k] = (dx * frame.v[0] + dy * frame.v[1] - g.b0) / g.h;
  }
  const P = worldPositions;
  for (let t = 0; t < indices.length; t += 3) {
    const A = indices[t], B = indices[t + 1], C = indices[t + 2];
    const za = P[3 * A + 2], zb = P[3 * B + 2], zc = P[3 * C + 2];
    if ((za + zb + zc) / 3 > maxZ) continue;
    const ax = pa[A], ay = pb[A], bx = pa[B], by = pb[B], cx = pa[C], cy = pb[C];
    const ci = Math.round((ax + bx + cx) / 3), cj = Math.round((ay + by + cy) / 3);
    if (ci >= 0 && cj >= 0 && ci < g.nx && cj < g.ny) {
      const k = cj * g.nx + ci;
      z[k] = Math.max(z[k], Math.min(maxZ, Math.max(za, zb, zc)));
    }
    const minI = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), maxI = Math.min(g.nx - 1, Math.floor(Math.max(ax, bx, cx)));
    const minJ = Math.max(0, Math.ceil(Math.min(ay, by, cy))), maxJ = Math.min(g.ny - 1, Math.floor(Math.max(ay, by, cy)));
    if (minI > maxI || minJ > maxJ) continue;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue;
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const l1 = ((by - cy) * (i - cx) + (cx - bx) * (j - cy)) / det;
        const l2 = ((cy - ay) * (i - cx) + (ax - cx) * (j - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const k = j * g.nx + i;
        const zz = Math.min(maxZ, l1 * za + l2 * zb + l3 * zc);
        if (zz > z[k]) z[k] = zz;
      }
    }
  }
  for (let k = 0; k < z.length; k++) if (z[k] === -Infinity) z[k] = NaN;
  return z;
}

/** 1D squared Euclidean distance transform (Felzenszwalb & Huttenlocher). */
export function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, zz: Float64Array): void {
  let k = 0;
  v[0] = 0;
  zz[0] = -Infinity;
  zz[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= zz[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    zz[k] = s;
    zz[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (zz[k + 1] < q) k++;
    d[q] = (q - v[k]) ** 2 + f[v[k]];
  }
}

/** Euclidean distance (mm) from every node to the nearest node where `mask` is set. */
export function distanceTransform(mask: Uint8Array, g: Grid): Float32Array {
  const INF = 1e12;
  const { nx, ny } = g;
  const n = Math.max(nx, ny);
  const f = new Float64Array(n), d = new Float64Array(n), zz = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const tmp = new Float64Array(nx * ny);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) f[j] = mask[j * nx + i] ? 0 : INF;
    edt1d(f, ny, d, v, zz);
    for (let j = 0; j < ny; j++) tmp[j * nx + i] = d[j];
  }
  const out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) f[i] = tmp[j * nx + i];
    edt1d(f, nx, d, v, zz);
    for (let i = 0; i < nx; i++) out[j * nx + i] = Math.sqrt(d[i]) * g.h;
  }
  return out;
}

/** Signed distance to a mask region (negative inside), in mm. */
export function signedDistance(mask: Uint8Array, g: Grid): Float32Array {
  const outside = distanceTransform(mask, g);
  const inv = new Uint8Array(mask.length);
  for (let k = 0; k < mask.length; k++) inv[k] = mask[k] ? 0 : 1;
  const inside = distanceTransform(inv, g);
  const sd = new Float32Array(mask.length);
  // ± half a cell so the zero level lies between the last inside and first outside node.
  for (let k = 0; k < mask.length; k++) sd[k] = mask[k] ? -(inside[k] - 0.5 * g.h) : outside[k] - 0.5 * g.h;
  return sd;
}

/**
 * Spherical dilation of a height field by radius r: out(p) = max over |q − p| ≤ r of
 * f(q) + √(r² − |q − p|²) – the height field of the solid offset outward by r (the true
 * normal offset of the surface seen from above). NaN nodes of `f` are empty; nodes with no
 * data within r stay NaN.
 */
export function sphericalDilate(f: Float32Array, g: Grid, r: number): Float32Array {
  const out = new Float32Array(f.length).fill(NaN);
  const R = Math.floor(r / g.h);
  const offs: [number, number, number][] = [];
  for (let dj = -R; dj <= R; dj++)
    for (let di = -R; di <= R; di++) {
      const d2 = (di * di + dj * dj) * g.h * g.h;
      if (d2 <= r * r) offs.push([di, dj, Math.sqrt(r * r - d2)]);
    }
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const v = f[j * g.nx + i];
      if (Number.isNaN(v)) continue;
      for (const [di, dj, lift] of offs) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny) continue;
        const k = jj * g.nx + ii;
        const c = v + lift;
        if (!(out[k] >= c)) out[k] = c;
      }
    }
  }
  return out;
}

/**
 * Spherical erosion (downward offset) of a height field by radius r:
 * out(p) = min over |q − p| ≤ r of f(q) − √(r² − |q − p|²), i.e. the surface lying exactly r
 * below `f` measured along its normal (a plain z-shift is too close on steep slopes).
 */
export function sphericalErode(f: Float32Array, g: Grid, r: number): Float32Array {
  const neg = f.map((v) => -v);
  return sphericalDilate(neg, g, r).map((v) => -v);
}
