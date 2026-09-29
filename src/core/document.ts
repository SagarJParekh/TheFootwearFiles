import type { LandmarkId, ScanType, Side } from './landmarks/definitions';
import { IDENTITY_TRANSFORM, type MeshData, type RigidTransform, type Vec3 } from './types';

export interface PlacedLandmark {
  /** Position in mesh-local coordinates (mm). */
  local: Vec3;
  placedAt: string;
}

export type LandmarkMap = Partial<Record<LandmarkId, PlacedLandmark>>;

export interface ScanInfo {
  type: ScanType;
  side: Side;
}

/**
 * The serialisable document: everything needed to reproduce a session.
 * No UI or rendering state lives here.
 */
export interface ProjectDocument {
  meta: {
    sourceFileName: string;
    units: 'mm';
    createdAt: string;
  };
  scan: ScanInfo | null;
  mesh: MeshData;
  transform: RigidTransform;
  landmarks: LandmarkMap;
}

export function newDocument(mesh: MeshData, sourceFileName: string): ProjectDocument {
  return {
    meta: { sourceFileName, units: 'mm', createdAt: new Date().toISOString() },
    scan: null,
    mesh,
    transform: { ...IDENTITY_TRANSFORM },
    landmarks: {},
  };
}
