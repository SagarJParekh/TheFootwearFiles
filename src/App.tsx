import { useEffect, useState } from 'react';
import { Viewport } from './viewer/Viewport';
import { Toolbar } from './ui/Toolbar';
import { InfoPanel } from './ui/panels/InfoPanel';
import { DisplayPanel } from './ui/panels/DisplayPanel';
import { TransformPanel } from './ui/panels/TransformPanel';
import { ScanSetupDialog } from './ui/ScanSetupDialog';
import { LandmarkPanel } from './ui/panels/LandmarkPanel';
import { MeasurementsPanel } from './ui/panels/MeasurementsPanel';
import { ClipCutPanel } from './ui/panels/ClipCutPanel';
import { HolesPanel } from './ui/panels/HolesPanel';
import { InsolePanel } from './ui/panels/InsolePanel';
import { ViewportScanToggle } from './ui/ScanDisplayToggle';
import { StatusBar } from './ui/StatusBar';
import { useKeyboardShortcuts } from './ui/useKeyboardShortcuts';
import { openAnyFile } from './state/fileOpen';
import { useStore } from './state/store';

export default function App() {
  const hasDoc = useStore((s) => !!s.doc);
  const tool = useStore((s) => s.tool);
  const rightTab = useStore((s) => s.rightTab);
  const [dragOver, setDragOver] = useState(false);
  useKeyboardShortcuts();

  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  return (
    <div
      className="app"
      onDragEnter={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void openAnyFile(f);
      }}
    >
      <Toolbar />
      <div className="main">
        <aside className="sidebar left">
          {hasDoc ? (
            <>
              <InfoPanel />
              <DisplayPanel />
              <TransformPanel />
              <ClipCutPanel />
              <HolesPanel />
            </>
          ) : (
            <div className="empty-hint">
              <h3>No model loaded</h3>
              <p>Drop a 3D file anywhere, use <b>Open…</b>, or pick one of the <b>Samples</b>.</p>
              <p className="hint">
                Supported: STL, OBJ, PLY, OFF, 3MF, AMF, glTF/GLB, COLLADA (DAE), FBX, 3DS, VRML, STEP/STP, IGES,
                BREP and Rhino 3DM. Everything is converted to millimetres, Z up.
              </p>
            </div>
          )}
        </aside>
        <div className={`viewport tool-${tool}`}>
          <Viewport />
          <ViewportScanToggle />
          {dragOver && <div className="drop-overlay">Drop a 3D model, project or landmarks JSON</div>}
        </div>
        {hasDoc && (
          <aside className="sidebar right">
            <div className="tabs">
              <button className={rightTab === 'landmarks' ? 'active' : ''} onClick={() => useStore.setState({ rightTab: 'landmarks' })}>
                Landmarks
              </button>
              <button
                className={rightTab === 'insole' ? 'active' : ''}
                onClick={() => useStore.setState({ rightTab: 'insole' })}
                data-testid="tab-insole"
              >
                Insole designer
              </button>
            </div>
            {rightTab === 'landmarks' ? (
              <>
                <LandmarkPanel />
                <MeasurementsPanel />
              </>
            ) : (
              <InsolePanel />
            )}
          </aside>
        )}
      </div>
      <StatusBar />
      <ScanSetupDialog />
    </div>
  );
}
