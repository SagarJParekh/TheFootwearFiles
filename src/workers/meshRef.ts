import type { MeshData } from '../core/types';

/** A mesh passed to the worker: in full, or by id when the worker already caches it. */
export type MeshRef = MeshData | { id: string };
export const MESH_NOT_CACHED = 'MESH_NOT_CACHED';
