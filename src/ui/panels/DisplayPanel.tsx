import { setView, useStore } from '../../state/store';
import { Panel, Toggle } from '../common';

export function DisplayPanel() {
  const view = useStore((s) => s.view);
  const triCount = useStore((s) => s.derived?.stats.triangleCount ?? 0);
  return (
    <Panel title="Display">
      <div className="toggle-grid">
        <Toggle label="Wireframe" checked={view.wireframe} onChange={(v) => setView({ wireframe: v })} />
        <Toggle label="Flat shading" checked={view.flatShading} onChange={(v) => setView({ flatShading: v })} />
        <Toggle label="Grid" checked={view.showGrid} onChange={(v) => setView({ showGrid: v })} />
        <Toggle label="Axes" checked={view.showAxes} onChange={(v) => setView({ showAxes: v })} />
        <Toggle label="Labels" checked={view.showLabels} onChange={(v) => setView({ showLabels: v })} />
      </div>
      {view.wireframe && triCount > 1_000_000 && (
        <p className="hint warn">Wireframe on {Math.round(triCount / 1e5) / 10}M triangles may be slow.</p>
      )}
    </Panel>
  );
}
