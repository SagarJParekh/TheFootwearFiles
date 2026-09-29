import { applyInverseTransform, applyTransform, transformPositions } from '../math/transform';
import { buildInsoleFrame, worldToFrame, type FrameLandmarks } from '../insole/frame';
import type { RigidTransform, Vec3 } from '../types';

/**
 * Arch adjustment on the FOOT scan (not the insole). With the base plane set (sole on Z = 0),
 * the plantar surface under the medial longitudinal arch is raised (+) or lowered (−) by a
 * smooth bump: full effect at the arch, fading to zero towards the heel, the metatarsal heads,
 * the lateral side and up the side of the foot. The insole is then generated from the modified
 * foot, so it follows the new arch.
 */
export interface ArchRegion {
  toFrame: (x: number, y: number) => [number, number];
  centre: [number, number];
  radiusAcross: number;
  radiusAlong: number;
}

export function archRegion(lm: FrameLandmarks): ArchRegion {
  const f = buildInsoleFrame(lm);
  const [a1, b1] = f.met1, [a5, b5] = f.met5;
  const bMT = (b1 + b5) / 2;
  const centre: [number, number] = f.arch ?? [f.medialSign * Math.max(12, 0.45 * Math.abs(a1)), 0.45 * bMT];
  return {
    toFrame: (x, y) => worldToFrame(f, x, y),
    centre,
    radiusAcross: Math.max(20, 0.4 * Math.abs(a1 - a5)),
    radiusAlong: 0.42 * bMT,
  };
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Weight 0…1 of the arch adjustment at a world point (sole on Z = 0). */
export function archWeight(r: ArchRegion, x: number, y: number, z: number): number {
  const [a, b] = r.toFrame(x, y);
  const q = ((a - r.centre[0]) / r.radiusAcross) ** 2 + ((b - r.centre[1]) / r.radiusAlong) ** 2;
  if (q >= 1) return 0;
  return (1 - q) * (1 - q) * smoothstep(45, 15, z); // only the sole and the lower side wall
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
