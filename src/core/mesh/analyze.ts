import type { BoundingBox, MeshData, MeshStats } from '../types';
import { buildEdgeTopology } from './topology';

export function computeBounds(positions: Float32Array): BoundingBox {
  if (positions.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export function analyzeMesh(mesh: MeshData): MeshStats {
  const topo = buildEdgeTopology(mesh);
  return {
    vertexCount: mesh.positions.length / 3,
    triangleCount: mesh.indices.length / 3,
    bounds: computeBounds(mesh.positions),
    boundaryEdgeCount: topo.boundaryHalfEdges.length,
    nonManifoldEdgeCount: topo.nonManifoldEdgeCount,
    watertight: topo.boundaryHalfEdges.length === 0 && topo.nonManifoldEdgeCount === 0 && mesh.indices.length > 0,
    meanEdgeLength: topo.edgeCount > 0 ? topo.totalEdgeLength / topo.edgeCount : 0,
  };
}
