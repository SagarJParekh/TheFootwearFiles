import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SIDE_LABEL } from '../../core/landmarks/definitions';
import {
  HEEL_BASE_LABEL, METATARSALS, MORTONS_LABEL, RANGES, UK_SIZES, WEDGE_SIDE_LABEL, WEDGE_TYPE_LABEL, insoleLengthMm,
  type HeelBaseWidth, type InsoleParams, type MortonsExtension, type Range, type WedgeSide, type WedgeType,
} from '../../core/insole/params';
import {
  exportInsoleStl, insoleGesture, insoleLandmarks, setInsoleEnabled, updateInsole,
} from '../../state/insoleActions';
import { setView, useStore } from '../../state/store';
import { Panel, downloadBlob } from '../common';
import { BasePlaneStatus } from './TransformPanel';
import { ScanDisplayToggle } from '../ScanDisplayToggle';

// --- small controls -----------------------------------------------------------------------

function Switch({ checked, onChange, disabled, testId }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testId?: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span />
    </label>
  );
}

function Field({ label, children, right }: { label: string; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">
        <span>{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/**
 * Slider + number box like the reference UI. Dragging updates the design live and records a
 * single undo step on release; typing a value commits immediately.
 */
function SliderField({
  label, range, value, set, testId,
}: {
  label: string;
  range: Range;
  value: number;
  set: (p: InsoleParams, v: number) => InsoleParams;
  testId?: string;
}) {
  const dragging = useRef(false);
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(Math.round(value * 100) / 100)), [value]);
  const clamp = (v: number) => Math.min(range.max, Math.max(range.min, v));
  const endDrag = () => {
    if (dragging.current) {
      dragging.current = false;
      insoleGesture.end(label);
    }
  };
  return (
    <Field label={`${label}${range.unit ? ` (${range.unit})` : ''}`}>
      <div className="slider-row">
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          data-testid={testId}
          onPointerDown={() => {
            dragging.current = true;
            insoleGesture.begin();
          }}
          onPointerUp={endDrag}
          onBlur={endDrag}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (dragging.current) insoleGesture.update((p) => set(p, v));
            else updateInsole(label, (p) => set(p, v)); // keyboard arrows
          }}
        />
        <input
          type="number"
          min={range.min}
          max={range.max}
          step={range.step}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = parseFloat(text);
            if (Number.isFinite(v) && clamp(v) !== value) updateInsole(label, (p) => set(p, clamp(v)));
            else setText(String(value));
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      <div className="slider-scale">
        <span>{range.min}</span>
        <span>{range.max}</span>
      </div>
    </Field>
  );
}

function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {(Object.keys(options) as T[]).map((k) => (
          <option key={k} value={k}>
            {options[k]}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ToggleField({ label, checked, onChange, children, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; children?: ReactNode; testId?: string }) {
  return (
    <>
      <Field label={label} right={<Switch checked={checked} onChange={onChange} testId={testId} />} />
      {checked && children && <div className="sub">{children}</div>}
    </>
  );
}

// --- panel ------------------------------------------------------------------------------

export function InsolePanel() {
  const doc = useStore((s) => s.doc);
  const busy = useStore((s) => s.insoleBusy);
  const error = useStore((s) => s.insoleError);
  const result = useStore((s) => s.insole?.output);
  const showToeArrow = useStore((s) => s.view.showToeArrow);
  if (!doc) return null;
  const p = doc.insole;
  const { missing } = insoleLandmarks(doc);
  const ready = missing.length === 0;

  const toggle = (label: string, fn: (p: InsoleParams, v: boolean) => InsoleParams) => (v: boolean) => updateInsole(label, (q) => fn(q, v));
  const o = p?.orthosis;

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
        {p && (
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
        <Field
          label="Create the insole"
          right={<Switch checked={!!p} disabled={!ready} onChange={(v) => void setInsoleEnabled(v)} testId="create-insole" />}
        />
      </Panel>

      {p && o && (
        <Panel title="2 · Insole settings">
          <div className={`status-line ${error ? 'err' : ''}`} data-testid="insole-status">
            {busy ? <><span className="spinner" /> updating…</> : error ? error : result ? `${result.kind === 'orthosis' ? 'Orthosis' : 'Insole'} · ${result.length.toFixed(0)} × ${result.width.toFixed(0)} mm · ${result.minThickness.toFixed(1)}–${result.maxThickness.toFixed(1)} mm thick` : ''}
          </div>
          <ToggleField label="Narrow insole profile" checked={p.narrowProfile} onChange={toggle('Narrow profile', (q, v) => ({ ...q, narrowProfile: v }))} />
          {!o.enabled && (
            <SliderField label="Padding thickness" range={RANGES.paddingThickness} value={p.paddingThickness} set={(q, v) => ({ ...q, paddingThickness: v })} testId="padding" />
          )}
          <SliderField label="Medial Arch pressure" range={RANGES.medialArchPressure} value={p.medialArchPressure} set={(q, v) => ({ ...q, medialArchPressure: v })} />
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
          <SliderField label="Heel cup height" range={RANGES.heelCupHeight} value={p.heelCupHeight} set={(q, v) => ({ ...q, heelCupHeight: v })} testId="heel-cup" />
          <ToggleField label="MT Bar" checked={p.mtBar.enabled} onChange={toggle('MT bar', (q, v) => ({ ...q, mtBar: { ...q.mtBar, enabled: v } }))} testId="mt-bar">
            <SliderField label="MT bar thickness" range={RANGES.mtBarThickness} value={p.mtBar.thickness} set={(q, v) => ({ ...q, mtBar: { ...q.mtBar, thickness: v } })} />
          </ToggleField>
          <ToggleField
            label="Add thickness (rigid orthosis)"
            checked={o.enabled}
            onChange={toggle('Add thickness', (q, v) => ({ ...q, orthosis: { ...q.orthosis, enabled: v } }))}
            testId="orthosis"
          >
            <SliderField label="Heel raise" range={RANGES.heelRaise} value={o.heelRaise} set={(q, v) => ({ ...q, orthosis: { ...q.orthosis, heelRaise: v } })} />
            <SliderField label="Heel height" range={RANGES.heelHeight} value={o.heelHeight} set={(q, v) => ({ ...q, orthosis: { ...q.orthosis, heelHeight: v } })} />
            <SelectField<MortonsExtension> label="Morton's extension" value={o.mortonsExtension} options={MORTONS_LABEL} onChange={(v) => updateInsole("Morton's extension", (q) => ({ ...q, orthosis: { ...q.orthosis, mortonsExtension: v } }))} />
            <SelectField<HeelBaseWidth> label="Heel base width" value={o.heelBaseWidth} options={HEEL_BASE_LABEL} onChange={(v) => updateInsole('Heel base width', (q) => ({ ...q, orthosis: { ...q.orthosis, heelBaseWidth: v } }))} />
            <Field label="choose offloads">
              <div className="chips">
                {METATARSALS.map((mt) => {
                  const on = o.offloads.includes(mt);
                  return (
                    <button
                      key={mt}
                      className={on ? 'active' : ''}
                      onClick={() => updateInsole('Offloads', (q) => ({
                        ...q,
                        orthosis: { ...q.orthosis, offloads: on ? q.orthosis.offloads.filter((x) => x !== mt) : [...q.orthosis.offloads, mt] },
                      }))}
                    >
                      {mt}{on ? ' ✕' : ''}
                    </button>
                  );
                })}
              </div>
            </Field>
            <ToggleField label="Provide offloads" checked={o.provideOffloads} onChange={toggle('Provide offloads', (q, v) => ({ ...q, orthosis: { ...q.orthosis, provideOffloads: v } }))} />
            <SliderField label="Footplate Thickness" range={RANGES.footplateThickness} value={o.footplateThickness} set={(q, v) => ({ ...q, orthosis: { ...q.orthosis, footplateThickness: v } })} />
            <ToggleField label="Hole in heel" checked={o.holeInHeel} onChange={toggle('Hole in heel', (q, v) => ({ ...q, orthosis: { ...q.orthosis, holeInHeel: v } }))} />
          </ToggleField>
          <Field label="Foot scan">
            <ScanDisplayToggle />
          </Field>
          <Field label={`Finalise and download ${o.enabled ? 'orthosis' : 'insole'}`}>
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
