import type { MeshData, Vec3 } from '../types';
import { buildEdgeTopology, nextHalfEdge } from './topology';

/**
 * A closed loop of boundary edges (a hole, or the open rim of a scan).
 * `vertices` follow the direction of the boundary half-edges, i.e. the loop runs
 * *with* the adjacent triangles' winding; a patch filling it must use the reverse order.
 */
export interface BoundaryLoop {
  id: number;
  vertices: number[];
  edgeCount: number;
  /** mm */
  perimeter: number;
  centroid: Vec3;
  /** Largest distance between two loop vertices (approximate diameter, mm). */
  diameter: number;
}

/**
 * Extracts all boundary loops. Vertices shared by several loops ("pinch" vertices)
 * are handled by splitting the walk whenever it revisits a vertex, so each returned
 * loop is simple.
 */
export function findBoundaryLoops(mesh: Pick<MeshData, 'positions' | 'indices'>): BoundaryLoop[] {
  const { positions: p, indices: idx } = mesh;
  const { boundaryHalfEdges } = buildEdgeTopology(mesh);
  if (boundaryHalfEdges.length === 0) return [];

  // vertex -> boundary half-edges starting there
  const outgoing = new Map<number, number[]>();
  for (const h of boundaryHalfEdges) {
    const from = idx[h];
    const list = outgoing.get(from);
    if (list) list.push(h);
    else outgoing.set(from, [h]);
  }
  const used = new Set<number>();
  const rawLoops: number[][] = [];

  for (const startHe of boundaryHalfEdges) {
    if (used.has(startHe)) continue;
    // Walk boundary half-edges; `path` holds the vertices of the current open walk.
    const path: number[] = [idx[startHe]];
    const pos = new Map<number, number>([[idx[startHe], 0]]); // vertex -> index in path
    let h = startHe;
    for (;;) {
      used.add(h);
      const to = idx[nextHalfEdge(h)];
      const at = pos.get(to);
      if (at !== undefined) {
        // Revisited a vertex: the part of the walk from `to` onwards is a closed simple loop.
        const loop = path.splice(at);
        loop.forEach((v) => pos.delete(v));
        rawLoops.push(loop);
      }
      pos.set(to, path.length);
      path.push(to);
      const next = outgoing.get(to)?.find((c) => !used.has(c));
      if (next === undefined) break; // done (or an open chain from non-manifold input – dropped)
      h = next;
    }
  }

  return rawLoops
    .filter((l) => l.length >= 3)
    .map((vertices, id) => describeLoop(p, vertices, id));
}

function describeLoop(p: Float32Array, vertices: number[], id: number): BoundaryLoop {
  let perimeter = 0;
  let cx = 0, cy = 0, cz = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[i] * 3, b = vertices[(i + 1) % n] * 3;
    perimeter += Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
    cx += p[a]; cy += p[a + 1]; cz += p[a + 2];
  }
  // approximate diameter: farthest vertex from the first, then farthest from that
  const far = (from: number) => {
    let best = from, bestD = -1;
    for (const v of vertices) {
      const d = (p[3 * v] - p[3 * from]) ** 2 + (p[3 * v + 1] - p[3 * from + 1]) ** 2 + (p[3 * v + 2] - p[3 * from + 2]) ** 2;
      if (d > bestD) { bestD = d; best = v; }
    }
    return { v: best, d: Math.sqrt(bestD) };
  };
  const diameter = far(far(vertices[0]).v).d;
  return { id, vertices, edgeCount: n, perimeter, centroid: [cx / n, cy / n, cz / n], diameter };
}

/**
 * Default "fill all" exclusion: the largest loop is treated as the scan's open rim
 * (e.g. the top of a leg scan) when its perimeter is ≥ 3× the next largest, or when
 * it is the only loop and longer than `rimMinPerimeter`.
 */
export function suggestExcludedLoops(loops: BoundaryLoop[], rimMinPerimeter = 150): Set<number> {
  const sorted = [...loops].sort((a, b) => b.perimeter - a.perimeter);
  const out = new Set<number>();
  if (sorted.length === 0) return out;
  const [largest, second] = sorted;
  if ((second && largest.perimeter >= 3 * second.perimeter) || (!second && largest.perimeter >= rimMinPerimeter)) {
    out.add(largest.id);
  }
  return out;
}
