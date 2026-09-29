import { applyInverseTransform, applyTransform, transformPositions } from '../math/transform';
import { buildInsoleFrame, worldToFrame, type FrameLandmarks } from '../insole/frame';
import type { RigidTransform, Vec3 } from '../types';

/**
 * Arch adjustment on the FOOT scan (not the insole). With the base plane set (sole on Z = 0),
 * the plantar surface under the medial longitudinal arch is raised (+) or lowered (−) between
 * the "arch start" and "arch end" landmarks only: zero at and beyond both points, full effect at
 * the arch peak (landmark, or 45 % of the way), fading towards the lateral side and up the side
 * of the foot. The insole is then generated from the modified foot, so it follows the new arch.
 */
export interface ArchRegion {
  toFrame: (x: number, y: number) => [number, number];
  start: [number, number];
  end: [number, number];
  /** Position of the peak along start → end (0…1). */
  peakT: number;
  /** Lateral offset of the peak from the start–end line (mm, + = lateral). */
  peakOffset: number;
  /** Unit vectors: along start → end, and towards the lateral side. */
  along: [number, number];
  lateral: [number, number];
  length: number;
  radiusAcross: number;
}

export const ARCH_LANDMARKS_MISSING = 'Place the "Medial arch – start" and "Medial arch – end" landmarks first.';

export function archRegion(lm: FrameLandmarks): ArchRegion {
  if (!lm.archStart || !lm.archEnd) throw new Error(ARCH_LANDMARKS_MISSING);
  const f = buildInsoleFrame(lm);
  const start = f.archStart!, end = f.archEnd!;
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length < 20) throw new Error('The arch start and end landmarks are too close together.');
  const along: [number, number] = [dx / length, dy / length];
  let lateral: [number, number] = [-along[1], along[0]];
  if (lateral[0] * f.medialSign > 0) lateral = [-lateral[0], -lateral[1]];
  let peakT = 0.45, peakOffset = 0;
  if (f.arch) {
    const px = f.arch[0] - start[0], py = f.arch[1] - start[1];
    peakT = Math.min(0.8, Math.max(0.2, (px * along[0] + py * along[1]) / length));
    peakOffset = px * lateral[0] + py * lateral[1];
  }
  return {
    toFrame: (x, y) => worldToFrame(f, x, y),
    start, end, peakT, peakOffset, along, lateral, length,
    radiusAcross: Math.max(20, 0.4 * Math.abs(f.met1[0] - f.met5[0])),
  };
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Weight 0…1 of the arch adjustment at a world point (sole on Z = 0). */
export function archWeight(r: ArchRegion, x: number, y: number, z: number): number {
  const [a, b] = r.toFrame(x, y);
  const px = a - r.start[0], py = b - r.start[1];
  const t = (px * r.along[0] + py * r.along[1]) / r.length;
  if (t <= 0 || t >= 1) return 0; // strictly between the arch start and end
  // Along: smooth rise from the start to the peak and fall to the end (zero slope at both ends).
  const hat = t < r.peakT ? t / r.peakT : (1 - t) / (1 - r.peakT);
  const w = Math.sin((Math.PI / 2) * hat) ** 2;
  // Across: full on the medial side of the start–peak–end line, fading laterally.
  const lat = px * r.lateral[0] + py * r.lateral[1] - r.peakOffset * hat;
  const across = lat <= 0 ? 1 : smoothstep(r.radiusAcross, 0, lat);
  return w * across * smoothstep(45, 15, z); // only the sole and the lower side wall
}

function displace(z: number, w: number, delta: number): number {
  if (w <= 0) return z;
  const nz = z + delta * w;
  // Lowering never pushes the sole through the floor.
  return delta < 0 ? Math.max(nz, Math.min(z, 0.3)) : nz;
}

/** New mesh-local positions with the arch adjusted by `delta` mm. */
export function adjustArchPositions(localPositions: Float32Array, transform: RigidTransform, region: ArchRegion, delta: number): Float32Array {
  const world = transformPositions(localPositions, transform);
  const out = localPositions.slice();
  for (let i = 0; i < world.length; i += 3) {
    const w = archWeight(region, world[i], world[i + 1], world[i + 2]);
    if (w <= 0) continue;
    const p = applyInverseTransform(transform, [world[i], world[i + 1], displace(world[i + 2], w, delta)]);
    out[i] = p[0];
    out[i + 1] = p[1];
    out[i + 2] = p[2];
  }
  return out;
}

/** Same displacement for a single mesh-local point (keeps landmarks on the modified surface). */
export function adjustArchPoint(local: Vec3, transform: RigidTransform, region: ArchRegion, delta: number): Vec3 {
  const w0 = applyTransform(transform, local);
  const w = archWeight(region, w0[0], w0[1], w0[2]);
  if (w <= 0) return local;
  return applyInverseTransform(transform, [w0[0], w0[1], displace(w0[2], w, delta)]);
}
