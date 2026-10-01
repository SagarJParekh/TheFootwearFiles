import { useState } from 'react';
import { UK_SIZES, insoleLengthMm } from '../../core/insole/params';
import {
  CHAPPAL_STYLE_LABEL, FOOTWEAR_RANGES as R, FOOTWEAR_RULES, REFERENCE_DESIGNS, SIDE_WALL_LABEL, STRAP_PATTERN_LABEL, TREAD_LABEL, UPPER_PATTERN_LABEL,
  type ChappalStyle, type DesignId, type FootwearKind, type FootwearParams, type SideWall, type StrapPattern, type TreadPattern, type UpperPattern,
} from '../../core/footwear/params';
import { applyFootwearDesign, requestAnkleLandmarks, exportFootwearStl, footwearGesture, setFootwearEnabled, setFootwearKind, updateFootwear } from '../../state/footwearActions';
import { useStore } from '../../state/store';
import { Panel, downloadBlob } from '../common';
import { ScanDisplayToggle } from '../ScanDisplayToggle';
import { MESH_DETAIL_LABEL, type MeshDetail } from '../../core/detail';
import { ANKLE_LANDMARKS, LANDMARK_BY_ID } from '../../core/landmarks/definitions';
import { Field, SelectField, SliderField, Switch, type ParamApi } from './designControls';

const api: ParamApi<FootwearParams> = { ...footwearGesture, commit: updateFootwear };

function Slider(props: { label: string; range: (typeof R)[keyof typeof R]; value: number; set: (p: FootwearParams, v: number) => FootwearParams; testId?: string }) {
  return <SliderField<FootwearParams> {...props} api={api} />;
}

const KIND_INFO: Record<FootwearKind, { title: string; sub: string }> = {
  chappal: { title: 'Chappal', sub: 'Slides & thongs · lattice footbed' },
  shoe: { title: 'Shoe', sub: 'Double-skin lattice upper' },
};

/**
 * The malleolus landmarks the footwear asks for (the shoe collar is kept below them): their
 * status, and a button that starts placing the missing ones on the scan.
 */
function AnkleLandmarks() {
  const landmarks = useStore((s) => s.doc?.landmarks);
  const active = useStore((s) => (s.tool === 'landmark' ? s.activeLandmark : null));
  if (!landmarks) return null;
  const missing = ANKLE_LANDMARKS.filter((id) => !landmarks[id]);
  const placing = active && ANKLE_LANDMARKS.includes(active) ? active : null;
  return (
    <div className={`rule-box ${missing.length ? 'ask' : ''}`} data-testid="fw-ankle-landmarks">
      <div className="field-group-label">Ankle landmarks (for the shoe collar)</div>
      {ANKLE_LANDMARKS.map((id) => (
        <div key={id} className={`rule ${landmarks[id] ? 'ok' : 'bad'}`} data-testid={`fw-ankle-${id}`}>
          <span>{landmarks[id] ? '✔' : '○'} {LANDMARK_BY_ID[id].label} ({LANDMARK_BY_ID[id].shortLabel})</span>
          <b>{landmarks[id] ? 'placed' : placing === id ? 'click it on the scan…' : 'missing'}</b>
        </div>
      ))}
      {placing ? (
        <div className="hint warn" data-testid="fw-ankle-placing">
          Click the most prominent point of the <b>{LANDMARK_BY_ID[placing].label.toLowerCase()}</b> on the scan.
        </div>
      ) : missing.length ? (
        <button className="primary" onClick={requestAnkleLandmarks} data-testid="fw-place-ankle">
          Place {missing.map((id) => LANDMARK_BY_ID[id].shortLabel).join(' and ')} now
        </button>
      ) : null}
    </div>
  );
}

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
        <AnkleLandmarks />
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
        {p && (
          <Field label="Reference design">
            <select
              value={p.design}
              data-testid="fw-design"
              onChange={(e) => e.target.value !== 'custom' && applyFootwearDesign(e.target.value as Exclude<DesignId, 'custom'>)}
            >
              {(Object.keys(REFERENCE_DESIGNS) as Exclude<DesignId, 'custom'>[])
                .filter((id) => REFERENCE_DESIGNS[id].kind === p.kind)
                .map((id) => (
                  <option key={id} value={id}>
                    {REFERENCE_DESIGNS[id].label} (like {REFERENCE_DESIGNS[id].like})
                  </option>
                ))}
              {p.design === 'custom' && <option value="custom">Custom</option>}
            </select>
            <div className="hint">Modelled on your reference designs; choosing one sets the style, sole, rim, strap and lattice below.</div>
          </Field>
        )}
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
              {result.upperGap && (
                <div className="hint" data-testid="footwear-upper-gap">
                  {result.kind === 'shoe' ? 'Upper' : 'Straps'}: standard shape around the foot, {result.upperGap.min.toFixed(1)}–{result.upperGap.max.toFixed(1)} mm from it.
                </div>
              )}
              {result.warnings.map((w) => (
                <div key={w} className="hint warn">{w}</div>
              ))}
            </div>
          )}
          <div className="hint" style={{ marginTop: 0 }}>Only the footbed follows the foot; the sole, straps and upper are standard shapes fitted around it.</div>
          <Slider label={`Footbed clearance to the foot (rule ${FOOTWEAR_RULES.clearance.min}–${FOOTWEAR_RULES.clearance.max})`} range={R.clearance} value={p.clearance} set={(q, v) => ({ ...q, clearance: v })} testId="fw-clearance" />
          <Slider label={`Lattice strut diameter (rule ${FOOTWEAR_RULES.strutDiameter.min}–${FOOTWEAR_RULES.strutDiameter.max})`} range={R.strutDiameter} value={p.strutDiameter} set={(q, v) => ({ ...q, strutDiameter: v })} testId="fw-strut" />
          <Slider label="Lattice cell size" range={R.cellSize} value={p.cellSize} set={(q, v) => ({ ...q, cellSize: v })} testId="fw-cell" />
          <Field label="Smooth footbed skin (solid top)" right={<Switch checked={p.footbedSkin} onChange={(v) => updateFootwear('Footbed skin', (q) => ({ ...q, footbedSkin: v }))} testId="fw-skin" />} />
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
              <div className="field-group-label">{p.chappalStyle === 'slide' ? 'Strap' : 'Wings, ridge and toe post'}</div>
              {p.chappalStyle === 'slide' ? (
                <>
                  <Slider label="Strap length on top of the foot" range={R.strapWidth} value={p.strap.width} set={(q, v) => ({ ...q, strap: { ...q.strap, width: v } })} testId="fw-strap-width" />
                  <Slider label="Strap position (centre, from the heel)" range={R.strapPosition} value={p.strap.position} set={(q, v) => ({ ...q, strap: { ...q.strap, position: v } })} />
                </>
              ) : (
                <Slider label="Wing width (where it meets the sole)" range={R.thongArmWidth} value={p.thongArmWidth} set={(q, v) => ({ ...q, thongArmWidth: v })} />
              )}
              <SelectField<StrapPattern> label={p.chappalStyle === 'slide' ? 'Strap' : 'Wings'} value={p.strapPattern} options={STRAP_PATTERN_LABEL} onChange={(v) => updateFootwear('Strap pattern', (q) => ({ ...q, strapPattern: v }))} />
              <Slider label="Strap thickness" range={R.strapThickness} value={p.strap.thickness} set={(q, v) => ({ ...q, strap: { ...q.strap, thickness: v } })} />
            </>
          ) : (
            <>
              <div className="field-group-label">Upper</div>
              <SelectField<UpperPattern> label="Upper lattice" value={p.upperPattern} options={UPPER_PATTERN_LABEL} onChange={(v) => updateFootwear('Upper pattern', (q) => ({ ...q, upperPattern: v }))} />
              <Slider label="Collar height (above the footbed)" range={R.collarHeight} value={p.shoe.collarHeight} set={(q, v) => ({ ...q, shoe: { ...q.shoe, collarHeight: v } })} />
              <Slider label="Throat (opening ends, fraction of length)" range={R.throat} value={p.shoe.throat} set={(q, v) => ({ ...q, shoe: { ...q.shoe, throat: v } })} />
              <Slider label="Collar rim diameter (solid)" range={R.collarDiameter} value={p.shoe.collarDiameter} set={(q, v) => ({ ...q, shoe: { ...q.shoe, collarDiameter: v } })} />
              <Slider label="Collar rim below the malleoli" range={R.malleolusGap} value={p.shoe.malleolusGap} set={(q, v) => ({ ...q, shoe: { ...q.shoe, malleolusGap: v } })} testId="fw-malleolus-gap" />
              {!(doc.landmarks.medialMalleolus && doc.landmarks.lateralMalleolus) && (
                <div className="hint warn" data-testid="fw-malleoli-missing">
                  Place the medial (MM) and lateral (LM) malleolus landmarks (Landmarks tab) so the collar rim is kept {p.shoe.malleolusGap} mm below the ankle bones and doesn't pinch the skin.
                </div>
              )}
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
          <Field
            label="Smooth fused joins (like the reference designs)"
            right={<Switch checked={p.smoothJoins} onChange={(v) => updateFootwear('Smooth joins', (q) => ({ ...q, smoothJoins: v }))} testId="fw-smooth" />}
          />
          <div className="hint" style={{ marginTop: -4 }}>
            Fuses the sole, rim, straps, ridge and post into one surface with rounded fillets at every junction. Takes 20–60 s; switch it on when the design is final.
          </div>
          <SelectField<MeshDetail> label="Mesh detail (triangles)" value={p.detail} options={MESH_DETAIL_LABEL} onChange={(v) => updateFootwear('Mesh detail', (q) => ({ ...q, detail: v }))} testId="fw-detail" />
          {result && <div className="hint" style={{ marginTop: -4 }}>{(result.mesh.indices.length / 3).toLocaleString()} triangles</div>}
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
