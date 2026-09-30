/**
 * Estimated top of the foot, for scans that only capture the sole (plantar / foam-box scans)
 * or stop low on the sides. Straps and shoe uppers need the dorsum, so it is modelled from the
 * scanned footprint: along the foot, a typical adult dorsal height profile (as a fraction of
 * the foot length); across, a rounded-box section spanning the footprint width at each row,
 * sitting on the scanned plantar surface. Where the scan does reach higher, the scan wins.
 */
import { makeMesh, type MeshData } from '../types';
import { frameToWorld, type InsoleFrame } from '../insole/frame';
import { gaussianBlur, type Grid } from '../insole/heightfield';

/** Dorsal height above the sole (fraction of foot length) vs position from heel (0) to toe (1). */
const PROFILE: [number, number][] = [
  [0, 0.03], [0.03, 0.15], [0.1, 0.25], [0.3, 0.29], [0.5, 0.23], [0.72, 0.14], [0.85, 0.1], [0.95, 0.06], [1, 0.02],
];

export function dorsalHeightFraction(s: number): number {
  if (s <= 0) return PROFILE[0][1];
  for (let i = 1; i < PROFILE.length; i++) {
    const [s1, h1] = PROFILE[i], [s0, h0] = PROFILE[i - 1];
    if (s <= s1) {
      const t = (s - s0) / (s1 - s0);
      return h0 + (h1 - h0) * t * t * (3 - 2 * t);
    }
  }
  return PROFILE[PROFILE.length - 1][1];
}

/**
 * Estimated dorsum height field (NaN outside the footprint) over `mask`, sitting on `plantar`.
 * Section exponent 3 gives the fairly upright sides of a real foot.
 */
export function estimateDorsum(mask: Uint8Array, plantar: Float32Array, g: Grid): Float32Array {
  const { nx, ny } = g;
  let back = Infinity, front = -Infinity;
  const rowMin = new Float32Array(ny).fill(Infinity), rowMax = new Float32Array(ny).fill(-Infinity);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (!mask[j * nx + i]) continue;
      const a = g.a0 + i * g.h, b = g.b0 + j * g.h;
      back = Math.min(back, b);
      front = Math.max(front, b);
      rowMin[j] = Math.min(rowMin[j], a);
      rowMax[j] = Math.max(rowMax[j], a);
    }
  const L = front - back;
  const lift = new Float32Array(nx * ny); // height above the sole (0 outside)
  for (let j = 0; j < ny; j++) {
    if (!Number.isFinite(rowMin[j])) continue;
    const b = g.b0 + j * g.h;
    const h = dorsalHeightFraction((b - back) / L) * L;
    const ac = (rowMin[j] + rowMax[j]) / 2, hw = Math.max(1, (rowMax[j] - rowMin[j]) / 2 + g.h / 2);
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!mask[k]) continue;
      const u = Math.min(1, Math.abs((g.a0 + i * g.h - ac) / hw));
      lift[k] = h * Math.cbrt(1 - u * u * u);
    }
  }
  // Smooth along the foot (the rows are independent) without pulling the edges up.
  const smooth = gaussianBlur(lift, g, 3);
  const out = new Float32Array(nx * ny).fill(NaN);
  for (let k = 0; k < out.length; k++) if (mask[k]) out[k] = plantar[k] + Math.min(lift[k] + 2, smooth[k]);
  return out;
}

/**
 * Surface mesh of a height field (world coordinates) over its defined (non-NaN) region,
 * triangulated every `step` grid nodes, facing up (or down with `facingDown`).
 */
export function heightFieldMesh(f: Float32Array, g: Grid, frame: InsoleFrame, step = 2, facingDown = false): MeshData {
  const { nx, ny } = g;
  const id = new Int32Array(nx * ny).fill(-1);
  const pos: number[] = [];
  for (let j = 0; j < ny; j += step)
    for (let i = 0; i < nx; i += step) {
      const k = j * nx + i;
      if (Number.isNaN(f[k])) continue;
      id[k] = pos.length / 3;
      const [x, y] = frameToWorld(frame, g.a0 + i * g.h, g.b0 + j * g.h);
      pos.push(x, y, f[k]);
    }
  const idx: number[] = [];
  for (let j = 0; j + step < ny; j += step)
    for (let i = 0; i + step < nx; i += step) {
      const p = id[j * nx + i], q = id[j * nx + i + step], r = id[(j + step) * nx + i + step], s = id[(j + step) * nx + i];
      // CCW in (a, b) = facing +Z (see solidMesh)
      if (p >= 0 && q >= 0 && r >= 0) idx.push(p, q, r);
      if (p >= 0 && r >= 0 && s >= 0) idx.push(p, r, s);
      else if (p >= 0 && q >= 0 && s >= 0 && r < 0) idx.push(p, q, s);
      else if (q >= 0 && r >= 0 && s >= 0 && p < 0) idx.push(q, r, s);
    }
  if (facingDown) for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
  return makeMesh(Float32Array.from(pos), Uint32Array.from(idx));
}
