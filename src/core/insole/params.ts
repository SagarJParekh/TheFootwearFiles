/**
 * Parametric insole design, organised around how the insole is manufactured:
 *
 *  - Full length (FDM print): the top follows the foot (minus the padding clearance), the
 *    forefoot is flat, and the part is finished with a completely FLAT BASE for printing.
 *  - 3/4 length (powder-bed print): the top follows the foot (minus the padding clearance) and
 *    the part is a shell of uniform thickness (2–4 mm, typically 2.5 mm), with optional heel
 *    post, Morton's extension, offloads and heel hole.
 *
 * The padding is added externally after printing, so "padding clearance" is a gap between the
 * foot and the printed insole, not material. Plain serialisable data – stored in the project
 * document and undoable.
 */

import { normalizeDetail, type MeshDetail } from '../detail';

export type InsoleType = 'full' | 'threeQuarter';
export type WedgeType = 'heel' | 'forefoot' | 'full';
export type WedgeSide = 'medial' | 'lateral';
export type MortonsExtension = 'none' | 'mortons' | 'reverseMortons';
export type HeelBaseWidth = 'narrow' | 'normal' | 'wide';
export type MtBarPath = 'oblique' | 'straight' | 'anatomical';
export type MtBarCoverage = 'full' | 'rays2to5' | 'rays2to4';
export type MetatarsalId = 'MT-1' | 'MT-2' | 'MT-3' | 'MT-4' | 'MT-5';

export interface InsoleParams {
  /** Manufacturing type, chosen before designing. */
  type: InsoleType;
  /** Mesh detail of the generated insole (surface grid). */
  detail: MeshDetail;
  /** UK shoe size (adult), decides the insole length. */
  shoeSizeUK: number;
  narrowProfile: boolean;
  /** Gap left between the foot and the printed insole for padding added later (mm). */
  paddingClearance: number;
  wedge: { enabled: boolean; type: WedgeType; side: WedgeSide; angleDeg: number };
  mtPad: { enabled: boolean; height: number };
  fasciaGroove: { enabled: boolean; depth: number };
  /** Height of the heel cup rim above the lowest point of the heel (mm). */
  heelCupHeight: number;
  /**
   * Metatarsal bar: a raised strip just proximal to the metatarsal heads. `thickness` is its
   * height, `width` its front-to-back size, `behindHeads` the gap from its front edge to the heads.
   */
  mtBar: { enabled: boolean; thickness: number; path: MtBarPath; coverage: MtBarCoverage; width: number; behindHeads: number };
  /** Smooths the metatarsal region and the transition into the flat forefoot (0 = off … 10). */
  mtSmoothing: number;
  /** Full length (FDM): thickness at the thinnest point above the flat base (mm). */
  full: { baseThickness: number };
  /** 3/4 length (powder): shell thickness and orthotic options. */
  threeQuarter: {
    thickness: number;
    /** Heel lift of the rearfoot, tapering to 0 at the metatarsals; supported by a heel post (mm). */
    heelRaise: number;
    /** Heel post below the shell (mm). */
    heelHeight: number;
    heelBaseWidth: HeelBaseWidth;
    mortonsExtension: MortonsExtension;
    offloads: MetatarsalId[];
    provideOffloads: boolean;
    holeInHeel: boolean;
  };
}

export interface Range {
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export const RANGES = {
  paddingClearance: { min: 0, max: 4, step: 0.1, unit: 'mm' },
  wedgeAngle: { min: 0, max: 7, step: 0.5, unit: '°' },
  mtPadHeight: { min: 0, max: 7, step: 0.1, unit: 'mm' },
  fasciaGrooveDepth: { min: 0, max: 4, step: 0.1, unit: 'mm' },
  heelCupHeight: { min: 6, max: 30, step: 1, unit: 'mm' },
  mtBarThickness: { min: 2, max: 5, step: 0.1, unit: 'mm' },
  mtBarWidth: { min: 15, max: 35, step: 1, unit: 'mm' },
  mtBarBehindHeads: { min: 3, max: 15, step: 0.5, unit: 'mm' },
  mtSmoothing: { min: 0, max: 10, step: 1 },
  fullBaseThickness: { min: 1, max: 6, step: 0.1, unit: 'mm' },
  threeQuarterThickness: { min: 2, max: 4, step: 0.1, unit: 'mm' },
  heelRaise: { min: 0, max: 20, step: 0.5, unit: 'mm' },
  heelHeight: { min: 0, max: 10, step: 0.5, unit: 'mm' },
  /** Arch adjustment applied to the FOOT scan (not the insole). */
  footArch: { min: -15, max: 15, step: 0.5, unit: 'mm' },
} satisfies Record<string, Range>;

export const UK_SIZES: number[] = Array.from({ length: 23 }, (_, i) => 2 + i * 0.5); // UK2 … UK13

export const METATARSALS: MetatarsalId[] = ['MT-1', 'MT-2', 'MT-3', 'MT-4', 'MT-5'];

export function defaultInsoleParams(shoeSizeUK = 8, type: InsoleType = 'full'): InsoleParams {
  return {
    type,
    detail: 'standard',
    shoeSizeUK,
    narrowProfile: false,
    paddingClearance: 2.5,
    wedge: { enabled: false, type: 'full', side: 'medial', angleDeg: 4 },
    mtPad: { enabled: false, height: 4 },
    fasciaGroove: { enabled: false, depth: 3 },
    heelCupHeight: 12,
    mtBar: { enabled: false, thickness: 3, path: 'oblique', coverage: 'full', width: 25, behindHeads: 7 },
    mtSmoothing: 5,
    full: { baseThickness: 2 },
    threeQuarter: {
      thickness: 2.5,
      heelRaise: 0,
      heelHeight: 0,
      heelBaseWidth: 'normal',
      mortonsExtension: 'none',
      offloads: ['MT-1'],
      provideOffloads: false,
      holeInHeel: false,
    },
  };
}

/**
 * Reads insole parameters from any saved version (older projects used a soft-insole /
 * "orthosis" model with paddingThickness, medialArchPressure and orthosis.footplateThickness).
 */
export function normalizeInsoleParams(raw: unknown): InsoleParams {
  const r = (raw ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const d = defaultInsoleParams(typeof r.shoeSizeUK === 'number' ? r.shoeSizeUK : 8);
  const legacyOrth = r.orthosis as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  const type: InsoleType = r.type === 'threeQuarter' || r.type === 'full' ? r.type : legacyOrth?.enabled ? 'threeQuarter' : 'full';
  const tq = { ...d.threeQuarter, ...(legacyOrth ?? {}), ...(r.threeQuarter ?? {}) };
  if (legacyOrth && !r.threeQuarter && typeof legacyOrth.footplateThickness === 'number') {
    tq.thickness = Math.min(4, Math.max(2, legacyOrth.footplateThickness));
  }
  delete (tq as Record<string, unknown>).enabled;
  delete (tq as Record<string, unknown>).footplateThickness;
  return {
    ...d,
    ...pick(r, ['narrowProfile', 'heelCupHeight', 'mtSmoothing']),
    type,
    detail: normalizeDetail(r.detail),
    paddingClearance: typeof r.paddingClearance === 'number' ? r.paddingClearance : typeof r.paddingThickness === 'number' ? r.paddingThickness : d.paddingClearance,
    wedge: { ...d.wedge, ...(r.wedge ?? {}) },
    mtPad: { ...d.mtPad, ...(r.mtPad ?? {}) },
    fasciaGroove: { ...d.fasciaGroove, ...(r.fasciaGroove ?? {}) },
    mtBar: { ...d.mtBar, ...(r.mtBar ?? {}) },
    full: { ...d.full, ...(r.full ?? {}) },
    threeQuarter: tq as InsoleParams['threeQuarter'],
  };
}

function pick(o: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
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

export const INSOLE_TYPE_LABEL: Record<InsoleType, string> = {
  full: 'Full length – FDM print (flat base)',
  threeQuarter: '3/4 length – powder print (shell)',
};
export const WEDGE_TYPE_LABEL: Record<WedgeType, string> = { heel: 'Heel wedge', forefoot: 'Forefoot wedge', full: 'Full wedge' };
export const WEDGE_SIDE_LABEL: Record<WedgeSide, string> = { medial: 'Medial Wedge', lateral: 'Lateral Wedge' };
export const MORTONS_LABEL: Record<MortonsExtension, string> = {
  none: 'none',
  mortons: "Morton's Extension",
  reverseMortons: "Reverse Morton's Extension",
};
export const MT_BAR_PATH_LABEL: Record<MtBarPath, string> = {
  oblique: 'Oblique – parallel to the MT head line',
  straight: 'Straight – across the foot axis',
  anatomical: 'Anatomical – follows the MT parabola',
};
export const MT_BAR_COVERAGE_LABEL: Record<MtBarCoverage, string> = {
  full: 'Full width (MT 1–5)',
  rays2to5: 'MT 2–5 (spares the 1st ray)',
  rays2to4: 'MT 2–4 (central, spares 1st & 5th)',
};
export const HEEL_BASE_LABEL: Record<HeelBaseWidth, string> = { narrow: 'Narrow', normal: 'Normal', wide: 'Wide' };
