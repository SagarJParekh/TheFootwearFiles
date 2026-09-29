import { setScanDisplay } from '../state/insoleActions';
import { useStore, type ScanDisplay } from '../state/store';

const MODES: { id: ScanDisplay; label: string; title: string }[] = [
  { id: 'solid', label: 'Visible', title: 'Show the foot scan normally' },
  { id: 'transparent', label: 'Transparent', title: 'See-through foot, so the insole underneath is visible' },
  { id: 'hidden', label: 'Hidden', title: 'Hide the foot scan (landmarks too)' },
];

/** Segmented control: foot scan visible / transparent / hidden. */
export function ScanDisplayToggle({ compact = false }: { compact?: boolean }) {
  const mode = useStore((s) => s.view.scanDisplay);
  return (
    <div className={`segmented ${compact ? 'compact' : ''}`} role="radiogroup" aria-label="Foot scan display">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={mode === m.id}
          className={mode === m.id ? 'active' : ''}
          title={m.title}
          onClick={() => setScanDisplay(m.id)}
          data-testid={`scan-${m.id}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** Floating toggle over the viewport, shown once an insole or footwear exists. */
export function ViewportScanToggle() {
  const hasDesign = useStore((s) => !!(s.designCategory === 'footwear' ? s.doc?.footwear : s.doc?.insole));
  if (!hasDesign) return null;
  return (
    <div className="viewport-overlay top-left">
      <span>Foot:</span>
      <ScanDisplayToggle compact />
    </div>
  );
}
