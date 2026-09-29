import { useEffect } from 'react';
import { setError, setNotice, useStore } from '../state/store';

export function StatusBar() {
  const busy = useStore((s) => s.busy);
  const error = useStore((s) => s.error);
  const notice = useStore((s) => s.notice);
  const tool = useStore((s) => s.tool);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <footer className="statusbar" data-testid="status">
      {busy && (
        <span className="busy">
          <span className="spinner" /> {busy}…
        </span>
      )}
      {error && (
        <span className="error" role="alert">
          {error} <button className="link" onClick={() => setError(null)}>dismiss</button>
        </span>
      )}
      {!busy && !error && notice && <span className="notice">{notice}</span>}
      <span className="spacer" />
      <span className="hint">
        {tool === 'landmark' ? 'Click the surface to place the selected landmark · drag markers to adjust · ' : ''}
        Left-drag orbit · right-drag pan · wheel zoom
      </span>
    </footer>
  );
}
