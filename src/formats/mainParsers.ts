/**
 * Parsers that must run on the main thread because the Three.js loaders use DOMParser or
 * image decoding. Each is loaded on demand (code-split), extracts a triangle soup and hands
 * it to the worker for welding/analysis. These formats are usually small (CAD exports, 3D
 * printing packages); large scans are typically STL / OBJ / PLY, which parse in the worker.
 */
import type * as THREE from 'three';
import { unzipSync, strFromU8 } from 'fflate';
import { parseUnitName, unitFromMetres, type LengthUnit } from '../core/units';
import { extractSoup } from './extractSoup';
import type { ParsedModel } from './workerParsers';

const decode = (buffer: ArrayBuffer) => new TextDecoder().decode(new Uint8Array(buffer));

function toModel(root: THREE.Object3D, units: LengthUnit | null, what: string): ParsedModel {
  const { soup, meshCount, pointsOnly } = extractSoup(root);
  if (pointsOnly) throw new Error(`This ${what} file contains only points (no surfaces).`);
  if (!soup.length) throw new Error(`No triangle meshes found in this ${what} file.`);
  return { soup, units, detail: `${meshCount} mesh${meshCount === 1 ? '' : 'es'}` };
}

async function parse3mf(buffer: ArrayBuffer): Promise<ParsedModel> {
  const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
  // The loader ignores the model's unit attribute; read it ourselves (default millimetre per spec).
  let units: LengthUnit = 'mm';
  try {
    const files = unzipSync(new Uint8Array(buffer), { filter: (f) => f.name.toLowerCase().endsWith('.model') });
    const xml = Object.values(files).map((b) => strFromU8(b)).join('\n');
    units = parseUnitName(/<model[^>]*\sunit="([^"]+)"/i.exec(xml)?.[1]) ?? 'mm';
  } catch {
    /* fall back to mm */
  }
  return toModel(new ThreeMFLoader().parse(buffer), units, '3MF');
}

async function parseAmf(buffer: ArrayBuffer): Promise<ParsedModel> {
  const { AMFLoader } = await import('three/examples/jsm/loaders/AMFLoader.js');
  // AMFLoader already converts the file's unit attribute to millimetres.
  return toModel(new AMFLoader().parse(buffer), 'mm', 'AMF');
}

async function parseGltf(buffer: ArrayBuffer): Promise<ParsedModel> {
  const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/loaders/DRACOLoader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ]);
  const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  try {
    const gltf = await loader.parseAsync(buffer, '');
    return toModel(gltf.scene, 'm', 'glTF'); // glTF is metres, Y-up by specification
  } finally {
    draco.dispose();
  }
}

async function parseDae(buffer: ArrayBuffer): Promise<ParsedModel> {
  const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
  // ColladaLoader applies <unit meter="…"> (output in metres) and converts Z-up to Y-up.
  const collada = new ColladaLoader().parse(decode(buffer), '');
  if (!collada) throw new Error('Could not read the COLLADA file');
  return toModel(collada.scene, 'm', 'COLLADA');
}

async function parseFbx(buffer: ArrayBuffer): Promise<ParsedModel> {
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const group = new FBXLoader().parse(buffer, '');
  // FBX UnitScaleFactor is centimetres per file unit (default 1 → cm).
  const cmPerUnit = Number(group.userData.unitScaleFactor ?? 1);
  return toModel(group, unitFromMetres(cmPerUnit / 100), 'FBX');
}

async function parse3ds(buffer: ArrayBuffer): Promise<ParsedModel> {
  const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js');
  return toModel(new TDSLoader().parse(buffer, ''), null, '3DS');
}

async function parseVrml(buffer: ArrayBuffer): Promise<ParsedModel> {
  const { VRMLLoader } = await import('three/examples/jsm/loaders/VRMLLoader.js');
  return toModel(new VRMLLoader().parse(decode(buffer), ''), 'm', 'VRML'); // VRML97: metres, Y-up
}

export const MAIN_THREAD_PARSERS: Record<string, (buffer: ArrayBuffer) => Promise<ParsedModel>> = {
  '3mf': parse3mf,
  amf: parseAmf,
  gltf: parseGltf,
  dae: parseDae,
  fbx: parseFbx,
  '3ds': parse3ds,
  wrl: parseVrml,
};
