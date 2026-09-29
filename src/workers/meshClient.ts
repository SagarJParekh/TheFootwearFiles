import * as Comlink from 'comlink';
import type { MeshData } from '../core/types';
import type { MeshWorkerApi } from './mesh.worker';
import { MESH_NOT_CACHED, type MeshRef } from './meshRef';

let remote: Comlink.Remote<MeshWorkerApi> | null = null;

/** Lazily-created singleton proxy to the mesh worker. */
export function meshWorker(): Comlink.Remote<MeshWorkerApi> {
  if (!remote) {
    const worker = new Worker(new URL('./mesh.worker.ts', import.meta.url), { type: 'module' });
    remote = Comlink.wrap<MeshWorkerApi>(worker);
  }
  return remote;
}

/**
 * Calls the worker with a lightweight `{ id }` reference first; if the worker no longer
 * caches that mesh version it answers MESH_NOT_CACHED and we resend the full mesh.
 * Saves structured-cloning large typed arrays on the main thread for every call.
 */
export async function withMesh<T>(mesh: MeshData, call: (ref: MeshRef) => Promise<T>): Promise<T> {
  try {
    return await call({ id: mesh.id });
  } catch (e) {
    if (e instanceof Error && e.message.includes(MESH_NOT_CACHED)) return call(mesh);
    throw e;
  }
}
