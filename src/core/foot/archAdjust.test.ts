import { describe, expect, it } from 'vitest';
import { closedFoot } from '../fixtures/footShapes';
import { IDENTITY_TRANSFORM, type Vec3 } from '../types';
import { adjustArchPoint, adjustArchPositions, archRegion, archWeight } from './archAdjust';

const START: Vec3 = [-12, 70, 3], END: Vec3 = [-22, 150, 1];
const LM = { heelCentre: [4, 38, 0] as Vec3, met1Head: [-26, 182, 0] as Vec3, met5Head: [44, 165, 0] as Vec3, archStart: START, archEnd: END };

/** Position of (x, y) along arch start → end (0 at the start, 1 at the end), in world XY. */
function along(x: number, y: number): number {
  const dx = END[0] - START[0], dy = END[1] - START[1];
  return ((x - START[0]) * dx + (y - START[1]) * dy) / (dx * dx + dy * dy);
}

describe('arch adjustment on the foot', () => {
  const foot = closedFoot(4);
  const region = archRegion(LM);
  const T = { ...IDENTITY_TRANSFORM };

  it('needs the arch start and end landmarks', () => {
    expect(() => archRegion({ heelCentre: LM.heelCentre, met1Head: LM.met1Head, met5Head: LM.met5Head })).toThrow(/arch/);
  });

  it('raises the arch only between the arch start and end landmarks', () => {
    const up = adjustArchPositions(foot.positions, T, region, 8);
    let maxLift = 0, movedOutside = 0, movedInside = 0;
    for (let i = 0; i < up.length; i += 3) {
      const dz = up[i + 2] - foot.positions[i + 2];
      maxLift = Math.max(maxLift, dz);
      const t = along(foot.positions[i], foot.positions[i + 1]);
      if ((t <= 0 || t >= 1 || foot.positions[i + 2] > 45) && Math.abs(dz) > 1e-6) movedOutside++;
      if (t > 0 && t < 1 && dz > 1e-6) movedInside++;
      expect(up[i]).toBeCloseTo(foot.positions[i], 5); // only vertical movement
    }
    expect(maxLift).toBeGreaterThan(6);
    expect(maxLift).toBeLessThanOrEqual(8 + 1e-4);
    expect(movedInside).toBeGreaterThan(20);
    expect(movedOutside).toBe(0);
  });

  it('peaks at the arch peak landmark when it is placed', () => {
    const peak: Vec3 = [-17, 90, 5];
    const r = archRegion({ ...LM, archPeak: peak });
    expect(archWeight(r, ...peak)).toBeGreaterThan(0.99);
    // closer to the start than the default 45 % peak → the weight there is higher than without it
    expect(archWeight(r, -14, 82, 4)).toBeGreaterThan(archWeight(region, -14, 82, 4));
  });

  it('lowering never pushes the sole through the floor', () => {
    const down = adjustArchPositions(foot.positions, T, region, -15);
    for (let i = 2; i < down.length; i += 3) {
      if (foot.positions[i] >= 0) expect(down[i]).toBeGreaterThanOrEqual(Math.min(foot.positions[i], 0.3) - 1e-5);
    }
  });

  it('moves points on the surface consistently and leaves the end points alone', () => {
    for (const p of [LM.heelCentre, LM.met1Head, LM.met5Head, START, END]) expect(adjustArchPoint(p, T, region, 10)).toEqual(p);
    const mid: Vec3 = [-17, 110, 5];
    expect(adjustArchPoint(mid, T, region, 10)[2]).toBeGreaterThan(12);
  });
});
