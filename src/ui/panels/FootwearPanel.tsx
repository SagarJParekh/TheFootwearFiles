import { useState } from 'react';
import { UK_SIZES, insoleLengthMm } from '../../core/insole/params';
import {
  CHAPPAL_STYLE_LABEL, FOOTWEAR_RANGES as R, FOOTWEAR_RULES, SIDE_WALL_LABEL, TREAD_LABEL,
  type ChappalStyle, type FootwearKind, type FootwearParams, type SideWall, type TreadPattern,
} from '../../core/footwear/params';
import { exportFootwearStl, footwearGesture, setFootwearEnabled, setFootwearKind, updateFootwear } from '../../state/footwearActions';
import { useStore } from '../../state/store';
import { Panel, downloadBlob } from '../common';
import { ScanDisplayToggle } from '../ScanDisplayToggle';
import { Field, SelectField, SliderField, Switch, type ParamApi } from './designControls';

const api: ParamApi<FootwearParams> = { ...footwearGesture, commit: updateFootwear };

function Slider(props: { label: string; range: (typeof R)[keyof typeof R]; value: number; set: (p: FootwearParams, v: number) => FootwearParams; testId?: string }) {
  return <SliderField<FootwearParams> {...props} api={api} />;
}

const KIND_INFO: Record<FootwearKind, { title: string; sub: string }> = {
  chappal: { title: 'Chappal', sub: 'Lattice footbed · solid strap' },
  shoe: { title: 'Shoe', sub: 'Lattice upper · lattice sole' },
};

/** Sections 2b–4 of the designer when the "Footwear" category is chosen. */
export function FootwearPanel({ ready }: { ready: boolean }) {
  const doc = useStore((s) => s.doc);
  const busy = useStore((s) => s.footwearBusy);
  const error = useStore((s) => s.footwearError);
  const result = useStore((s) => s.footwear?.output);
  const pendingKind = useStore((s) => s.pendingFootwearKind);
  const [merge, setMerge] = useState(false);
  if (!doc) return null;
  const p = doc.footwear ?? null;
  const kind: FootwearKind = p?.kind ?? pendingKind;

  return (
    <>
      <Panel title="Footwear">
        <div className="type-choice" role="radiogroup">
          {(['chappal', 'shoe'] as FootwearKind[]).map((k) => (
            <label key={k} className={`type-card ${kind === k ? 'active' : ''}`}>
              <input type="radio" name="footwearKind" checked={kind === k} onChange={() => setFootwearKind(k)} data-testid={`fw-kind-${k}`} />
              <span>
                <b>{KIND_INFO[k].title}</b>
                <small>{KIND_INFO[k].sub}</small>
              </span>
            </label>
          ))}
        </div>
        {p && p.kind === 'chappal' && (
          <SelectField<ChappalStyle>
            label="Chappal style"
            value={p.chappalStyle}
            options={CHAPPAL_STYLE_LABEL}
            onChange={(v) => updateFootwear('Chappal style', (q) => ({ ...q, chappalStyle: v }))}
          />
        )}
        {p && (
          <Field label="Shoe Size">
            <select value={p.shoeSizeUK} onChange={(e) => updateFootwear('Shoe size', (q) => ({ ...q, shoeSizeUK: parseFloat(e.target.value) }))}>
              {UK_SIZES.map((s) => (
                <option key={s} value={s}>UK{s} ({insoleLengthMm(s).toFixed(0)} mm)</option>
              ))}
            </select>
            <div className="hint">The footwear is fitted to the scan; the size is used for the file name and label.</div>
          </Field>
        )}
        <Field
          label={`Create the ${kind}`}
          right={<Switch checked={!!p} disabled={!ready} onChange={(v) => void setFootwearEnabled(v, kind)} testId="create-footwear" />}
        />
      </Panel>

      {p && (
        <Panel title="3 · Footwear design">
          <div className={`status-line ${error ? 'err' : ''}`} data-testid="footwear-status">
            {busy ? <><span className="spinner" /> updating…</> : error ? error : result ? `${result.kind === 'shoe' ? 'Shoe' : 'Chappal'} · ${result.length.toFixed(0)} × ${result.width.toFixed(0)} mm · ${result.strutCount.toLocaleString()} struts` : ''}
          </div>
          {result && (
            <div className="rule-box" data-testid="footwear-rules">
              <div className="field-group-label">Design rules</div>
              {result.rules.map((r) => (
                <div key={r.rule} className={`rule ${r.ok ? 'ok' : 'bad'}`}>
                  <span>{r.ok ? '✔' : '✘'} {r.rule}</span>
                  <b>{r.value}</b>
                </div>
              ))}
              {result.warnings.map((w) => (
                <div key={w} className="hint warn">{w}</div>
              ))}
            </div>
          )}
          <Slider label={`Clearance to the foot (rule ${FOOTWEAR_RULES.clearance.min}–${FOOTWEAR_RULES.clearance.max})`} range={R.clearance} value={p.clearance} set={(q, v) => ({ ...q, clearance: v })} testId="fw-clearance" />
          <Slider label={`Lattice strut diameter (rule ${FOOTWEAR_RULES.strutDiameter.min}–${FOOTWEAR_RULES.strutDiameter.max})`} range={R.strutDiameter} value={p.strutDiameter} set={(q, v) => ({ ...q, strutDiameter: v })} testId="fw-strut" />
          <Slider label="Lattice cell size" range={R.cellSize} value={p.cellSize} set={(q, v) => ({ ...q, cellSize: v })} testId="fw-cell" />
          <div className="field-group-label">Sole</div>
          <Slider label="Sole thickness (thinnest point)" range={R.soleThickness} value={p.soleThickness} set={(q, v) => ({ ...q, soleThickness: v })} testId="fw-sole" />
          <Slider label="Outsole thickness (solid)" range={R.outsoleThickness} value={p.outsoleThickness} set={(q, v) => ({ ...q, outsoleThickness: v })} />
          <Slider label="Toe spring" range={R.toeSpring} value={p.toeSpring} set={(q, v) => ({ ...q, toeSpring: v })} />
          <SelectField<SideWall> label="Sole side wall" value={p.sideWall} options={SIDE_WALL_LABEL} onChange={(v) => updateFootwear('Side wall', (q) => ({ ...q, sideWall: v }))} />
          <Slider label="Rim height (at the heel)" range={R.rimHeight} value={p.rimHeight} set={(q, v) => ({ ...q, rimHeight: v })} />
          <Slider label="Rim wall thickness" range={R.wallThickness} value={p.wallThickness} set={(q, v) => ({ ...q, wallThickness: v })} />
          <Slider label="Toe allowance" range={R.toeAllowance} value={p.toeAllowance} set={(q, v) => ({ ...q, toeAllowance: v })} />
          <SelectField<TreadPattern> label="Outsole tread" value={p.tread} options={TREAD_LABEL} onChange={(v) => updateFootwear('Tread', (q) => ({ ...q, tread: v }))} />
          {p.kind === 'chappal' ? (
            <>
              <div className="field-group-label">{p.chappalStyle === 'slide' ? 'Strap' : 'Y-strap and toe post'}</div>
              {p.chappalStyle === 'slide' ? (
                <>
                  <Slider label="Strap width" range={R.strapWidth} value={p.strap.width} set={(q, v) => ({ ...q, strap: { ...q.strap, width: v } })} testId="fw-strap-width" />
                  <Slider label="Strap position (from the heel)" range={R.strapPosition} value={p.strap.position} set={(q, v) => ({ ...q, strap: { ...q.strap, position: v } })} />
                </>
              ) : (
                <Slider label="Strap arm width" range={R.thongArmWidth} value={p.thongArmWidth} set={(q, v) => ({ ...q, thongArmWidth: v })} />
              )}
              <Slider label="Strap thickness" range={R.strapThickness} value={p.strap.thickness} set={(q, v) => ({ ...q, strap: { ...q.strap, thickness: v } })} />
            </>
          ) : (
            <>
              <div className="field-group-label">Upper</div>
              <Slider label="Collar height (above the footbed)" range={R.collarHeight} value={p.shoe.collarHeight} set={(q, v) => ({ ...q, shoe: { ...q.shoe, collarHeight: v } })} />
              <Slider label="Throat (opening ends, fraction of length)" range={R.throat} value={p.shoe.throat} set={(q, v) => ({ ...q, shoe: { ...q.shoe, throat: v } })} />
              <Slider label="Collar rim diameter (solid)" range={R.collarDiameter} value={p.shoe.collarDiameter} set={(q, v) => ({ ...q, shoe: { ...q.shoe, collarDiameter: v } })} />
            </>
          )}
        </Panel>
      )}

      {p && (
        <Panel title="4 · Finish & download">
          <Field label="Foot scan">
            <ScanDisplayToggle />
          </Field>
          <Field label="Merge into one watertight solid" right={<Switch checked={merge} onChange={setMerge} testId="fw-merge" />} />
          <div className="hint" style={{ marginTop: -4 }}>
            Off: the parts are exported as overlapping closed shells (fast; slicers join them). On: one watertight solid (can take a minute).
          </div>
          <Field label={`Download ${p.kind === 'shoe' ? 'shoe' : 'chappal'}`}>
            <button
              className="download"
              disabled={!result || busy}
              data-testid="download-footwear"
              onClick={async () => {
                const r = await exportFootwearStl(merge);
                if (r) downloadBlob(r.data, r.fileName, 'model/stl');
              }}
            >
              ⤓ Download File (STL)
            </button>
          </Field>
        </Panel>
      )}
    </>
  );
}
