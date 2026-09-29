import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { closedFoot } from '../core/fixtures/footShapes';
import { analyzeMesh } from '../core/mesh/analyze';
import type { MeshData } from '../core/types';
import { convertPositions, guessUnits, reinterpretation, unitFromMetres } from '../core/units';
import { writeBinaryStl } from '../core/io/stlWrite';
import { write3dm, writeObj, writeOff, writePlyAscii, writePlyBinary } from '../../scripts/formatWriters';
import { finishImport } from './finishImport';
import { formatForFile, unsupportedMessage } from './registry';
import { parse3dmModel, parseCadModel, parseObjModel, parseOffModel, parsePlyModel, parseStlModel, type ParsedModel } from './workerParsers';

const buf = (x: string | Uint8Array | ArrayBuffer): ArrayBuffer =>
  typeof x === 'string' ? (new TextEncoder().encode(x).buffer as ArrayBuffer) : x instanceof Uint8Array ? (x.slice().buffer as ArrayBuffer) : x;
const occtFile = (rel: string) => buf(new Uint8Array(readFileSync(join('node_modules/occt-import-js/test/testfiles', rel))));

function importAs(parsed: ParsedModel, fileName: string) {
  return finishImport(parsed, formatForFile(fileName)!);
}

describe('format registry', () => {
  it('maps extensions case-insensitively', () => {
    expect(formatForFile('Scan.STP')!.id).toBe('step');
    expect(formatForFile('a.glb')!.id).toBe('gltf');
    expect(formatForFile('x.igs')!.id).toBe('iges');
    expect(formatForFile('x.f3d')).toBeNull();
  });
  it('explains proprietary formats', () => {
    expect(unsupportedMessage('shoe.f3d')).toMatch(/Fusion 360.*STEP/);
    expect(unsupportedMessage('x.weird')).toMatch(/Unsupported/);
  });
});

describe('units', () => {
  it('guesses units from model size', () => {
    expect(guessUnits(0.27)).toBe('m');
    expect(guessUnits(27)).toBe('cm');
    expect(guessUnits(270)).toBe('mm');
  });
  it('maps metre scales', () => {
    expect(unitFromMetres(0.001)).toBe('mm');
    expect(unitFromMetres(0.0254)).toBe('in');
    expect(unitFromMetres(0.003)).toBeNull();
  });
  it('converts Y-up to Z-up with a proper rotation', () => {
    const p = new Float32Array([0, 1, 0, 0, 0, 1]);
    convertPositions(p, 10, true);
    Array.from(p).forEach((v, i) => expect(v).toBeCloseTo([0, 0, 10, 0, -10, 0][i], 9));
  });
  it('reinterpretation undoes the old import and applies the new one', () => {
    const r = reinterpretation({ units: 'mm', upAxis: 'z' }, { units: 'cm', upAxis: 'y' });
    expect(r.point([1, 2, 3])).toEqual([10, -30, 20]);
    const back = reinterpretation({ units: 'cm', upAxis: 'y' }, { units: 'mm', upAxis: 'z' });
    back.point(r.point([1, 2, 3])).forEach((v, i) => expect(v).toBeCloseTo([1, 2, 3][i], 6));
  });
});

describe('mesh format parsers (worker side)', () => {
  let foot: MeshData;
  let ref: { tris: number; size: number[] };
  beforeAll(() => {
    foot = closedFoot(8);
    const s = analyzeMesh(foot);
    ref = { tris: s.triangleCount, size: s.bounds.max.map((v, i) => v - s.bounds.min[i]) };
  });

  const expectSameFoot = (mesh: MeshData) => {
    const s = analyzeMesh(mesh);
    expect(s.triangleCount).toBe(ref.tris);
    expect(s.watertight).toBe(true);
    s.bounds.max.forEach((v, i) => expect(v - s.bounds.min[i]).toBeCloseTo(ref.size[i], 1));
  };

  it('STL', () => {
    const { mesh, info } = importAs(parseStlModel(writeBinaryStl(foot)), 'f.stl');
    expectSameFoot(mesh);
    expect(info.unitsSource).toBe('guess');
    expect(info.units).toBe('mm');
  });
  it('OBJ', () => expectSameFoot(importAs(parseObjModel(buf(writeObj(foot))), 'f.obj').mesh));
  it('OBJ with quads and negative indices', () => {
    const obj = 'v 0 0 0\nv 100 0 0\nv 100 100 0\nv 0 100 0\nf -4 -3 -2 -1\n';
    expect(analyzeMesh(importAs(parseObjModel(buf(obj)), 'q.obj').mesh).triangleCount).toBe(2);
  });
  it('PLY ascii + binary', () => {
    expectSameFoot(importAs(parsePlyModel(buf(writePlyAscii(foot))), 'f.ply').mesh);
    expectSameFoot(importAs(parsePlyModel(buf(writePlyBinary(foot))), 'f.ply').mesh);
  });
  it('PLY point cloud is rejected with a helpful message', () => {
    const ply = 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n';
    expect(() => parsePlyModel(buf(ply))).toThrow(/point cloud/);
  });
  it('OFF', () => expectSameFoot(importAs(parseOffModel(buf(writeOff(foot))), 'f.off').mesh));
  it('3DM (rhino3dm) with millimetre units', async () => {
    const { mesh, info } = importAs(await parse3dmModel(buf(await write3dm(foot))), 'f.3dm');
    expectSameFoot(mesh);
    expect(info).toMatchObject({ units: 'mm', unitsSource: 'file' });
  });
});

describe('CAD formats via OpenCASCADE', () => {
  const size = (m: MeshData) => {
    const b = analyzeMesh(m).bounds;
    return b.max.map((v, i) => v - b.min[i]);
  };
  it('STEP cube 10 mm → closed mesh, 10 mm', async () => {
    const { mesh, info } = importAs(await parseCadModel(occtFile('cube-10x10mm/Cube 10x10.stp'), 'step'), 'c.stp');
    expect(analyzeMesh(mesh).watertight).toBe(true);
    size(mesh).forEach((v) => expect(v).toBeCloseTo(10, 3));
    expect(info.units).toBe('mm');
  });
  it('IGES cube', async () => {
    const { mesh } = importAs(await parseCadModel(occtFile('cube-10x10mm/Cube 10x10.igs'), 'iges'), 'c.igs');
    size(mesh).forEach((v) => expect(v).toBeCloseTo(10, 3));
  });
  it('STEP files in metres / inches are converted to millimetres', async () => {
    const m = importAs(await parseCadModel(occtFile('cube-units/cube-m.step'), 'step'), 'c.step').mesh;
    const i = importAs(await parseCadModel(occtFile('cube-units/cube-mm.step'), 'step'), 'c.step').mesh;
    const inch = importAs(await parseCadModel(occtFile('cube-units/cube-in.step'), 'step'), 'c.step').mesh;
    // the same 1 m cube declared in metres, millimetres and inches → always 1000 mm
    for (const mesh of [m, i, inch]) expect(size(mesh)[0]).toBeCloseTo(1000, 3);
  });
  it('curved STEP geometry is tessellated finely', async () => {
    const { mesh } = importAs(await parseCadModel(occtFile('rounded-cube/rounded-cube.step'), 'step'), 'r.step');
    expect(analyzeMesh(mesh).triangleCount).toBeGreaterThan(100); // OCCT default gives 84
  });
});
