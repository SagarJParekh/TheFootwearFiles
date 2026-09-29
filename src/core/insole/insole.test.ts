import { beforeAll, describe, expect, it } from 'vitest';
import { closedFoot, plantarScan } from '../fixtures/footShapes';
import { analyzeMesh } from '../mesh/analyze';
import { findBoundaryLoops } from '../mesh/holes';
import { signedVolume } from '../mesh/normals';
import { generateInsole, samplePlantarSurface, type PlantarSurface } from './generate';
import { defaultInsoleParams, insoleLengthMm, suggestShoeSize, type InsoleParams } from './params';
import { frameToWorld } from './frame';
import type { MeshData } from '../types';

const LANDMARKS = { heelCentre: [4, 38, 0.2], met1Head: [-26, 182, 0.3], met5Head: [44, 165, 0.3] } as const;

/** Highest top-surface z of the mesh near a point (x, y) (world). */
function topZ(mesh: MeshData, x: number, y: number, r = 2.5): number {
  let best = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    if (Math.hypot(mesh.positions[i] - x, mesh.positions[i + 1] - y) < r) best = Math.max(best, mesh.positions[i + 2]);
  }
  return best;
}
function lowZ(mesh: MeshData, x: number, y: number, r = 2.5): number {
  let best = Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    if (Math.hypot(mesh.positions[i] - x, mesh.positions[i + 1] - y) < r) best = Math.min(best, mesh.positions[i + 2]);
  }
  return best;
}

describe('insole generator', () => {
  let surface: PlantarSurface;
  const gen = (fn: (p: InsoleParams) => void = () => {}) => {
    const p = defaultInsoleParams(8);
    fn(p);
    return generateInsole(surface, p);
  };
  const world = (a: number, b: number) => frameToWorld(surface.frame, a, b);

  beforeAll(() => {
    const foot = closedFoot(3);
    surface = samplePlantarSurface(foot.positions, foot.indices, {
      heelCentre: [...LANDMARKS.heelCentre], met1Head: [...LANDMARKS.met1Head], met5Head: [...LANDMARKS.met5Head],
    });
  });

  it('measures the foot and suggests a shoe size', () => {
    expect(surface.footLength).toBeGreaterThan(240);
    expect(surface.footLength).toBeLessThan(260);
    expect(insoleLengthMm(8)).toBeCloseTo(274.4, 1);
    expect(suggestShoeSize(250)).toBe(6);
  });

  it('builds a closed, outward-facing insole of the shoe-size length with the padding thickness', () => {
    const r = gen();
    const s = analyzeMesh(r.mesh);
    expect(s.watertight).toBe(true);
    expect(signedVolume(r.mesh)).toBeGreaterThan(0);
    expect(r.minThickness).toBeCloseTo(2.5, 3);
    expect(r.maxThickness).toBeCloseTo(2.5, 3);
    // length along the foot axis ≈ size length
    const b = s.bounds;
    expect(Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1])).toBeGreaterThan(r.length * 0.97);
    expect(b.max[1] - b.min[1]).toBeGreaterThan(r.length * 0.95);
  });

  it('narrow profile and padding thickness', () => {
    expect(gen((p) => (p.narrowProfile = true)).width).toBeLessThan(gen().width * 0.93);
    const thick = gen((p) => (p.paddingThickness = 4));
    expect(thick.maxThickness).toBeCloseTo(4, 3);
  });

  it('medial arch pressure raises the insole under the arch', () => {
    const [x, y] = world(-15, 75);
    expect(topZ(gen((p) => (p.medialArchPressure = 10)).mesh, x, y)).toBeGreaterThan(topZ(gen().mesh, x, y) + 6);
    expect(topZ(gen((p) => (p.medialArchPressure = -10)).mesh, x, y)).toBeLessThan(topZ(gen().mesh, x, y) - 6);
  });

  it('MT pad, MT bar and fascia groove change the top surface where expected', () => {
    const f = surface.frame;
    const pad = world(f.met1[0] + 0.4 * (f.met5[0] - f.met1[0]), f.met1[1] + 0.4 * (f.met5[1] - f.met1[1]) - 12);
    expect(topZ(gen((p) => (p.mtPad = { enabled: true, height: 5 })).mesh, ...pad) - topZ(gen().mesh, ...pad)).toBeCloseTo(5, 0);
    const bar = world((f.met1[0] + f.met5[0]) / 2, (f.met1[1] + f.met5[1]) / 2 - 10);
    expect(topZ(gen((p) => (p.mtBar = { enabled: true, thickness: 4 })).mesh, ...bar) - topZ(gen().mesh, ...bar)).toBeGreaterThan(3);
    const groove = world(-7.7, 45); // on the heel → 1st/2nd ray line
    const withGroove = gen((p) => (p.fasciaGroove = { enabled: true, depth: 3 }));
    expect(topZ(gen().mesh, ...groove, 1.2) - topZ(withGroove.mesh, ...groove, 1.2)).toBeGreaterThan(1.5);
    expect(withGroove.minThickness).toBeGreaterThanOrEqual(0.8 - 1e-6);
  });

  it('medial wedge raises the medial side more than the lateral side', () => {
    const w = gen((p) => (p.wedge = { enabled: true, type: 'full', side: 'medial', angleDeg: 5 }));
    const base = gen();
    const med = world(-25, 120), lat = world(30, 120);
    const dMed = topZ(w.mesh, ...med) - topZ(base.mesh, ...med);
    const dLat = topZ(w.mesh, ...lat) - topZ(base.mesh, ...lat);
    expect(dMed).toBeGreaterThan(dLat + 3);
    // heel wedge leaves the forefoot alone
    const heelW = gen((p) => (p.wedge = { enabled: true, type: 'heel', side: 'medial', angleDeg: 5 }));
    const fore = world(-20, 170);
    expect(Math.abs(topZ(heelW.mesh, ...fore) - topZ(base.mesh, ...fore))).toBeLessThan(0.2);
  });

  it('heel cup height sets the rim height', () => {
    const low = gen((p) => (p.heelCupHeight = 6));
    const high = gen((p) => (p.heelCupHeight = 24));
    const rim = world(0, surface.heelBack! + 1.5);
    expect(topZ(high.mesh, ...rim, 2) - topZ(low.mesh, ...rim, 2)).toBeGreaterThan(14);
    expect(topZ(high.mesh, ...rim, 2)).toBeGreaterThan(18);
  });

  it('orthosis: 3/4 length, flat filled rearfoot, heel post, Morton’s extension, offloads and heel hole', () => {
    const insole = gen();
    const orth = gen((p) => (p.orthosis.enabled = true));
    const s = analyzeMesh(orth.mesh);
    expect(s.watertight).toBe(true);
    expect(orth.kind).toBe('orthosis');
    // 3/4 length: nothing near the toes
    const toe = world(0, 200);
    expect(topZ(orth.mesh, ...toe, 4)).toBe(-Infinity);
    expect(topZ(insole.mesh, ...toe, 4)).toBeGreaterThan(-Infinity);
    // Morton's extension brings back the medial forefoot only
    const mort = gen((p) => { p.orthosis.enabled = true; p.orthosis.mortonsExtension = 'mortons'; });
    const f = surface.frame;
    expect(topZ(mort.mesh, ...world(f.met1[0] + 4, f.met1[1] + 25), 4)).toBeGreaterThan(-Infinity);
    expect(topZ(mort.mesh, ...world(f.met5[0] - 5, f.met5[1] + 25), 4)).toBe(-Infinity);
    // heel post height lowers the underside at the heel
    const post = gen((p) => { p.orthosis.enabled = true; p.orthosis.heelHeight = 6; });
    expect(lowZ(orth.mesh, ...world(0, 0)) - lowZ(post.mesh, ...world(0, 0))).toBeCloseTo(6, 0);
    // heel raise lifts the heel top surface
    const raise = gen((p) => { p.orthosis.enabled = true; p.orthosis.heelRaise = 8; });
    expect(topZ(raise.mesh, ...world(0, 0)) - topZ(orth.mesh, ...world(0, 0))).toBeCloseTo(8, 0);
    // footplate thickness is the minimum thickness
    expect(gen((p) => { p.orthosis.enabled = true; p.orthosis.footplateThickness = 4; }).minThickness).toBeCloseTo(4, 3);
    // heel hole → an extra boundary-free tunnel: the heel centre has no material
    const hole = gen((p) => { p.orthosis.enabled = true; p.orthosis.holeInHeel = true; });
    expect(topZ(hole.mesh, ...world(0, 0), 5)).toBe(-Infinity);
    expect(analyzeMesh(hole.mesh).watertight).toBe(true);
    expect(findBoundaryLoops(hole.mesh).length).toBe(0);
    // offload aperture under MT-1 (with Morton's extension so the forefoot exists there)
    const off = gen((p) => { p.orthosis.enabled = true; p.orthosis.mortonsExtension = 'mortons'; p.orthosis.provideOffloads = true; p.orthosis.offloads = ['MT-1']; });
    expect(topZ(off.mesh, ...world(f.met1[0], f.met1[1] - 3), 4)).toBe(-Infinity);
  });

  it('works on an open plantar-sheet scan', () => {
    const sheet = plantarScan();
    const surf = samplePlantarSurface(sheet.positions, sheet.indices, {
      heelCentre: [...LANDMARKS.heelCentre], met1Head: [...LANDMARKS.met1Head], met5Head: [...LANDMARKS.met5Head],
    });
    const r = generateInsole(surf, defaultInsoleParams(7));
    expect(analyzeMesh(r.mesh).watertight).toBe(true);
    expect(r.maxThickness).toBeCloseTo(2.5, 3);
  });
});
