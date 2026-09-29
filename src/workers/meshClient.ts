import * as Comlink from 'comlink';
import type { MeshWorkerApi } from './mesh.worker';

let remote: Comlink.Remote<MeshWorkerApi> | null = null;

/** Lazily-created singleton proxy to the mesh worker. */
export function meshWorker(): Comlink.Remote<MeshWorkerApi> {
  if (!remote) {
    const worker = new Worker(new URL('./mesh.worker.ts', import.meta.url), { type: 'module' });
    remote = Comlink.wrap<MeshWorkerApi>(worker);
  }
  return remote;
}
