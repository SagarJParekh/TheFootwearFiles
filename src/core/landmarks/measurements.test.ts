import { describe, expect, it } from 'vitest';
import type { LandmarkMap } from '../document';
import { archHeight, computeMeasurements } from './measurements';
import type { Vec3 } from '../types';

const lm = (v: Vec3) => ({ local: v, placedAt: '' });

describe('measurements', () => {
  const landmarks: LandmarkMap = {
    heelCentre: lm([0, 0, 0]),
    met1Head: lm([-30, 180, 0]),
    met5Head: lm([40, 170, 0]),
    archPeak: lm([-25, 100, 18]),
    medialMalleolus: lm([-30, 40, 90]),
    lateralMalleolus: lm([35, 30, 75]),
  };

  it('computes distances for a plantar scan (no malleoli)', () => {
    const m = computeMeasurements(landmarks, 'plantar');
    const by = Object.fromEntries(m.map((x) => [x.id, x.value]));
    expect(Object.keys(by)).not.toContain('interMalleolar');
    expect(by.forefootWidth).toBeCloseTo(Math.hypot(70, 10), 6);
    expect(by.heelToMet1).toBeCloseTo(Math.hypot(30, 180), 6);
    expect(by.heelToMet5).toBeCloseTo(Math.hypot(40, 170), 6);
    expect(by.archHeight).toBeCloseTo(18, 6); // plantar plane is z = 0
  });

  it('includes inter-malleolar distance for lower-limb scans', () => {
    const m = computeMeasurements(landmarks, 'lowerLimb').find((x) => x.id === 'interMalleolar')!;
    expect(m.value).toBeCloseTo(Math.hypot(65, 10, 15), 6);
  });

  it('reports missing landmarks', () => {
    const m = computeMeasurements({ heelCentre: lm([0, 0, 0]) }, 'plantar');
    const arch = m.find((x) => x.id === 'archHeight')!;
    expect(arch.value).toBeNull();
    expect(arch.missing).toEqual(['met1Head', 'met5Head', 'archPeak']);
  });

  it('arch height is the perpendicular distance to a tilted plantar plane', () => {
    // plane through three points on z = x (45° tilt): distance of (0,0,10) is 10/√2
    expect(archHeight([0, 0, 0], [10, 0, 10], [0, 10, 0], [0, 0, 10])).toBeCloseTo(10 / Math.SQRT2, 6);
    expect(archHeight([0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 0, 1])).toBeNull(); // collinear
  });
});
