import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { LandmarkMap, ProjectDocument, ScanInfo } from '../document';
import { LANDMARK_BY_ID, type LandmarkId } from '../landmarks/definitions';
import { makeMesh, type RigidTransform } from '../types';
import { defaultInsoleParams, type InsoleParams } from '../insole/params';

/**
 * Project file (.tffproj): a zip containing
 *   project.json      – metadata, scan info, transform, landmarks (mesh-local)
 *   mesh/positions.bin – Float32 little-endian xyz per vertex (mm, mesh-local)
 *   mesh/indices.bin   – Uint32 little-endian, 3 per triangle
 */
export const PROJECT_FORMAT = 'footwear-files/project';
export const PROJECT_VERSION = 1;

interface ProjectJson {
  format: typeof PROJECT_FORMAT;
  version: number;
  savedAt: string;
  meta: ProjectDocument['meta'];
  scan: ScanInfo | null;
  transform: RigidTransform;
  landmarks: LandmarkMap;
  insole?: InsoleParams | null;
  mesh: { vertexCount: number; triangleCount: number; positions: string; indices: string };
}

const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function toLEBytes(arr: Float32Array | Uint32Array): Uint8Array {
  if (littleEndian) return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength).slice();
  const out = new Uint8Array(arr.byteLength);
  const view = new DataView(out.buffer);
  arr.forEach((v, i) => (arr instanceof Float32Array ? view.setFloat32(i * 4, v, true) : view.setUint32(i * 4, v, true)));
  return out;
}

function fromLEBytes<T extends Float32Array | Uint32Array>(bytes: Uint8Array, ctor: { new (b: ArrayBuffer): T }): T {
  const copy = bytes.slice().buffer as ArrayBuffer;
  if (littleEndian) return new ctor(copy);
  const view = new DataView(copy);
  const out = new ctor(new ArrayBuffer(copy.byteLength));
  for (let i = 0; i < out.length; i++) out[i] = ctor === (Float32Array as unknown) ? view.getFloat32(i * 4, true) : view.getUint32(i * 4, true);
  return out;
}

export function serializeProject(doc: ProjectDocument, savedAt = new Date().toISOString()): Uint8Array {
  const json: ProjectJson = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt,
    meta: doc.meta,
    scan: doc.scan,
    transform: doc.transform,
    landmarks: doc.landmarks,
    insole: doc.insole ?? null,
    mesh: {
      vertexCount: doc.mesh.positions.length / 3,
      triangleCount: doc.mesh.indices.length / 3,
      positions: 'mesh/positions.bin',
      indices: 'mesh/indices.bin',
    },
  };
  return zipSync(
    {
      'project.json': strToU8(JSON.stringify(json, null, 2)),
      'mesh/positions.bin': [toLEBytes(doc.mesh.positions), { level: 1 }],
      'mesh/indices.bin': [toLEBytes(doc.mesh.indices), { level: 6 }],
    },
  );
}

export function deserializeProject(data: Uint8Array): ProjectDocument {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new Error('Not a project file (invalid zip)');
  }
  const jsonBytes = files['project.json'];
  if (!jsonBytes) throw new Error('Project file is missing project.json');
  const json = JSON.parse(strFromU8(jsonBytes)) as ProjectJson;
  if (json.format !== PROJECT_FORMAT) throw new Error('Not a Footwear Files project');
  if (json.version > PROJECT_VERSION) throw new Error(`Project version ${json.version} is newer than this app supports`);
  const posBytes = files[json.mesh.positions];
  const idxBytes = files[json.mesh.indices];
  if (!posBytes || !idxBytes) throw new Error('Project file is missing mesh data');
  const positions = fromLEBytes(posBytes, Float32Array);
  const indices = fromLEBytes(idxBytes, Uint32Array);
  if (positions.length !== json.mesh.vertexCount * 3 || indices.length !== json.mesh.triangleCount * 3) {
    throw new Error('Mesh data size does not match the project header');
  }
  const vertexCount = json.mesh.vertexCount;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= vertexCount) throw new Error('Mesh data is corrupt (index out of range)');
  }
  const landmarks: LandmarkMap = {};
  for (const [id, l] of Object.entries(json.landmarks ?? {})) {
    if (id in LANDMARK_BY_ID && l && Array.isArray(l.local) && l.local.length === 3) landmarks[id as LandmarkId] = l;
  }
  return {
    meta: json.meta,
    scan: json.scan ?? null,
    mesh: makeMesh(positions, indices),
    transform: json.transform,
    landmarks,
    insole: json.insole ? { ...defaultInsoleParams(), ...json.insole, orthosis: { ...defaultInsoleParams().orthosis, ...json.insole.orthosis } } : null,
  };
}
