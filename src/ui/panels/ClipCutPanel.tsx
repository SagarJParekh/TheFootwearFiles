import { useState } from 'react';
import { alignClip, clipRange, cutWithClipPlane, flipClip } from '../../state/clipActions';
import { setClip, useStore } from '../../state/store';
import { Panel, Toggle } from '../common';

const AXES = ['X', 'Y', 'Z'] as const;

export function ClipCutPanel() {
  const clip = useStore((s) => s.clip);
  const watertight = useStore((s) => s.derived?.stats.watertight ?? false);
  const busy = useStore((s) => !!s.busy);
  useStore((s) => s.doc?.transform); // slider range follows the model
  const [keep, setKeep] = useState<'visible' | 'hidden'>('visible');
  const [cap, setCap] = useState(true);
  const [lo, hi] = clipRange(clip.normal);
  const pad = (hi - lo) * 0.02 + 0.5;
  const n = clip.normal;
  const axisAligned = n.filter((v) => Math.abs(v) > 0.9999).length === 1;

  return (
    <Panel title="Clip & cut">
      <Toggle label="Clipping plane (non-destructive)" checked={clip.enabled} onChange={(v) => (v ? alignClip(2, -1) : setClip({ enabled: false, gizmo: 'none' }))} />
      {clip.enabled && (
        <>
          <div className="field-group-label">Align to axis (through model centre)</div>
          <div className="button-row small">
            {AXES.map((a, i) => (
              <span key={a} className="pair">
                <button onClick={() => alignClip(i as 0 | 1 | 2, 1)} title={`Normal +${a}: show the +${a} side`}>+{a}</button>
                <button onClick={() => alignClip(i as 0 | 1 | 2, -1)} title={`Normal −${a}: show the −${a} side`}>−{a}</button>
              </span>
            ))}
            <button onClick={flipClip} title="Show the other side">Flip</button>
          </div>
          <div className="row">
            <span>Offset</span>
            <input
              type="range"
              min={lo - pad}
              max={hi + pad}
              step={(hi - lo) / 500 || 0.1}
              value={clip.constant}
              onChange={(e) => setClip({ constant: parseFloat(e.target.value) })}
              data-testid="clip-offset"
            />
            <input
              type="number"
              value={Math.round(clip.constant * 100) / 100}
              step={0.5}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) setClip({ constant: v });
              }}
            />
          </div>
          <div className="hint" style={{ marginTop: 0 }}>
            Normal ({n.map((v) => v.toFixed(2)).join(', ')}){axisAligned ? '' : ' – free orientation'}
          </div>
          <div className="button-row">
            <button className={clip.gizmo === 'translate' ? 'active' : ''} onClick={() => setClip({ gizmo: clip.gizmo === 'translate' ? 'none' : 'translate' })}>
              Drag plane
            </button>
            <button className={clip.gizmo === 'rotate' ? 'active' : ''} onClick={() => setClip({ gizmo: clip.gizmo === 'rotate' ? 'none' : 'rotate' })}>
              Rotate plane
            </button>
            <Toggle label="Show plane" checked={clip.showPlane} onChange={(v) => setClip({ showPlane: v })} />
          </div>

          <div className="field-group-label">Cut (destructive, undoable)</div>
          <div className="row">
            <label>
              <input type="radio" checked={keep === 'visible'} onChange={() => setKeep('visible')} /> Keep visible side
            </label>
            <label>
              <input type="radio" checked={keep === 'hidden'} onChange={() => setKeep('hidden')} /> Keep hidden side
            </label>
          </div>
          <Toggle label="Cap the cut (close the section)" checked={cap} onChange={setCap} />
          <div className="button-row">
            <button className="primary" disabled={busy} onClick={() => void cutWithClipPlane(keep, cap)} data-testid="cut-button">
              Cut mesh
            </button>
          </div>
          <p className="hint">
            {cap && watertight
              ? 'Watertight mesh: cut with manifold-3d (≤1.5M triangles) or a verified plane split – result stays closed.'
              : cap
                ? 'Open mesh: plane split + flat cap of every closed section loop.'
                : 'Section is left open.'}
          </p>
        </>
      )}
    </Panel>
  );
}
