/**
 * Parametric insole / orthosis design. Every control and range mirrors the reference
 * workflow: a soft full-length insole shaped to the plantar scan, optional modifications,
 * and an optional rigid orthosis ("Add thickness") with posting and offloads.
 * Plain serialisable data – stored in the project document and undoable.
 */

export type WedgeType = 'heel' | 'forefoot' | 'full';
export type WedgeSide = 'medial' | 'lateral';
export type MortonsExtension = 'none' | 'mortons' | 'reverseMortons';
export type HeelBaseWidth = 'narrow' | 'normal' | 'wide';
export type MetatarsalId = 'MT-1' | 'MT-2' | 'MT-3' | 'MT-4' | 'MT-5';

export interface InsoleParams {
  /** UK shoe size (adult), decides the insole length. */
  shoeSizeUK: number;
  narrowProfile: boolean;
  /** Soft insole shell thickness (mm). */
  paddingThickness: number;
  /** Raises (+) or lowers (−) the insole under the medial longitudinal arch (mm). */
  medialArchPressure: number;
  wedge: { enabled: boolean; type: WedgeType; side: WedgeSide; angleDeg: number };
  mtPad: { enabled: boolean; height: number };
  fasciaGroove: { enabled: boolean; depth: number };
  /** Height of the heel cup rim above the lowest point of the heel (mm). */
  heelCupHeight: number;
  mtBar: { enabled: boolean; thickness: number };
  /** "Add thickness": rigid, filled 3/4-length orthosis instead of a soft shell insole. */
  orthosis: {
    enabled: boolean;
    /** Heel lift of the rearfoot top surface, tapering to 0 at the metatarsals (mm). */
    heelRaise: number;
    /** Extra height of the heel post below the shell (mm). */
    heelHeight: number;
    mortonsExtension: MortonsExtension;
    heelBaseWidth: HeelBaseWidth;
    offloads: MetatarsalId[];
    provideOffloads: boolean;
    footplateThickness: number;
    holeInHeel: boolean;
  };
}

export interface Range {
  min: number;
  max: number;
  step: number;
  unit?: string;
}

/** Slider ranges exactly as in the reference tool. */
export const RANGES = {
  paddingThickness: { min: 1.5, max: 4, step: 0.1, unit: 'mm' },
  medialArchPressure: { min: -25, max: 25, step: 1, unit: 'mm' },
  wedgeAngle: { min: 0, max: 7, step: 0.5, unit: '°' },
  mtPadHeight: { min: 0, max: 7, step: 0.1, unit: 'mm' },
  fasciaGrooveDepth: { min: 0, max: 4, step: 0.1, unit: 'mm' },
  heelCupHeight: { min: 6, max: 30, step: 1, unit: 'mm' },
  mtBarThickness: { min: 2, max: 5, step: 0.1, unit: 'mm' },
  heelRaise: { min: 0, max: 20, step: 0.5, unit: 'mm' },
  heelHeight: { min: 0, max: 10, step: 0.5, unit: 'mm' },
  footplateThickness: { min: 2, max: 5, step: 0.1, unit: 'mm' },
} satisfies Record<string, Range>;

export const UK_SIZES: number[] = Array.from({ length: 23 }, (_, i) => 2 + i * 0.5); // UK2 … UK13

export const METATARSALS: MetatarsalId[] = ['MT-1', 'MT-2', 'MT-3', 'MT-4', 'MT-5'];

export function defaultInsoleParams(shoeSizeUK = 8): InsoleParams {
  return {
    shoeSizeUK,
    narrowProfile: false,
    paddingThickness: 2.5,
    medialArchPressure: 0,
    wedge: { enabled: false, type: 'full', side: 'medial', angleDeg: 4 },
    mtPad: { enabled: false, height: 4 },
    fasciaGroove: { enabled: false, depth: 3 },
    heelCupHeight: 12,
    mtBar: { enabled: false, thickness: 3 },
    orthosis: {
      enabled: false,
      heelRaise: 0,
      heelHeight: 0,
      mortonsExtension: 'none',
      heelBaseWidth: 'normal',
      offloads: ['MT-1'],
      provideOffloads: false,
      footplateThickness: 2,
      holeInHeel: false,
    },
  };
}

/**
 * Insole length for a UK adult size: last length = (size + 25) barleycorns (1/3 inch),
 * minus a 5 mm fitting allowance. UK8 → 274 mm.
 */
export function insoleLengthMm(shoeSizeUK: number): number {
  return (shoeSizeUK + 25) * (25.4 / 3) - 5;
}

/** Suggests the UK size whose insole fits a foot of the given length (≈ foot + 8 mm toe allowance). */
export function suggestShoeSize(footLengthMm: number): number {
  const target = footLengthMm + 8;
  let best = UK_SIZES[0];
  for (const s of UK_SIZES) if (Math.abs(insoleLengthMm(s) - target) < Math.abs(insoleLengthMm(best) - target)) best = s;
  return best;
}

export const WEDGE_TYPE_LABEL: Record<WedgeType, string> = { heel: 'Heel wedge', forefoot: 'Forefoot wedge', full: 'Full wedge' };
export const WEDGE_SIDE_LABEL: Record<WedgeSide, string> = { medial: 'Medial Wedge', lateral: 'Lateral Wedge' };
export const MORTONS_LABEL: Record<MortonsExtension, string> = {
  none: 'none',
  mortons: "Morton's Extension",
  reverseMortons: "Reverse Morton's Extension",
};
export const HEEL_BASE_LABEL: Record<HeelBaseWidth, string> = { narrow: 'Narrow', normal: 'Normal', wide: 'Wide' };
