import type { LandmarkMap, ProjectDocument, ScanInfo } from '../document';
import { LANDMARKS, LANDMARK_BY_ID, type LandmarkId, type ScanType, type Side } from '../landmarks/definitions';
import { computeMeasurements } from '../landmarks/measurements';
import { applyInverseTransform, applyTransform } from '../math/transform';
import type { RigidTransform, Vec3 } from '../types';

export const LANDMARKS_FORMAT = 'footwear-files/landmarks';
export const LANDMARKS_VERSION = 1;

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

export interface LandmarkRecord {
  id: LandmarkId;
  name: string;
  local: XYZ;
  world: XYZ;
}

export interface LandmarksFile {
  format: typeof LANDMARKS_FORMAT;
  version: number;
  units: 'mm';
  sourceFileName: string;
  scanType: ScanType | null;
  side: Side | null;
  exportedAt: string;
  /** Model transform at export time: world = R * local + t. */
  transform: RigidTransform;
  landmarks: LandmarkRecord[];
  measurements: { id: string; label: string; valueMm: number | null }[];
}

const toXYZ = (v: Vec3): XYZ => ({ x: round(v[0]), y: round(v[1]), z: round(v[2]) });
const fromXYZ = (v: XYZ): Vec3 => [v.x, v.y, v.z];
const round = (v: number) => Math.round(v * 1e4) / 1e4;

type LandmarkSource = Pick<ProjectDocument, 'landmarks' | 'transform' | 'scan'> & { meta: { sourceFileName: string } };

export function buildLandmarksFile(doc: LandmarkSource, exportedAt = new Date().toISOString()): LandmarksFile {
  const landmarks: LandmarkRecord[] = [];
  for (const def of LANDMARKS) {
    const l = doc.landmarks[def.id];
    if (!l) continue;
    landmarks.push({ id: def.id, name: def.label, local: toXYZ(l.local), world: toXYZ(applyTransform(doc.transform, l.local)) });
  }
  return {
    format: LANDMARKS_FORMAT,
    version: LANDMARKS_VERSION,
    units: 'mm',
    sourceFileName: doc.meta.sourceFileName,
    scanType: doc.scan?.type ?? null,
    side: doc.scan?.side ?? null,
    exportedAt,
    transform: doc.transform,
    landmarks,
    measurements: doc.scan
      ? computeMeasurements(doc.landmarks, doc.scan.type).map((m) => ({
          id: m.id,
          label: m.label,
          valueMm: m.value === null ? null : round(m.value),
        }))
      : [],
  };
}

export function landmarksToJson(doc: LandmarkSource): string {
  return JSON.stringify(buildLandmarksFile(doc), null, 2);
}

const CSV_HEADER = [
  'id', 'name', 'local_x', 'local_y', 'local_z', 'world_x', 'world_y', 'world_z', 'scan_type', 'side', 'source_file',
];

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function landmarksToCsv(doc: LandmarkSource): string {
  const f = buildLandmarksFile(doc);
  const rows = f.landmarks.map((l) =>
    [l.id, l.name, l.local.x, l.local.y, l.local.z, l.world.x, l.world.y, l.world.z, f.scanType ?? '', f.side ?? '', f.sourceFileName]
      .map(csvCell)
      .join(','),
  );
  return [CSV_HEADER.join(','), ...rows].join('\n') + '\n';
}

export interface ParsedLandmarks {
  landmarks: LandmarkMap;
  scan: ScanInfo | null;
  sourceFileName: string;
  warnings: string[];
}

/**
 * Parses a landmarks JSON file. Local coordinates are authoritative; if a record only
 * has world coordinates they are mapped into local space with `currentTransform`.
 */
export function parseLandmarksJson(text: string, currentTransform: RigidTransform): ParsedLandmarks {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not valid JSON');
  }
  const f = data as Partial<LandmarksFile>;
  if (f.format !== LANDMARKS_FORMAT || !Array.isArray(f.landmarks)) {
    throw new Error('Not a Footwear Files landmarks file');
  }
  const warnings: string[] = [];
  const landmarks: LandmarkMap = {};
  const now = new Date().toISOString();
  const isXYZ = (v: unknown): v is XYZ =>
    !!v && typeof v === 'object' && ['x', 'y', 'z'].every((k) => Number.isFinite((v as Record<string, unknown>)[k]));

  for (const rec of f.landmarks as Partial<LandmarkRecord>[]) {
    if (!rec.id || !(rec.id in LANDMARK_BY_ID)) {
      warnings.push(`Skipped unknown landmark "${String(rec.id)}"`);
      continue;
    }
    let local: Vec3;
    if (isXYZ(rec.local)) local = fromXYZ(rec.local);
    else if (isXYZ(rec.world)) local = applyInverseTransform(currentTransform, fromXYZ(rec.world));
    else {
      warnings.push(`Skipped "${rec.id}": no coordinates`);
      continue;
    }
    landmarks[rec.id] = { local, placedAt: now };
  }
  const scan: ScanInfo | null =
    (f.scanType === 'plantar' || f.scanType === 'lowerLimb') && (f.side === 'left' || f.side === 'right')
      ? { type: f.scanType, side: f.side }
      : null;
  return { landmarks, scan, sourceFileName: f.sourceFileName ?? '', warnings };
}
