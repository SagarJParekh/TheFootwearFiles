import { describe, expect, it } from 'vitest';
import { box, icosphere } from '../fixtures/primitives';
import { distancesToSurface } from './closestPoint';

describe('distancesToSurface', () => {
  it('measures distance to a box', () => {
    const d = distancesToSurface(box([10, 10, 10]), [[0, 0, 5], [0, 0, 8], [0, 0, 0], [8, 8, 5]]);
    expect(d[0]).toBeCloseTo(0, 6);
    expect(d[1]).toBeCloseTo(3, 6);
    expect(d[2]).toBeCloseTo(5, 6);
    expect(d[3]).toBeCloseTo(Math.hypot(3, 3), 6);
  });
  it('is ~0 for points on a sphere', () => {
    const [d] = distancesToSurface(icosphere(50, 4), [[50, 0, 0]]);
    expect(d).toBeLessThan(0.01);
  });
});
