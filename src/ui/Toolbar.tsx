import { useRef, useState } from 'react';
import { exportStl, loadModelFile, saveProject } from '../state/actions';
import { ACCEPT } from '../formats/registry';
import { downloadBlob } from './common';
import { redoEdit, requestCamera, undoEdit, useStore, type ViewPreset } from '../state/store';
import { openAnyFile } from '../state/fileOpen';

export const SAMPLES = [
  { file: 'foot-plantar.stl', label: 'Plantar scan (open sheet)' },
  { file: 'leg-open-top.stl', label: 'Lower limb (open top, 2 holes)' },
  { file: 'foot-closed.stl', label: 'Closed foot (watertight)' },
  { file: 'sphere-with-holes.stl', label: 'Sphere with 3 holes' },
  { file: 'cube-ascii.stl', label: 'Cube (ASCII STL)' },
];

export async function loadSample(file: string) {
  const res = await fetch(`${import.meta.env.BASE_URL}samples/${file}`);
  if (!res.ok) throw new Error(`Sample ${file} not found`);
  const blob = await res.blob();
  await loadModelFile(new File([blob], file));
}

const PRESETS: { id: ViewPreset; label: string; title: string }[] = [
  { id: 'top', label: 'Top', title: 'Dorsal view (from +Z)' },
  { id: 'bottom', label: 'Plantar', title: 'Plantar view (from −Z)' },
  { id: 'medial', label: 'Medial', title: 'Medial view (depends on Left/Right)' },
  { id: 'lateral', label: 'Lateral', title: 'Lateral view (depends on Left/Right)' },
  { id: 'front', label: 'Front', title: 'Anterior view (from +Y)' },
  { id: 'back', label: 'Back', title: 'Posterior view (from −Y)' },
  { id: 'iso', label: 'Iso', title: 'Isometric view' },
];

export function Toolbar({ right }: { right?: React.ReactNode }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasDoc = useStore((s) => !!s.doc);
  const canUndo = useStore((s) => s.history.past.length > 0);
  const canRedo = useStore((s) => s.history.future.length > 0);
  const undoLabel = useStore((s) => s.history.past.at(-1)?.label);
  const redoLabel = useStore((s) => s.history.future[0]?.label);
  const [bake, setBake] = useState(true);

  return (
    <div className="toolbar">
      <span className="brand">Footwear Files</span>
      <button onClick={() => inputRef.current?.click()} title="Open a 3D model (STL, OBJ, PLY, 3MF, AMF, glTF/GLB, STEP, IGES, 3DM, …), a .tffproj project or landmarks .json">
        Open…
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        data-testid="file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openAnyFile(f);
          e.target.value = '';
        }}
      />
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) void loadSample(e.target.value).catch((err) => useStore.setState({ error: String(err) }));
        }}
        title="Load a generated test model"
      >
        <option value="">Samples…</option>
        {SAMPLES.map((s) => (
          <option key={s.file} value={s.file}>
            {s.label}
          </option>
        ))}
      </select>
      <span className="sep" />
      <button disabled={!canUndo} onClick={undoEdit} title={`Undo ${undoLabel ?? ''} (Ctrl+Z)`}>
        ↶ Undo
      </button>
      <button disabled={!canRedo} onClick={redoEdit} title={`Redo ${redoLabel ?? ''} (Ctrl+Shift+Z)`}>
        ↷ Redo
      </button>
      <span className="sep" />
      <button disabled={!hasDoc} onClick={() => requestCamera('fit')} title="Fit to view (F)">
        Fit
      </button>
      {PRESETS.map((p) => (
        <button key={p.id} disabled={!hasDoc} onClick={() => requestCamera('preset', p.id)} title={p.title}>
          {p.label}
        </button>
      ))}
      <span className="spacer" />
      <button
        disabled={!hasDoc}
        onClick={async () => {
          const r = await saveProject();
          if (r) downloadBlob(r.data as BlobPart, r.fileName);
        }}
        title="Save mesh + transform + landmarks as a .tffproj project"
      >
        Save project
      </button>
      <button
        disabled={!hasDoc}
        onClick={async () => {
          const r = await exportStl(bake);
          if (r) downloadBlob(r.data, r.fileName, 'model/stl');
        }}
        title="Export the edited mesh as binary STL"
        data-testid="export-stl"
      >
        Export STL
      </button>
      <label className="toggle" title="Write vertices in world coordinates (with the current move/rotate applied)">
        <input type="checkbox" checked={bake} onChange={(e) => setBake(e.target.checked)} />
        apply transform
      </label>
      {right}
    </div>
  );
}
