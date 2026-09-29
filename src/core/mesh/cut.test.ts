import { beforeAll, describe, expect, it } from 'vitest';
import Module, { type ManifoldToplevel } from 'manifold-3d';
import { box, icosphere, punchHole } from '../fixtures/primitives';
import { closedFoot, lowerLimbScan } from '../fixtures/footShapes';
import { analyzeMesh } from './analyze';
import { cutMeshByPlane } from './cut';
import { findBoundaryLoops } from './holes';
import { manifoldTrim } from './manifoldCut';
import { signedVolume } from './normals';
import type { Plane } from '../types';

const zPlane = (z: number): Plane => ({ normal: [0, 0, 1], constant: z });

function allOnSide(positions: Float32Array, plane: Plane, positive: boolean, tol = 1e-3) {
  for (let i = 0; i < positions.length; i += 3) {
    const d = plane.normal[0] * positions[i] + plane.normal[1] * positions[i + 1] + plane.normal[2] * positions[i + 2] - plane.constant;
    if (positive ? d < -tol : d > tol) return false;
  }
  return true;
}

describe('cutMeshByPlane (own split)', () => {
  it('cuts and caps a sphere into a watertight hemisphere', () => {
    const sphere = icosphere(50, 4);
    const r = cutMeshByPlane(sphere, zPlane(10), { keepPositive: true, cap: true });
    const s = analyzeMesh(r.mesh);
    expect(s.watertight).toBe(true);
    expect(r.cappedLoops).toBe(1);
    expect(allOnSide(r.mesh.positions, zPlane(10), true)).toBe(true);
    // spherical cap volume: π h² (3r − h) / 3 with h = 40
    const expected = (Math.PI * 40 * 40 * (150 - 40)) / 3;
    expect(signedVolume(r.mesh)).toBeGreaterThan(expected * 0.97);
    expect(signedVolume(r.mesh)).toBeLessThan(expected * 1.01);
  });

  it('keeps the negative side when asked', () => {
    const r = cutMeshByPlane(icosphere(50, 3), zPlane(0), { keepPositive: false, cap: true });
    expect(allOnSide(r.mesh.positions, zPlane(0), false)).toBe(true);
    expect(analyzeMesh(r.mesh).watertight).toBe(true);
    expect(signedVolume(r.mesh)).toBeGreaterThan(0);
  });

  it('leaves an open rim without capping', () => {
    const r = cutMeshByPlane(icosphere(50, 3), zPlane(0), { keepPositive: true, cap: false });
    const loops = findBoundaryLoops(r.mesh);
    expect(loops.length).toBe(1);
    expect(loops[0].perimeter).toBeGreaterThan(2 * Math.PI * 50 * 0.98);
  });

  it('handles a plane through existing vertices (box face at z = 0)', () => {
    const r = cutMeshByPlane(box([10, 10, 10]), zPlane(0), { keepPositive: true, cap: true });
    const s = analyzeMesh(r.mesh);
    expect(s.watertight).toBe(true);
    expect(signedVolume(r.mesh)).toBeCloseTo(500, 3);
  });

  it('caps a ring-shaped section with a hole (nested loops)', () => {
    // hollow box: outer 40, inner 20 (inner inverted), cut through the middle
    const outer = box([40, 40, 40]);
    const inner = box([20, 20, 20]);
    const inv = new Uint32Array(inner.indices.length);
    for (let i = 0; i < inv.length; i += 3) {
      inv[i] = inner.indices[i] + 8; inv[i + 1] = inner.indices[i + 2] + 8; inv[i + 2] = inner.indices[i + 1] + 8;
    }
    const positions = new Float32Array([...outer.positions, ...inner.positions]);
    const indices = new Uint32Array([...outer.indices, ...inv]);
    const r = cutMeshByPlane({ id: 'h', positions, indices }, zPlane(0), { keepPositive: true, cap: true });
    expect(r.cappedLoops).toBe(2);
    expect(analyzeMesh(r.mesh).watertight).toBe(true);
    expect(signedVolume(r.mesh)).toBeCloseTo(40 * 40 * 20 - 20 * 20 * 10, 0);
  });

  it('cuts an open leg scan horizontally and closes the stump', () => {
    const leg = lowerLimbScan();
    const r = cutMeshByPlane(leg, zPlane(200), { keepPositive: false, cap: true });
    expect(r.cappedLoops).toBe(1);
    // the open top is gone; only the two small scanner holes remain
    const loops = findBoundaryLoops(r.mesh);
    expect(loops.length).toBe(2);
    expect(allOnSide(r.mesh.positions, zPlane(200), false)).toBe(true);
  });

  it('reports open cross-sections that cannot be capped', () => {
    // hemisphere shell (open at z=0) cut by a vertical plane: section is an open arc
    const shell = punchHole(icosphere(50, 3), [0, 0, -1], 90);
    const r = cutMeshByPlane(shell, { normal: [1, 0, 0], constant: 10 }, { keepPositive: true, cap: true });
    expect(r.cappedLoops).toBe(0);
    expect(r.openCutLoops).toBe(1);
  });
});

describe('manifoldTrim', () => {
  let wasm: ManifoldToplevel;
  beforeAll(async () => {
    wasm = await Module();
    wasm.setup();
  });

  it('trims a closed foot and returns a watertight result', () => {
    const foot = closedFoot(5);
    const plane: Plane = { normal: [0, 1, 0], constant: 120 };
    const out = manifoldTrim(wasm, foot, plane, false);
    expect(analyzeMesh(out).watertight).toBe(true);
    expect(allOnSide(out.positions, plane, false)).toBe(true);
    const own = cutMeshByPlane(foot, plane, { keepPositive: false, cap: true });
    expect(signedVolume(out)).toBeCloseTo(signedVolume(own.mesh), -2);
  });

  it('throws on open meshes', () => {
    expect(() => manifoldTrim(wasm, punchHole(icosphere(50, 3), [0, 0, 1], 20), zPlane(0), true)).toThrow();
  });
});
