/// <reference lib="webworker" />
/**
 * Heavy mesh operations run here so the UI never blocks. Exposed via Comlink;
 * the main thread talks to it through `meshClient.ts`.
 * Returned typed arrays are transferred (zero-copy) back to the main thread.
 */
import * as Comlink from 'comlink';
import { parseStl } from '../core/io/stlParse';
import { writeBinaryStl } from '../core/io/stlWrite';
import { weldSoup } from '../core/mesh/weld';
import { analyzeMesh } from '../core/mesh/analyze';
import { computeVertexNormals } from '../core/mesh/normals';
import { transformPositions } from '../core/math/transform';
import { distancesToSurface } from '../core/mesh/closestPoint';
import type { MeshData, MeshStats, RigidTransform, Vec3 } from '../core/types';

function transferMesh<T extends object>(result: T, ...meshes: MeshData[]): T {
  return Comlink.transfer(
    result,
    meshes.flatMap((m) => [m.positions.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer]),
  );
}

const api = {
  async loadStl(buffer: ArrayBuffer): Promise<{ mesh: MeshData; stats: MeshStats; format: 'binary' | 'ascii'; normals: Float32Array }> {
    const { soup, format } = parseStl(buffer);
    if (soup.length === 0) throw new Error('STL contains no triangles');
    const mesh = weldSoup(soup);
    const stats = analyzeMesh(mesh);
    const normals = computeVertexNormals(mesh);
    const res = transferMesh({ mesh, stats, format, normals }, mesh);
    return Comlink.transfer(res, [normals.buffer]);
  },

  async analyze(mesh: MeshData): Promise<MeshStats> {
    return analyzeMesh(mesh);
  },

  async normals(mesh: MeshData): Promise<Float32Array> {
    const n = computeVertexNormals(mesh);
    return Comlink.transfer(n, [n.buffer]);
  },

  async surfaceDistances(mesh: MeshData, points: Vec3[]): Promise<number[]> {
    return distancesToSurface(mesh, points);
  },

  async exportStl(mesh: MeshData, transform: RigidTransform | null): Promise<ArrayBuffer> {
    const positions = transform ? transformPositions(mesh.positions, transform) : mesh.positions;
    const buf = writeBinaryStl({ positions, indices: mesh.indices });
    return Comlink.transfer(buf, [buf]);
  },
};

export type MeshWorkerApi = typeof api;

Comlink.expose(api);
