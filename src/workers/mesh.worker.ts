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
import type { MeshData, MeshStats, Plane, RigidTransform, Vec3 } from '../core/types';
import { cutMeshByPlane, type CutResult } from '../core/mesh/cut';
import { manifoldTrim } from '../core/mesh/manifoldCut';
import Module, { type ManifoldToplevel } from 'manifold-3d';
import { findBoundaryLoops, suggestExcludedLoops } from '../core/mesh/holes';
import { fillHoles, type FillOptions } from '../core/mesh/fill/fillHoles';

/** Hole description sent to the UI (loop polyline instead of vertex indices). */
export interface HoleInfo {
  id: number;
  edgeCount: number;
  perimeter: number;
  diameter: number;
  centroid: Vec3;
  /** Closed polyline, xyz per loop vertex (mesh-local). */
  points: Float32Array;
  suggestedExclude: boolean;
}
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';

let manifoldPromise: Promise<ManifoldToplevel> | null = null;
function manifold(): Promise<ManifoldToplevel> {
  manifoldPromise ??= Module({ locateFile: () => manifoldWasmUrl }).then((m) => {
    m.setup();
    return m;
  });
  return manifoldPromise;
}

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

  /**
   * Hybrid plane cut: manifold-3d for watertight meshes when capping (robust, always closed),
   * otherwise the own split + planar cap which also handles open scans.
   */
  async cut(mesh: MeshData, plane: Plane, keepPositive: boolean, cap: boolean, watertight: boolean): Promise<CutResult & { fallbackReason?: string }> {
    let fallbackReason: string | undefined;
    if (cap && watertight) {
      try {
        const out = manifoldTrim(await manifold(), mesh, plane, keepPositive);
        return transferMesh({ mesh: out, cappedLoops: -1, openCutLoops: 0, method: 'manifold' as const }, out);
      } catch (e) {
        fallbackReason = e instanceof Error ? e.message : String(e);
      }
    }
    const r = cutMeshByPlane(mesh, plane, { keepPositive, cap });
    return transferMesh({ ...r, fallbackReason }, r.mesh);
  },

  async findHoles(mesh: MeshData): Promise<HoleInfo[]> {
    const loops = findBoundaryLoops(mesh);
    const excluded = suggestExcludedLoops(loops);
    const holes = loops.map((l) => {
      const points = new Float32Array(l.vertices.length * 3);
      l.vertices.forEach((v, i) => points.set(mesh.positions.subarray(3 * v, 3 * v + 3), 3 * i));
      return { id: l.id, edgeCount: l.edgeCount, perimeter: l.perimeter, diameter: l.diameter, centroid: l.centroid, points, suggestedExclude: excluded.has(l.id) };
    });
    return Comlink.transfer(holes, holes.map((h) => h.points.buffer as ArrayBuffer));
  },

  async fillHoles(mesh: MeshData, loopIds: number[], options: FillOptions) {
    const r = fillHoles(mesh, loopIds, options);
    return transferMesh(r, r.mesh);
  },

  async exportStl(mesh: MeshData, transform: RigidTransform | null): Promise<ArrayBuffer> {
    const positions = transform ? transformPositions(mesh.positions, transform) : mesh.positions;
    const buf = writeBinaryStl({ positions, indices: mesh.indices });
    return Comlink.transfer(buf, [buf]);
  },
};

export type MeshWorkerApi = typeof api;

Comlink.expose(api);
