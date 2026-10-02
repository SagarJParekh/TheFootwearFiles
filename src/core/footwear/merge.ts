import type { ManifoldToplevel, Manifold as ManifoldT } from 'manifold-3d';
import { makeMesh, type MeshData } from '../types';
import { latticeToMesh, type Lattice } from './lattice';

/**
 * Merges the footwear parts (closed solids + lattice struts) into ONE watertight
 * solid with manifold-3d boolean union. This takes tens of seconds for ~10 000 struts, so it
 * is an export option; the default export is the overlapping closed parts (slicers union them).
 */
export function mergeFootwear(wasm: ManifoldToplevel, parts: { solids: MeshData[]; lattice: Lattice }, strutSides = 6): MeshData {
  const { Manifold, Mesh } = wasm;
  const all: ManifoldT[] = [];
  const make = (positions: Float32Array, indices: Uint32Array) => {
    const mesh = new Mesh({ numProp: 3, vertProperties: positions, triVerts: indices });
    mesh.merge();
    const m = new Manifold(mesh);
    all.push(m);
    return m;
  };
  try {
    // The big solids and the thousands of small struts are unioned in separate batches and
    // then once together: a single mixed batch re-processes the large meshes at every step.
    const solids = parts.solids.map((s) => make(s.positions, s.indices));
    const struts: ManifoldT[] = [];
    // Struts only (with their filleted ends): adding joint spheres makes the boolean several
    // times slower, and the flared ends already overlap at every node.
    const l = parts.lattice, N = l.nodes;
    for (let e = 0; e < l.edges.length / 2; e++) {
      const p = l.edges[2 * e], q = l.edges[2 * e + 1];
      const strut = latticeToMesh({ nodes: [...N.slice(3 * p, 3 * p + 3), ...N.slice(3 * q, 3 * q + 3)], edges: [0, 1], radii: [l.radii[e]] }, strutSides, false, true);
      struts.push(make(strut.positions, strut.indices));
    }
    const solidUnion = Manifold.union(solids), strutUnion = Manifold.union(struts);
    all.push(solidUnion, strutUnion);
    const merged = Manifold.union(solidUnion, strutUnion);
    try {
      const out = merged.getMesh();
      const positions = new Float32Array(out.numVert * 3);
      for (let v = 0; v < out.numVert; v++) {
        positions[3 * v] = out.vertProperties[v * out.numProp];
        positions[3 * v + 1] = out.vertProperties[v * out.numProp + 1];
        positions[3 * v + 2] = out.vertProperties[v * out.numProp + 2];
      }
      return makeMesh(positions, new Uint32Array(out.triVerts));
    } finally {
      merged.delete();
    }
  } finally {
    for (const m of all) m.delete();
  }
}
