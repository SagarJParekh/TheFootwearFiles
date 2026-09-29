import { SCAN_TYPE_LABEL, SIDE_LABEL } from '../../core/landmarks/definitions';
import { useStore } from '../../state/store';
import { Panel, fmt } from '../common';

export function InfoPanel() {
  const doc = useStore((s) => s.doc);
  const derived = useStore((s) => s.derived);
  if (!doc) return null;
  const stats = derived?.meshId === doc.mesh.id ? derived.stats : null;
  const size = stats ? stats.bounds.max.map((v, i) => v - stats.bounds.min[i]) : null;

  return (
    <Panel
      title="Model"
      actions={
        <button className="link" onClick={() => useStore.setState({ scanDialogOpen: true })}>
          Scan setup
        </button>
      }
    >
      <dl className="info-grid">
        <dt>File</dt>
        <dd title={doc.meta.sourceFileName}>{doc.meta.sourceFileName}</dd>
        {doc.meta.import && (
          <>
            <dt>Source</dt>
            <dd data-testid="source-info">
              {doc.meta.import.format.toUpperCase()} · {doc.meta.import.units}
              {doc.meta.import.upAxis === 'y' ? ' · Y-up→Z-up' : ''}
              {doc.meta.import.unitsSource === 'guess' && <small className="warn"> (units guessed)</small>}
            </dd>
          </>
        )}
        <dt>Scan</dt>
        <dd>{doc.scan ? `${SCAN_TYPE_LABEL[doc.scan.type]} · ${SIDE_LABEL[doc.scan.side]}` : '—'}</dd>
        {stats ? (
          <>
            <dt>Triangles</dt>
            <dd data-testid="tri-count">{stats.triangleCount.toLocaleString()}</dd>
            <dt>Vertices</dt>
            <dd>{stats.vertexCount.toLocaleString()}</dd>
            <dt>Size (mm)</dt>
            <dd data-testid="bbox">
              {fmt(size![0])} × {fmt(size![1])} × {fmt(size![2])}
            </dd>
            <dt>Watertight</dt>
            <dd data-testid="watertight" className={stats.watertight ? 'ok' : 'warn'}>
              {stats.watertight ? 'Yes' : 'No'}
              {!stats.watertight && (
                <small>
                  {' '}
                  ({stats.boundaryEdgeCount} open edges
                  {stats.nonManifoldEdgeCount ? `, ${stats.nonManifoldEdgeCount} non-manifold` : ''})
                </small>
              )}
            </dd>
          </>
        ) : (
          <>
            <dt>Analysis</dt>
            <dd>computing…</dd>
          </>
        )}
      </dl>
      <p className="hint">Size is the bounding box in mesh-local coordinates.</p>
    </Panel>
  );
}
