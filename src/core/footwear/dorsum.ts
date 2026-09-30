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
  // the back of the heel rises almost vertically (heel counter / Achilles region)
  [0, 0.12], [0.02, 0.22], [0.08, 0.27], [0.3, 0.29], [0.5, 0.23], [0.72, 0.14], [0.85, 0.1], [0.95, 0.06], [1, 0.02],
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
 * The estimated top of the foot as a lofted surface mesh (world coordinates, facing outward):
 * one cross-section every `step` mm along the foot, each a rounded arch from the medial to the
 * lateral edge of the footprint sampled evenly around its curve, closed with end caps at the
 * heel and the toes. Unlike a height-field mesh it has even vertex density on the steep sides,
 * so the shoe upper's lattice is as dense there as on top.
 */
export function loftDorsum(mask: Uint8Array, plantar: Float32Array, g: Grid, frame: InsoleFrame, step = 2): MeshData {
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
  const at = (a: number, b: number) => {
    const i = Math.min(nx - 1, Math.max(0, Math.round((a - g.a0) / g.h))), j = Math.min(ny - 1, Math.max(0, Math.round((b - g.b0) / g.h)));
    return plantar[j * nx + i];
  };
  const SEG = 40;
  const pos: number[] = [];
  const rows: number[] = []; // first vertex index of each section
  const centres: [number, number, number][] = [];
  const stepRows = Math.max(1, Math.round(step / g.h));
  for (let j = 0; j < ny; j += stepRows) {
    if (!Number.isFinite(rowMin[j])) continue;
    const b = g.b0 + j * g.h;
    const h = dorsalHeightFraction((b - back) / L) * L;
    const ac = (rowMin[j] + rowMax[j]) / 2, hw = Math.max(1, (rowMax[j] - rowMin[j]) / 2);
    rows.push(pos.length / 3);
    for (let s = 0; s <= SEG; s++) {
      const th = (Math.PI * s) / SEG, c = Math.cos(th), sn = Math.sin(th);
      const a = ac + hw * Math.sign(c) * Math.pow(Math.abs(c), 2 / 3);
      const [x, y] = frameToWorld(frame, a, b);
      pos.push(x, y, at(a, b) + h * Math.pow(sn, 2 / 3));
    }
    const [cx, cy] = frameToWorld(frame, ac, b);
    centres.push([cx, cy, at(ac, b)]);
  }
  const idx: number[] = [];
  for (let r = 0; r + 1 < rows.length; r++)
    for (let s = 0; s < SEG; s++) {
      const p = rows[r] + s, q = rows[r] + s + 1, u = rows[r + 1] + s + 1, v = rows[r + 1] + s;
      idx.push(p, q, u, p, u, v);
    }
  for (const r of [0, rows.length - 1]) {
    const c = pos.length / 3;
    pos.push(...centres[r]);
    for (let s = 0; s < SEG; s++) idx.push(c, rows[r] + s, rows[r] + s + 1);
  }
  // Orient every triangle away from the middle of the foot (the dome is convex enough).
  let mx = 0, my = 0, mz = 0;
  const nv = pos.length / 3;
  for (let v = 0; v < nv; v++) {
    mx += pos[3 * v] / nv;
    my += pos[3 * v + 1] / nv;
    mz += pos[3 * v + 2] / nv;
  }
  for (let t = 0; t < idx.length; t += 3) {
    const A = idx[t] * 3, B = idx[t + 1] * 3, C = idx[t + 2] * 3;
    const e1 = [pos[B] - pos[A], pos[B + 1] - pos[A + 1], pos[B + 2] - pos[A + 2]];
    const e2 = [pos[C] - pos[A], pos[C + 1] - pos[A + 1], pos[C + 2] - pos[A + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const o = [(pos[A] + pos[B] + pos[C]) / 3 - mx, (pos[A + 1] + pos[B + 1] + pos[C + 1]) / 3 - my, (pos[A + 2] + pos[B + 2] + pos[C + 2]) / 3 - mz];
    if (n[0] * o[0] + n[1] * o[1] + n[2] * o[2] < 0) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
  }
  return makeMesh(Float32Array.from(pos), Uint32Array.from(idx));
}
