import { describe, expect, it } from 'vitest';
import { closedFoot, lowerLimbScan, plantarScan } from '../fixtures/footShapes';
import { finishImport } from '../../formats/finishImport';
import { formatForFile } from '../../formats/registry';
import { detectToeTurn } from './footOrient';

/** Copy of `p` turned about Z by `deg` (90° steps). */
function turned(p: Float32Array, deg: number): Float32Array {
  const out = new Float32Array(p.length);
  const c = Math.round(Math.cos((deg * Math.PI) / 180)), s = Math.round(Math.sin((deg * Math.PI) / 180));
  for (let i = 0; i < p.length; i += 3) {
    out[i] = c * p[i] - s * p[i + 1];
    out[i + 1] = s * p[i] + c * p[i + 1];
    out[i + 2] = p[i + 2];
  }
  return out;
}

describe('toe direction', () => {
  it('finds the toes of a foot scan pointing any way along the floor (by the ankle, or the forefoot width)', () => {
    for (const [name, m] of [['closed foot', closedFoot(4)], ['plantar scan', plantarScan(4)]] as const) {
      // fixtures point their toes along +Y; turning the scan by d needs a turn of −d back
      for (const d of [0, 90, 180, -90]) {
        const r = detectToeTurn(turned(m.positions, d));
        expect(r, `${name} turned ${d}°`).not.toBeNull();
        expect(((r!.turn + d) % 360 + 360) % 360, `${name} turned ${d}°`).toBe(0);
      }
    }
    expect(detectToeTurn(closedFoot(4).positions)!.by).toBe('height');
  });

  it('leaves models alone that do not lie on the floor like a foot', () => {
    // standing on end (the leg of a lower-limb scan is taller than the foot is long)
    expect(detectToeTurn(lowerLimbScan(6).positions)).toBeNull();
  });
});

describe('import units', () => {
  const soup = (scale: number) => {
    const m = closedFoot(6);
    const s = new Float32Array(m.indices.length * 3);
    m.indices.forEach((v, i) => {
      for (let k = 0; k < 3; k++) s[3 * i + k] = m.positions[3 * v + k] * scale;
    });
    return s;
  };
  it('falls back to a size-based guess when the units stated by the file give an impossible foot', () => {
    // glTF means metres, but scanning apps often write millimetres
    const r = finishImport({ soup: soup(1), units: null }, formatForFile('scan.glb')!, {});
    expect(r.info.units).toBe('mm');
    expect(r.info.unitsSource).toBe('guess');
    expect(r.info.note).toMatch(/metres/);
    // a real metres file stays metres
    const ok = finishImport({ soup: soup(0.001), units: null }, formatForFile('scan.glb')!, {});
    expect(ok.info.units).toBe('m');
    expect(ok.info.note).toBeUndefined();
    // the user's choice always wins
    expect(finishImport({ soup: soup(1), units: null }, formatForFile('scan.glb')!, { units: 'm' }).info.units).toBe('m');
  });
});
