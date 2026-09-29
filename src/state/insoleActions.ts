/**
 * Insole designer actions: create/remove the design, edit parameters (undoable), align the
 * scan from landmarks, and keep the generated insole in sync (debounced worker calls).
 */
import type { ProjectDocument } from '../core/document';
import { alignFromLandmarks } from '../core/align/landmarkAlign';
import type { FrameLandmarks } from '../core/insole/frame';
import { defaultInsoleParams, suggestShoeSize, type InsoleParams } from '../core/insole/params';
import { applyTransform } from '../core/math/transform';
import type { Vec3 } from '../core/types';
import { meshWorker, withMesh } from '../workers/meshClient';
import { requestCamera, setView, useStore, commit, beginGesture, updateLive, endGesture } from './store';
import { withBusy } from './actions';

const get = useStore.getState;
const set = useStore.setState;

/** World-space landmarks needed by the insole frame, or null with the missing names. */
export function insoleLandmarks(doc: ProjectDocument): { lm: FrameLandmarks | null; missing: string[] } {
  const w = (id: 'heelCentre' | 'met1Head' | 'met5Head' | 'archPeak'): Vec3 | undefined => {
    const l = doc.landmarks[id];
    return l ? applyTransform(doc.transform, l.local) : undefined;
  };
  const hc = w('heelCentre'), m1 = w('met1Head'), m5 = w('met5Head');
  const missing = [!hc && 'Heel centre', !m1 && '1st metatarsal head', !m5 && '5th metatarsal head'].filter(Boolean) as string[];
  if (!hc || !m1 || !m5) return { lm: null, missing };
  const arch = w('archPeak');
  return { lm: { heelCentre: hc, met1Head: m1, met5Head: m5, ...(arch ? { archPeak: arch } : {}) }, missing };
}

/** "Create the insole" toggle. Suggests the shoe size from the scan footprint the first time. */
export async function setInsoleEnabled(enabled: boolean): Promise<void> {
  const { doc } = get();
  if (!doc) return;
  if (!enabled) {
    commit('Remove insole', (d) => ({ ...d, insole: null }));
    return;
  }
  const { lm, missing } = insoleLandmarks(doc);
  if (!lm) {
    set({ error: `Place these landmarks first: ${missing.join(', ')}` });
    return;
  }
  let size = 8;
  await withBusy('Measuring the foot', async () => {
    const len = await withMesh(doc.mesh, (m) => meshWorker().measureFoot(m, doc.transform, lm));
    if (len) size = suggestShoeSize(len);
  });
  commit('Create insole', (d) => ({ ...d, insole: d.insole ?? defaultInsoleParams(size) }));
  set({ notice: `Insole created (UK${size} suggested from the scan)` });
}

/** Undoable parameter change (single step, e.g. a toggle or select). */
export function updateInsole(label: string, fn: (p: InsoleParams) => InsoleParams): void {
  commit(label, (d) => (d.insole ? { ...d, insole: fn(d.insole) } : d));
}

/** Continuous change (slider drag): live updates, one undo step when released. */
export const insoleGesture = {
  begin: () => beginGesture(),
  update: (fn: (p: InsoleParams) => InsoleParams) => updateLive((d) => (d.insole ? { ...d, insole: fn(d.insole) } : d)),
  end: (label: string) => endGesture(label),
};

/** "Align the scan": plantar plane (HC, M1, M5) to the floor, heel→toes along +Y. */
export function alignScanFromLandmarks(): void {
  const { doc, derived } = get();
  if (!doc) return;
  const hc = doc.landmarks.heelCentre?.local, m1 = doc.landmarks.met1Head?.local, m5 = doc.landmarks.met5Head?.local;
  if (!hc || !m1 || !m5) {
    set({ error: 'Place the heel centre and 1st/5th metatarsal heads first' });
    return;
  }
  const b = derived?.stats.bounds;
  const centroid: Vec3 = b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] : hc;
  const above = doc.landmarks.archPeak?.local ?? centroid;
  try {
    const t = alignFromLandmarks({ heelCentre: hc, met1Head: m1, met5Head: m5, abovePoint: above });
    commit('Align from landmarks', (d) => ({ ...d, transform: t }));
    requestCamera('preset', 'iso');
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  }
}

export function toggleScanVisibility(): void {
  setView({ showScan: !get().view.showScan });
}

// ---------------------------------------------------------------------------
// Regeneration: whenever the design, scan, transform or landmarks change.
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;
let requestId = 0;

function designKey(doc: ProjectDocument, lm: FrameLandmarks): string {
  return JSON.stringify([doc.mesh.id, doc.transform, lm, doc.insole]);
}

async function regenerate(): Promise<void> {
  const { doc } = get();
  if (!doc?.insole) {
    if (get().insole) set({ insole: null, insoleError: null });
    return;
  }
  const { lm, missing } = insoleLandmarks(doc);
  if (!lm) {
    set({ insoleError: `Missing landmarks: ${missing.join(', ')}` });
    return;
  }
  const key = designKey(doc, lm);
  if (get().insole?.key === key) return;
  const id = ++requestId;
  set({ insoleBusy: true });
  try {
    const output = await withMesh(doc.mesh, (m) => meshWorker().generateInsole(m, doc.transform, lm, doc.insole!));
    if (id === requestId) set({ insole: { key, output }, insoleError: null });
  } catch (e) {
    if (id === requestId) set({ insoleError: e instanceof Error ? e.message : String(e) });
  } finally {
    if (id === requestId) set({ insoleBusy: false });
  }
}

useStore.subscribe((state, prev) => {
  const d = state.doc, p = prev.doc;
  if (d === p) return;
  if (d?.insole !== p?.insole || d?.mesh !== p?.mesh || d?.transform !== p?.transform || d?.landmarks !== p?.landmarks) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void regenerate(), 120);
  }
});

export async function exportInsoleStl(): Promise<{ data: ArrayBuffer; fileName: string } | undefined> {
  const { insole, doc } = get();
  if (!insole || !doc) return;
  const mesh = insole.output.mesh;
  const base = doc.meta.sourceFileName.replace(/\.[^.]+$/, '') || 'scan';
  return withBusy('Exporting insole', async () => ({
    data: await withMesh(mesh, (m) => meshWorker().exportStl(m, null)),
    fileName: `${base}-${insole.output.kind}-UK${doc.insole?.shoeSizeUK ?? ''}.stl`,
  }));
}
