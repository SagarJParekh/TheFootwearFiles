import { DEFAULT_FILL_OPTIONS, type FillOptions } from '../core/mesh/fill/fillHoles';
import { meshWorker, withMesh } from '../workers/meshClient';
import { withBusy } from './actions';
import { commit, useStore } from './store';

const get = useStore.getState;
const set = useStore.setState;

let detecting: string | null = null;

/** Detects boundary loops for the current mesh (runs in the worker). */
export async function detectHoles(): Promise<void> {
  const { doc } = get();
  if (!doc || detecting === doc.mesh.id) return;
  const meshId = doc.mesh.id;
  detecting = meshId;
  try {
    const loops = await withMesh(doc.mesh, (m) => meshWorker().findHoles(m));
    if (get().doc?.mesh.id !== meshId) return;
    set({
      holes: { meshId, loops },
      holeExcluded: new Set(loops.filter((l) => l.suggestedExclude).map((l) => l.id)),
      hoveredHole: null,
    });
  } catch (e) {
    set({ error: `Hole detection failed: ${String(e)}` });
  } finally {
    if (detecting === meshId) detecting = null;
  }
}

// Re-detect whenever the mesh version changes (load, cut, fill, undo/redo).
useStore.subscribe((state, prev) => {
  if (state.doc?.mesh.id !== prev.doc?.mesh.id) {
    set({ holes: null, hoveredHole: null });
    if (state.doc) void detectHoles();
  }
});

export function toggleHoleExcluded(id: number): void {
  const next = new Set(get().holeExcluded);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  set({ holeExcluded: next });
}

/** Excludes every loop whose perimeter exceeds `mm` (and includes the rest). */
export function excludeLargerThan(mm: number): void {
  const loops = get().holes?.loops ?? [];
  set({ holeExcluded: new Set(loops.filter((l) => l.perimeter > mm).map((l) => l.id)) });
}

export async function fillHoleIds(ids: number[], options: FillOptions = DEFAULT_FILL_OPTIONS): Promise<void> {
  const { doc } = get();
  if (!doc || !ids.length) return;
  await withBusy(`Filling ${ids.length} hole${ids.length > 1 ? 's' : ''}`, async () => {
    const r = await withMesh(doc.mesh, (m) => meshWorker().fillHoles(m, ids, options));
    if (get().doc?.mesh.id !== doc.mesh.id) return; // mesh changed meanwhile
    commit(ids.length === 1 ? 'Fill hole' : `Fill ${ids.length} holes`, (d) => ({ ...d, mesh: r.mesh }));
    set({ notice: `Filled ${r.filled} hole(s): +${r.addedTriangles.toLocaleString()} triangles` });
  });
}

export async function fillAllIncluded(options: FillOptions = DEFAULT_FILL_OPTIONS): Promise<void> {
  const { holes, holeExcluded } = get();
  if (!holes) return;
  await fillHoleIds(holes.loops.filter((l) => !holeExcluded.has(l.id)).map((l) => l.id), options);
}
