import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { InsoleParams, Range } from '../../core/insole/params';
import { insoleGesture, updateInsole } from '../../state/insoleActions';

/** How a slider edits its parameters: live gesture updates + one undo step, or a single commit. */
export interface ParamApi<P> {
  begin: () => void;
  update: (fn: (p: P) => P) => void;
  end: (label: string) => void;
  commit: (label: string, fn: (p: P) => P) => void;
}

export const insoleApi: ParamApi<InsoleParams> = { ...insoleGesture, commit: updateInsole };

// --- small controls -----------------------------------------------------------------------

export function Switch({ checked, onChange, disabled, testId }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testId?: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span />
    </label>
  );
}

export function Field({ label, children, right }: { label: string; children?: ReactNode; right?: ReactNode }) {
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
export function SliderField<P = InsoleParams>({
  label, range, value, set, testId, api = insoleApi as unknown as ParamApi<P>,
}: {
  label: string;
  range: Range;
  value: number;
  set: (p: P, v: number) => P;
  testId?: string;
  api?: ParamApi<P>;
}) {
  const dragging = useRef(false);
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(Math.round(value * 100) / 100)), [value]);
  const clamp = (v: number) => Math.min(range.max, Math.max(range.min, v));
  const endDrag = () => {
    if (dragging.current) {
      dragging.current = false;
      api.end(label);
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
            api.begin();
          }}
          onPointerUp={endDrag}
          onBlur={endDrag}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (dragging.current) api.update((p) => set(p, v));
            else api.commit(label, (p) => set(p, v)); // keyboard arrows
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
            if (Number.isFinite(v) && clamp(v) !== value) api.commit(label, (p) => set(p, clamp(v)));
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

export function SelectField<T extends string>({ label, value, options, onChange, testId }: { label: string; value: T; options: Record<T, string>; onChange: (v: T) => void; testId?: string }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} data-testid={testId}>
        {(Object.keys(options) as T[]).map((k) => (
          <option key={k} value={k}>
            {options[k]}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ToggleField({ label, checked, onChange, children, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; children?: ReactNode; testId?: string }) {
  return (
    <>
      <Field label={label} right={<Switch checked={checked} onChange={onChange} testId={testId} />} />
      {checked && children && <div className="sub">{children}</div>}
    </>
  );
}
