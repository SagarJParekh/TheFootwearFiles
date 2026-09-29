import { describe, expect, it } from 'vitest';
import { icosphere, punchHole, sphereWithHoles } from '../../fixtures/primitives';
import { lowerLimbScan } from '../../fixtures/footShapes';
import { analyzeMesh } from '../analyze';
import { findBoundaryLoops, suggestExcludedLoops } from '../holes';
import { signedVolume } from '../normals';
import { fillHoles } from './fillHoles';
import { minimumAreaTriangulation, projectedTriangulation } from './triangulate';
import type { Vec3 } from '../../types';

describe('hole detection', () => {
  it('finds the three holes of the sphere fixture with sensible perimeters', () => {
    const loops = findBoundaryLoops(sphereWithHoles());
    expect(loops.length).toBe(3);
    const perims = loops.map((l) => l.perimeter).sort((a, b) => a - b);
    // radius of a cap of half-angle θ on r=50: 50·sinθ → perimeter ≈ 2π·50·sinθ (jagged, so larger)
    [12, 20, 30].forEach((deg, i) => {
      const ideal = 2 * Math.PI * 50 * Math.sin((deg * Math.PI) / 180);
      expect(perims[i]).toBeGreaterThan(ideal * 0.9);
      expect(perims[i]).toBeLessThan(ideal * 1.6);
    });
    loops.forEach((l) => expect(l.edgeCount).toBe(l.vertices.length));
  });

  it('returns no loops for a closed mesh', () => {
    expect(findBoundaryLoops(icosphere(10, 2))).toEqual([]);
  });

  it('splits loops that touch at a pinch vertex', () => {
    // two triangles sharing only vertex 0 → two separate 3-edge loops
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0]);
    const indices = new Uint32Array([0, 1, 2, 0, 3, 4]);
    const loops = findBoundaryLoops({ positions, indices });
    expect(loops.length).toBe(2);
    expect(loops.every((l) => l.vertices.length === 3)).toBe(true);
  });

  it('suggests excluding the open rim of a leg scan but not its small holes', () => {
    const loops = findBoundaryLoops(lowerLimbScan());
    expect(loops.length).toBe(3);
    const excluded = suggestExcludedLoops(loops);
    expect(excluded.size).toBe(1);
    const rim = loops.find((l) => excluded.has(l.id))!;
    expect(rim.centroid[2]).toBeGreaterThan(300);
  });
});

describe('triangulation', () => {
  const ring = (n: number, r = 10): Vec3[] =>
    Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n), 0]);

  it('minimum-area triangulation produces n−2 triangles with polygon orientation', () => {
    const pts = ring(12);
    const tri = minimumAreaTriangulation(pts);
    expect(tri.length / 3).toBe(10);
    for (let t = 0; t < tri.length; t += 3) {
      const [a, b, c] = [pts[tri[t]], pts[tri[t + 1]], pts[tri[t + 2]]];
      const z = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      expect(z).toBeGreaterThan(0); // CCW like the ring
    }
  });

  it('projected triangulation keeps orientation and all vertices', () => {
    const pts = ring(500, 80);
    const tri = projectedTriangulation(pts);
    expect(new Set(tri).size).toBe(500);
    for (let t = 0; t < tri.length; t += 3) {
      const [a, b, c] = [pts[tri[t]], pts[tri[t + 1]], pts[tri[t + 2]]];
      expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('fillHoles', () => {
  it('closes all holes of the sphere fixture (watertight, outward, correct volume)', () => {
    const r = fillHoles(sphereWithHoles(), 'all');
    const s = analyzeMesh(r.mesh);
    expect(r.filled).toBe(3);
    expect(s.watertight).toBe(true);
    const sphereVolume = (4 / 3) * Math.PI * 50 ** 3;
    expect(signedVolume(r.mesh)).toBeGreaterThan(sphereVolume * 0.97);
    expect(signedVolume(r.mesh)).toBeLessThan(sphereVolume * 1.01);
  });

  it('faired patch follows the sphere curvature (not a flat fan)', () => {
    const holed = punchHole(icosphere(50, 4), [0, 0, 1], 30);
    const before = holed.positions.length / 3;
    const faired = fillHoles(holed, 'all', { refine: true, fair: true }).mesh;
    const flat = fillHoles(holed, 'all', { refine: true, fair: false }).mesh;
    const radialError = (m: typeof faired) => {
      let worst = 0;
      for (let v = before; v < m.positions.length / 3; v++) {
        const r = Math.hypot(m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]);
        worst = Math.max(worst, Math.abs(r - 50));
      }
      return worst;
    };
    expect(faired.positions.length / 3).toBeGreaterThan(before + 20); // refinement added vertices
    const flatErr = radialError(flat);
    const fairErr = radialError(faired);
    expect(flatErr).toBeGreaterThan(5); // flat cap sits ~6.7 mm below the sphere at the centre
    expect(fairErr).toBeLessThan(flatErr * 0.35);
  });

  it('fills only the requested loops', () => {
    const mesh = sphereWithHoles();
    const loops = findBoundaryLoops(mesh);
    const r = fillHoles(mesh, [loops[0].id]);
    expect(findBoundaryLoops(r.mesh).length).toBe(2);
  });

  it('fills the small holes of a leg scan and leaves the rim open', () => {
    const leg = lowerLimbScan();
    const loops = findBoundaryLoops(leg);
    const excluded = suggestExcludedLoops(loops);
    const r = fillHoles(leg, loops.filter((l) => !excluded.has(l.id)).map((l) => l.id));
    const after = findBoundaryLoops(r.mesh);
    expect(after.length).toBe(1);
    expect(after[0].centroid[2]).toBeGreaterThan(300);
    expect(analyzeMesh(r.mesh).nonManifoldEdgeCount).toBe(0);
  });
});
