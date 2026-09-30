/** Length units a model file may be authored in; everything is converted to millimetres on import. */
export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

export const UNIT_TO_MM: Record<LengthUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

export const UNIT_LABEL: Record<LengthUnit, string> = {
  mm: 'Millimetres', cm: 'Centimetres', m: 'Metres', in: 'Inches', ft: 'Feet',
};

/** How the import settings were decided. */
export type ImportSource = 'file' | 'guess' | 'user';

export type UpAxis = 'z' | 'y';

/** How the source file was interpreted; stored in the document so it can be changed after loading. */
export interface ImportInfo {
  format: string;
  units: LengthUnit;
  unitsSource: ImportSource;
  /** Up axis of the file; Y-up files are rotated so the app's Z is up. */
  upAxis: UpAxis;
  upAxisSource: ImportSource;
  /** Why the units differ from what the file states (e.g. a glTF in millimetres instead of metres). */
  note?: string;
}

/** Largest plausible size (mm) of a foot / lower-limb scan; files that would be bigger were misread. */
export const MAX_PLAUSIBLE_MM = 2500;

/**
 * Guesses the units of a unit-less file from its size, assuming it is a foot / lower-limb scan
 * (roughly 100–1000 mm across). Only overrides millimetres when the model would be implausibly small.
 */
export function guessUnits(maxDimension: number): LengthUnit {
  if (maxDimension <= 0) return 'mm';
  if (maxDimension < 2.5) return 'm';
  if (maxDimension < 70) return 'cm';
  return 'mm';
}

/** Parses unit names found in 3MF / AMF / 3DM / DAE files. */
export function parseUnitName(name: string | undefined | null): LengthUnit | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  if (n.startsWith('millimet') || n === 'mm') return 'mm';
  if (n.startsWith('centimet') || n === 'cm') return 'cm';
  if (n.startsWith('met') || n === 'm') return 'm';
  if (n.startsWith('inch') || n === 'in') return 'in';
  if (n.startsWith('f') && (n.startsWith('foot') || n.startsWith('feet') || n === 'ft')) return 'ft';
  return null;
}

/** Maps a scale in metres-per-unit (e.g. COLLADA <unit meter="0.001">) to the nearest known unit. */
export function unitFromMetres(metresPerUnit: number): LengthUnit | null {
  if (!Number.isFinite(metresPerUnit) || metresPerUnit <= 0) return null;
  const mm = metresPerUnit * 1000;
  let best: LengthUnit | null = null;
  let bestErr = Infinity;
  for (const [u, f] of Object.entries(UNIT_TO_MM) as [LengthUnit, number][]) {
    const err = Math.abs(Math.log(mm / f));
    if (err < bestErr) {
      bestErr = err;
      best = u;
    }
  }
  return bestErr < 0.05 ? best : null;
}

/**
 * Converts positions in place: scale to millimetres and rotate a Y-up file to Z-up
 * ((x, y, z) → (x, −z, y), i.e. +90° about X).
 */
export function convertPositions(positions: Float32Array, scale: number, yUpToZUp: boolean): void {
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] * scale, y = positions[i + 1] * scale, z = positions[i + 2] * scale;
    if (yUpToZUp) {
      positions[i] = x;
      positions[i + 1] = -z;
      positions[i + 2] = y;
    } else {
      positions[i] = x;
      positions[i + 1] = y;
      positions[i + 2] = z;
    }
  }
}

/**
 * Re-interprets already-imported millimetre / Z-up coordinates after the user changes the
 * file's units or up axis: undoes the old conversion and applies the new one.
 * Returns a function mapping one point, plus a bulk version for position arrays.
 */
export function reinterpretation(from: Pick<ImportInfo, 'units' | 'upAxis'>, to: Pick<ImportInfo, 'units' | 'upAxis'>) {
  const s = UNIT_TO_MM[to.units] / UNIT_TO_MM[from.units];
  // undo old axis conversion: Z-up app coords back to file axes
  const undo = (x: number, y: number, z: number): [number, number, number] => (from.upAxis === 'y' ? [x, z, -y] : [x, y, z]);
  const redo = (x: number, y: number, z: number): [number, number, number] => (to.upAxis === 'y' ? [x, -z, y] : [x, y, z]);
  const point = (p: [number, number, number]): [number, number, number] => {
    const [a, b, c] = undo(p[0], p[1], p[2]);
    return redo(a * s, b * s, c * s);
  };
  const positions = (src: Float32Array): Float32Array => {
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      const r = point([src[i], src[i + 1], src[i + 2]]);
      out[i] = r[0];
      out[i + 1] = r[1];
      out[i + 2] = r[2];
    }
    return out;
  };
  return { point, positions, identity: s === 1 && from.upAxis === to.upAxis };
}
