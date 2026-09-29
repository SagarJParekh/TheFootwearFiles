import { useEffect, useState } from 'react';
import { SCAN_TYPE_LABEL, SIDE_LABEL, landmarksForScanType, type ScanType, type Side } from '../core/landmarks/definitions';
import { commit, useStore } from '../state/store';

/** Asked on load: which scan type (decides the landmark set) and which foot. */
export function ScanSetupDialog() {
  const open = useStore((s) => s.scanDialogOpen);
  const current = useStore((s) => s.doc?.scan);
  const [type, setType] = useState<ScanType>(current?.type ?? 'plantar');
  const [side, setSide] = useState<Side>(current?.side ?? 'right');

  useEffect(() => {
    if (open) {
      setType(current?.type ?? 'plantar');
      setSide(current?.side ?? 'right');
    }
  }, [open, current]);

  if (!open) return null;

  const confirm = () => {
    const doc = useStore.getState().doc;
    if (doc && !doc.scan) {
      // First-time setup right after loading is part of the load, not an undoable edit.
      useStore.setState({ doc: { ...doc, scan: { type, side } }, scanDialogOpen: false });
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
