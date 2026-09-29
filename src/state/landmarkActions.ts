import { landmarksToCsv, landmarksToJson, parseLandmarksJson } from '../core/io/landmarksIO';
import { LANDMARK_BY_ID, landmarksForScanType, type LandmarkId } from '../core/landmarks/definitions';
import type { Vec3 } from '../core/types';
import { meshWorker } from '../workers/meshClient';
import { commit, setTool, updateLive, useStore } from './store';

const get = useStore.getState;
const set = useStore.setState;

/** Selects which landmark the next surface click places (and enters landmark mode). */
export function selectLandmark(id: LandmarkId | null): void {
  set({ activeLandmark: id });
  setTool(id ? 'landmark' : 'none');
}

/** Next landmark (in list order) that is still missing, or null. */
function nextMissing(after: LandmarkId): LandmarkId | null {
  const { doc } = get();
  if (!doc?.scan) return null;
  const defs = landmarksForScanType(doc.scan.type);
  const start = defs.findIndex((d) => d.id === after);
  for (let i = 1; i <= defs.length; i++) {
    const d = defs[(start + i) % defs.length];
    if (!doc.landmarks[d.id]) return d.id;
  }
  return null;
}

export function placeLandmark(id: LandmarkId, local: Vec3): void {
  const existed = !!get().doc?.landmarks[id];
  commit(`${existed ? 'Re-place' : 'Place'} ${LANDMARK_BY_ID[id].label}`, (doc) => ({
    ...doc,
    landmarks: { ...doc.landmarks, [id]: { local, placedAt: new Date().toISOString() } },
  }));
  clearOffSurface(id);
  // Advance to the next missing landmark so a full set can be placed click-by-click.
  const next = nextMissing(id);
  selectLandmark(next);
}

/** Live update while dragging (history is recorded by the surrounding gesture). */
export function dragLandmark(id: LandmarkId, local: Vec3): void {
  updateLive((doc) => {
    const l = doc.landmarks[id];
    if (!l) return doc;
    return { ...doc, landmarks: { ...doc.landmarks, [id]: { ...l, local } } };
  });
  clearOffSurface(id);
}

export function deleteLandmark(id: LandmarkId): void {
  commit(`Delete ${LANDMARK_BY_ID[id].label}`, (doc) => {
    const landmarks = { ...doc.landmarks };
    delete landmarks[id];
    return { ...doc, landmarks };
  });
  clearOffSurface(id);
}

export function clearAllLandmarks(): void {
  commit('Clear landmarks', (doc) => (Object.keys(doc.landmarks).length ? { ...doc, landmarks: {} } : doc));
  set({ offSurface: {} });
}

function clearOffSurface(id: LandmarkId) {
  const off = get().offSurface;
  if (off[id] !== undefined) {
    const next = { ...off };
    delete next[id];
    set({ offSurface: next });
  }
}

/** Threshold (mm) above which a landmark is reported as no longer on the surface. */
export const OFF_SURFACE_TOLERANCE = 0.5;

/** Re-checks which landmarks still lie on the (edited) surface. */
export async function refreshOffSurface(): Promise<void> {
  const { doc } = get();
  if (!doc) return;
  const ids = Object.keys(doc.landmarks) as LandmarkId[];
  if (!ids.length) {
    set({ offSurface: {} });
    return;
  }
  const meshId = doc.mesh.id;
  const d = await meshWorker().surfaceDistances(doc.mesh, ids.map((id) => doc.landmarks[id]!.local));
  if (get().doc?.mesh.id !== meshId) return;
  const off: Partial<Record<LandmarkId, number>> = {};
  ids.forEach((id, i) => {
    if (d[i] > OFF_SURFACE_TOLERANCE) off[id] = d[i];
  });
  set({ offSurface: off });
}

// Mesh edits (cut, fill, undo/redo across them) may move the surface away from landmarks.
useStore.subscribe((state, prev) => {
  if (state.doc && prev.doc && state.doc.mesh.id !== prev.doc.mesh.id) void refreshOffSurface();
});

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

export function exportLandmarksJson(): string | null {
  const { doc } = get();
  return doc ? landmarksToJson(doc) : null;
}

export function exportLandmarksCsv(): string | null {
  const { doc } = get();
  return doc ? landmarksToCsv(doc) : null;
}

export async function importLandmarksFile(file: File): Promise<void> {
  const { doc } = get();
  if (!doc) {
    set({ error: 'Load a mesh before importing landmarks' });
    return;
  }
  try {
    const parsed = parseLandmarksJson(await file.text(), doc.transform);
    const count = Object.keys(parsed.landmarks).length;
    commit(`Import ${count} landmarks`, (d) => ({
      ...d,
      scan: parsed.scan ?? d.scan,
      landmarks: { ...d.landmarks, ...parsed.landmarks },
    }));
    const notes = [...parsed.warnings];
    if (parsed.sourceFileName && parsed.sourceFileName !== doc.meta.sourceFileName) {
      notes.push(`landmarks were exported from "${parsed.sourceFileName}"`);
    }
    set({ notice: `Imported ${count} landmarks${notes.length ? ` (${notes.join('; ')})` : ''}` });
    await refreshOffSurface();
  } catch (e) {
    set({ error: `Landmark import failed: ${e instanceof Error ? e.message : String(e)}` });
  }
}
