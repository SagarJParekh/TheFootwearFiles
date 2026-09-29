import { create } from 'zustand';
import type { ProjectDocument } from '../core/document';
import type { MeshStats, Vec3 } from '../core/types';
import type { LandmarkId } from '../core/landmarks/definitions';
import type { HoleInfo, InsoleOutput } from '../workers/mesh.worker';
import { emptyHistory, pushHistory, redo, undo, type HistoryState } from './history';

export type ViewPreset = 'top' | 'bottom' | 'medial' | 'lateral' | 'front' | 'back' | 'iso';
export type GizmoMode = 'none' | 'translate' | 'rotate';
export type Tool = 'none' | 'landmark' | 'clip' | 'holes';

export interface ViewState {
  wireframe: boolean;
  flatShading: boolean;
  showGrid: boolean;
  showAxes: boolean;
  showLabels: boolean;
  gizmo: GizmoMode;
  /** Show the scan (the insole designer can hide it: "Toggle scan visibility"). */
  showScan: boolean;
  showToeArrow: boolean;
}

/** Non-destructive clipping plane in world space; the visible side is where dot(n, p) >= constant. */
export interface ClipState {
  enabled: boolean;
  normal: Vec3;
  constant: number;
  showPlane: boolean;
  gizmo: 'none' | 'translate' | 'rotate';
}

export interface CameraRequest {
  kind: 'fit' | 'preset';
  preset?: ViewPreset;
  nonce: number;
}

/** Derived, non-serialised data computed for a specific mesh version. */
export interface MeshDerived {
  meshId: string;
  stats: MeshStats;
  normals: Float32Array;
}

export interface AppState {
  doc: ProjectDocument | null;
  derived: MeshDerived | null;
  history: HistoryState;
  view: ViewState;
  camera: CameraRequest;
  clip: ClipState;
  tool: Tool;
  busy: string | null;
  error: string | null;
  notice: string | null;
  scanDialogOpen: boolean;
  /** Landmark that the next click on the surface will place. */
  activeLandmark: LandmarkId | null;
  /** Landmarks found to be off the current surface (e.g. after a cut), with distance in mm. */
  offSurface: Partial<Record<LandmarkId, number>>;
  /** Boundary loops of the current mesh (null until detected). */
  holes: { meshId: string; loops: HoleInfo[] } | null;
  /** Loop ids excluded from "fill all" (per mesh version). */
  holeExcluded: Set<number>;
  hoveredHole: number | null;
  showHoles: boolean;
  /** Generated insole for the current design (derived, not saved). */
  insole: { key: string; output: InsoleOutput } | null;
  insoleBusy: boolean;
  insoleError: string | null;
  /** Right sidebar tab. */
  rightTab: 'landmarks' | 'insole';
  /** Snapshot taken at the start of a continuous gesture (gizmo drag, landmark drag). */
  gestureStart: ProjectDocument | null;
}

export const initialView: ViewState = {
  wireframe: false,
  flatShading: false,
  showGrid: true,
  showAxes: true,
  showLabels: true,
  gizmo: 'none',
  showScan: true,
  showToeArrow: true,
};

export const useStore = create<AppState>(() => ({
  doc: null,
  derived: null,
  history: emptyHistory(),
  view: initialView,
  camera: { kind: 'fit', nonce: 0 },
  clip: { enabled: false, normal: [0, 0, -1], constant: 0, showPlane: true, gizmo: 'none' },
  tool: 'none',
  busy: null,
  error: null,
  notice: null,
  scanDialogOpen: false,
  activeLandmark: null,
  offSurface: {},
  holes: null,
  holeExcluded: new Set(),
  hoveredHole: null,
  showHoles: true,
  insole: null,
  insoleBusy: false,
  insoleError: null,
  rightTab: 'landmarks',
  gestureStart: null,
}));

const get = useStore.getState;
const set = useStore.setState;

// ---------------------------------------------------------------------------
// Document edits with history
// ---------------------------------------------------------------------------

/** Applies an undoable edit to the document. */
export function commit(label: string, update: (doc: ProjectDocument) => ProjectDocument): void {
  const { doc, history } = get();
  if (!doc) return;
  const next = update(doc);
  if (next === doc) return;
  set({ doc: next, history: pushHistory(history, doc, label, next) });
}

/** Replaces the document without recording history (e.g. loading a file). */
export function resetDocument(doc: ProjectDocument | null): void {
  set({ doc, history: emptyHistory(), gestureStart: null });
}

/** Starts a continuous edit (drag). Intermediate updates go through `updateLive`. */
export function beginGesture(): void {
  const { doc } = get();
  if (doc) set({ gestureStart: doc });
}

export function updateLive(update: (doc: ProjectDocument) => ProjectDocument): void {
  const { doc } = get();
  if (doc) set({ doc: update(doc) });
}

export function endGesture(label: string): void {
  const { gestureStart, doc, history } = get();
  if (!gestureStart || !doc) return;
  set({
    gestureStart: null,
    history: gestureStart === doc ? history : pushHistory(history, gestureStart, label, doc),
  });
}

export function undoEdit(): void {
  const { doc, history } = get();
  if (!doc) return;
  const r = undo(history, doc);
  if (r) set({ doc: r.doc, history: r.history, notice: `Undo: ${r.label}` });
}

export function redoEdit(): void {
  const { doc, history } = get();
  if (!doc) return;
  const r = redo(history, doc);
  if (r) set({ doc: r.doc, history: r.history, notice: `Redo: ${r.label}` });
}

// ---------------------------------------------------------------------------
// View helpers
// ---------------------------------------------------------------------------

export function setView(patch: Partial<ViewState>): void {
  const clip = patch.gizmo && patch.gizmo !== 'none' ? { ...get().clip, gizmo: 'none' as const } : get().clip;
  set({ view: { ...get().view, ...patch }, clip });
}

export function requestCamera(kind: 'fit' | 'preset', preset?: ViewPreset): void {
  set({ camera: { kind, preset, nonce: get().camera.nonce + 1 } });
}

export function setClip(patch: Partial<ClipState>): void {
  const clip = { ...get().clip, ...patch };
  // Only one transform gizmo at a time.
  const view = patch.gizmo && patch.gizmo !== 'none' ? { ...get().view, gizmo: 'none' as const } : get().view;
  set({ clip, view });
}

export function setTool(tool: Tool): void {
  set({ tool });
}

export function setError(error: string | null): void {
  set({ error });
}

export function setNotice(notice: string | null): void {
  set({ notice });
}
