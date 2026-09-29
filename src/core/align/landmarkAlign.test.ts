import { describe, expect, it } from 'vitest';
import { applyTransform, eulerDegToQuat } from '../math/transform';
import type { RigidTransform, Vec3 } from '../types';
import { alignFromLandmarks } from './landmarkAlign';

describe('alignFromLandmarks', () => {
  it('puts the plantar plane on the floor and the toes along +Y, whatever the scan pose', () => {
    // Landmarks of an already-aligned right foot…
    const hc: Vec3 = [2, 0, 0], m1: Vec3 = [-28, 150, 0], m5: Vec3 = [42, 132, 0], arch: Vec3 = [-20, 70, 15];
    // …scrambled by an arbitrary pose (as a scanner might export it)
    const pose: RigidTransform = { position: [120, -40, 300], quaternion: eulerDegToQuat([110, -35, 70]) };
    const [a, b, c, d] = [hc, m1, m5, arch].map((p) => applyTransform(pose, p));
    const t = alignFromLandmarks({ heelCentre: a, met1Head: b, met5Head: c, abovePoint: d });
    const [HC, M1, M5, AR] = [a, b, c, d].map((p) => applyTransform(t, p));
    for (const p of [HC, M1, M5]) expect(p[2]).toBeCloseTo(0, 6);
    expect(HC[0]).toBeCloseTo(0, 6);
    expect(HC[1]).toBeCloseTo(0, 6);
    expect(AR[2]).toBeGreaterThan(10); // arch is above the floor
    const mid = [(M1[0] + M5[0]) / 2, (M1[1] + M5[1]) / 2];
    expect(Math.abs(mid[0])).toBeLessThan(1e-6);
    expect(mid[1]).toBeGreaterThan(100);
  });
});
