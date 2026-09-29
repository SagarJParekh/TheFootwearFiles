import { useEffect, useState } from 'react';
import { SCAN_TYPE_LABEL, SIDE_LABEL, landmarksForScanType, type ScanType, type Side } from '../core/landmarks/definitions';
import { UNIT_LABEL, UNIT_TO_MM, type LengthUnit, type UpAxis } from '../core/units';
import { reinterpretImport } from '../state/actions';
import { emptyHistory } from '../state/history';
import { commit, useStore } from '../state/store';

const UNITS: LengthUnit[] = ['mm', 'cm', 'm', 'in', 'ft'];
const SOURCE_NOTE = { file: 'from the file', guess: 'guessed from the model size – please check', user: 'set by you' } as const;

/** Asked on load: which scan type (decides the landmark set) and which foot. */
export function ScanSetupDialog() {
  const open = useStore((s) => s.scanDialogOpen);
  const current = useStore((s) => s.doc?.scan);
  const [type, setType] = useState<ScanType>(current?.type ?? 'plantar');
  const [side, setSide] = useState<Side>(current?.side ?? 'right');
  const importInfo = useStore((s) => s.doc?.meta.import);
  const locked = useStore((s) => !!s.doc?.basePlaneLocked);
  const bounds = useStore((s) => s.derived?.stats.bounds);
  const [units, setUnits] = useState<LengthUnit>(importInfo?.units ?? 'mm');
  const [upAxis, setUpAxis] = useState<UpAxis>(importInfo?.upAxis ?? 'z');

  useEffect(() => {
    if (open) {
      setType(current?.type ?? 'plantar');
      setSide(current?.side ?? 'right');
      setUnits(importInfo?.units ?? 'mm');
      setUpAxis(importInfo?.upAxis ?? 'z');
    }
  }, [open, current, importInfo]);

  if (!open) return null;

  const confirm = () => {
    const firstTime = !useStore.getState().doc?.scan;
    reinterpretImport(units, upAxis);
    const doc = useStore.getState().doc;
    if (doc && firstTime) {
      // First-time setup right after loading is part of the load, not an undoable edit.
      useStore.setState({ doc: { ...doc, scan: { type, side } }, scanDialogOpen: false, history: emptyHistory() });
      return;
    }
    commit('Scan setup', (doc) => {
      if (doc.scan?.type === type && doc.scan.side === side) return doc;
      // Drop landmarks that are not offered for the new scan type.
      const allowed = new Set(landmarksForScanType(type).map((l) => l.id));
      const landmarks = Object.fromEntries(Object.entries(doc.landmarks).filter(([id]) => allowed.has(id as never)));
      return { ...doc, scan: { type, side }, landmarks };
    });
    useStore.setState({ scanDialogOpen: false });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="scan-setup-title">
      <div className="modal">
        <h2 id="scan-setup-title">Scan setup</h2>
        <fieldset>
          <legend>Scan type</legend>
          {(['plantar', 'lowerLimb'] as ScanType[]).map((t) => (
            <label key={t} className="radio">
              <input type="radio" name="scanType" checked={type === t} onChange={() => setType(t)} />
              {SCAN_TYPE_LABEL[t]}
              <small>{landmarksForScanType(t).map((l) => l.shortLabel).join(', ')}</small>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Foot</legend>
          {(['left', 'right'] as Side[]).map((s) => (
            <label key={s} className="radio">
              <input type="radio" name="side" checked={side === s} onChange={() => setSide(s)} />
              {SIDE_LABEL[s]}
            </label>
          ))}
        </fieldset>
        {importInfo && (
          <fieldset>
            <legend>File interpretation</legend>
            <div className="row">
              <label>
                Units
                <select value={units} disabled={locked} onChange={(e) => setUnits(e.target.value as LengthUnit)} data-testid="units-select">
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABEL[u]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Up axis
                <select value={upAxis} disabled={locked} onChange={(e) => setUpAxis(e.target.value as UpAxis)}>
                  <option value="z">Z up</option>
                  <option value="y">Y up</option>
                </select>
              </label>
            </div>
            {locked && <p className="hint warn" style={{ marginTop: 0 }}>Locked by the base plane – release it to change units or axis.</p>}
            <p className="hint" style={{ marginTop: 0 }}>
              Units {SOURCE_NOTE[units === importInfo.units ? importInfo.unitsSource : 'user']}.
              {bounds && (
                <>
                  {' '}
                  Size in mm:{' '}
                  <b data-testid="setup-size">
                    {bounds.max
                      .map((v, i) => ((v - bounds.min[i]) * UNIT_TO_MM[units]) / UNIT_TO_MM[importInfo.units])
                      .map((v) => v.toFixed(0))
                      .join(' × ')}
                  </b>
                  {' '}(a foot is ~220–300 mm long).
                </>
              )}
            </p>
          </fieldset>
        )}
        <p className="hint">
          Coordinate convention: Z up, +Y towards the toes, +X to the patient's right. Side decides which way the
          medial/lateral views look.
        </p>
        <div className="modal-actions">
          {current && <button onClick={() => useStore.setState({ scanDialogOpen: false })}>Cancel</button>}
          <button className="primary" onClick={confirm} data-testid="scan-setup-ok">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
