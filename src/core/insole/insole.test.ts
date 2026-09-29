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

  it('builds a closed, outward-facing insole of the shoe-size length', () => {
    const r = gen();
    const s = analyzeMesh(r.mesh);
    expect(s.watertight).toBe(true);
    expect(signedVolume(r.mesh)).toBeGreaterThan(0);
    // length along the foot axis ≈ size length
    const b = s.bounds;
    expect(Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1])).toBeGreaterThan(r.length * 0.97);
    expect(b.max[1] - b.min[1]).toBeGreaterThan(r.length * 0.95);
  });

  it('full-length insole is completely flat from the M1–M5 line forward', () => {
    const f = surface.frame;
    const mesh = gen().mesh;
    // distance distal of the M1→M5 line, in frame coords
    const dA = f.met5[0] - f.met1[0], dB = f.met5[1] - f.met1[1];
    const len = Math.hypot(dA, dB);
    let nA = -dB / len, nB = dA / len;
    if (nB < 0) [nA, nB] = [-nA, -nB];
    const [ox, oy] = surface.frame.origin, [ux, uy] = surface.frame.u, [vx, vy] = surface.frame.v;
    const tops: number[] = [];
    const p = mesh.positions;
    for (let i = 0; i < p.length / 2; i += 3) {
      // top-surface vertices are stored first (first half of the vertex array)
      const x = p[i] - ox, y = p[i + 1] - oy;
      const a = x * ux + y * uy, b = x * vx + y * vy;
      if ((a - f.met1[0]) * nA + (b - f.met1[1]) * nB > 0.5) tops.push(p[i + 2]);
    }
    expect(tops.length).toBeGreaterThan(500);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1e-3);
  });

  it('padding clearance leaves a gap between the foot and the insole top', () => {
    const [x, y] = world(12, 70); // midfoot, away from features and the heel cup
    const i = Math.round((12 - surface.grid.a0) / surface.grid.h), j = Math.round((70 - surface.grid.b0) / surface.grid.h);
    const footZ = surface.z[j * surface.grid.nx + i];
    const noGap = gen((p) => (p.paddingClearance = 0));
    const gap3 = gen((p) => (p.paddingClearance = 3));
    expect(topZ(noGap.mesh, x, y, 1.2)).toBeCloseTo(footZ, 0);
    expect(topZ(noGap.mesh, x, y, 1.2) - topZ(gap3.mesh, x, y, 1.2)).toBeCloseTo(3, 1);
  });

  it('full length (FDM) has one completely flat base with the set minimum thickness', () => {
    const r = gen((p) => (p.full.baseThickness = 2.4));
    expect(r.kind).toBe('full');
    const pz = r.mesh.positions;
    const bottoms: number[] = [];
    for (let i = pz.length / 2; i < pz.length; i += 3) bottoms.push(pz[i + 2]); // bottom copy = 2nd half
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(1e-4);
    expect(bottoms[0]).toBeCloseTo(r.baseZ!, 4);
    expect(r.minThickness).toBeCloseTo(2.4, 3);
    expect(analyzeMesh(r.mesh).bounds.min[2]).toBeCloseTo(r.baseZ!, 4);
  });

  it('narrow profile', () => {
    expect(gen((p) => (p.narrowProfile = true)).width).toBeLessThan(gen().width * 0.93);
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

  it('3/4 length (powder): uniform shell thickness 2–4 mm, heel post, Morton’s extension, offloads and heel hole', () => {
    const tq = (fn: (p: InsoleParams) => void = () => {}) => gen((p) => { p.type = 'threeQuarter'; fn(p); });
    const full = gen();
    const shell = tq();
    expect(analyzeMesh(shell.mesh).watertight).toBe(true);
    expect(shell.kind).toBe('threeQuarter');
    expect(shell.minThickness).toBeCloseTo(2.5, 3);
    expect(shell.maxThickness).toBeCloseTo(2.5, 3);
    const thick = tq((p) => (p.threeQuarter.thickness = 4));
    expect(thick.minThickness).toBeCloseTo(4, 3);
    expect(thick.maxThickness).toBeCloseTo(4, 3);
    // 3/4 length: nothing near the toes
    const toe = world(0, 200);
    expect(topZ(shell.mesh, ...toe, 4)).toBe(-Infinity);
    expect(topZ(full.mesh, ...toe, 4)).toBeGreaterThan(-Infinity);
    // Morton's extension brings back the medial forefoot only
    const mort = tq((p) => (p.threeQuarter.mortonsExtension = 'mortons'));
    const f = surface.frame;
    expect(topZ(mort.mesh, ...world(f.met1[0] + 4, f.met1[1] + 25), 4)).toBeGreaterThan(-Infinity);
    expect(topZ(mort.mesh, ...world(f.met5[0] - 5, f.met5[1] + 25), 4)).toBe(-Infinity);
    // heel post lowers the underside at the heel
    const post = tq((p) => (p.threeQuarter.heelHeight = 6));
    expect(lowZ(shell.mesh, ...world(0, 0)) - lowZ(post.mesh, ...world(0, 0))).toBeGreaterThan(5.5);
    // heel raise lifts the heel top surface
    const raise = tq((p) => (p.threeQuarter.heelRaise = 8));
    expect(topZ(raise.mesh, ...world(0, 0)) - topZ(shell.mesh, ...world(0, 0))).toBeCloseTo(8, 0);
    // heel hole and offload aperture
    const hole = tq((p) => (p.threeQuarter.holeInHeel = true));
    expect(topZ(hole.mesh, ...world(0, 0), 5)).toBe(-Infinity);
    expect(analyzeMesh(hole.mesh).watertight).toBe(true);
    expect(findBoundaryLoops(hole.mesh).length).toBe(0);
    const off = tq((p) => { p.threeQuarter.mortonsExtension = 'mortons'; p.threeQuarter.provideOffloads = true; p.threeQuarter.offloads = ['MT-1']; });
    expect(topZ(off.mesh, ...world(f.met1[0], f.met1[1] - 3), 4)).toBe(-Infinity);
  });

  it('works on an open plantar-sheet scan', () => {
    const sheet = plantarScan();
    const surf = samplePlantarSurface(sheet.positions, sheet.indices, {
      heelCentre: [...LANDMARKS.heelCentre], met1Head: [...LANDMARKS.met1Head], met5Head: [...LANDMARKS.met5Head],
    });
    const r = generateInsole(surf, defaultInsoleParams(7));
    expect(analyzeMesh(r.mesh).watertight).toBe(true);
  });
});
