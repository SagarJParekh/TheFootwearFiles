import type { LandmarkMap } from '../document';
import type { LandmarkId, ScanType } from './definitions';
import { LANDMARK_BY_ID } from './definitions';
import { planeFromPoints, signedDistance } from '../math/plane';
import { distance } from '../math/vec';
import type { Vec3 } from '../types';

export type MeasurementId = 'forefootWidth' | 'heelToMet1' | 'heelToMet5' | 'archHeight' | 'interMalleolar';

export interface Measurement {
  id: MeasurementId;
  label: string;
  /** mm, or null when required landmarks are missing / degenerate. */
  value: number | null;
  requires: LandmarkId[];
  missing: LandmarkId[];
  description: string;
}

interface MeasurementDef {
  id: MeasurementId;
  label: string;
  requires: LandmarkId[];
  scanTypes: ScanType[];
  description: string;
  compute: (p: Record<LandmarkId, Vec3>) => number | null;
}

/**
 * Plantar plane = plane through heel centre, 1st and 5th metatarsal heads (the three
 * weight-bearing points). Arch height = perpendicular distance of the arch peak to that plane.
 */
export function archHeight(heel: Vec3, met1: Vec3, met5: Vec3, arch: Vec3): number | null {
  const plane = planeFromPoints(heel, met1, met5);
  return plane ? Math.abs(signedDistance(plane, arch)) : null;
}

const DEFS: MeasurementDef[] = [
  {
    id: 'forefootWidth', label: 'Forefoot width (M1–M5)', requires: ['met1Head', 'met5Head'],
    scanTypes: ['plantar', 'lowerLimb'], description: 'Distance between 1st and 5th metatarsal heads.',
    compute: (p) => distance(p.met1Head, p.met5Head),
  },
  {
    id: 'heelToMet1', label: 'Heel – M1', requires: ['heelCentre', 'met1Head'],
    scanTypes: ['plantar', 'lowerLimb'], description: 'Heel centre to 1st metatarsal head.',
    compute: (p) => distance(p.heelCentre, p.met1Head),
  },
  {
    id: 'heelToMet5', label: 'Heel – M5', requires: ['heelCentre', 'met5Head'],
    scanTypes: ['plantar', 'lowerLimb'], description: 'Heel centre to 5th metatarsal head.',
    compute: (p) => distance(p.heelCentre, p.met5Head),
  },
  {
    id: 'archHeight', label: 'Arch height', requires: ['heelCentre', 'met1Head', 'met5Head', 'archPeak'],
    scanTypes: ['plantar', 'lowerLimb'],
    description: 'Perpendicular distance from the arch peak to the plantar plane through HC, M1 and M5.',
    compute: (p) => archHeight(p.heelCentre, p.met1Head, p.met5Head, p.archPeak),
  },
  {
    id: 'interMalleolar', label: 'Inter-malleolar distance', requires: ['medialMalleolus', 'lateralMalleolus'],
    scanTypes: ['lowerLimb'], description: 'Distance between medial and lateral malleoli.',
    compute: (p) => distance(p.medialMalleolus, p.lateralMalleolus),
  },
];

/**
 * Computes the measurements offered for a scan type. Landmarks are in mesh-local coordinates;
 * since the model transform is rigid, distances are identical in world coordinates.
 */
export function computeMeasurements(landmarks: LandmarkMap, scanType: ScanType): Measurement[] {
  const points = Object.fromEntries(
    Object.entries(landmarks).map(([id, l]) => [id, l!.local]),
  ) as Record<LandmarkId, Vec3>;
  return DEFS.filter((d) => d.scanTypes.includes(scanType)).map((d) => {
    const missing = d.requires.filter((id) => !landmarks[id]);
    return {
      id: d.id,
      label: d.label,
      requires: d.requires,
      missing,
      description: d.description,
      value: missing.length === 0 ? d.compute(points) : null,
    };
  });
}

export function describeMissing(m: Measurement): string {
  return m.missing.map((id) => LANDMARK_BY_ID[id].shortLabel).join(', ');
}
