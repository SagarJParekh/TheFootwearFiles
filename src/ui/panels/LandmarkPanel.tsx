import { useRef } from 'react';
import { ANKLE_LANDMARKS, landmarksForScanType, SCAN_TYPE_LABEL, SIDE_LABEL } from '../../core/landmarks/definitions';
import { applyTransform } from '../../core/math/transform';
import {
  clearAllLandmarks,
  deleteLandmark,
  exportLandmarksCsv,
  exportLandmarksJson,
  importLandmarksFile,
  selectLandmark,
} from '../../state/landmarkActions';
import { useStore } from '../../state/store';
import { Panel, downloadBlob, fmt } from '../common';

const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || 'scan';

export function LandmarkPanel() {
  const doc = useStore((s) => s.doc);
  const active = useStore((s) => s.activeLandmark);
  const tool = useStore((s) => s.tool);
  const footwear = useStore((s) => s.designCategory === 'footwear');
  const offSurface = useStore((s) => s.offSurface);
  const importRef = useRef<HTMLInputElement>(null);
  if (!doc) return null;
  if (!doc.scan) {
    return (
      <Panel title="Landmarks">
        <p className="hint">Choose the scan type and side first.</p>
        <button onClick={() => useStore.setState({ scanDialogOpen: true })}>Scan setup…</button>
      </Panel>
    );
  }
  // footwear adds the malleoli (also shown once placed, whatever is being designed)
  const withAnkle = footwear || ANKLE_LANDMARKS.some((id) => doc.landmarks[id]);
  const defs = landmarksForScanType(doc.scan.type, withAnkle);
  const ankleMissing = withAnkle && doc.scan.type === 'plantar' && ANKLE_LANDMARKS.some((id) => !doc.landmarks[id]);
  const placed = defs.filter((d) => doc.landmarks[d.id]).length;

  return (
    <Panel title={`Landmarks (${placed}/${defs.length})`}>
      <p className="hint" style={{ marginTop: 0 }}>
        {SCAN_TYPE_LABEL[doc.scan.type]} · {SIDE_LABEL[doc.scan.side]} foot.{' '}
        {tool === 'landmark' && active ? 'Click the surface to place the highlighted landmark.' : 'Select a landmark, then click the surface.'}
      </p>
      {footwear && ANKLE_LANDMARKS.some((id) => !doc.landmarks[id]) && (
        <p className="hint warn" data-testid="ankle-landmarks-hint">
          Footwear: also place the <b>medial (MM)</b> and <b>lateral (LM) malleolus</b> – the most prominent point of each ankle bone. The shoe collar is kept below them.
          {ankleMissing ? ' (This scan type is a plantar scan: place them only if the scan shows the ankle.)' : ''}
        </p>
      )}
      <ul className="lm-list" data-testid="landmark-list">
        {defs.map((def) => {
          const l = doc.landmarks[def.id];
          const off = offSurface[def.id];
          const world = l ? applyTransform(doc.transform, l.local) : null;
          const selected = active === def.id && tool === 'landmark';
          return (
            <li
              key={def.id}
              className={`lm-item ${selected ? 'selected' : ''}`}
              onClick={() => selectLandmark(selected ? null : def.id)}
              title={def.hint}
              data-testid={`lm-${def.id}`}
            >
              <div className="lm-row">
                <span className="lm-dot" style={{ background: def.colour }} />
                <span className="lm-name">{def.label}</span>
                {l ? (
                  off !== undefined ? (
                    <span className="lm-status off" title={`${fmt(off, 2)} mm from the current surface`}>
                      off surface
                    </span>
                  ) : (
                    <span className="lm-status placed">placed</span>
                  )
                ) : (
                  <span className="lm-status missing">missing</span>
                )}
                {l && (
                  <button
                    className="link"
                    title="Delete landmark"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteLandmark(def.id);
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
              {world && (
                <div className="lm-coords" title="World coordinates (mm)">
                  X {fmt(world[0])} · Y {fmt(world[1])} · Z {fmt(world[2])}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="button-row">
        <button
          disabled={!placed}
          onClick={() => downloadBlob(exportLandmarksJson()!, `${baseName(doc.meta.sourceFileName)}-landmarks.json`, 'application/json')}
        >
          Export JSON
        </button>
        <button
          disabled={!placed}
          onClick={() => downloadBlob(exportLandmarksCsv()!, `${baseName(doc.meta.sourceFileName)}-landmarks.csv`, 'text/csv')}
        >
          Export CSV
        </button>
        <button onClick={() => importRef.current?.click()}>Import JSON…</button>
        <input
          ref={importRef}
          type="file"
          accept=".json"
          hidden
          data-testid="landmark-import"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importLandmarksFile(f);
            e.target.value = '';
          }}
        />
        <button className="danger" disabled={!placed} onClick={clearAllLandmarks}>
          Clear all
        </button>
      </div>
      <p className="hint">Coordinates shown are world (after transform); landmarks are stored in mesh-local coordinates.</p>
    </Panel>
  );
}
