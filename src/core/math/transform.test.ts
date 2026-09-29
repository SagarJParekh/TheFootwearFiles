import { describe, expect, it } from 'vitest';
import type { RigidTransform, Vec3 } from '../types';
import { applyInverseTransform, applyTransform, eulerDegToQuat, quatToEulerDeg, rotateVector, transformPositions } from './transform';
import { planeFromNormalAndPoint, planeWorldToLocal, signedDistance } from './plane';

const close = (a: Vec3, b: Vec3, d = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d));

describe('transform math', () => {
  it('euler ↔ quaternion round trip', () => {
    for (const e of [[10, 20, 30], [-45, 80, 170], [0, 0, 90], [90, 0, 0]] as Vec3[]) {
      close(quatToEulerDeg(eulerDegToQuat(e)), e, 4);
    }
  });

  it('rotates 90° about Z', () => {
    close(rotateVector(eulerDegToQuat([0, 0, 90]), [1, 0, 0]), [0, 1, 0]);
  });

  it('inverse transform undoes transform', () => {
    const t: RigidTransform = { position: [10, -5, 3], quaternion: eulerDegToQuat([12, -40, 77]) };
    const p: Vec3 = [3, 4, 5];
    close(applyInverseTransform(t, applyTransform(t, p)), p);
    const baked = transformPositions(new Float32Array(p), t);
    close([baked[0], baked[1], baked[2]], applyTransform(t, p), 4);
  });

  it('converts world planes to local planes', () => {
    const t: RigidTransform = { position: [0, 0, 100], quaternion: eulerDegToQuat([0, 90, 0]) };
    const worldPlane = planeFromNormalAndPoint([0, 0, 1], [0, 0, 110]);
    const local = planeWorldToLocal(worldPlane, t);
    const pLocal: Vec3 = [-7, 3, 2];
    expect(signedDistance(local, pLocal)).toBeCloseTo(signedDistance(worldPlane, applyTransform(t, pLocal)), 6);
  });
});
