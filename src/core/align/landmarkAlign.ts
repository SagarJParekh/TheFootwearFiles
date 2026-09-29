import type { Quat, RigidTransform, Vec3 } from '../types';
import { cross, dot, normalize, scale, sub } from '../math/vec';
import { rotateVector } from '../math/transform';

/** Quaternion from a rotation matrix given by its rows (orthonormal, det +1). */
export function quatFromRows(r0: Vec3, r1: Vec3, r2: Vec3): Quat {
  const [m00, m01, m02] = r0, [m10, m11, m12] = r1, [m20, m21, m22] = r2;
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  const l = Math.hypot(x, y, z, w);
  return [x / l, y / l, z / l, w / l];
}

export interface AlignInput {
  heelCentre: Vec3;
  met1Head: Vec3;
  met5Head: Vec3;
  /** A point known to be above the sole (arch peak, or the mesh centroid) – fixes the up direction. */
  abovePoint: Vec3;
}

/**
 * Standard foot frame from landmarks (all in mesh-local coordinates):
 *   plantar plane through heel centre, 1st and 5th metatarsal heads → the floor (Z = 0),
 *   heel centre → midpoint of the metatarsal heads → +Y (toes), heel centre at X = Y = 0.
 * Returns the rigid transform world = R · local + t.
 */
export function alignFromLandmarks({ heelCentre: hc, met1Head: m1, met5Head: m5, abovePoint }: AlignInput): RigidTransform {
  let n = normalize(cross(sub(m1, hc), sub(m5, hc)));
  if (n[0] === 0 && n[1] === 0 && n[2] === 0) throw new Error('Heel centre and metatarsal heads are collinear.');
  if (dot(n, sub(abovePoint, hc)) < 0) n = scale(n, -1);
  const mid = scale([m1[0] + m5[0], m1[1] + m5[1], m1[2] + m5[2]], 0.5);
  const fwd = sub(mid, hc);
  const y = normalize(sub(fwd, scale(n, dot(fwd, n))));
  const x = cross(y, n);
  const q = quatFromRows(x, y, n);
  const r = rotateVector(q, hc);
  return { quaternion: q, position: [-r[0], -r[1], -r[2]] };
}
