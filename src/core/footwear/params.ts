/**
 * Parametric footwear designed from the same scan, landmarks and plantar sampling as the
 * insole. The outer shape is a standard product shape (smooth outline, level rim, rounded
 * edges, smooth straps / upper that enclose the foot); only the footbed – the insole part – is
 * contoured to the foot. The sole is a 3D-printed lattice under that footbed.
 *
 * Design rules (enforced by the parameter ranges and checked on the generated result):
 *  - lattice strut diameter 1.2 – 1.8 mm
 *  - clearance between the foot and the footwear 1 – 2 mm
 */
import type { Range } from '../insole/params';
import { normalizeDetail, type MeshDetail } from '../detail';

export type FootwearKind = 'shoe' | 'chappal';
export type ChappalStyle = 'slide' | 'thong' | 'splitToe';
export type TreadPattern = 'none' | 'hexagon' | 'diamond' | 'waves';
export type SideWall = 'solid' | 'lattice';
export type ShoeFinish = 'solid' | 'lattice';
/** Chappal straps / wings: a smooth solid sheet, or an open lattice panel with a solid border. */
export type StrapPattern = 'solid' | 'lattice';
/** Shoe upper lattice: triangulated grid, or diamonds (a knit look). */
export type UpperPattern = 'grid' | 'diamond';
/** Presets modelled on the team's reference designs (see REFERENCE_DESIGNS). */
export type DesignId = 'custom' | 'classicSlide' | 'latticeSlide' | 'sleekSlide' | 'splitToeThong' | 'latticeThong' | 'latticeSneaker' | 'knitSlipOn';

export interface FootwearParams {
  kind: FootwearKind;
  /** The reference design the parameters were last set from ('custom' = none). */
  design: DesignId;
  /** Mesh detail (surface grid, strut roundness, strap sampling). */
  detail: MeshDetail;
  /**
   * Smooth fused joins: the solid parts are fused into one surface with fillets at every junction
   * (like the reference designs) instead of overlapping parts. Slower (tens of seconds).
   */
  smoothJoins: boolean;
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
  /** Smooth solid skin on the contoured footbed (over the lattice) instead of an open lattice top. */
  footbedSkin: boolean;
  /** Extra length in front of the toes (mm). */
  toeAllowance: number;
  tread: TreadPattern;
  /**
   * Chappal straps (solid). Slide: `width` = length of the vamp on top of the foot, `position` =
   * its centre as a fraction of the foot length from the heel (the sides sweep further back).
   */
  strap: { width: number; thickness: number; position: number };
  /** Straps / wings: solid, or a lattice panel with a solid border. */
  strapPattern: StrapPattern;
  /** Shoe upper lattice pattern. */
  upperPattern: UpperPattern;
  /** Thong / split-toe: width of each strap wing where it grows out of the sole wall (mm). */
  thongArmWidth: number;
  /**
   * Shoe upper: collar height above the footbed, throat position (fraction of length), collar rim
   * diameter, and how far the top of the collar rim stays below each malleolus (when placed).
   */
  shoe: {
    collarHeight: number;
    throat: number;
    /** Lattice finish: height of the solid collar rim band (mm). */
    collarDiameter: number;
    malleolusGap: number;
    /** Upper wall thickness (mm). */
    wall: number;
    /** Design the shoe as a smooth solid first; switch to lattice at the end. */
    finish: ShoeFinish;
  };
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
  wallThickness: { min: 1.5, max: 8, step: 0.1, unit: 'mm' },
  toeAllowance: { min: 0, max: 20, step: 0.5, unit: 'mm' },
  strapWidth: { min: 30, max: 100, step: 1, unit: 'mm' },
  strapThickness: { min: 2, max: 8, step: 0.1, unit: 'mm' },
  strapPosition: { min: 0.45, max: 0.8, step: 0.01 },
  thongArmWidth: { min: 25, max: 80, step: 1, unit: 'mm' },
  collarHeight: { min: 25, max: 90, step: 1, unit: 'mm' },
  throat: { min: 0.4, max: 0.75, step: 0.01 },
  collarDiameter: { min: 2, max: 12, step: 0.5, unit: 'mm' },
  shoeWall: { min: 2.5, max: 8, step: 0.1, unit: 'mm' },
  malleolusGap: { min: 3, max: 15, step: 0.5, unit: 'mm' },
} satisfies Record<string, Range>;

export function defaultFootwearParams(shoeSizeUK = 8, kind: FootwearKind = 'chappal'): FootwearParams {
  return {
    kind,
    design: kind === 'shoe' ? 'latticeSneaker' : 'classicSlide',
    detail: 'standard',
    smoothJoins: false,
    chappalStyle: 'slide',
    shoeSizeUK,
    clearance: 1.5,
    strutDiameter: 1.5,
    cellSize: 6,
    soleThickness: kind === 'shoe' ? 9 : 10,
    outsoleThickness: 2.5,
    toeSpring: 8,
    rimHeight: kind === 'shoe' ? 8 : 10,
    wallThickness: 2.5,
    sideWall: kind === 'shoe' ? 'lattice' : 'solid',
    footbedSkin: false,
    toeAllowance: kind === 'shoe' ? 3 : 8,
    tread: 'hexagon',
    strap: { width: 75, thickness: 3, position: 0.66 },
    strapPattern: 'solid',
    upperPattern: 'grid',
    thongArmWidth: 55,
    shoe: { collarHeight: 55, throat: 0.45, collarDiameter: 5, malleolusGap: 5, wall: 4, finish: 'solid' },
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
    footbedSkin: typeof r.footbedSkin === 'boolean' ? r.footbedSkin : d.footbedSkin,
    detail: normalizeDetail(r.detail),
    smoothJoins: typeof r.smoothJoins === 'boolean' ? r.smoothJoins : d.smoothJoins,
    design: typeof r.design === 'string' && (r.design === 'custom' || r.design in REFERENCE_DESIGNS) ? (r.design as DesignId) : d.design,
    strapPattern: r.strapPattern === 'lattice' || r.strapPattern === 'solid' ? r.strapPattern : d.strapPattern,
    upperPattern: r.upperPattern === 'diamond' || r.upperPattern === 'grid' ? r.upperPattern : d.upperPattern,
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
      malleolusGap: clampTo(r.shoe?.malleolusGap, R.malleolusGap, d.shoe.malleolusGap),
      wall: clampTo(r.shoe?.wall, R.shoeWall, d.shoe.wall),
      finish: r.shoe?.finish === 'lattice' ? 'lattice' : 'solid',
    },
  };
}

export const FOOTWEAR_KIND_LABEL: Record<FootwearKind, string> = { shoe: 'Shoe', chappal: 'Chappal' };
export const CHAPPAL_STYLE_LABEL: Record<ChappalStyle, string> = {
  slide: 'Slide (wide strap)',
  thong: 'Thong (wings, toe post)',
  splitToe: 'Split-toe thong',
};
export const SIDE_WALL_LABEL: Record<SideWall, string> = { solid: 'Solid wall', lattice: 'Lattice (open cage)' };
export const TREAD_LABEL: Record<TreadPattern, string> = { none: 'None', hexagon: 'Hexagon', diamond: 'Diamond', waves: 'Waves' };

export const STRAP_PATTERN_LABEL: Record<StrapPattern, string> = { solid: 'Solid (smooth)', lattice: 'Lattice panel (open, solid border)' };
export const UPPER_PATTERN_LABEL: Record<UpperPattern, string> = { grid: 'Grid (triangles, braced)', diamond: 'Diamond (knit look)' };

/**
 * Reference designs: parameter sets modelled on the team's reference STLs (measured sole and rim
 * heights, strap coverage and thickness, lattice pattern, tread). Choosing one sets these
 * parameters; everything can still be adjusted afterwards.
 */
export const REFERENCE_DESIGNS: Record<Exclude<DesignId, 'custom'>, { kind: FootwearKind; label: string; like: string; set: (p: FootwearParams) => FootwearParams }> = {
  classicSlide: {
    kind: 'chappal', label: 'Classic slide', like: 'Parth, Atit',
    set: (p) => ({ ...p, chappalStyle: 'slide', strapPattern: 'solid', soleThickness: 11, rimHeight: 10, tread: 'hexagon', toeAllowance: 8, strap: { ...p.strap, width: 75, thickness: 3, position: 0.66 } }),
  },
  latticeSlide: {
    kind: 'chappal', label: 'Lattice-vamp slide', like: 'Rushik, Atheka, Anmol',
    set: (p) => ({ ...p, chappalStyle: 'slide', strapPattern: 'lattice', soleThickness: 11, rimHeight: 10, tread: 'diamond', toeAllowance: 8, strap: { ...p.strap, width: 80, thickness: 3.5, position: 0.66 } }),
  },
  sleekSlide: {
    kind: 'chappal', label: 'Sleek low slide', like: 'Jigar',
    set: (p) => ({ ...p, chappalStyle: 'slide', strapPattern: 'solid', soleThickness: 8, rimHeight: 8, tread: 'hexagon', toeAllowance: 6, strap: { ...p.strap, width: 70, thickness: 2.5, position: 0.66 } }),
  },
  splitToeThong: {
    kind: 'chappal', label: 'Split-toe lattice thong', like: 'Aashay',
    set: (p) => ({ ...p, chappalStyle: 'splitToe', strapPattern: 'lattice', soleThickness: 9, rimHeight: 6, tread: 'diamond', toeAllowance: 6, thongArmWidth: 80, strap: { ...p.strap, thickness: 3.5 } }),
  },
  latticeThong: {
    kind: 'chappal', label: 'Lattice thong', like: 'Saagr',
    set: (p) => ({ ...p, chappalStyle: 'thong', strapPattern: 'lattice', soleThickness: 9, rimHeight: 7, tread: 'waves', toeAllowance: 6, thongArmWidth: 75, strap: { ...p.strap, thickness: 3.5 } }),
  },
  latticeSneaker: {
    kind: 'shoe', label: 'Lattice sneaker', like: 'Shoes, Sagar_Shoes_red',
    set: (p) => ({ ...p, upperPattern: 'grid', sideWall: 'lattice', cellSize: 7, soleThickness: 9, tread: 'hexagon', shoe: { ...p.shoe, collarHeight: 60, throat: 0.45 } }),
  },
  knitSlipOn: {
    kind: 'shoe', label: 'Knit slip-on', like: 'Left/Right shoe_v1, sagar shoes',
    set: (p) => ({ ...p, upperPattern: 'diamond', sideWall: 'lattice', cellSize: 6, soleThickness: 9, tread: 'diamond', shoe: { ...p.shoe, collarHeight: 55, throat: 0.45 } }),
  },
};

export const SHOE_FINISH_LABEL: Record<ShoeFinish, string> = { solid: 'Solid (design the shape first)', lattice: 'Lattice (final)' };
