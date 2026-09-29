import type { InsoleFrame } from './frame';

/** Regular grid over the insole frame: node (i, j) is at a = a0 + i·h, b = b0 + j·h. */
export interface Grid {
  a0: number;
  b0: number;
  h: number;
  nx: number;
  ny: number;
}

export const gridIndex = (g: Grid, i: number, j: number) => j * g.nx + i;

/**
 * Rasterises the *lowest* surface of a mesh (world coordinates, Z up) onto the grid:
 * a Z-buffer keeping the minimum Z per node, i.e. the plantar surface when the foot is
 * aligned sole-down. Nodes not covered by any triangle are NaN.
 */
export function rasterizeLowestSurface(worldPositions: Float32Array, indices: Uint32Array, frame: InsoleFrame, g: Grid, maxSlopeDeg = 65): Float32Array {
  const z = new Float32Array(g.nx * g.ny).fill(Infinity); // lowest non-steep surface
  const zAll = new Float32Array(g.nx * g.ny).fill(Infinity); // lowest surface of any slope
  const n = worldPositions.length / 3;
  const pa = new Float32Array(n), pb = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const dx = worldPositions[3 * k] - frame.origin[0], dy = worldPositions[3 * k + 1] - frame.origin[1];
    pa[k] = (dx * frame.u[0] + dy * frame.u[1] - g.a0) / g.h;
    pb[k] = (dx * frame.v[0] + dy * frame.v[1] - g.b0) / g.h;
  }
  // Steep faces (the sides of the foot) are skipped so the sampled surface is the sole only;
  // |nz| is used so the result doesn't depend on the mesh winding.
  const minNz = Math.cos((maxSlopeDeg * Math.PI) / 180);
  const P = worldPositions;
  for (let t = 0; t < indices.length; t += 3) {
    const A = indices[t], B = indices[t + 1], C = indices[t + 2];
    const e1x = P[3 * B] - P[3 * A], e1y = P[3 * B + 1] - P[3 * A + 1], e1z = P[3 * B + 2] - P[3 * A + 2];
    const e2x = P[3 * C] - P[3 * A], e2y = P[3 * C + 1] - P[3 * A + 1], e2z = P[3 * C + 2] - P[3 * A + 2];
    const nxx = e1y * e2z - e1z * e2y, nyy = e1z * e2x - e1x * e2z, nzz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nxx, nyy, nzz);
    if (nl === 0) continue;
    const flat = Math.abs(nzz) / nl >= minNz;
    const ax = pa[A], ay = pb[A], bx = pa[B], by = pb[B], cx = pa[C], cy = pb[C];
    const za = P[3 * A + 2], zb = P[3 * B + 2], zc = P[3 * C + 2];
    // centroid splat catches triangles smaller than a cell
    const ci = Math.round((ax + bx + cx) / 3), cj = Math.round((ay + by + cy) / 3);
    if (ci >= 0 && cj >= 0 && ci < g.nx && cj < g.ny) {
      const zc3 = (za + zb + zc) / 3;
      const ck = cj * g.nx + ci;
      if (zc3 < zAll[ck]) zAll[ck] = zc3;
      if (flat && zc3 < z[ck]) z[ck] = zc3;
    }
    const minI = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), maxI = Math.min(g.nx - 1, Math.floor(Math.max(ax, bx, cx)));
    if (minI > maxI) continue;
    const minJ = Math.max(0, Math.ceil(Math.min(ay, by, cy))), maxJ = Math.min(g.ny - 1, Math.floor(Math.max(ay, by, cy)));
    if (minJ > maxJ) continue;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue;
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const l1 = ((by - cy) * (i - cx) + (cx - bx) * (j - cy)) / det;
        const l2 = ((cy - ay) * (i - cx) + (ax - cx) * (j - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const zz = l1 * za + l2 * zb + l3 * zc;
        const idx = j * g.nx + i;
        if (zz < zAll[idx]) zAll[idx] = zz;
        if (flat && zz < z[idx]) z[idx] = zz;
      }
    }
  }
  // Keep a sample only where the lowest surface itself is the sole (not a steep side / heel
  // back with the top of the foot above it).
  for (let k = 0; k < z.length; k++) if (z[k] === Infinity || z[k] - zAll[k] > 1.5) z[k] = NaN;
  return z;
}

/**
 * Fills NaN nodes (areas the scan doesn't cover, e.g. an insole outline wider than the
 * footprint): multi-source BFS copies the nearest known value, then Jacobi relaxation on
 * the filled nodes only smooths the transition. Known nodes are never changed.
 */
export function fillMissing(values: Float32Array, g: Grid, relaxIterations = 60): Float32Array {
  const out = values.slice();
  const known = new Uint8Array(out.length);
  let queue: number[] = [];
  for (let k = 0; k < out.length; k++) {
    if (!Number.isNaN(out[k])) {
      known[k] = 1;
      queue.push(k);
    }
  }
  if (!queue.length) throw new Error('The scan does not cover the insole area – check the alignment and landmarks.');
  if (queue.length === out.length) return out;
  const visited = known.slice();
  while (queue.length) {
    const next: number[] = [];
    for (const k of queue) {
      const i = k % g.nx, j = (k / g.nx) | 0;
      const nb = [i > 0 ? k - 1 : -1, i < g.nx - 1 ? k + 1 : -1, j > 0 ? k - g.nx : -1, j < g.ny - 1 ? k + g.nx : -1];
      for (const q of nb) {
        if (q < 0 || visited[q]) continue;
        visited[q] = 1;
        out[q] = out[k];
        next.push(q);
      }
    }
    queue = next;
  }
  const filled: number[] = [];
  for (let k = 0; k < out.length; k++) if (!known[k]) filled.push(k);
  for (let it = 0; it < relaxIterations; it++) {
    for (const k of filled) {
      const i = k % g.nx, j = (k / g.nx) | 0;
      let s = 0, c = 0;
      if (i > 0) { s += out[k - 1]; c++; }
      if (i < g.nx - 1) { s += out[k + 1]; c++; }
      if (j > 0) { s += out[k - g.nx]; c++; }
      if (j < g.ny - 1) { s += out[k + g.nx]; c++; }
      out[k] = s / c;
    }
  }
  return out;
}

/** Separable Gaussian blur (sigma in mm). */
export function gaussianBlur(values: Float32Array, g: Grid, sigmaMm: number): Float32Array {
  const sigma = sigmaMm / g.h;
  if (sigma < 0.3) return values.slice();
  const r = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  for (let k = -r; k <= r; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel.push(w);
  }
  const tmp = new Float32Array(values.length);
  const out = new Float32Array(values.length);
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      let s = 0, w = 0;
      for (let k = -r; k <= r; k++) {
        const ii = i + k;
        if (ii < 0 || ii >= g.nx) continue;
        s += values[j * g.nx + ii] * kernel[k + r];
        w += kernel[k + r];
      }
      tmp[j * g.nx + i] = s / w;
    }
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      let s = 0, w = 0;
      for (let k = -r; k <= r; k++) {
        const jj = j + k;
        if (jj < 0 || jj >= g.ny) continue;
        s += tmp[jj * g.nx + i] * kernel[k + r];
        w += kernel[k + r];
      }
      out[j * g.nx + i] = s / w;
    }
  return out;
}
