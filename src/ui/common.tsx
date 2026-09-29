import { useEffect, useState, type ReactNode } from 'react';

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="panel">
      <header className="panel-header">
        <button className="panel-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▸'} {title}
        </button>
        {actions}
      </header>
      {open && <div className="panel-body">{children}</div>}
    </section>
  );
}

/**
 * Numeric input that only commits on blur / Enter, so typing intermediate values
 * (e.g. "-", "1.") doesn't create a history entry per keystroke.
 */
export function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  digits = 2,
  disabled,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  digits?: number;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value.toFixed(digits));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(value.toFixed(digits));
  }, [value, digits, editing]);

  const commitText = () => {
    setEditing(false);
    const v = parseFloat(text);
    if (Number.isFinite(v) && Math.abs(v - value) > 10 ** -(digits + 1)) onCommit(v);
    else setText(value.toFixed(digits));
  };

  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={text}
        disabled={disabled}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(value.toFixed(digits));
            setEditing(false);
          }
        }}
      />
    </label>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export const fmt = (v: number, digits = 1) => v.toFixed(digits);

/** Triggers a browser download for a blob / buffer. */
export function downloadBlob(data: BlobPart, fileName: string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
