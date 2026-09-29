import type { MeshData } from '../types';

/**
 * Edge topology built with a CSR bucket per lower vertex index, which is fast and
 * memory-lean for multi-million-triangle meshes (no hash maps or string keys).
 *
 * Half-edge id h = 3 * triangle + corner, running from indices[h] to indices[next(h)].
 */
export interface EdgeTopology {
  /** Number of unique undirected edges. */
  edgeCount: number;
  /** Half-edge ids whose undirected edge is used by exactly one triangle. */
  boundaryHalfEdges: Uint32Array;
  /** Undirected edges used by more than two triangles. */
  nonManifoldEdgeCount: number;
  /** Sum of unique edge lengths (mm). */
  totalEdgeLength: number;
}

export const nextHalfEdge = (h: number): number => (h % 3 === 2 ? h - 2 : h + 1);

export function buildEdgeTopology(mesh: Pick<MeshData, 'positions' | 'indices'>): EdgeTopology {
  const { positions: p, indices: idx } = mesh;
  const vertCount = p.length / 3;
  const heCount = idx.length;

  const offsets = new Uint32Array(vertCount + 1);
  for (let h = 0; h < heCount; h++) {
    const a = idx[h], b = idx[nextHalfEdge(h)];
    offsets[(a < b ? a : b) + 1]++;
  }
  for (let v = 0; v < vertCount; v++) offsets[v + 1] += offsets[v];
  const cursor = offsets.slice(0, vertCount);
  const bucketHi = new Uint32Array(heCount);
  const bucketHe = new Uint32Array(heCount);
  for (let h = 0; h < heCount; h++) {
    const a = idx[h], b = idx[nextHalfEdge(h)];
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const slot = cursor[lo]++;
    bucketHi[slot] = hi;
    bucketHe[slot] = h;
  }

  const boundary: number[] = [];
  let edgeCount = 0;
  let nonManifold = 0;
  let totalLen = 0;
  const seen = new Uint8Array(heCount); // marks bucket slots already grouped

  for (let lo = 0; lo < vertCount; lo++) {
    const start = offsets[lo], end = offsets[lo + 1];
    for (let i = start; i < end; i++) {
      if (seen[i]) continue;
      const hi = bucketHi[i];
      let count = 1;
      seen[i] = 1;
      for (let j = i + 1; j < end; j++) {
        if (!seen[j] && bucketHi[j] === hi) {
          seen[j] = 1;
          count++;
        }
      }
      edgeCount++;
      const dx = p[3 * hi] - p[3 * lo], dy = p[3 * hi + 1] - p[3 * lo + 1], dz = p[3 * hi + 2] - p[3 * lo + 2];
      totalLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (count === 1) boundary.push(bucketHe[i]);
      else if (count > 2) nonManifold++;
    }
  }

  return {
    edgeCount,
    boundaryHalfEdges: Uint32Array.from(boundary),
    nonManifoldEdgeCount: nonManifold,
    totalEdgeLength: totalLen,
  };
}

/**
 * Vertex → incident triangles adjacency (CSR). Used by hole-fill fairing and cut capping.
 */
export interface VertexTriangles {
  offsets: Uint32Array;
  triangles: Uint32Array;
}

export function buildVertexTriangles(indices: Uint32Array, vertCount: number): VertexTriangles {
  const offsets = new Uint32Array(vertCount + 1);
  for (let i = 0; i < indices.length; i++) offsets[indices[i] + 1]++;
  for (let v = 0; v < vertCount; v++) offsets[v + 1] += offsets[v];
  const cursor = offsets.slice(0, vertCount);
  const triangles = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) triangles[cursor[indices[i]]++] = (i / 3) | 0;
  return { offsets, triangles };
}
