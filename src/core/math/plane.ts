import type { Plane, RigidTransform, Vec3 } from '../types';
import { cross, dot, normalize, sub } from './vec';
import { applyInverseTransform, quatConjugate, rotateVector } from './transform';

export function planeFromNormalAndPoint(normal: Vec3, point: Vec3): Plane {
  const n = normalize(normal);
  return { normal: n, constant: dot(n, point) };
}

/** Plane through three points; normal follows right-hand rule a→b→c. Returns null if degenerate. */
export function planeFromPoints(a: Vec3, b: Vec3, c: Vec3): Plane | null {
  const n = cross(sub(b, a), sub(c, a));
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-12) return null;
  return planeFromNormalAndPoint(n, a);
}

export function signedDistance(plane: Plane, p: Vec3): number {
  return dot(plane.normal, p) - plane.constant;
}

/** Converts a plane given in world coordinates to the mesh's local coordinates. */
export function planeWorldToLocal(plane: Plane, t: RigidTransform): Plane {
  const n = rotateVector(quatConjugate(t.quaternion), plane.normal);
  const pointOnPlaneWorld: Vec3 = [
    plane.normal[0] * plane.constant,
    plane.normal[1] * plane.constant,
    plane.normal[2] * plane.constant,
  ];
  return planeFromNormalAndPoint(n, applyInverseTransform(t, pointOnPlaneWorld));
}

/** Two unit vectors (u, v) spanning the plane, with u × v = normal. */
export function planeBasis(normal: Vec3): [Vec3, Vec3] {
  const n = normalize(normal);
  const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(helper, n));
  const v = cross(n, u);
  return [u, v];
}
