/**
 * Insole designer actions: create/remove the design, edit parameters (undoable), align the
 * scan from landmarks, and keep the generated insole in sync (debounced worker calls).
 */
import type { ProjectDocument } from '../core/document';
import type { FrameLandmarks } from '../core/insole/frame';
import { defaultInsoleParams, suggestShoeSize, type InsoleParams, type InsoleType } from '../core/insole/params';
import { ARCH_LANDMARKS_MISSING, adjustArchPoint, archRegion } from '../core/foot/archAdjust';
import { syncBasePlane } from '../core/align/basePlane';
import { applyTransform } from '../core/math/transform';
import type { Vec3 } from '../core/types';
import { meshWorker, withMesh } from '../workers/meshClient';
import { setView, useStore, commit, beginGesture, updateLive, endGesture, type ScanDisplay } from './store';
import { setBasePlaneAction } from './basePlaneActions';
import { withBusy } from './actions';

const get = useStore.getState;
const set = useStore.setState;

/** World-space landmarks needed by the insole frame, or null with the missing names. */
export function insoleLandmarks(doc: ProjectDocument): { lm: FrameLandmarks | null; missing: string[] } {
  const w = (id: 'heelCentre' | 'met1Head' | 'met5Head' | 'archPeak' | 'archStart' | 'archEnd'): Vec3 | undefined => {
    const l = doc.landmarks[id];
    return l ? applyTransform(doc.transform, l.local) : undefined;
  };
  const hc = w('heelCentre'), m1 = w('met1Head'), m5 = w('met5Head');
  const missing = [!hc && 'Heel centre', !m1 && '1st metatarsal head', !m5 && '5th metatarsal head'].filter(Boolean) as string[];
  if (!hc || !m1 || !m5) return { lm: null, missing };
  const lm: FrameLandmarks = { heelCentre: hc, met1Head: m1, met5Head: m5 };
  for (const id of ['archPeak', 'archStart', 'archEnd'] as const) {
    const p = w(id);
    if (p) lm[id] = p;
  }
  return { lm, missing };
}

/** "Create the insole" toggle (with the chosen type). Suggests the shoe size from the scan footprint. */
export async function setInsoleEnabled(enabled: boolean, type: InsoleType = get().pendingInsoleType): Promise<void> {
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
  commit(`Create ${type === 'full' ? 'full-length' : '3/4'} insole`, (d) => ({ ...d, insole: d.insole ?? defaultInsoleParams(size, type) }));
  // Make the foot see-through so the new insole underneath is visible (toggle in the panel).
  if (get().view.scanDisplay === 'solid') setView({ scanDisplay: 'transparent' });
  set({ notice: `Insole created (UK${size} suggested from the scan)` });
}

/** Chooses Full length (FDM) or 3/4 length (powder) – before creating, or switching an existing design. */
export function setInsoleType(type: InsoleType): void {
  set({ pendingInsoleType: type });
  if (get().doc?.insole && get().doc!.insole!.type !== type) {
    updateInsole(type === 'full' ? 'Full-length insole' : '3/4 insole', (p) => ({ ...p, type }));
  }
}

/**
 * Sets the arch adjustment of the FOOT scan to `target` mm (cumulative): the scan's plantar arch
 * is raised/lowered and the insole regenerates from the modified foot. One undo step.
 */
export async function setFootArch(target: number): Promise<void> {
  const { doc } = get();
  if (!doc) return;
  if (!doc.basePlaneLocked) {
    set({ error: 'Set the base plane (heel centre, M1, M5) before adjusting the arch.' });
    return;
  }
  const { lm } = insoleLandmarks(doc);
  if (!lm) return;
  if (!lm.archStart || !lm.archEnd) {
    set({ error: ARCH_LANDMARKS_MISSING });
    return;
  }
  const delta = target - (doc.footArchAdjust ?? 0);
  if (Math.abs(delta) < 1e-6) return;
  await withBusy('Adjusting the arch', async () => {
    const mesh = await withMesh(doc.mesh, (m) => meshWorker().adjustFootArch(m, doc.transform, lm, delta));
    const region = archRegion(lm);
    commit(`Foot arch ${target > 0 ? '+' : ''}${target} mm`, (d) =>
      syncBasePlane({
        ...d,
        mesh,
        footArchAdjust: target,
        landmarks: Object.fromEntries(
          Object.entries(d.landmarks).map(([id, l]) => [id, { ...l!, local: adjustArchPoint(l!.local, d.transform, region, delta) }]),
        ),
      }),
    );
  });
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

/** "Align the scan": sets the heel/M1/M5 base plane (aligns and locks the model). */
export function alignScanFromLandmarks(): void {
  setBasePlaneAction();
}

export function setScanDisplay(mode: ScanDisplay): void {
  setView({ scanDisplay: mode });
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
