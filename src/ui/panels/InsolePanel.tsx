import { useEffect, useState } from 'react';
import { SIDE_LABEL } from '../../core/landmarks/definitions';
import {
  HEEL_BASE_LABEL, INSOLE_TYPE_LABEL, METATARSALS, MORTONS_LABEL, MT_BAR_COVERAGE_LABEL, MT_BAR_PATH_LABEL, RANGES, UK_SIZES, WEDGE_SIDE_LABEL, WEDGE_TYPE_LABEL, insoleLengthMm,
  type HeelBaseWidth, type InsoleParams, type InsoleType, type MortonsExtension, type MtBarCoverage, type MtBarPath, type WedgeSide, type WedgeType,
} from '../../core/insole/params';
import {
  exportInsoleStl, insoleLandmarks, setFootArch, setInsoleEnabled, setInsoleType, updateInsole,
} from '../../state/insoleActions';
import { setView, useStore } from '../../state/store';
import { Panel, downloadBlob } from '../common';
import { BasePlaneStatus } from './TransformPanel';
import { ScanDisplayToggle } from '../ScanDisplayToggle';
import { Field, SelectField, SliderField, Switch, ToggleField } from './designControls';
import { FootwearPanel } from './FootwearPanel';
import { setDesignCategory } from '../../state/footwearActions';

// --- panel ------------------------------------------------------------------------------

/** Arch adjustment on the FOOT: slider commits when released (one mesh edit, undoable). */
function FootArchField({ value, disabledReason }: { value: number; disabledReason: string | null }) {
  const disabled = !!disabledReason;
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const r = RANGES.footArch;
  const apply = (x: number) => {
    const c = Math.min(r.max, Math.max(r.min, x));
    if (c !== value) void setFootArch(c);
  };
  return (
    <Field label="Arch on the foot (mm)">
      <div className="slider-row">
        <input
          type="range" min={r.min} max={r.max} step={r.step} value={v} disabled={disabled} data-testid="foot-arch"
          onChange={(e) => setV(parseFloat(e.target.value))}
          onPointerUp={() => apply(v)}
          onKeyUp={() => apply(v)}
        />
        <input
          type="number" min={r.min} max={r.max} step={r.step} value={v} disabled={disabled}
          onChange={(e) => setV(parseFloat(e.target.value))}
          onBlur={() => Number.isFinite(v) && apply(v)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      <div className="slider-scale"><span>{r.min} lower</span><span>raise {r.max}</span></div>
      <div className="hint">
        {disabledReason ??
          'Raises (+) or lowers (−) the medial arch of the foot scan itself, only between the arch start (AS) and arch end (AE) landmarks; the insole follows the modified foot.'}
      </div>
    </Field>
  );
}

export function InsolePanel() {
  const doc = useStore((s) => s.doc);
  const busy = useStore((s) => s.insoleBusy);
  const error = useStore((s) => s.insoleError);
  const result = useStore((s) => s.insole?.output);
  const showToeArrow = useStore((s) => s.view.showToeArrow);
  const pendingType = useStore((s) => s.pendingInsoleType);
  const category = useStore((s) => s.designCategory);
  if (!doc) return null;
  const p = doc.insole;
  const { missing } = insoleLandmarks(doc);
  const ready = missing.length === 0;
  const type: InsoleType = p?.type ?? pendingType;

  const toggle = (label: string, fn: (p: InsoleParams, v: boolean) => InsoleParams) => (v: boolean) => updateInsole(label, (q) => fn(q, v));
  const tq = p?.threeQuarter;
  const setTQ = (fn: (t: InsoleParams['threeQuarter']) => InsoleParams['threeQuarter']) => (q: InsoleParams): InsoleParams => ({ ...q, threeQuarter: fn(q.threeQuarter) });

  return (
    <>
      <Panel title="1 · Align & set up">
        <Field label="Align the scan (base plane)">
          <BasePlaneStatus locked={!!doc.basePlaneLocked} hasPoints={ready} />
        </Field>
        <Field
          label="Toes aligned in the arrow direction"
          right={<Switch checked={showToeArrow} onChange={(v) => setView({ showToeArrow: v })} />}
        />
        <Field label="Which side is model">
          <div className="row">
            <b>{doc.scan ? SIDE_LABEL[doc.scan.side] : '—'}</b>
            <button className="link" onClick={() => useStore.setState({ scanDialogOpen: true })}>change</button>
          </div>
        </Field>
        <Field label="Landmarks (heel centre, 1st & 5th metatarsal heads)">
          <ul className="check-list">
            {['Heel centre', '1st metatarsal head', '5th metatarsal head'].map((n) => (
              <li key={n} className={missing.includes(n) ? 'todo' : ''}>{n}</li>
            ))}
          </ul>
          {!ready && (
            <button className="small" onClick={() => useStore.setState({ rightTab: 'landmarks' })}>Place landmarks…</button>
          )}
        </Field>
        <Field label="Arch landmarks (for the arch adjustment)">
          <ul className="check-list">
            {([['archStart', 'Medial arch – start (AS)'], ['archPeak', 'Medial arch – peak (AR, optional)'], ['archEnd', 'Medial arch – end (AE)']] as const).map(([id, n]) => (
              <li key={id} className={doc.landmarks[id] ? '' : 'todo'}>{n}</li>
            ))}
          </ul>
        </Field>
        <FootArchField
          value={doc.footArchAdjust ?? 0}
          disabledReason={
            !doc.basePlaneLocked
              ? 'Set the base plane first.'
              : !doc.landmarks.archStart || !doc.landmarks.archEnd
                ? 'Place the arch start (AS) and arch end (AE) landmarks – the arch is only changed between them.'
                : null
          }
        />
      </Panel>

      <Panel title="2 · What to design">
        <div className="type-choice three" role="radiogroup">
          {(Object.keys(INSOLE_TYPE_LABEL) as InsoleType[]).map((t) => (
            <label key={t} className={`type-card ${category === 'insole' && type === t ? 'active' : ''}`}>
              <input
                type="radio" name="designType" checked={category === 'insole' && type === t} data-testid={`type-${t}`}
                onChange={() => { setDesignCategory('insole'); setInsoleType(t); }}
              />
              <span>
                <b>{t === 'full' ? 'Full length' : '3/4 length'}</b>
                <small>{t === 'full' ? 'Insole · FDM · flat base' : 'Insole · powder · shell'}</small>
              </span>
            </label>
          ))}
          <label className={`type-card ${category === 'footwear' ? 'active' : ''}`}>
            <input type="radio" name="designType" checked={category === 'footwear'} onChange={() => setDesignCategory('footwear')} data-testid="type-footwear" />
            <span>
              <b>Footwear</b>
              <small>Shoe or chappal · lattice</small>
            </span>
          </label>
        </div>
        {category === 'insole' && p && (
          <Field label="Shoe Size">
            <select
              value={p.shoeSizeUK}
              onChange={(e) => updateInsole('Shoe size', (q) => ({ ...q, shoeSizeUK: parseFloat(e.target.value) }))}
              data-testid="shoe-size"
            >
              {UK_SIZES.map((s) => (
                <option key={s} value={s}>UK{s} ({insoleLengthMm(s).toFixed(0)} mm)</option>
              ))}
            </select>
            {result?.footLength && <div className="hint">Scan foot length ≈ {result.footLength.toFixed(0)} mm</div>}
          </Field>
        )}
        {category === 'insole' && (
          <Field
            label="Create the insole"
            right={<Switch checked={!!p} disabled={!ready} onChange={(v) => void setInsoleEnabled(v, type)} testId="create-insole" />}
          />
        )}
      </Panel>

      {category === 'footwear' && <FootwearPanel ready={ready} />}

      {category === 'insole' && p && tq && (
        <Panel title="3 · Design">
          <div className={`status-line ${error ? 'err' : ''}`} data-testid="insole-status">
            {busy ? <><span className="spinner" /> updating…</> : error ? error : result ? `${result.kind === 'full' ? 'Full length' : '3/4'} · ${result.length.toFixed(0)} × ${result.width.toFixed(0)} mm · ${result.minThickness.toFixed(1)}–${result.maxThickness.toFixed(1)} mm thick` : ''}
          </div>
          <SliderField label="Padding clearance (gap to the foot)" range={RANGES.paddingClearance} value={p.paddingClearance} set={(q, v) => ({ ...q, paddingClearance: v })} testId="padding" />
          <div className="hint" style={{ marginTop: -4 }}>Space left for the padding that is added after printing.</div>
          <ToggleField label="Narrow insole profile" checked={p.narrowProfile} onChange={toggle('Narrow profile', (q, v) => ({ ...q, narrowProfile: v }))} />
          <ToggleField label="Add Wedge" checked={p.wedge.enabled} onChange={toggle('Wedge', (q, v) => ({ ...q, wedge: { ...q.wedge, enabled: v } }))} testId="wedge">
            <SelectField<WedgeType> label="Type of wedge" value={p.wedge.type} options={WEDGE_TYPE_LABEL} onChange={(v) => updateInsole('Wedge type', (q) => ({ ...q, wedge: { ...q.wedge, type: v } }))} />
            <SelectField<WedgeSide> label="Side of the wedge" value={p.wedge.side} options={WEDGE_SIDE_LABEL} onChange={(v) => updateInsole('Wedge side', (q) => ({ ...q, wedge: { ...q.wedge, side: v } }))} />
            <SliderField label="Wedge angle (in degrees)" range={{ ...RANGES.wedgeAngle, unit: undefined }} value={p.wedge.angleDeg} set={(q, v) => ({ ...q, wedge: { ...q.wedge, angleDeg: v } })} />
          </ToggleField>
          <ToggleField label="Add MT Pad" checked={p.mtPad.enabled} onChange={toggle('MT pad', (q, v) => ({ ...q, mtPad: { ...q.mtPad, enabled: v } }))} testId="mt-pad">
            <SliderField label="MT pad height" range={RANGES.mtPadHeight} value={p.mtPad.height} set={(q, v) => ({ ...q, mtPad: { ...q.mtPad, height: v } })} />
          </ToggleField>
          <ToggleField label="Plantar fascia groove" checked={p.fasciaGroove.enabled} onChange={toggle('Fascia groove', (q, v) => ({ ...q, fasciaGroove: { ...q.fasciaGroove, enabled: v } }))} testId="fascia">
            <SliderField label="Fascia groove depth" range={RANGES.fasciaGrooveDepth} value={p.fasciaGroove.depth} set={(q, v) => ({ ...q, fasciaGroove: { ...q.fasciaGroove, depth: v } })} />
          </ToggleField>
          <SliderField label="Metatarsal smoothing" range={RANGES.mtSmoothing} value={p.mtSmoothing} set={(q, v) => ({ ...q, mtSmoothing: v })} testId="mt-smoothing" />
          <div className="hint" style={{ marginTop: -4 }}>Evens out the metatarsal head area and the blend into the forefoot (0 = off).</div>
          <SliderField label="Heel cup height" range={RANGES.heelCupHeight} value={p.heelCupHeight} set={(q, v) => ({ ...q, heelCupHeight: v })} testId="heel-cup" />
          <ToggleField label="MT Bar" checked={p.mtBar.enabled} onChange={toggle('MT bar', (q, v) => ({ ...q, mtBar: { ...q.mtBar, enabled: v } }))} testId="mt-bar">
            <SelectField<MtBarPath> label="Bar type" value={p.mtBar.path} options={MT_BAR_PATH_LABEL} onChange={(v) => updateInsole('MT bar type', (q) => ({ ...q, mtBar: { ...q.mtBar, path: v } }))} />
            <SelectField<MtBarCoverage> label="Coverage" value={p.mtBar.coverage} options={MT_BAR_COVERAGE_LABEL} onChange={(v) => updateInsole('MT bar coverage', (q) => ({ ...q, mtBar: { ...q.mtBar, coverage: v } }))} />
            <SliderField label="Bar height" range={RANGES.mtBarThickness} value={p.mtBar.thickness} set={(q, v) => ({ ...q, mtBar: { ...q.mtBar, thickness: v } })} />
            <SliderField label="Bar width (front to back)" range={RANGES.mtBarWidth} value={p.mtBar.width} set={(q, v) => ({ ...q, mtBar: { ...q.mtBar, width: v } })} />
            <SliderField label="Front edge behind the MT heads" range={RANGES.mtBarBehindHeads} value={p.mtBar.behindHeads} set={(q, v) => ({ ...q, mtBar: { ...q.mtBar, behindHeads: v } })} />
          </ToggleField>
        </Panel>
      )}

      {category === 'insole' && p && tq && (
        <Panel title={p.type === 'full' ? '4 · Finish – flat base (FDM)' : '4 · Finish – thickness (powder)'}>
          {p.type === 'full' ? (
            <>
              <div className="hint" style={{ marginTop: 0 }}>
                The insole is built down to one completely flat base (the print bed), under all the features above.
              </div>
              <SliderField label="Thickness at the thinnest point" range={RANGES.fullBaseThickness} value={p.full.baseThickness} set={(q, v) => ({ ...q, full: { ...q.full, baseThickness: v } })} testId="base-thickness" />
            </>
          ) : (
            <>
              <SliderField label="Insole thickness (average 2.5)" range={RANGES.threeQuarterThickness} value={tq.thickness} set={(q, v) => setTQ((t) => ({ ...t, thickness: v }))(q)} testId="tq-thickness" />
              <SliderField label="Heel raise" range={RANGES.heelRaise} value={tq.heelRaise} set={(q, v) => setTQ((t) => ({ ...t, heelRaise: v }))(q)} />
              <SliderField label="Heel height (post)" range={RANGES.heelHeight} value={tq.heelHeight} set={(q, v) => setTQ((t) => ({ ...t, heelHeight: v }))(q)} />
              <SelectField<HeelBaseWidth> label="Heel base width" value={tq.heelBaseWidth} options={HEEL_BASE_LABEL} onChange={(v) => updateInsole('Heel base width', setTQ((t) => ({ ...t, heelBaseWidth: v })))} />
              <SelectField<MortonsExtension> label="Morton's extension" value={tq.mortonsExtension} options={MORTONS_LABEL} onChange={(v) => updateInsole("Morton's extension", setTQ((t) => ({ ...t, mortonsExtension: v })))} />
              <Field label="choose offloads">
                <div className="chips">
                  {METATARSALS.map((mt) => {
                    const on = tq.offloads.includes(mt);
                    return (
                      <button
                        key={mt}
                        className={on ? 'active' : ''}
                        onClick={() => updateInsole('Offloads', setTQ((t) => ({ ...t, offloads: on ? t.offloads.filter((x) => x !== mt) : [...t.offloads, mt] })))}
                      >
                        {mt}{on ? ' ✕' : ''}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <ToggleField label="Provide offloads" checked={tq.provideOffloads} onChange={(v) => updateInsole('Provide offloads', setTQ((t) => ({ ...t, provideOffloads: v })))} />
              <ToggleField label="Hole in heel" checked={tq.holeInHeel} onChange={(v) => updateInsole('Hole in heel', setTQ((t) => ({ ...t, holeInHeel: v })))} />
            </>
          )}
          <Field label="Foot scan">
            <ScanDisplayToggle />
          </Field>
          <Field label={`Finalise and download ${p.type === 'full' ? 'full-length (FDM)' : '3/4 (powder)'} insole`}>
            <button
              className="download"
              disabled={!result || busy}
              data-testid="download-insole"
              onClick={async () => {
                const r = await exportInsoleStl();
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
