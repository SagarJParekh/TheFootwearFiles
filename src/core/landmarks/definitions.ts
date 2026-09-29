export type ScanType = 'plantar' | 'lowerLimb';
export type Side = 'left' | 'right';

export type LandmarkId =
  | 'heelCentre'
  | 'met1Head'
  | 'met5Head'
  | 'archStart'
  | 'archPeak'
  | 'archEnd'
  | 'medialMalleolus'
  | 'lateralMalleolus';

export interface LandmarkDefinition {
  id: LandmarkId;
  label: string;
  shortLabel: string;
  colour: string;
  scanTypes: ScanType[];
  hint: string;
}

export const LANDMARKS: LandmarkDefinition[] = [
  {
    id: 'heelCentre', label: 'Heel centre', shortLabel: 'HC', colour: '#e6194b',
    scanTypes: ['plantar', 'lowerLimb'], hint: 'Centre of the plantar heel pad.',
  },
  {
    id: 'met1Head', label: '1st metatarsal head', shortLabel: 'M1', colour: '#3cb44b',
    scanTypes: ['plantar', 'lowerLimb'], hint: 'Plantar prominence of the 1st metatarsal head (medial forefoot).',
  },
  {
    id: 'met5Head', label: '5th metatarsal head', shortLabel: 'M5', colour: '#4363d8',
    scanTypes: ['plantar', 'lowerLimb'], hint: 'Plantar prominence of the 5th metatarsal head (lateral forefoot).',
  },
  {
    id: 'archStart', label: 'Medial arch – start', shortLabel: 'AS', colour: '#bfef45',
    scanTypes: ['plantar', 'lowerLimb'], hint: 'Where the medial arch starts rising, at the front of the heel (medial side).',
  },
  {
    id: 'archPeak', label: 'Medial arch – max height', shortLabel: 'AR', colour: '#f58231',
    scanTypes: ['plantar', 'lowerLimb'], hint: 'Highest point of the medial longitudinal arch (plantar surface).',
  },
  {
    id: 'archEnd', label: 'Medial arch – end', shortLabel: 'AE', colour: '#9a6324',
    scanTypes: ['plantar', 'lowerLimb'], hint: 'Where the medial arch meets the ground again, behind the 1st metatarsal head.',
  },
  {
    id: 'medialMalleolus', label: 'Medial malleolus', shortLabel: 'MM', colour: '#911eb4',
    scanTypes: ['lowerLimb'], hint: 'Most prominent point of the medial malleolus.',
  },
  {
    id: 'lateralMalleolus', label: 'Lateral malleolus', shortLabel: 'LM', colour: '#42d4f4',
    scanTypes: ['lowerLimb'], hint: 'Most prominent point of the lateral malleolus.',
  },
];

export const LANDMARK_BY_ID: Record<LandmarkId, LandmarkDefinition> = Object.fromEntries(
  LANDMARKS.map((l) => [l.id, l]),
) as Record<LandmarkId, LandmarkDefinition>;

export function landmarksForScanType(scanType: ScanType): LandmarkDefinition[] {
  return LANDMARKS.filter((l) => l.scanTypes.includes(scanType));
}

export const SCAN_TYPE_LABEL: Record<ScanType, string> = { plantar: 'Plantar surface', lowerLimb: 'Lower limb' };
export const SIDE_LABEL: Record<Side, string> = { left: 'Left', right: 'Right' };
