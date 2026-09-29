import { makeMesh, type MeshData, type Vec3 } from '../../types';
import { findBoundaryLoops, type BoundaryLoop } from '../holes';
import { buildVertexTriangles } from '../topology';
import { fairPatch } from './fair';
import { refinePatch } from './refine';
import { triangulateLoop } from './triangulate';

export interface FillOptions {
  /** Subdivide the patch to match the surrounding edge length. */
  refine: boolean;
  /** Smooth the patch to follow the surrounding curvature (otherwise it stays flat). */
  fair: boolean;
}

export const DEFAULT_FILL_OPTIONS: FillOptions = { refine: true, fair: true };

export interface FillResult {
  mesh: MeshData;
  filled: number;
  addedTriangles: number;
  addedVertices: number;
}

/**
 * Fills the boundary loops with the given ids (as returned by findBoundaryLoops on the
 * same mesh). Each loop is triangulated, refined and faired independently, then all
 * patches are appended to the mesh.
 */
export function fillHoles(mesh: MeshData, loopIds: number[] | 'all', options: FillOptions = DEFAULT_FILL_OPTIONS): FillResult {
  const loops = findBoundaryLoops(mesh);
  const wanted = loopIds === 'all' ? loops : loops.filter((l) => loopIds.includes(l.id));
  return fillLoops(mesh, wanted, options);
}

export function fillLoops(mesh: MeshData, loops: BoundaryLoop[], options: FillOptions): FillResult {
  const { positions, indices } = mesh;
  const vertCount = positions.length / 3;
  if (!loops.length) return { mesh, filled: 0, addedTriangles: 0, addedVertices: 0 };

  const vt = buildVertexTriangles(indices, vertCount);
  const neighboursInMesh = (v: number): number[] => {
    const set = new Set<number>();
    for (let k = vt.offsets[v]; k < vt.offsets[v + 1]; k++) {
      const t = vt.triangles[k];
      for (let e = 0; e < 3; e++) {
        const u = indices[3 * t + e];
        if (u !== v) set.add(u);
      }
    }
    return [...set];
  };

  const p: number[] = Array.from(positions);
  const newTris: number[] = [];

  for (const loop of loops) {
    // Patch order is the reverse of the boundary half-edge direction.
    const verts = [...loop.vertices].reverse();
    const pts: Vec3[] = verts.map((v) => [p[3 * v], p[3 * v + 1], p[3 * v + 2]]);
    const local = triangulateLoop(pts);
    const tris = local.map((i) => verts[i]);

    // σ per loop vertex: mean length of its edges in the original mesh.
    const sigma = new Map<number, number>();
    const meshNb = new Map<number, number[]>();
    for (const v of verts) {
      const nb = neighboursInMesh(v);
      meshNb.set(v, nb);
      const lens = nb.map((u) => Math.hypot(p[3 * u] - p[3 * v], p[3 * u + 1] - p[3 * v + 1], p[3 * u + 2] - p[3 * v + 2]));
      sigma.set(v, lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : loop.perimeter / loop.edgeCount);
    }

    const created = options.refine ? refinePatch({ positions: p, triangles: tris, sigma }) : [];

    if (options.fair && created.length) {
      const nb = new Map<number, Set<number>>();
      const link = (a: number, b: number) => {
        let s = nb.get(a);
        if (!s) nb.set(a, (s = new Set()));
        s.add(b);
      };
      for (let t = 0; t < tris.length; t += 3) {
        for (let e = 0; e < 3; e++) link(tris[t + e], tris[t + ((e + 1) % 3)]), link(tris[t + ((e + 1) % 3)], tris[t + e]);
      }
      for (const v of verts) for (const u of meshNb.get(v)!) link(v, u);
      const neighbours = new Map<number, number[]>();
      for (const [v, s] of nb) neighbours.set(v, [...s]);
      fairPatch({ positions: p, free: created, neighbours });
    }
    newTris.push(...tris);
  }

  const outIdx = new Uint32Array(indices.length + newTris.length);
  outIdx.set(indices);
  outIdx.set(newTris, indices.length);
  const outPos = Float32Array.from(p);
  return {
    mesh: makeMesh(outPos, outIdx),
    filled: loops.length,
    addedTriangles: newTris.length / 3,
    addedVertices: outPos.length / 3 - vertCount,
  };
}
