import { describe, expect, it } from 'vitest';
import { newDocument } from '../document';
import { closedFoot } from '../fixtures/footShapes';
import { applyTransform, eulerDegToQuat, transformPositions } from '../math/transform';
import { makeMesh, type RigidTransform, type Vec3 } from '../types';
import { basePlaneTransform, setBasePlane, syncBasePlane } from './basePlane';

// A foot scanned in an arbitrary pose (as scanners export it)
const pose: RigidTransform = { position: [50, 80, -30], quaternion: eulerDegToQuat([70, 20, -110]) };
const foot = closedFoot(6);
const scanned = makeMesh(transformPositions(foot.positions, pose), foot.indices);
const at = (p: Vec3) => ({ local: applyTransform(pose, p), placedAt: '' });

function docWith(ids: ('heelCentre' | 'met1Head' | 'met5Head')[]) {
  const all = { heelCentre: at([4, 38, 0]), met1Head: at([-26, 182, 0]), met5Head: at([44, 165, 0]) };
  const d = newDocument(scanned, 'f.stl');
  return { ...d, landmarks: Object.fromEntries(ids.map((id) => [id, all[id]])) };
}

describe('base plane', () => {
  it('puts heel centre, M1 and M5 on the floor with the foot above it, and locks', () => {
    const d = setBasePlane(docWith(['heelCentre', 'met1Head', 'met5Head']));
    expect(d.basePlaneLocked).toBe(true);
    for (const id of ['heelCentre', 'met1Head', 'met5Head'] as const) {
      expect(applyTransform(d.transform, d.landmarks[id]!.local)[2]).toBeCloseTo(0, 5);
    }
    // the rest of the foot is above the base plane (centroid well above the floor)
    const world = transformPositions(scanned.positions, d.transform);
    let zSum = 0;
    for (let i = 2; i < world.length; i += 3) zSum += world[i];
    expect(zSum / (world.length / 3)).toBeGreaterThan(10);
  });

  it('needs all three landmarks', () => {
    expect(basePlaneTransform(docWith(['heelCentre', 'met1Head']))).toBeNull();
    expect(() => setBasePlane(docWith(['heelCentre']))).toThrow();
  });

  it('follows a moved landmark and releases when one is deleted', () => {
    const d = setBasePlane(docWith(['heelCentre', 'met1Head', 'met5Head']));
    const moved = syncBasePlane({ ...d, landmarks: { ...d.landmarks, met5Head: at([44, 165, 6]) } });
    expect(moved.basePlaneLocked).toBe(true);
    expect(applyTransform(moved.transform, moved.landmarks.met5Head!.local)[2]).toBeCloseTo(0, 5);
    const { met1Head: _removed, ...rest } = d.landmarks;
    void _removed;
    expect(syncBasePlane({ ...d, landmarks: rest }).basePlaneLocked).toBe(false);
    // unlocked documents are left alone
    const free = docWith(['heelCentre', 'met1Head', 'met5Head']);
    expect(syncBasePlane(free)).toBe(free);
  });
});
