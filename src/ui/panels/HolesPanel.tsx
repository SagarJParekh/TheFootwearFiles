import { useState } from 'react';
import { excludeLargerThan, fillAllIncluded, fillHoleIds, toggleHoleExcluded } from '../../state/holeActions';
import { useStore } from '../../state/store';
import { Panel, Toggle, fmt } from '../common';

/** Distinct, stable colour per loop id (golden-ratio hue spacing). */
export function holeColour(id: number): string {
  return `hsl(${Math.round((id * 137.508) % 360)}, 85%, 45%)`;
}

export function HolesPanel() {
  const holes = useStore((s) => s.holes);
  const excluded = useStore((s) => s.holeExcluded);
  const hovered = useStore((s) => s.hoveredHole);
  const showHoles = useStore((s) => s.showHoles);
  const busy = useStore((s) => !!s.busy);
  const [fair, setFair] = useState(true);
  const [limit, setLimit] = useState('');
  const options = { refine: true, fair };

  if (!holes) {
    return (
      <Panel title="Holes">
        <p className="hint">Detecting…</p>
      </Panel>
    );
  }
  const loops = [...holes.loops].sort((a, b) => b.perimeter - a.perimeter);
  const included = loops.filter((l) => !excluded.has(l.id));

  return (
    <Panel title={`Holes (${loops.length})`}>
      {loops.length === 0 ? (
        <p className="hint" style={{ marginTop: 0 }} data-testid="no-holes">
          No open boundaries – the mesh is closed.
        </p>
      ) : (
        <>
          <Toggle label="Highlight holes" checked={showHoles} onChange={(v) => useStore.setState({ showHoles: v })} />
          <ul className="hole-list" data-testid="hole-list">
            {loops.map((l, i) => (
              <li
                key={l.id}
                className={`hole-item ${excluded.has(l.id) ? 'excluded' : ''} ${hovered === l.id ? 'hover' : ''}`}
                onMouseEnter={() => useStore.setState({ hoveredHole: l.id })}
                onMouseLeave={() => useStore.setState({ hoveredHole: null })}
              >
                <input
                  type="checkbox"
                  checked={!excluded.has(l.id)}
                  onChange={() => toggleHoleExcluded(l.id)}
                  title="Include in 'Fill all'"
                />
                <span className="lm-dot" style={{ background: holeColour(l.id) }} />
                <span className="meta">
                  #{i + 1} · {fmt(l.perimeter)} mm · {l.edgeCount} edges
                  {l.suggestedExclude ? ' · open rim?' : ''}
                </span>
                <button className="small" disabled={busy} onClick={() => void fillHoleIds([l.id], options)}>
                  Fill
                </button>
              </li>
            ))}
          </ul>
          <div className="row">
            <span>Exclude loops longer than</span>
            <input type="number" value={limit} placeholder="mm" onChange={(e) => setLimit(e.target.value)} />
            <button className="small" disabled={!limit} onClick={() => excludeLargerThan(parseFloat(limit))}>
              Apply
            </button>
          </div>
          <Toggle label="Smooth patch (follow surrounding curvature)" checked={fair} onChange={setFair} />
          <div className="button-row">
            <button className="primary" disabled={busy || !included.length} onClick={() => void fillAllIncluded(options)} data-testid="fill-all">
              Fill all ({included.length})
            </button>
          </div>
          <p className="hint">Unchecked loops (e.g. the open top of a leg scan) are skipped by “Fill all”.</p>
        </>
      )}
    </Panel>
  );
}
