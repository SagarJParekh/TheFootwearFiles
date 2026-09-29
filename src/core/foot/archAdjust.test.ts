import { describe, expect, it } from 'vitest';
import { closedFoot } from '../fixtures/footShapes';
import { IDENTITY_TRANSFORM } from '../types';
import { adjustArchPoint, adjustArchPositions, archRegion, archWeight } from './archAdjust';

const LM = { heelCentre: [4, 38, 0] as [number, number, number], met1Head: [-26, 182, 0] as [number, number, number], met5Head: [44, 165, 0] as [number, number, number] };

describe('arch adjustment on the foot', () => {
  const foot = closedFoot(4);
  const region = archRegion(LM);
  const T = { ...IDENTITY_TRANSFORM };

  it('raises the plantar arch region and leaves heel, forefoot and dorsum alone', () => {
    const up = adjustArchPositions(foot.positions, T, region, 8);
    let maxLift = 0, movedOutside = 0;
    for (let i = 0; i < up.length; i += 3) {
      const dz = up[i + 2] - foot.positions[i + 2];
      maxLift = Math.max(maxLift, dz);
      const y = foot.positions[i + 1], z = foot.positions[i + 2];
      if ((y < 38 || y > 165 || z > 45) && Math.abs(dz) > 1e-6) movedOutside++; // heel centre y=38, MT heads y≈165–182
      expect(up[i]).toBeCloseTo(foot.positions[i], 5); // only vertical movement
    }
    expect(maxLift).toBeGreaterThan(6);
    expect(maxLift).toBeLessThanOrEqual(8 + 1e-4);
    expect(movedOutside).toBe(0);
  });

  it('lowering never pushes the sole through the floor', () => {
    const down = adjustArchPositions(foot.positions, T, region, -15);
    for (let i = 2; i < down.length; i += 3) {
      if (foot.positions[i] >= 0) expect(down[i]).toBeGreaterThanOrEqual(Math.min(foot.positions[i], 0.3) - 1e-5);
    }
  });

  it('moves points on the surface consistently and ignores the base-plane landmarks', () => {
    expect(archWeight(region, ...LM.heelCentre)).toBe(0);
    expect(archWeight(region, ...LM.met1Head)).toBe(0);
    expect(adjustArchPoint(LM.met5Head, T, region, 10)).toEqual(LM.met5Head);
    const p = adjustArchPoint([region.centre[0] + 4, 38 + region.centre[1], 5], T, region, 10);
    expect(p[2]).toBeGreaterThan(12);
  });
});
