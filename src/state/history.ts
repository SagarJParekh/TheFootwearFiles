import type { ProjectDocument } from '../core/document';

/**
 * Undo/redo history of immutable document snapshots. Snapshots share mesh
 * references, so transform/landmark edits cost almost nothing; mesh edits keep
 * the previous mesh alive. A byte budget evicts the oldest entries first.
 */
export interface HistoryEntry {
  label: string;
  doc: ProjectDocument;
}

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const DEFAULT_HISTORY_BUDGET_BYTES = 600 * 1024 * 1024;
export const MAX_HISTORY_ENTRIES = 200;

export const emptyHistory = (): HistoryState => ({ past: [], future: [] });

function meshBytes(doc: ProjectDocument): number {
  return doc.mesh.positions.byteLength + doc.mesh.indices.byteLength;
}

/** Total bytes of distinct meshes retained by history + current document. */
export function historyBytes(h: HistoryState, current: ProjectDocument | null): number {
  const seen = new Set<string>();
  let total = 0;
  const visit = (d: ProjectDocument | null) => {
    if (!d || seen.has(d.mesh.id)) return;
    seen.add(d.mesh.id);
    total += meshBytes(d);
  };
  visit(current);
  h.past.forEach((e) => visit(e.doc));
  h.future.forEach((e) => visit(e.doc));
  return total;
}

/** Records `before` as an undo point (labelled with the action that follows it). Clears redo. */
export function pushHistory(
  h: HistoryState,
  before: ProjectDocument,
  label: string,
  current: ProjectDocument,
  budget = DEFAULT_HISTORY_BUDGET_BYTES,
): HistoryState {
  const past = [...h.past, { label, doc: before }];
  const next: HistoryState = { past, future: [] };
  while (next.past.length > MAX_HISTORY_ENTRIES) next.past.shift();
  while (next.past.length > 1 && historyBytes(next, current) > budget) next.past.shift();
  return next;
}

export function undo(h: HistoryState, current: ProjectDocument): { history: HistoryState; doc: ProjectDocument; label: string } | null {
  const entry = h.past[h.past.length - 1];
  if (!entry) return null;
  return {
    history: { past: h.past.slice(0, -1), future: [{ label: entry.label, doc: current }, ...h.future] },
    doc: entry.doc,
    label: entry.label,
  };
}

export function redo(h: HistoryState, current: ProjectDocument): { history: HistoryState; doc: ProjectDocument; label: string } | null {
  const entry = h.future[0];
  if (!entry) return null;
  return {
    history: { past: [...h.past, { label: entry.label, doc: current }], future: h.future.slice(1) },
    doc: entry.doc,
    label: entry.label,
  };
}
