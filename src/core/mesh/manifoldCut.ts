import type { ManifoldToplevel } from 'manifold-3d';
import { makeMesh, type MeshData, type Plane } from '../types';

/**
 * Plane trim via manifold-3d. Requires a closed 2-manifold input; the result is capped
 * and watertight by construction. Throws if manifold rejects the mesh (the caller then
 * falls back to `cutMeshByPlane`).
 */
export function manifoldTrim(wasm: ManifoldToplevel, mesh: MeshData, plane: Plane, keepPositive: boolean): MeshData {
  const { Manifold, Mesh } = wasm;
  const input = new Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices });
  input.merge();
  const solid = new Manifold(input);
  try {
    const status = solid.status();
    if (status !== 'NoError') throw new Error(`manifold rejected mesh: ${status}`);
    const n = keepPositive ? plane.normal : ([-plane.normal[0], -plane.normal[1], -plane.normal[2]] as const);
    const offset = keepPositive ? plane.constant : -plane.constant;
    const trimmed = solid.trimByPlane([n[0], n[1], n[2]], offset);
    try {
      const out = trimmed.getMesh();
      const positions = new Float32Array(out.numVert * 3);
      for (let v = 0; v < out.numVert; v++) {
        positions[3 * v] = out.vertProperties[v * out.numProp];
        positions[3 * v + 1] = out.vertProperties[v * out.numProp + 1];
        positions[3 * v + 2] = out.vertProperties[v * out.numProp + 2];
      }
      return makeMesh(positions, new Uint32Array(out.triVerts));
    } finally {
      trimmed.delete();
    }
  } finally {
    solid.delete();
  }
}
