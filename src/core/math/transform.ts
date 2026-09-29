import type { Quat, RigidTransform, Vec3 } from '../types';

const DEG = Math.PI / 180;

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatConjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function quatNormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function rotateVector(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2w(q×v) + 2 q×(q×v)
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

/**
 * Euler angles in degrees, intrinsic XYZ order (same as Three.js default 'XYZ').
 */
export function eulerDegToQuat(e: Vec3): Quat {
  const [x, y, z] = [e[0] * DEG * 0.5, e[1] * DEG * 0.5, e[2] * DEG * 0.5];
  const c1 = Math.cos(x), c2 = Math.cos(y), c3 = Math.cos(z);
  const s1 = Math.sin(x), s2 = Math.sin(y), s3 = Math.sin(z);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** Inverse of eulerDegToQuat (XYZ order), returns degrees. */
export function quatToEulerDeg(q: Quat): Vec3 {
  const [x, y, z, w] = quatNormalize(q);
  // rotation matrix elements
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  let ex: number, ez: number;
  if (Math.abs(m13) < 0.9999999) {
    ex = Math.atan2(-m23, m33);
    ez = Math.atan2(-m12, m11);
  } else {
    ex = Math.atan2(m32, m22);
    ez = 0;
  }
  return [ex / DEG, ey / DEG, ez / DEG];
}

export function applyTransform(t: RigidTransform, local: Vec3): Vec3 {
  const r = rotateVector(t.quaternion, local);
  return [r[0] + t.position[0], r[1] + t.position[1], r[2] + t.position[2]];
}

export function applyInverseTransform(t: RigidTransform, world: Vec3): Vec3 {
  const d: Vec3 = [world[0] - t.position[0], world[1] - t.position[1], world[2] - t.position[2]];
  return rotateVector(quatConjugate(t.quaternion), d);
}

/** Returns a new positions array with the transform baked in. */
export function transformPositions(positions: Float32Array, t: RigidTransform): Float32Array {
  const out = new Float32Array(positions.length);
  const [qx, qy, qz, qw] = t.quaternion;
  const [px, py, pz] = t.position;
  for (let i = 0; i < positions.length; i += 3) {
    const vx = positions[i], vy = positions[i + 1], vz = positions[i + 2];
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    out[i] = vx + qw * tx + (qy * tz - qz * ty) + px;
    out[i + 1] = vy + qw * ty + (qz * tx - qx * tz) + py;
    out[i + 2] = vz + qw * tz + (qx * ty - qy * tx) + pz;
  }
  return out;
}

export function isIdentity(t: RigidTransform, eps = 1e-9): boolean {
  const [x, y, z, w] = t.quaternion;
  return (
    Math.abs(t.position[0]) < eps &&
    Math.abs(t.position[1]) < eps &&
    Math.abs(t.position[2]) < eps &&
    Math.abs(x) < eps &&
    Math.abs(y) < eps &&
    Math.abs(z) < eps &&
    Math.abs(Math.abs(w) - 1) < eps
  );
}
