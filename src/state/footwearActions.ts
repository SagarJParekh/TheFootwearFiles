/**
 * Footwear designer actions (shoe / chappal): create/remove the design, edit parameters
 * (undoable), keep the generated footwear in sync (debounced worker calls) and export it.
 */
import type { ProjectDocument } from '../core/document';
import type { FrameLandmarks } from '../core/insole/frame';
import { suggestShoeSize } from '../core/insole/params';
import { defaultFootwearParams, REFERENCE_DESIGNS, type DesignId, type FootwearKind, type FootwearParams } from '../core/footwear/params';
import { meshWorker, withMesh } from '../workers/meshClient';
import { setView, useStore, commit, beginGesture, updateLive, endGesture } from './store';
import { insoleLandmarks } from './insoleActions';
import { withBusy } from './actions';

const get = useStore.getState;
const set = useStore.setState;

/** Shows the insole or the footwear designer (panel and viewport). */
export function setDesignCategory(category: 'insole' | 'footwear'): void {
  set({ designCategory: category });
}

/** "Create the footwear" toggle. Suggests the shoe size from the scan footprint. */
export async function setFootwearEnabled(enabled: boolean, kind: FootwearKind = get().pendingFootwearKind): Promise<void> {
  const { doc } = get();
  if (!doc) return;
  if (!enabled) {
    commit('Remove footwear', (d) => ({ ...d, footwear: null }));
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
  commit(`Create ${kind}`, (d) => ({ ...d, footwear: d.footwear ?? defaultFootwearParams(size, kind) }));
  if (get().view.scanDisplay === 'solid') setView({ scanDisplay: 'transparent' });
  set({ notice: `${kind === 'shoe' ? 'Shoe' : 'Chappal'} created (UK${size} suggested from the scan)` });
}

/** Shoe or chappal – before creating, or switching an existing design (keeps the shared settings). */
export function setFootwearKind(kind: FootwearKind): void {
  set({ pendingFootwearKind: kind });
  const p = get().doc?.footwear;
  if (p && p.kind !== kind) {
    // Kind-specific defaults and that kind's default reference design; the design rules stay as set.
    const design = defaultFootwearParams(p.shoeSizeUK, kind).design as Exclude<DesignId, 'custom'>;
    updateFootwear(kind === 'shoe' ? 'Shoe' : 'Chappal', (q) => withDesign(q, design));
  }
}

/** Parameters `q` switched to the kind of reference design `id` and set from it. */
function withDesign(q: FootwearParams, id: Exclude<DesignId, 'custom'>): FootwearParams {
  const ref = REFERENCE_DESIGNS[id];
  let base = q;
  if (q.kind !== ref.kind) {
    const d = defaultFootwearParams(q.shoeSizeUK, ref.kind);
    base = { ...q, kind: ref.kind, soleThickness: d.soleThickness, toeSpring: d.toeSpring, rimHeight: d.rimHeight, toeAllowance: d.toeAllowance, sideWall: d.sideWall };
  }
  return { ...ref.set(base), design: id };
}

/** Sets the parameters from one of the reference designs (undoable). */
export function applyFootwearDesign(id: Exclude<DesignId, 'custom'>): void {
  set({ pendingFootwearKind: REFERENCE_DESIGNS[id].kind });
  updateFootwear(`Design: ${REFERENCE_DESIGNS[id].label}`, (q) => withDesign(q, id));
}

export function updateFootwear(label: string, fn: (p: FootwearParams) => FootwearParams): void {
  commit(label, (d) => (d.footwear ? { ...d, footwear: fn(d.footwear) } : d));
}

export const footwearGesture = {
  begin: () => beginGesture(),
  update: (fn: (p: FootwearParams) => FootwearParams) => updateLive((d) => (d.footwear ? { ...d, footwear: fn(d.footwear) } : d)),
  end: (label: string) => endGesture(label),
};

// ---------------------------------------------------------------------------
// Regeneration
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;
let requestId = 0;

function designKey(doc: ProjectDocument, lm: FrameLandmarks): string {
  return JSON.stringify([doc.mesh.id, doc.transform, lm, doc.footwear]);
}

async function regenerate(): Promise<void> {
  const { doc } = get();
  if (!doc?.footwear) {
    if (get().footwear) set({ footwear: null, footwearError: null });
    return;
  }
  const { lm, missing } = insoleLandmarks(doc);
  if (!lm) {
    set({ footwearError: `Missing landmarks: ${missing.join(', ')}` });
    return;
  }
  const key = designKey(doc, lm);
  if (get().footwear?.key === key) return;
  const id = ++requestId;
  set({ footwearBusy: true });
  try {
    const output = await withMesh(doc.mesh, (m) => meshWorker().generateFootwear(m, doc.transform, lm, doc.footwear!));
    if (id === requestId) set({ footwear: { key, output }, footwearError: null });
  } catch (e) {
    if (id === requestId) set({ footwearError: e instanceof Error ? e.message : String(e) });
  } finally {
    if (id === requestId) set({ footwearBusy: false });
  }
}

useStore.subscribe((state, prev) => {
  const d = state.doc, p = prev.doc;
  if (d === p) return;
  if (d?.footwear !== p?.footwear || d?.mesh !== p?.mesh || d?.transform !== p?.transform || d?.landmarks !== p?.landmarks) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void regenerate(), 150);
  }
});

/** STL of the current footwear; `merge` = one watertight solid (slow). */
export async function exportFootwearStl(merge: boolean): Promise<{ data: ArrayBuffer; fileName: string } | undefined> {
  const { doc } = get();
  if (!doc?.footwear) return;
  const { lm } = insoleLandmarks(doc);
  if (!lm) return;
  const p = doc.footwear;
  const base = doc.meta.sourceFileName.replace(/\.[^.]+$/, '') || 'scan';
  const style = p.kind === 'shoe' ? 'shoe' : `chappal-${p.chappalStyle}`;
  return withBusy(merge ? 'Merging the footwear into one solid (this can take a minute)' : 'Exporting footwear', async () => ({
    data: await withMesh(doc.mesh, (m) => meshWorker().exportFootwearStl(m, doc.transform, lm, p, merge)),
    fileName: `${base}-${style}-UK${p.shoeSizeUK}${merge ? '-merged' : ''}.stl`,
  }));
}
