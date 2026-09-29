/**
 * Parametric footwear designed from the same scan, landmarks and plantar sampling as the
 * insole: a 3D-printed lattice sole (conformal lattice under a footbed that follows the foot)
 * with a solid outsole and rim, plus either chappal straps or a lattice shoe upper.
 *
 * Design rules (enforced by the parameter ranges and checked on the generated result):
 *  - lattice strut diameter 1.2 – 1.8 mm
 *  - clearance between the foot and the footwear 1 – 2 mm
 */
import type { Range } from '../insole/params';

export type FootwearKind = 'shoe' | 'chappal';
export type ChappalStyle = 'slide' | 'thong' | 'splitToe';
export type TreadPattern = 'none' | 'hexagon' | 'diamond' | 'waves';
export type SideWall = 'solid' | 'lattice';

export interface FootwearParams {
  kind: FootwearKind;
  chappalStyle: ChappalStyle;
  shoeSizeUK: number;
  /** Gap between the foot and the footwear (mm) – design rule 1–2 mm. */
  clearance: number;
  /** Lattice strut diameter (mm) – design rule 1.2–1.8 mm. */
  strutDiameter: number;
  /** Lattice cell size (node spacing, mm). */
  cellSize: number;
  /** Sole height under the footbed at its thinnest point (mm). */
  soleThickness: number;
  /** Solid outsole plate under the lattice (mm). */
  outsoleThickness: number;
  /** Rise of the sole under the toes (mm). */
  toeSpring: number;
  /** Solid rim: height above the footbed at the heel (mm; lower towards the toes) and wall thickness. */
  rimHeight: number;
  wallThickness: number;
  /** Sole side: solid wall (chappal look) or an open lattice cage along the outline (lattice shoe look). */
  sideWall: SideWall;
  /** Extra length in front of the toes (mm). */
  toeAllowance: number;
  tread: TreadPattern;
  /** Chappal straps (solid). `position` = strap centre as a fraction of the length from the heel. */
  strap: { width: number; thickness: number; position: number };
  /** Thong / split-toe: width of the two strap arms (mm). */
  thongArmWidth: number;
  /** Shoe upper: collar height above the footbed, throat position (fraction of length), collar rim diameter. */
  shoe: { collarHeight: number; throat: number; collarDiameter: number };
}

export const FOOTWEAR_RULES = {
  strutDiameter: { min: 1.2, max: 1.8 },
  clearance: { min: 1, max: 2 },
} as const;

export const FOOTWEAR_RANGES = {
  clearance: { min: FOOTWEAR_RULES.clearance.min, max: FOOTWEAR_RULES.clearance.max, step: 0.1, unit: 'mm' },
  strutDiameter: { min: FOOTWEAR_RULES.strutDiameter.min, max: FOOTWEAR_RULES.strutDiameter.max, step: 0.05, unit: 'mm' },
  cellSize: { min: 4, max: 10, step: 0.5, unit: 'mm' },
  soleThickness: { min: 8, max: 35, step: 0.5, unit: 'mm' },
  outsoleThickness: { min: 1.5, max: 4, step: 0.1, unit: 'mm' },
  toeSpring: { min: 0, max: 15, step: 0.5, unit: 'mm' },
  rimHeight: { min: 0, max: 25, step: 0.5, unit: 'mm' },
  wallThickness: { min: 1.5, max: 4, step: 0.1, unit: 'mm' },
  toeAllowance: { min: 0, max: 20, step: 0.5, unit: 'mm' },
  strapWidth: { min: 30, max: 100, step: 1, unit: 'mm' },
  strapThickness: { min: 2, max: 5, step: 0.1, unit: 'mm' },
  strapPosition: { min: 0.45, max: 0.8, step: 0.01 },
  thongArmWidth: { min: 12, max: 35, step: 0.5, unit: 'mm' },
  collarHeight: { min: 25, max: 90, step: 1, unit: 'mm' },
  throat: { min: 0.4, max: 0.75, step: 0.01 },
  collarDiameter: { min: 2, max: 4, step: 0.1, unit: 'mm' },
} satisfies Record<string, Range>;

export function defaultFootwearParams(shoeSizeUK = 8, kind: FootwearKind = 'chappal'): FootwearParams {
  return {
    kind,
    chappalStyle: 'slide',
    shoeSizeUK,
    clearance: 1.5,
    strutDiameter: 1.5,
    cellSize: 6,
    soleThickness: kind === 'shoe' ? 14 : 16,
    outsoleThickness: 2.5,
    toeSpring: kind === 'shoe' ? 8 : 5,
    rimHeight: kind === 'shoe' ? 12 : 10,
    wallThickness: 2.5,
    sideWall: kind === 'shoe' ? 'lattice' : 'solid',
    toeAllowance: kind === 'shoe' ? 3 : 8,
    tread: 'hexagon',
    strap: { width: 65, thickness: 3, position: 0.6 },
    thongArmWidth: 20,
    shoe: { collarHeight: 45, throat: 0.58, collarDiameter: 3 },
  };
}

const clampTo = (v: unknown, r: Range, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, v)) : d);

/** Reads saved parameters, filling defaults and forcing the design-rule ranges. */
export function normalizeFootwearParams(raw: unknown): FootwearParams {
  const r = (raw ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const kind: FootwearKind = r.kind === 'shoe' ? 'shoe' : 'chappal';
  const d = defaultFootwearParams(typeof r.shoeSizeUK === 'number' ? r.shoeSizeUK : 8, kind);
  const R = FOOTWEAR_RANGES;
  return {
    ...d,
    chappalStyle: ['slide', 'thong', 'splitToe'].includes(r.chappalStyle) ? r.chappalStyle : d.chappalStyle,
    tread: ['none', 'hexagon', 'diamond', 'waves'].includes(r.tread) ? r.tread : d.tread,
    sideWall: r.sideWall === 'solid' || r.sideWall === 'lattice' ? r.sideWall : d.sideWall,
    clearance: clampTo(r.clearance, R.clearance, d.clearance),
    strutDiameter: clampTo(r.strutDiameter, R.strutDiameter, d.strutDiameter),
    cellSize: clampTo(r.cellSize, R.cellSize, d.cellSize),
    soleThickness: clampTo(r.soleThickness, R.soleThickness, d.soleThickness),
    outsoleThickness: clampTo(r.outsoleThickness, R.outsoleThickness, d.outsoleThickness),
    toeSpring: clampTo(r.toeSpring, R.toeSpring, d.toeSpring),
    rimHeight: clampTo(r.rimHeight, R.rimHeight, d.rimHeight),
    wallThickness: clampTo(r.wallThickness, R.wallThickness, d.wallThickness),
    toeAllowance: clampTo(r.toeAllowance, R.toeAllowance, d.toeAllowance),
    strap: {
      width: clampTo(r.strap?.width, R.strapWidth, d.strap.width),
      thickness: clampTo(r.strap?.thickness, R.strapThickness, d.strap.thickness),
      position: clampTo(r.strap?.position, R.strapPosition, d.strap.position),
    },
    thongArmWidth: clampTo(r.thongArmWidth, R.thongArmWidth, d.thongArmWidth),
    shoe: {
      collarHeight: clampTo(r.shoe?.collarHeight, R.collarHeight, d.shoe.collarHeight),
      throat: clampTo(r.shoe?.throat, R.throat, d.shoe.throat),
      collarDiameter: clampTo(r.shoe?.collarDiameter, R.collarDiameter, d.shoe.collarDiameter),
    },
  };
}

export const FOOTWEAR_KIND_LABEL: Record<FootwearKind, string> = { shoe: 'Shoe', chappal: 'Chappal' };
export const CHAPPAL_STYLE_LABEL: Record<ChappalStyle, string> = {
  slide: 'Slide (wide strap)',
  thong: 'Thong (Y-strap, toe post)',
  splitToe: 'Split-toe thong',
};
export const SIDE_WALL_LABEL: Record<SideWall, string> = { solid: 'Solid wall', lattice: 'Lattice (open cage)' };
export const TREAD_LABEL: Record<TreadPattern, string> = { none: 'None', hexagon: 'Hexagon', diamond: 'Diamond', waves: 'Waves' };
