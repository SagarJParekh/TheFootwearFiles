import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { newDocument } from '../document';
import { sphereWithHoles } from '../fixtures/primitives';
import { eulerDegToQuat } from '../math/transform';
import { defaultInsoleParams, normalizeInsoleParams } from '../insole/params';
import { deserializeProject, serializeProject } from './project';

describe('project files', () => {
  it('round-trips mesh, transform, scan info and landmarks', () => {
    const mesh = sphereWithHoles();
    const doc = {
      ...newDocument(mesh, 'scan.stl'),
      scan: { type: 'plantar' as const, side: 'right' as const },
      transform: { position: [1, 2, 3] as [number, number, number], quaternion: eulerDegToQuat([10, 20, 30]) },
      landmarks: { heelCentre: { local: [1.5, -2, 3.25] as [number, number, number], placedAt: '2026-01-01' } },
    };
    const back = deserializeProject(serializeProject(doc));
    expect(back.meta).toEqual(doc.meta);
    expect(back.scan).toEqual(doc.scan);
    expect(back.transform).toEqual(doc.transform);
    expect(back.landmarks).toEqual(doc.landmarks);
    expect(Array.from(back.mesh.positions)).toEqual(Array.from(mesh.positions));
    expect(Array.from(back.mesh.indices)).toEqual(Array.from(mesh.indices));
    expect(back.mesh.id).not.toBe(mesh.id);
  });

  it('round-trips the insole design', () => {
    const insole = defaultInsoleParams(9);
    insole.mtPad = { enabled: true, height: 5.5 };
    insole.type = 'threeQuarter';
    insole.threeQuarter = { ...insole.threeQuarter, thickness: 3.2, mortonsExtension: 'mortons', offloads: ['MT-2', 'MT-3'] };
    const doc = { ...newDocument(sphereWithHoles(), 'x.stl'), insole, footArchAdjust: 4.5 };
    const back = deserializeProject(serializeProject(doc));
    expect(back.insole).toEqual(insole);
    expect(back.footArchAdjust).toBe(4.5);
    expect(deserializeProject(serializeProject(newDocument(sphereWithHoles(), 'x.stl'))).insole).toBeNull();
  });

  it('upgrades designs saved with the older soft-insole / orthosis model', () => {
    const legacy = { shoeSizeUK: 7, paddingThickness: 3, medialArchPressure: 5, heelCupHeight: 18,
      orthosis: { enabled: true, footplateThickness: 5, holeInHeel: true, heelRaise: 2 } };
    const p = normalizeInsoleParams(legacy);
    expect(p.type).toBe('threeQuarter');
    expect(p.paddingClearance).toBe(3);
    expect(p.threeQuarter.thickness).toBe(4); // clamped into 2–4
    expect(p.threeQuarter.holeInHeel).toBe(true);
    expect(p.heelCupHeight).toBe(18);
    expect('orthosis' in p).toBe(false);
    expect(normalizeInsoleParams({ shoeSizeUK: 9 }).type).toBe('full');
  });

  it('rejects non-project data', () => {
    expect(() => deserializeProject(new Uint8Array([1, 2, 3]))).toThrow(/zip/);
    expect(() => deserializeProject(zipSync({ 'project.json': strToU8('{"format":"x"}') }))).toThrow(/Footwear Files project/);
  });

  it('rejects corrupt mesh indices', () => {
    const doc = newDocument(sphereWithHoles(), 'a.stl');
    doc.mesh.indices[0] = 1e7;
    expect(() => deserializeProject(serializeProject(doc))).toThrow(/corrupt/);
  });
});
