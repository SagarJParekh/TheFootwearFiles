import { describe, expect, it } from 'vitest';
import { eulerDegToQuat } from '../math/transform';
import type { RigidTransform } from '../types';
import { buildLandmarksFile, landmarksToCsv, landmarksToJson, parseLandmarksJson } from './landmarksIO';

const transform: RigidTransform = { position: [10, 20, 30], quaternion: eulerDegToQuat([0, 0, 90]) };
const doc = {
  meta: { sourceFileName: 'patient 1, left.stl' },
  scan: { type: 'lowerLimb' as const, side: 'left' as const },
  transform,
  landmarks: {
    heelCentre: { local: [1, 2, 3] as [number, number, number], placedAt: 't' },
    met1Head: { local: [4, 5, 6] as [number, number, number], placedAt: 't' },
  },
};

describe('landmark serialisation', () => {
  it('writes name, local and world coordinates, scan type, side and file name', () => {
    const f = buildLandmarksFile(doc, '2026-01-01T00:00:00Z');
    expect(f.scanType).toBe('lowerLimb');
    expect(f.side).toBe('left');
    expect(f.sourceFileName).toBe('patient 1, left.stl');
    expect(f.landmarks[0]).toEqual({
      id: 'heelCentre',
      name: 'Heel centre',
      local: { x: 1, y: 2, z: 3 },
      world: { x: 8, y: 21, z: 33 }, // Rz(90°)·(1,2,3) = (−2,1,3), + t
    });
    expect(f.measurements.find((m) => m.id === 'heelToMet1')!.valueMm).toBeCloseTo(Math.sqrt(27), 3);
  });

  it('round-trips through JSON', () => {
    const parsed = parseLandmarksJson(landmarksToJson(doc), transform);
    expect(parsed.scan).toEqual({ type: 'lowerLimb', side: 'left' });
    expect(parsed.landmarks.heelCentre!.local).toEqual([1, 2, 3]);
    expect(parsed.landmarks.met1Head!.local).toEqual([4, 5, 6]);
    expect(parsed.warnings).toEqual([]);
  });

  it('falls back to world coordinates when local ones are missing', () => {
    const json = JSON.stringify({
      format: 'footwear-files/landmarks', version: 1,
      landmarks: [{ id: 'archPeak', world: { x: 8, y: 21, z: 33 } }, { id: 'bogus', local: { x: 0, y: 0, z: 0 } }],
    });
    const parsed = parseLandmarksJson(json, transform);
    const p = parsed.landmarks.archPeak!.local;
    expect(p[0]).toBeCloseTo(1, 6);
    expect(p[1]).toBeCloseTo(2, 6);
    expect(p[2]).toBeCloseTo(3, 6);
    expect(parsed.warnings.length).toBe(1);
  });

  it('rejects foreign JSON', () => {
    expect(() => parseLandmarksJson('{"a":1}', transform)).toThrow(/landmarks file/);
    expect(() => parseLandmarksJson('nope', transform)).toThrow(/JSON/);
  });

  it('writes CSV with a header and quoted file names', () => {
    const lines = landmarksToCsv(doc).trim().split('\n');
    expect(lines[0]).toBe('id,name,local_x,local_y,local_z,world_x,world_y,world_z,scan_type,side,source_file');
    expect(lines[1]).toBe('heelCentre,Heel centre,1,2,3,8,21,33,lowerLimb,left,"patient 1, left.stl"');
    expect(lines.length).toBe(3);
  });
});
