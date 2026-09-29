import { computeBounds } from '../core/mesh/analyze';
import { weldSoup } from '../core/mesh/weld';
import type { MeshData } from '../core/types';
import { convertPositions, guessUnits, UNIT_TO_MM, type ImportInfo, type LengthUnit, type UpAxis } from '../core/units';
import type { FormatInfo } from './registry';
import type { ParsedModel } from './workerParsers';

export interface ImportOverrides {
  units?: LengthUnit;
  upAxis?: UpAxis;
}

/**
 * Turns a parsed soup into the app's canonical mesh: millimetres, Z up, welded.
 * Units come from (in order) the user, the file, the format spec, or a size-based guess.
 */
export function finishImport(parsed: ParsedModel, format: FormatInfo, overrides: ImportOverrides = {}): { mesh: MeshData; info: ImportInfo } {
  const { soup } = parsed;
  if (soup.length === 0) throw new Error('The file contains no triangles');

  let units: LengthUnit;
  let unitsSource: ImportInfo['unitsSource'];
  if (overrides.units) [units, unitsSource] = [overrides.units, 'user'];
  else if (parsed.units) [units, unitsSource] = [parsed.units, 'file'];
  else if (format.units) [units, unitsSource] = [format.units, 'file'];
  else {
    const b = computeBounds(soup);
    units = guessUnits(Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]));
    unitsSource = 'guess';
  }
  const upAxis: UpAxis = overrides.upAxis ?? format.upAxis ?? 'z';
  const upAxisSource: ImportInfo['upAxisSource'] = overrides.upAxis ? 'user' : format.upAxis ? 'file' : 'guess';

  convertPositions(soup, UNIT_TO_MM[units], upAxis === 'y');
  return {
    mesh: weldSoup(soup),
    info: { format: format.id, units, unitsSource, upAxis, upAxisSource },
  };
}
