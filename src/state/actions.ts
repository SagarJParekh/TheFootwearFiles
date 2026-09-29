/**
 * High-level actions invoked by the UI. They orchestrate worker calls and store updates;
 * the heavy lifting is in core/ (run in the worker).
 */
import { newDocument } from '../core/document';
import { computeBounds } from '../core/mesh/analyze';
import { eulerDegToQuat, quatToEulerDeg, rotateVector, transformPositions } from '../core/math/transform';
import { IDENTITY_TRANSFORM, type MeshData, type RigidTransform, type Vec3 } from '../core/types';
import * as Comlink from 'comlink';
import { meshWorker, withMesh } from '../workers/meshClient';
import { commit, requestCamera, resetDocument, useStore, type MeshDerived } from './store';

const set = useStore.setState;
const get = useStore.getState;

async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  set({ busy: label, error: null });
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    set({ error: `${label} failed: ${e instanceof Error ? e.message : String(e)}` });
    return undefined;
  } finally {
    set({ busy: null });
  }
}

// ---------------------------------------------------------------------------
// Derived data cache (stats + normals per mesh version), so undo/redo is instant.
// ---------------------------------------------------------------------------
const derivedCache = new Map<string, MeshDerived>();
const CACHE_LIMIT = 6;

function cacheDerived(d: MeshDerived) {
  derivedCache.delete(d.meshId);
  derivedCache.set(d.meshId, d);
  while (derivedCache.size > CACHE_LIMIT) derivedCache.delete(derivedCache.keys().next().value!);
}

let pendingMeshId: string | null = null;
async function refreshDerived(mesh: MeshData) {
  const cached = derivedCache.get(mesh.id);
  if (cached) {
    set({ derived: cached });
    return;
  }
  pendingMeshId = mesh.id;
  const w = meshWorker();
  const [stats, normals] = await Promise.all([withMesh(mesh, (m) => w.analyze(m)), withMesh(mesh, (m) => w.normals(m))]);
  const d: MeshDerived = { meshId: mesh.id, stats, normals };
  cacheDerived(d);
  if (pendingMeshId === mesh.id && get().doc?.mesh.id === mesh.id) set({ derived: d });
}

// Keep derived data in sync with whatever mesh the document currently holds.
useStore.subscribe((state, prev) => {
  const mesh = state.doc?.mesh;
  if (!mesh) {
    if (prev.doc) set({ derived: null });
    return;
  }
  if (mesh.id !== prev.doc?.mesh.id && state.derived?.meshId !== mesh.id) {
    void refreshDerived(mesh).catch((e) => set({ error: `Analysis failed: ${String(e)}` }));
  }
});

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function loadStlFile(file: File): Promise<void> {
  await withBusy(`Loading ${file.name}`, async () => {
    const buffer = await file.arrayBuffer();
    // transfer (not copy) the file buffer – it can be hundreds of MB
    const { mesh, stats, normals, format } = await meshWorker().loadStl(Comlink.transfer(buffer, [buffer]));
    cacheDerived({ meshId: mesh.id, stats, normals });
    set({ derived: derivedCache.get(mesh.id)! });
    resetDocument(newDocument(mesh, file.name));
    set({
      scanDialogOpen: true,
      tool: 'none',
      activeLandmark: null,
      offSurface: {},
      notice: `Loaded ${file.name} (${format}, ${stats.triangleCount.toLocaleString()} triangles)`,
    });
    requestCamera('fit');
  });
}

/** Opens a .tffproj project (mesh + transform + landmarks + scan info). */
export async function loadProjectFile(file: File): Promise<void> {
  await withBusy(`Opening ${file.name}`, async () => {
    const buffer = await file.arrayBuffer();
    const { doc, stats, normals } = await meshWorker().loadProject(Comlink.transfer(buffer, [buffer]));
    cacheDerived({ meshId: doc.mesh.id, stats, normals });
    set({ derived: derivedCache.get(doc.mesh.id)! });
    resetDocument(doc);
    set({
      scanDialogOpen: !doc.scan,
      tool: 'none',
      activeLandmark: null,
      offSurface: {},
      notice: `Opened project ${file.name} (${Object.keys(doc.landmarks).length} landmarks)`,
    });
    requestCamera('fit');
  });
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || 'scan';

export async function saveProject(): Promise<{ data: Uint8Array; fileName: string } | undefined> {
  const { doc } = get();
  if (!doc) return;
  return withBusy('Saving project', async () => ({
    data: await withMesh(doc.mesh, (m) => meshWorker().saveProject({ meta: doc.meta, scan: doc.scan, transform: doc.transform, landmarks: doc.landmarks }, m)),
    fileName: `${baseName(doc.meta.sourceFileName)}.tffproj`,
  }));
}

/** Binary STL of the current mesh; with `applyTransform` the vertices are written in world coordinates. */
export async function exportStl(applyTransform: boolean): Promise<{ data: ArrayBuffer; fileName: string } | undefined> {
  const { doc } = get();
  if (!doc) return;
  return withBusy('Exporting STL', async () => ({
    data: await withMesh(doc.mesh, (m) => meshWorker().exportStl(m, applyTransform ? doc.transform : null)),
    fileName: `${baseName(doc.meta.sourceFileName)}-edited.stl`,
  }));
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

/** Local-space centre of the mesh bounding box (the rotation pivot). */
export function meshCentre(): Vec3 {
  const b = get().derived?.stats.bounds;
  if (!b) return [0, 0, 0];
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

export function setTransform(t: RigidTransform, label = 'Transform'): void {
  commit(label, (doc) => ({ ...doc, transform: t }));
}

export function setPosition(position: Vec3): void {
  const doc = get().doc;
  if (doc) setTransform({ ...doc.transform, position }, 'Move');
}

/**
 * Sets the rotation (Euler XYZ, degrees) while keeping the model centre fixed in world space,
 * i.e. rotation pivots about the bounding-box centre rather than the local origin.
 */
export function setRotationDeg(euler: Vec3): void {
  const doc = get().doc;
  if (!doc) return;
  setTransform(rotateAboutCentre(doc.transform, eulerDegToQuat(euler), meshCentre()), 'Rotate');
}

export function rotateAboutCentre(t: RigidTransform, q: RigidTransform['quaternion'], c: Vec3): RigidTransform {
  const oldC = rotateVector(t.quaternion, c);
  const newC = rotateVector(q, c);
  return {
    quaternion: q,
    position: [t.position[0] + oldC[0] - newC[0], t.position[1] + oldC[1] - newC[1], t.position[2] + oldC[2] - newC[2]],
  };
}

export function getRotationDeg(t: RigidTransform): Vec3 {
  return quatToEulerDeg(t.quaternion);
}

export function resetTransform(): void {
  setTransform({ ...IDENTITY_TRANSFORM }, 'Reset transform');
}

/** Translates the model so its bounding-box centre is on the Z axis and its lowest point sits on Z = 0. */
export function centreOnFloor(): void {
  const doc = get().doc;
  if (!doc) return;
  const b = computeBounds(transformPositions(doc.mesh.positions, doc.transform));
  const dx = -(b.min[0] + b.max[0]) / 2, dy = -(b.min[1] + b.max[1]) / 2, dz = -b.min[2];
  const p = doc.transform.position;
  setTransform({ ...doc.transform, position: [p[0] + dx, p[1] + dy, p[2] + dz] }, 'Centre on floor');
  requestCamera('fit');
}

/** Rotates the model by a fixed step about a world axis through its centre. */
export function rotateStep(axis: 0 | 1 | 2, degrees: number): void {
  const doc = get().doc;
  if (!doc) return;
  const half = (degrees * Math.PI) / 360;
  const dq: [number, number, number, number] = [0, 0, 0, Math.cos(half)];
  dq[axis] = Math.sin(half);
  const q = doc.transform.quaternion;
  // world-axis rotation: q' = dq * q
  const nq: [number, number, number, number] = [
    dq[3] * q[0] + dq[0] * q[3] + dq[1] * q[2] - dq[2] * q[1],
    dq[3] * q[1] - dq[0] * q[2] + dq[1] * q[3] + dq[2] * q[0],
    dq[3] * q[2] + dq[0] * q[1] - dq[1] * q[0] + dq[2] * q[3],
    dq[3] * q[3] - dq[0] * q[0] - dq[1] * q[1] - dq[2] * q[2],
  ];
  setTransform(rotateAboutCentre(doc.transform, nq, meshCentre()), `Rotate ${'XYZ'[axis]} ${degrees}°`);
}

export { withBusy };
