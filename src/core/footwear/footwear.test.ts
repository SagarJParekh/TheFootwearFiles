import { beforeAll, describe, expect, it } from 'vitest';
import { closedFoot, plantarScan } from '../fixtures/footShapes';
import { samplePlantarSurface } from '../insole/generate';
import { worldToFrame } from '../insole/frame';
import { analyzeMesh } from '../mesh/analyze';
import { footProbe, generateFootwear, prepareFootData, type FootData, type FootwearResult } from './generate';
import { conformalLattice, latticeToMesh } from './lattice';
import { sphericalDilate, sphericalErode, signedDistance } from './fields';
import { defaultFootwearParams, FOOTWEAR_RULES, normalizeFootwearParams, type FootwearParams } from './params';
import type { Grid } from '../insole/heightfield';

const LM = { heelCentre: [4, 38, 0.2], met1Head: [-26, 182, 0.3], met5Head: [44, 165, 0.3] } as const;
const landmarks = () => ({ heelCentre: [...LM.heelCentre] as [number, number, number], met1Head: [...LM.met1Head] as [number, number, number], met5Head: [...LM.met5Head] as [number, number, number] });

/** Smallest gap (mm) between any part of the footwear and the foot scan, excluding the toe post. */
function minGap(foot: FootData, r: FootwearResult, skipSolid = -1): number {
  const probe = footProbe(foot);
  let lo = Infinity;
  r.parts.solids.forEach((m, si) => {
    if (si === skipSolid) return;
    for (let i = 0; i < m.positions.length; i += 6) lo = Math.min(lo, probe(m.positions[i], m.positions[i + 1], m.positions[i + 2]).gap);
  });
  const l = r.parts.lattice;
  const nodeR = new Float32Array(l.nodes.length / 3);
  l.edges.forEach((v, i) => (nodeR[v] = Math.max(nodeR[v], l.radii[i >> 1])));
  for (let v = 0; v < nodeR.length; v++) if (nodeR[v] > 0) lo = Math.min(lo, probe(l.nodes[3 * v], l.nodes[3 * v + 1], l.nodes[3 * v + 2]).gap - nodeR[v]);
  return lo;
}

describe('footwear fields', () => {
  const g: Grid = { a0: -20, b0: -20, h: 1, nx: 41, ny: 41 };
  it('spherical dilation/erosion offset a plane exactly and a step along its normal', () => {
    const flat = new Float32Array(g.nx * g.ny).fill(5);
    expect(sphericalDilate(flat, g, 2)[20 * 41 + 20]).toBeCloseTo(7, 5);
    expect(sphericalErode(flat, g, 2)[20 * 41 + 20]).toBeCloseTo(3, 5);
    // a single raised node dilates into a hemisphere of radius r
    const spike = new Float32Array(g.nx * g.ny).fill(NaN);
    spike[20 * 41 + 20] = 0;
    const d = sphericalDilate(spike, g, 3);
    expect(d[20 * 41 + 20]).toBeCloseTo(3, 5);
    expect(d[20 * 41 + 23]).toBeCloseTo(0, 5);
    expect(Number.isNaN(d[20 * 41 + 24])).toBe(true);
  });
  it('signed distance of a disc', () => {
    const mask = new Uint8Array(g.nx * g.ny);
    for (let j = 0; j < 41; j++) for (let i = 0; i < 41; i++) if (Math.hypot(i - 20, j - 20) <= 10) mask[j * 41 + i] = 1;
    const sd = signedDistance(mask, g);
    expect(sd[20 * 41 + 20]).toBeLessThan(-9);
    expect(sd[20 * 41 + 35]).toBeGreaterThan(4);
    expect(sd[20 * 41 + 35]).toBeLessThan(5.5);
  });
});

describe('lattice', () => {
  it('conformal lattice fills the layer between two surfaces with struts of the given radius', () => {
    const g: Grid = { a0: 0, b0: 0, h: 1, nx: 61, ny: 61 };
    const lower = new Float32Array(61 * 61).fill(0), upper = new Float32Array(61 * 61).fill(12);
    const l = conformalLattice({ grid: g, lower, upper, inside: (a, b) => a > 5 && a < 55 && b > 5 && b < 55, cell: 6, radius: 0.75, layers: 2, toWorld: (a, b, z) => [a, b, z] });
    expect(l.edges.length / 2).toBeGreaterThan(300);
    expect(new Set(l.radii)).toEqual(new Set([0.75]));
    let zMax = -Infinity, zMin = Infinity;
    for (let v = 0; v < l.nodes.length / 3; v++) {
      zMax = Math.max(zMax, l.nodes[3 * v + 2]);
      zMin = Math.min(zMin, l.nodes[3 * v + 2]);
    }
    expect(zMax).toBeCloseTo(12, 5); // top layer centres on `upper`
    expect(zMin).toBeCloseTo(0, 5);
    // every node of the upper layers is connected down (tetrahedral cells)
    const deg = new Uint16Array(l.nodes.length / 3);
    for (const v of l.edges) deg[v]++;
    for (const v of l.topNodes) expect(deg[v]).toBeGreaterThanOrEqual(3);
    // each strut is a closed prism
    const m = latticeToMesh({ nodes: [0, 0, 0, 10, 0, 0], edges: [0, 1], radii: [0.75] }, 6, false);
    expect(analyzeMesh(m).watertight).toBe(true);
  });
});

describe('footwear generator', () => {
  let foot: FootData;
  const gen = (fn: (p: FootwearParams) => void = () => {}, kind: FootwearParams['kind'] = 'chappal') => {
    const p = defaultFootwearParams(6, kind);
    fn(p);
    return generateFootwear(foot, p);
  };

  beforeAll(() => {
    const m = closedFoot(3);
    foot = prepareFootData(samplePlantarSurface(m.positions, m.indices, landmarks()), m.positions, m.indices);
  });

  it('design rules: parameters are forced into 1.2–1.8 mm struts and 1–2 mm clearance', () => {
    const p = normalizeFootwearParams({ strutDiameter: 2.5, clearance: 0.2, kind: 'shoe' });
    expect(p.strutDiameter).toBe(FOOTWEAR_RULES.strutDiameter.max);
    expect(p.clearance).toBe(FOOTWEAR_RULES.clearance.min);
    expect(normalizeFootwearParams({ strutDiameter: 1 }).strutDiameter).toBe(1.2);
    expect(normalizeFootwearParams({ clearance: 3 }).clearance).toBe(2);
    expect(p.kind).toBe('shoe');
  });

  it('slide chappal: lattice footbed, solid outsole/rim/strap, rules met and measured on the result', () => {
    const r = gen();
    expect(r.kind).toBe('chappal');
    expect(r.parts.solids).toHaveLength(3); // outsole, rim wall, strap
    for (const s of r.parts.solids) expect(analyzeMesh(s).watertight).toBe(true);
    expect(r.strutCount).toBeGreaterThan(2000);
    expect(r.strut).toEqual({ min: 1.5, max: 1.5 });
    expect(r.rules.every((x) => x.ok)).toBe(true);
    const gap = minGap(foot, r);
    expect(gap).toBeGreaterThanOrEqual(FOOTWEAR_RULES.clearance.min);
    expect(r.clearance.min).toBeGreaterThan(1.45); // = the 1.5 mm setting, measured
    expect(r.clearance.max).toBeLessThan(1.6);
    expect(r.clearance.min).toBeCloseTo(gap, 1);
    expect(r.clearance.max).toBeLessThanOrEqual(FOOTWEAR_RULES.clearance.max);
    // longer than the foot (toe allowance) and fitted to it
    expect(r.length).toBeGreaterThan(255);
    expect(r.length).toBeLessThan(290);
  });

  it('strut diameter and clearance follow the settings at both ends of the rule ranges', () => {
    for (const [d, c] of [[1.2, 1], [1.8, 2]] as const) {
      const r = gen((p) => { p.strutDiameter = d; p.clearance = c; });
      expect(r.strut.min).toBeCloseTo(d, 6);
      expect(r.strut.max).toBeCloseTo(d, 6);
      expect(r.clearance.min).toBeGreaterThan(c - 0.05);
      expect(r.clearance.max).toBeLessThan(c + 0.1);
      expect(r.rules.every((x) => x.ok)).toBe(true);
    }
    // the footbed moves down with a larger clearance
    const zTop = (r: FootwearResult) => {
      let z = -Infinity;
      for (let v = 0; v < r.parts.lattice.nodes.length / 3; v++) {
        const [a, b] = worldToFrame(foot.surface.frame, r.parts.lattice.nodes[3 * v], r.parts.lattice.nodes[3 * v + 1]);
        if (Math.hypot(a, b - 10) < 6) z = Math.max(z, r.parts.lattice.nodes[3 * v + 2]);
      }
      return z;
    };
    expect(zTop(gen((p) => (p.clearance = 1))) - zTop(gen((p) => (p.clearance = 2)))).toBeCloseTo(1, 1);
  });

  it('thong and split-toe: Y-strap and toe post; split-toe slots the sole between the 1st and 2nd toes', () => {
    const thong = gen((p) => (p.chappalStyle = 'thong'));
    expect(thong.parts.solids).toHaveLength(4); // + toe post
    expect(minGap(foot, thong, 3)).toBeGreaterThanOrEqual(1 - 0.03);
    // the synthetic foot has no gap between the toes: the post is reported, not hidden
    expect(thong.warnings.some((w) => /toe post/.test(w))).toBe(true);
    const split = gen((p) => (p.chappalStyle = 'splitToe'));
    expect(split.toePost).toEqual(thong.toePost);
    // Outsole material near points on the line from just in front of the toe post to the toe tip.
    const f = foot.surface.frame;
    const [pa, pb] = split.toePost!;
    const nearSlot = (r: FootwearResult) => {
      const P = r.parts.solids[0].positions;
      let n = 0;
      for (let i = 0; i < P.length; i += 3) {
        const [a, b] = worldToFrame(f, P[i], P[i + 1]);
        const axisA = pa + ((pa - f.met1[0]) * 0.1 * (b - pb - 4)) / 146; // slot axis (see generate)
        if (b > pb + 8 && b < pb + 30 && Math.abs(a - axisA) < 1.2) n++;
      }
      return n;
    };
    expect(nearSlot(thong)).toBeGreaterThan(20);
    expect(nearSlot(split)).toBe(0);
    expect(minGap(foot, split, 3)).toBeGreaterThanOrEqual(1 - 0.03);
  });

  it('shoe: lattice upper fitted to the foot with a collar opening, lattice side wall, rules met', () => {
    const r = gen(() => {}, 'shoe');
    expect(r.kind).toBe('shoe');
    expect(r.parts.solids).toHaveLength(1); // outsole only – side wall and upper are lattice
    expect(r.strutCount).toBeGreaterThan(gen().strutCount);
    expect(r.rules.every((x) => x.ok)).toBe(true);
    expect(minGap(foot, r)).toBeGreaterThanOrEqual(1 - 0.01);
    // upper reaches over the forefoot dorsum, but not over the ankle (collar opening)
    const l = r.parts.lattice, f = foot.surface.frame;
    let foreTop = -Infinity, heelTop = -Infinity;
    for (let v = 0; v < l.nodes.length / 3; v++) {
      const [a, b] = worldToFrame(f, l.nodes[3 * v], l.nodes[3 * v + 1]);
      if (Math.abs(a) < 15 && b > 150 && b < 170) foreTop = Math.max(foreTop, l.nodes[3 * v + 2]);
      if (Math.abs(a) < 15 && b > 10 && b < 60) heelTop = Math.max(heelTop, l.nodes[3 * v + 2]);
    }
    expect(foreTop).toBeGreaterThan(35); // over the dorsum of the forefoot
    expect(heelTop).toBeLessThan(35); // opening over the heel/ankle: nothing above the footbed there
  });

  it('solid side wall option and tread', () => {
    const solid = gen((p) => (p.sideWall = 'solid'), 'shoe');
    expect(solid.parts.solids).toHaveLength(2);
    const flat = gen((p) => (p.tread = 'none'));
    const hex = gen((p) => (p.tread = 'hexagon'));
    const zMin = (r: FootwearResult) => analyzeMesh(r.parts.solids[0]).bounds.min[2];
    expect(zMin(hex)).toBeCloseTo(zMin(flat), 4); // grooves go up into the sole, the base stays flat
  });

  it('scans without the top of the foot: sole only, with a warning', () => {
    const m = plantarScan();
    const f = prepareFootData(samplePlantarSurface(m.positions, m.indices, landmarks()), m.positions, m.indices);
    expect(f.hasDorsum).toBe(false);
    const r = generateFootwear(f, defaultFootwearParams(6, 'chappal'));
    expect(r.parts.solids).toHaveLength(2);
    expect(r.warnings.join(' ')).toMatch(/top of the foot/);
  });
});
