import { describe, expect, it } from 'vitest';
import { box, icosphere, punchHole, sphereWithHoles } from '../fixtures/primitives';
import { analyzeMesh } from './analyze';
import { signedVolume } from './normals';
import { unweld, weldSoup } from './weld';

describe('weld + analysis', () => {
  it('welds a soup back into a shared-vertex mesh', () => {
    const sphere = icosphere(10, 3);
    const welded = weldSoup(unweld(sphere));
    expect(welded.positions.length).toBe(sphere.positions.length);
    expect(welded.indices.length).toBe(sphere.indices.length);
  });

  it('drops degenerate triangles', () => {
    const soup = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, /* dup */ 0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(weldSoup(soup).indices.length).toBe(3);
  });

  it('reports watertight closed meshes with outward orientation', () => {
    for (const m of [box([10, 10, 10]), icosphere(50, 3)]) {
      const s = analyzeMesh(m);
      expect(s.watertight).toBe(true);
      expect(s.boundaryEdgeCount).toBe(0);
      expect(signedVolume(m)).toBeGreaterThan(0);
    }
    expect(signedVolume(box([10, 20, 30]))).toBeCloseTo(6000, 3);
  });

  it('computes bounding box and counts', () => {
    const s = analyzeMesh(box([10, 20, 30], [1, 2, 3]));
    expect(s.triangleCount).toBe(12);
    expect(s.vertexCount).toBe(8);
    expect(s.bounds.min).toEqual([-4, -8, -12]);
    expect(s.bounds.max).toEqual([6, 12, 18]);
  });

  it('detects open meshes', () => {
    const s = analyzeMesh(punchHole(icosphere(50, 3), [0, 0, 1], 15));
    expect(s.watertight).toBe(false);
    expect(s.boundaryEdgeCount).toBeGreaterThan(3);
    expect(analyzeMesh(sphereWithHoles()).watertight).toBe(false);
  });

  it('counts non-manifold edges', () => {
    // three triangles sharing edge (0,1)
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1]);
    const indices = new Uint32Array([0, 1, 2, 1, 0, 3, 0, 1, 4]);
    const s = analyzeMesh({ id: 'x', positions, indices });
    expect(s.nonManifoldEdgeCount).toBe(1);
    expect(s.watertight).toBe(false);
  });
});
