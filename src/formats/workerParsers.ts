/**
 * Parsers that run inside the mesh worker (no DOM needed). Each returns a triangle soup
 * plus any units / up-axis information found in the file.
 */
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { parseStl } from '../core/io/stlParse';
import type { LengthUnit } from '../core/units';
import { extractSoup, geometryToSoup } from './extractSoup';

export interface ParsedModel {
  soup: Float32Array;
  /** Units stated in the file (null if the format/file has none). */
  units: LengthUnit | null;
  /** Extra description for the status bar, e.g. "binary", "3 bodies". */
  detail?: string;
}

const text = (buffer: ArrayBuffer) => new TextDecoder().decode(new Uint8Array(buffer));

export function parseStlModel(buffer: ArrayBuffer): ParsedModel {
  const { soup, format } = parseStl(buffer);
  return { soup, units: null, detail: format };
}

export function parseObjModel(buffer: ArrayBuffer): ParsedModel {
  const group = new OBJLoader().parse(text(buffer));
  const { soup, meshCount, pointsOnly } = extractSoup(group);
  if (pointsOnly) throw new Error('This OBJ contains only points (no faces). Mesh the point cloud first.');
  return { soup, units: null, detail: `${meshCount} object${meshCount === 1 ? '' : 's'}` };
}

export function parsePlyModel(buffer: ArrayBuffer): ParsedModel {
  const geom = new PLYLoader().parse(buffer);
  // PLYLoader returns non-indexed geometry only when the file has no faces.
  if (!geom.getIndex()) throw new Error('This PLY is a point cloud (no faces). Mesh it first, e.g. in the scanner software.');
  return { soup: geometryToSoup(geom), units: null };
}

/** Object File Format (OFF / COFF / NOFF): header, counts, one vertex per line, one polygon per line. */
export function parseOffModel(buffer: ArrayBuffer): ParsedModel {
  const lines = text(buffer)
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean);
  const first = lines.shift() ?? '';
  const m = /^([A-Z]*OFF)\s*(.*)$/.exec(first);
  if (!m) throw new Error('Not an OFF file');
  const countLine = m[2] || lines.shift() || '';
  const [nv, nf] = countLine.split(/\s+/).map((t) => parseInt(t, 10));
  if (!Number.isFinite(nv) || !Number.isFinite(nf)) throw new Error('Invalid OFF header');
  if (lines.length < nv + nf) throw new Error('OFF file is truncated');
  const verts = new Float64Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const t = lines[v].split(/\s+/);
    verts[3 * v] = parseFloat(t[0]);
    verts[3 * v + 1] = parseFloat(t[1]);
    verts[3 * v + 2] = parseFloat(t[2]);
  }
  const out: number[] = [];
  for (let f = 0; f < nf; f++) {
    const t = lines[nv + f].split(/\s+/).map((x) => parseInt(x, 10));
    const n = t[0];
    for (let k = 1; k + 1 < n; k++) {
      for (const vi of [t[1], t[1 + k], t[2 + k]]) out.push(verts[3 * vi], verts[3 * vi + 1], verts[3 * vi + 2]);
    }
  }
  return { soup: Float32Array.from(out), units: null };
}

// --- STEP / IGES / BREP via OpenCASCADE (occt-import-js, WASM ~7.6 MB, loaded on demand) ---------

interface OcctResult {
  success: boolean;
  meshes: { attributes: { position: { array: number[] } }; index: { array: number[] } }[];
}
interface Occt {
  ReadStepFile(content: Uint8Array, params: object | null): OcctResult;
  ReadIgesFile(content: Uint8Array, params: object | null): OcctResult;
  ReadBrepFile(content: Uint8Array, params: object | null): OcctResult;
}

/** In Node (unit tests) emscripten finds the .wasm next to its script; in the browser we give Vite's asset URL. */
const isNode = typeof process !== 'undefined' && !!process.versions?.node;

let occtPromise: Promise<Occt> | null = null;
async function occt(): Promise<Occt> {
  occtPromise ??= (async () => {
    const { default: init } = await import('occt-import-js');
    if (isNode) return (await init()) as Occt;
    const { default: wasmUrl } = await import('occt-import-js/dist/occt-import-js.wasm?url');
    return (await init({ locateFile: () => wasmUrl })) as Occt;
  })();
  return occtPromise;
}

/**
 * Tessellates STEP / IGES / BREP B-rep geometry. Output is in millimetres. The chordal
 * deflection is 0.05 mm absolute, fine enough for lasts / insoles without exploding the triangle count.
 */
export async function parseCadModel(buffer: ArrayBuffer, kind: 'step' | 'iges' | 'brep', linearDeflectionMm = 0.05): Promise<ParsedModel> {
  const lib = await occt();
  const params = { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: linearDeflectionMm, angularDeflection: 0.1 };
  const bytes = new Uint8Array(buffer);
  const r = kind === 'step' ? lib.ReadStepFile(bytes, params) : kind === 'iges' ? lib.ReadIgesFile(bytes, params) : lib.ReadBrepFile(bytes, null);
  if (!r.success) throw new Error(`Could not read the ${kind.toUpperCase()} file`);
  let total = 0;
  for (const m of r.meshes) total += m.index.array.length * 3;
  if (!total) throw new Error(`The ${kind.toUpperCase()} file contains no surfaces (only wires/points?)`);
  const soup = new Float32Array(total);
  let o = 0;
  for (const m of r.meshes) {
    const p = m.attributes.position.array, idx = m.index.array;
    for (let k = 0; k < idx.length; k++) {
      soup[o++] = p[3 * idx[k]];
      soup[o++] = p[3 * idx[k] + 1];
      soup[o++] = p[3 * idx[k] + 2];
    }
  }
  return {
    soup,
    units: kind === 'brep' ? null : 'mm',
    detail: `${r.meshes.length} bod${r.meshes.length === 1 ? 'y' : 'ies'}`,
  };
}

// --- Rhino 3DM via rhino3dm (WASM ~2.7 MB, loaded on demand) ---------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
let rhinoPromise: Promise<any> | null = null;
async function rhino(): Promise<any> {
  rhinoPromise ??= (async () => {
    const { default: init } = await import('rhino3dm/rhino3dm.module.js');
    if (isNode) return init();
    const { default: wasmUrl } = await import('rhino3dm/rhino3dm.wasm?url');
    return init({ locateFile: () => wasmUrl });
  })();
  return rhinoPromise;
}

const RHINO_UNITS: Record<string, LengthUnit> = { Millimeters: 'mm', Centimeters: 'cm', Meters: 'm', Inches: 'in', Feet: 'ft' };

/**
 * Reads meshes from a .3dm file. Rhino stores render meshes for NURBS objects (Breps,
 * extrusions, SubD) when the file is saved normally; those are used. rhino3dm cannot
 * tessellate NURBS itself, so files saved with "Save small" contain nothing drawable.
 */
export async function parse3dmModel(buffer: ArrayBuffer): Promise<ParsedModel> {
  const rh = await rhino();
  const doc = rh.File3dm.fromByteArray(new Uint8Array(buffer));
  if (!doc) throw new Error('Could not read the 3DM file');
  const chunks: Float32Array[] = [];
  let skipped = 0;
  const addMesh = (mesh: any) => {
    if (!mesh) return false;
    const b = mesh.toThreejsBuffers(false) as { position: Float32Array; index?: Uint32Array };
    const idx = b.index;
    const p = b.position;
    const n = idx ? idx.length : p.length / 3;
    const out = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const v = idx ? idx[k] : k;
      out[3 * k] = p[3 * v];
      out[3 * k + 1] = p[3 * v + 1];
      out[3 * k + 2] = p[3 * v + 2];
    }
    chunks.push(out);
    return true;
  };
  const objects = doc.objects();
  for (let i = 0; i < objects.count; i++) {
    const obj = objects.get(i);
    const geom = obj.geometry();
    const type = geom?.objectType;
    const is = (name: string) => type === rh.ObjectType[name] || type?.value === rh.ObjectType[name]?.value;
    let ok = false;
    if (is('Mesh')) ok = addMesh(geom);
    else if (is('Brep')) {
      const faces = geom.faces();
      for (let f = 0; f < faces.count; f++) ok = addMesh(faces.get(f).getMesh(rh.MeshType.Any)) || ok;
    } else if (is('Extrusion')) ok = addMesh(geom.getMesh(rh.MeshType.Any));
    else if (is('SubD')) ok = addMesh(rh.Mesh.createFromSubDControlNet?.(geom));
    else continue; // curves, points, annotations…
    if (!ok) skipped++;
  }
  const unitKey = Object.keys(RHINO_UNITS).find((k) => doc.settings().modelUnitSystem === rh.UnitSystem[k] || doc.settings().modelUnitSystem?.value === rh.UnitSystem[k]?.value);
  doc.delete?.();
  const total = chunks.reduce((s, c) => s + c.length, 0);
  if (!total) {
    throw new Error(
      skipped
        ? 'The 3DM file has NURBS surfaces but no saved render meshes. In Rhino, save normally (not "Save Small") or export STL/OBJ.'
        : 'The 3DM file contains no surfaces or meshes.',
    );
  }
  const soup = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    soup.set(c, o);
    o += c.length;
  }
  return {
    soup,
    units: unitKey ? RHINO_UNITS[unitKey] : null,
    detail: skipped ? `${skipped} object(s) without render mesh skipped` : undefined,
  };
}
