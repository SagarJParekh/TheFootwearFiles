import { beforeAll, describe, expect, it } from 'vitest';
import { closedFoot, lowerLimbScan, plantarScan } from '../fixtures/footShapes';
import { samplePlantarSurface } from '../insole/generate';
import { worldToFrame } from '../insole/frame';
import { analyzeMesh } from '../mesh/analyze';
import { footProbe, fuseFootwearSolids, generateFootwear, prepareFootData, type FootData, type FootwearResult } from './generate';
import { signedVolume } from '../mesh/normals';
import { conformalLattice, latticeToMesh } from './lattice';
import { sphericalDilate, sphericalErode, signedDistance } from './fields';
import { defaultFootwearParams, FOOTWEAR_RULES, normalizeFootwearParams, REFERENCE_DESIGNS, type DesignId, type FootwearParams } from './params';
import type { Grid } from '../insole/heightfield';
import { makeMesh } from '../types';

const LM = { heelCentre: [4, 38, 0.2], met1Head: [-26, 182, 0.3], met5Head: [44, 165, 0.3] } as const;
const landmarks = () => ({ heelCentre: [...LM.heelCentre] as [number, number, number], met1Head: [...LM.met1Head] as [number, number, number], met5Head: [...LM.met5Head] as [number, number, number] });

/** Closed and consistently wound: every directed edge once, and its reverse once (what manifold-3d needs). */
function consistent(m: { indices: Uint32Array }): boolean {
  const dir = new Set<string>();
  for (let t = 0; t < m.indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const k = `${m.indices[t + e]},${m.indices[t + ((e + 1) % 3)]}`;
      if (dir.has(k)) return false;
      dir.add(k);
    }
  for (const k of dir) {
    const [a, b] = k.split(',');
    if (!dir.has(`${b},${a}`)) return false;
  }
  return true;
}

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

  it('slide chappal: contoured lattice footbed in a standard sole, smooth band strap, rules met and measured', () => {
    const r = gen();
    expect(r.kind).toBe('chappal');
    expect(r.parts.solids).toHaveLength(3); // outsole, rim wall, strap
    for (const s of r.parts.solids) expect(analyzeMesh(s).watertight && consistent(s)).toBe(true);
    expect(r.strutCount).toBeGreaterThan(2000);
    expect(r.strut).toEqual({ min: 1.5, max: 1.5 });
    expect(r.rules.every((x) => x.ok)).toBe(true);
    // the footbed (the only contoured part) sits at the 1.5 mm setting; nothing is closer than 1 mm
    expect(r.clearance.min).toBeGreaterThan(1.45);
    expect(r.clearance.max).toBeLessThan(1.6);
    expect(minGap(foot, r)).toBeGreaterThanOrEqual(FOOTWEAR_RULES.clearance.min - 0.03);
    expect(r.minGap).toBeGreaterThanOrEqual(FOOTWEAR_RULES.clearance.min - 0.03);
    // the strap is a standard shape around the foot, not a copy of it: one arch height along it
    expect(r.upperGap!.min).toBeGreaterThanOrEqual(1 - 0.03);
    const strap = r.parts.solids[2].positions, f = foot.surface.frame;
    const topIn = (lo: number, hi: number) => {
      let z = -Infinity;
      for (let i = 0; i < strap.length; i += 3) {
        const b = worldToFrame(f, strap[i], strap[i + 1])[1];
        if (b >= lo && b <= hi) z = Math.max(z, strap[i + 2]);
      }
      return z;
    };
    let bLo = Infinity, bHi = -Infinity;
    for (let i = 0; i < strap.length; i += 3) {
      const b = worldToFrame(f, strap[i], strap[i + 1])[1];
      bLo = Math.min(bLo, b);
      bHi = Math.max(bHi, b);
    }
    const third = (bHi - bLo) / 3;
    // (it stands on the rim line, which falls gently towards the toes)
    expect(Math.abs(topIn(bLo + 0.2 * third, bLo + third) - topIn(bHi - third, bHi - 0.2 * third))).toBeLessThan(4);
    // standard sole outline: longer than the foot (toe allowance) and wider than it, not a copy
    const sole = analyzeMesh(r.parts.solids[0]).bounds, footB = analyzeMesh(makeMesh(foot.probePositions, foot.probeIndices)).bounds;
    expect(r.length).toBeGreaterThan(255);
    expect(r.length).toBeLessThan(300);
    expect(sole.max[0] - sole.min[0]).toBeGreaterThan(footB.max[0] - footB.min[0]);
  });

  it('smooth footbed skin option: a solid contoured footbed at the clearance over the lattice', () => {
    const r = gen((p) => { p.footbedSkin = true; p.clearance = 2; });
    expect(r.parts.solids).toHaveLength(4); // + skin
    expect(analyzeMesh(r.parts.solids[3]).watertight).toBe(true);
    expect(r.rules.every((x) => x.ok)).toBe(true);
    expect(r.clearance.min).toBeGreaterThan(1.9);
    expect(r.clearance.max).toBeLessThan(2.1);
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

  it('thong and split-toe: wide wings, a ridge and a toe post; split-toe slots the sole between the 1st and 2nd toes', () => {
    const thong = gen((p) => (p.chappalStyle = 'thong'));
    expect(thong.parts.solids).toHaveLength(5); // outsole, rim, wings, ridge, post
    for (const s of thong.parts.solids) expect(analyzeMesh(s).watertight && consistent(s)).toBe(true);
    expect(minGap(foot, thong, 4)).toBeGreaterThanOrEqual(1 - 0.03);
    // the wings come down onto the sole, inside its outline
    const sole = analyzeMesh(thong.parts.solids[0]).bounds;
    const wings = analyzeMesh(thong.parts.solids[2]).bounds;
    expect(wings.min[0]).toBeGreaterThanOrEqual(sole.min[0] - 1);
    expect(wings.max[0]).toBeLessThanOrEqual(sole.max[0] + 1);
    // …and leave a window over the sole in front of them: low down, they end well before the
    // front of the wings on top
    const f0 = foot.surface.frame, W = thong.parts.solids[2].positions;
    let zLow = Infinity, bLowMax = -Infinity, bTopMax = -Infinity;
    for (let k = 2; k < W.length; k += 3) zLow = Math.min(zLow, W[k]);
    for (let k = 0; k < W.length; k += 3) {
      const b = worldToFrame(f0, W[k], W[k + 1])[1];
      if (W[k + 2] < zLow + 5) bLowMax = Math.max(bLowMax, b);
      bTopMax = Math.max(bTopMax, b);
    }
    expect(bTopMax - bLowMax).toBeGreaterThan(12);
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
    expect(minGap(foot, split, 4)).toBeGreaterThanOrEqual(1 - 0.03);
  });

  it('shoe, solid design: one smooth closed body around the foot – snug heel, closed toe and heel, ankle opening', () => {
    const r = gen(() => {}, 'shoe');
    expect(r.kind).toBe('shoe');
    expect(r.parts.solids).toHaveLength(1); // upper, midsole and sole are ONE piece
    expect(r.strutCount).toBe(0); // (lattice only as the finish)
    const body = r.parts.solids[0];
    expect(analyzeMesh(body).watertight && consistent(body)).toBe(true);
    expect(r.rules.every((x) => x.ok), r.rules.map((x) => `${x.rule}: ${x.value}`).join(' | ')).toBe(true);
    expect(minGap(foot, r)).toBeGreaterThanOrEqual(1 - 0.1);
    const f = foot.surface.frame, P = body.positions;
    const topIn = (bLo: number, bHi: number, aMax = 15) => {
      let z = -Infinity;
      for (let i = 0; i < P.length; i += 3) {
        const [a, b] = worldToFrame(f, P[i], P[i + 1]);
        if (Math.abs(a) < aMax && b > bLo && b < bHi) z = Math.max(z, P[i + 2]);
      }
      return z;
    };
    expect(topIn(150, 170)).toBeGreaterThan(35); // closed over the forefoot dorsum
    expect(topIn(10, 40, 8)).toBeLessThan(topIn(150, 170) + 30); // the ankle opening (no lid over the heel)
    // closed at the toe and the heel: material in front of the toes and behind the heel, at mid height
    const probe = footProbe(foot);
    let front = 0, back = 0, heelGap = Infinity, bMax = -Infinity;
    for (let i = 0; i < P.length; i += 3) bMax = Math.max(bMax, worldToFrame(f, P[i], P[i + 1])[1]);
    for (let i = 0; i < P.length; i += 3) {
      const [a, b] = worldToFrame(f, P[i], P[i + 1]);
      if (Math.abs(a) > 10 || P[i + 2] < 12 || P[i + 2] > 30) continue;
      if (b > bMax - 12) front++;
      if (b < 0) {
        back++;
        heelGap = Math.min(heelGap, probe(P[i], P[i + 1], P[i + 2]).gap);
      }
    }
    expect(front).toBeGreaterThan(10);
    expect(back).toBeGreaterThan(10);
    // snug heel: the inside of the heel counter is close to the foot (clearance + a little)
    expect(heelGap).toBeLessThan(1.5 + 3);
  });

  it('shoe, lattice finish: double-skin lattice over the whole upper, solid bands, rules met', () => {
    const r = gen((p) => (p.shoe.finish = 'lattice'), 'shoe');
    expect(r.parts.solids).toHaveLength(1); // the solid bands: outsole, sole side wall, collar rim
    expect(analyzeMesh(r.parts.solids[0]).watertight).toBe(true);
    expect(r.strutCount).toBeGreaterThan(gen().strutCount); // midsole + upper lattice
    expect(r.strut).toEqual({ min: 1.5, max: 1.5 });
    expect(r.rules.every((x) => x.ok), r.rules.map((x) => `${x.rule}: ${x.value}`).join(' | ')).toBe(true);
    expect(minGap(foot, r)).toBeGreaterThanOrEqual(1 - 0.1);
    // the lattice covers the toe and the heel (no open ends) and has two skins
    const l = r.parts.lattice, f = foot.surface.frame;
    let toe = 0, heel = 0, bMax = -Infinity;
    const zs: number[] = [];
    for (let v = 0; v < l.nodes.length / 3; v++) bMax = Math.max(bMax, worldToFrame(f, l.nodes[3 * v], l.nodes[3 * v + 1])[1]);
    for (let v = 0; v < l.nodes.length / 3; v++) {
      const [a, b] = worldToFrame(f, l.nodes[3 * v], l.nodes[3 * v + 1]);
      const z = l.nodes[3 * v + 2];
      if (Math.abs(a) < 12 && b > bMax - 15 && z > 12) toe++;
      if (Math.abs(a) < 12 && b < 5 && z > 20) heel++;
      if (Math.abs(a) < 8 && b > 150 && b < 170 && z > 35) zs.push(z);
    }
    expect(toe).toBeGreaterThan(5);
    expect(heel).toBeGreaterThan(5);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(2);
  });

  it('side wall options and tread', () => {
    const solid = gen((p) => { p.sideWall = 'solid'; p.shoe.finish = 'lattice'; }, 'shoe');
    const cageShoe = gen((p) => { p.sideWall = 'lattice'; p.shoe.finish = 'lattice'; }, 'shoe');
    expect(solid.rules.every((x) => x.ok)).toBe(true);
    // a solid side wall is more solid band and fewer upper struts than a lattice one
    expect(signedVolume(solid.parts.solids[0])).toBeGreaterThan(signedVolume(cageShoe.parts.solids[0]));
    expect(solid.strutCount).toBeLessThan(cageShoe.strutCount);
    const cage = gen((p) => (p.sideWall = 'lattice'));
    expect(cage.parts.solids).toHaveLength(2); // outsole + strap
    expect(cage.rules.every((x) => x.ok)).toBe(true);
    const flat = gen((p) => (p.tread = 'none'));
    const hex = gen((p) => (p.tread = 'hexagon'));
    const zMin = (r: FootwearResult) => analyzeMesh(r.parts.solids[0]).bounds.min[2];
    expect(zMin(hex)).toBeCloseTo(zMin(flat), 4); // grooves go up into the sole, the base stays flat
  });

  it('thong: the wings reach the medial and lateral sides of the sole up to the level of the arch end', () => {
    const f = foot.surface.frame;
    const legsAt = (r: FootwearResult) => {
      // the lowest points of the wings = where they come down into the sole; their front end
      let zMin = Infinity, bMax = -Infinity;
      const P = r.parts.solids[2].positions;
      for (let k = 2; k < P.length; k += 3) zMin = Math.min(zMin, P[k]);
      for (let k = 0; k < P.length; k += 3) if (P[k + 2] < zMin + 3) bMax = Math.max(bMax, worldToFrame(f, P[k], P[k + 1])[1]);
      return bMax;
    };
    const m = closedFoot(3);
    for (const aeY of [135, 150]) {
      const ff = prepareFootData(samplePlantarSurface(m.positions, m.indices, { ...landmarks(), archEnd: [-22, aeY, 1] }), m.positions, m.indices);
      const p = defaultFootwearParams(6, 'chappal');
      p.chappalStyle = 'thong';
      const r = generateFootwear(ff, p);
      const bAE = ff.surface.frame.archEnd![1];
      expect(Math.abs(legsAt(r) - bAE)).toBeLessThan(6);
    }
  });

  it('reference designs: every preset generates within the design rules, with closed solid parts', () => {
    for (const [id, ref] of Object.entries(REFERENCE_DESIGNS)) {
      const p = { ...ref.set(defaultFootwearParams(6, ref.kind)), design: id as DesignId };
      const r = generateFootwear(foot, p);
      expect(r.kind, id).toBe(ref.kind);
      expect(r.rules.every((x) => x.ok), `${id}: ${r.rules.map((x) => x.value).join(' | ')}`).toBe(true);
      for (const m of r.parts.solids) expect(analyzeMesh(m).watertight && consistent(m), id).toBe(true);
    }
    // lattice straps: an open panel (border solids + struts) instead of one solid sheet
    const solid = gen((p) => (p.strapPattern = 'solid')), panel = gen((p) => (p.strapPattern = 'lattice'));
    expect(panel.parts.solids.length).toBe(solid.parts.solids.length + 3);
    expect(panel.strutCount).toBeGreaterThan(solid.strutCount + 100);
    // diamond shoe uppers: no struts along the sections, so fewer struts than the grid
    const grid = gen((p) => { p.upperPattern = 'grid'; p.shoe.finish = 'lattice'; }, 'shoe'), diamond = gen((p) => { p.upperPattern = 'diamond'; p.shoe.finish = 'lattice'; }, 'shoe');
    expect(diamond.strutCount).toBeLessThan(grid.strutCount);
    expect(diamond.rules.every((x) => x.ok)).toBe(true);
  });

  it('high mesh detail: finer surfaces and rounder struts, same design rules', () => {
    const m = closedFoot(3);
    const fine = prepareFootData(samplePlantarSurface(m.positions, m.indices, landmarks(), 0.5), m.positions, m.indices);
    for (const kind of ['chappal', 'shoe'] as const) {
      const std = gen(() => {}, kind);
      const hi = generateFootwear(fine, { ...defaultFootwearParams(6, kind), detail: 'high' });
      expect(hi.mesh.indices.length, kind).toBeGreaterThan(1.5 * std.mesh.indices.length);
      expect(hi.rules.every((x) => x.ok), `${kind}: ${hi.rules.map((x) => x.value).join(' | ')}`).toBe(true);
      for (const s of hi.parts.solids) expect(analyzeMesh(s).watertight && consistent(s), kind).toBe(true);
      expect(Math.abs(hi.length - std.length)).toBeLessThan(2);
    }
  });

  it('smooth fused joins: the solid parts become one closed surface with fillets, still clear of the foot', () => {
    const r = gen();
    const fused = fuseFootwearSolids(foot, r, 1.5, 1);
    expect(analyzeMesh(fused).watertight && consistent(fused)).toBe(true);
    expect(signedVolume(fused)).toBeGreaterThan(0);
    // it covers the parts it was made from (sample the parts' vertices: inside or on the surface)
    const fb = analyzeMesh(fused).bounds;
    for (const m of r.parts.solids) {
      const b = analyzeMesh(m).bounds;
      for (let k = 0; k < 3; k++) {
        expect(b.min[k]).toBeGreaterThan(fb.min[k] - 1.2);
        expect(b.max[k]).toBeLessThan(fb.max[k] + 1.2);
      }
    }
    // one piece, and more volume than the largest part alone (the strap and rim are joined)
    const volumes = r.parts.solids.map((m) => signedVolume(m));
    expect(signedVolume(fused)).toBeGreaterThan(Math.max(...volumes));
    // nothing closer to the foot than the clearance
    const probe = footProbe(foot);
    let lo = Infinity;
    for (let i = 0; i < fused.positions.length; i += 30) lo = Math.min(lo, probe(fused.positions[i], fused.positions[i + 1], fused.positions[i + 2]).gap);
    expect(lo).toBeGreaterThanOrEqual(1.5 - 0.1);
  });

  it('the sole follows the footprint: it contains it with room for the wall, and is not much wider', () => {
    const r = gen();
    const sole = r.parts.solids[0].positions, f = foot.surface.frame, g = foot.surface.grid;
    // widest point of the sole per 10 mm band along the foot vs the footprint there (heel to ball;
    // in front of that the toe allowance adds room on purpose)
    for (let b = 20; b <= 180; b += 10) {
      let sLo = Infinity, sHi = -Infinity, fLo = Infinity, fHi = -Infinity;
      for (let i = 0; i < sole.length; i += 3) {
        const [a, bb] = worldToFrame(f, sole[i], sole[i + 1]);
        if (Math.abs(bb - b) < 1) { sLo = Math.min(sLo, a); sHi = Math.max(sHi, a); }
      }
      for (let i = 0; i < g.nx; i++) {
        const k = Math.round((b - g.b0) / g.h) * g.nx + i;
        if (foot.lowSilhouetteSdf[k] < 0) { fLo = Math.min(fLo, g.a0 + i * g.h); fHi = Math.max(fHi, g.a0 + i * g.h); }
      }
      if (!Number.isFinite(fLo)) continue;
      expect(sLo, `b=${b}`).toBeLessThan(fLo - 3);
      expect(sHi, `b=${b}`).toBeGreaterThan(fHi + 3);
      // (margins of 2 × 5.5 mm, plus where the foot bulges wider than its footprint just above the floor)
      expect(sHi - sLo - (fHi - fLo), `b=${b}`).toBeLessThan(35);
    }
  });

  it('shoe collar: the rim stays the set gap below the malleoli (MM / LM landmarks)', () => {
    const m = lowerLimbScan();
    // most prominent points of the fixture's ankle bones (medial higher and more anterior)
    const mall = { medialMalleolus: [-42, 52, 88] as [number, number, number], lateralMalleolus: [46, 40, 76] as [number, number, number] };
    const f = prepareFootData(samplePlantarSurface(m.positions, m.indices, { ...landmarks(), ...mall }), m.positions, m.indices);
    const p = defaultFootwearParams(6, 'shoe');
    p.shoe.collarHeight = 90; // would reach over the ankle bones without the landmarks
    const without = generateFootwear(prepareFootData(samplePlantarSurface(m.positions, m.indices, landmarks()), m.positions, m.indices), p);
    expect(without.ankle).toBeNull();
    const r = generateFootwear(f, p);
    expect(r.ankle!.medial!).toBeGreaterThanOrEqual(5 - 0.1);
    expect(r.ankle!.lateral!).toBeGreaterThanOrEqual(5 - 0.1);
    // close to the gap, not far below it (flat under the bone)
    expect(Math.min(r.ankle!.medial!, r.ankle!.lateral!)).toBeLessThan(8);
    const rule = r.rules.find((x) => /malleoli/.test(x.rule))!;
    expect(rule.ok).toBe(true);
    expect(r.rules.every((x) => x.ok), r.rules.map((x) => `${x.rule}: ${x.value}`).join(' | ')).toBe(true);
    // a larger gap lowers the collar there
    const r10 = generateFootwear(f, { ...p, shoe: { ...p.shoe, malleolusGap: 10 } });
    expect(Math.min(r10.ankle!.medial!, r10.ankle!.lateral!)).toBeGreaterThanOrEqual(10 - 0.1);
    // chappals ignore the malleoli
    expect(generateFootwear(f, defaultFootwearParams(6, 'chappal')).ankle).toBeNull();
  });

  it('open full scans (cut at the leg, scanner holes): the real top of the foot is used and nothing gets too close', () => {
    const m = lowerLimbScan();
    const f = prepareFootData(samplePlantarSurface(m.positions, m.indices, landmarks()), m.positions, m.indices);
    expect(f.hasDorsum).toBe(true);
    // the clearance checks run against the scan with its holes closed
    expect(analyzeMesh(makeMesh(f.probePositions, f.probeIndices)).boundaryEdgeCount).toBe(0);
    for (const kind of ['chappal', 'shoe'] as const) {
      const r = generateFootwear(f, defaultFootwearParams(6, kind));
      expect(r.warnings.join(' ')).not.toMatch(/estimated foot shape/);
      expect(r.rules.every((x) => x.ok)).toBe(true);
      expect(minGap(f, r)).toBeGreaterThanOrEqual(1 - 0.1);
    }
  });

  it('scans without the top of the foot: straps and upper on an estimated foot shape, rules met', () => {
    const m = plantarScan();
    const f = prepareFootData(samplePlantarSurface(m.positions, m.indices, landmarks()), m.positions, m.indices);
    expect(f.hasDorsum).toBe(false);
    expect(f.dorsumEstimated).toBe(true);
    for (const [kind, style] of [['chappal', 'slide'], ['chappal', 'thong'], ['shoe', 'slide']] as const) {
      const p = defaultFootwearParams(6, kind);
      p.chappalStyle = style;
      const r = generateFootwear(f, p);
      expect(r.warnings.join(' ')).toMatch(/estimated foot shape/);
      expect(r.rules.every((x) => x.ok)).toBe(true);
      if (kind === 'chappal') expect(r.parts.solids.length).toBe(style === 'slide' ? 3 : 5); // outsole, rim, strap / wings, ridge, post
      else expect(r.parts.solids).toHaveLength(1); // one closed shoe body
    }
    // the estimated dorsum is foot-shaped: highest over the instep, low at the toes
    const g = f.surface.grid, fr = f.surface.frame;
    const topAt = (b: number) => f.top[Math.round((b - g.b0) / g.h) * g.nx + Math.round((0 - g.a0) / g.h)];
    expect(topAt(60)).toBeGreaterThan(55);
    expect(topAt(60)).toBeGreaterThan(topAt(200) + 25);
    expect(fr.origin).toBeDefined();
  });
});
