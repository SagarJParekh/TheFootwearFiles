/**
 * Strut lattices for 3D-printed footwear.
 *
 * A lattice is a set of nodes and edges; every edge becomes a closed prismatic strut and
 * every node a small closed joint polyhedron. The pieces overlap (slicers union overlapping
 * shells; the export can also merge everything into one watertight solid with manifold-3d).
 *
 *  - `conformalLattice`: stacked triangular layers between two height fields (the lattice
 *    midsole under the footbed). Each layer is shifted to the centroids of the layer below and
 *    connected to its 3 nearest nodes there (tetrahedral cells); the top layer also has its
 *    in-plane triangle edges, which form the visible footbed pattern.
 *  - `surfaceLattice`: a triangulated net lying on an offset of the foot surface (the shoe
 *    upper), made by vertex clustering of the scan mesh with cells of the lattice size.
 */
import { makeMesh, type MeshData } from '../types';
import type { Grid } from '../insole/heightfield';

export interface Lattice {
  /** Node positions xyz (world). */
  nodes: number[];
  /** Node index pairs. */
  edges: number[];
  /** Radius per edge (mm). */
  radii: number[];
}

export const emptyLattice = (): Lattice => ({ nodes: [], edges: [], radii: [] });

export function appendLattice(into: Lattice, l: Lattice): void {
  const off = into.nodes.length / 3;
  into.nodes.push(...l.nodes);
  for (const e of l.edges) into.edges.push(e + off);
  into.radii.push(...l.radii);
}

/** Bilinear sample of a grid field at frame coordinates (a, b). */
export function sampleGrid(g: Grid, f: Float32Array, a: number, b: number): number {
  const x = Math.min(g.nx - 1.001, Math.max(0, (a - g.a0) / g.h));
  const y = Math.min(g.ny - 1.001, Math.max(0, (b - g.b0) / g.h));
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const k = j * g.nx + i;
  return (f[k] * (1 - fx) + f[k + 1] * fx) * (1 - fy) + (f[k + g.nx] * (1 - fx) + f[k + g.nx + 1] * fx) * fy;
}

/**
 * Conformal tetrahedral lattice between `lower` and `upper` (height fields of the strut
 * centres) over the region where `inside(a, b)` holds. To keep the top of the struts on a
 * surface S, pass `upper` = S offset down by the strut radius along its normal.
 */
export function conformalLattice(opts: {
  grid: Grid;
  lower: Float32Array;
  upper: Float32Array;
  inside: (a: number, b: number) => boolean;
  cell: number;
  radius: number;
  layers: number;
  toWorld: (a: number, b: number, z: number) => [number, number, number];
}): Lattice & { topNodes: number[] } {
  const { grid: g, lower, upper, inside, cell: s, radius: r, layers: n, toWorld } = opts;
  const rowH = (s * Math.sqrt(3)) / 2;
  const aMin = g.a0, aMax = g.a0 + (g.nx - 1) * g.h, bMin = g.b0, bMax = g.b0 + (g.ny - 1) * g.h;
  const out = { ...emptyLattice(), topNodes: [] as number[] };
  const layerMaps: Map<string, number>[] = [];
  // Layer k is the base triangular lattice shifted by k × (s/2, s·√3/6) (ABC stacking).
  const origin = (k: number): [number, number] => [aMin + ((k * s) / 2) % s, bMin + ((k * s * Math.sqrt(3)) / 6) % (rowH * 2)];
  const pos2 = (k: number, i: number, j: number): [number, number] => {
    const [oa, ob] = origin(k);
    return [oa + (i + (((j % 2) + 2) % 2) / 2) * s, ob + j * rowH];
  };
  const nodeZ = (k: number, a: number, b: number) => {
    const lo = sampleGrid(g, lower, a, b), hi = sampleGrid(g, upper, a, b);
    return lo + (Math.max(0, hi - lo) * k) / n;
  };
  const ni = Math.ceil((aMax - aMin) / s) + 2, nj = Math.ceil((bMax - bMin) / rowH) + 2;
  for (let k = 0; k <= n; k++) {
    const map = new Map<string, number>();
    for (let j = -1; j < nj; j++) {
      for (let i = -1; i < ni; i++) {
        const [a, b] = pos2(k, i, j);
        if (!inside(a, b)) continue;
        map.set(`${i},${j}`, out.nodes.length / 3);
        if (k === n) out.topNodes.push(out.nodes.length / 3);
        out.nodes.push(...toWorld(a, b, nodeZ(k, a, b)));
      }
    }
    layerMaps.push(map);
  }
  const addEdge = (p: number | undefined, q: number | undefined) => {
    if (p === undefined || q === undefined || p === q) return;
    out.edges.push(p, q);
    out.radii.push(r);
  };
  // (i, j) of layer k at a frame point (nearest lattice node).
  const index = (k: number, a: number, b: number) => {
    const [oa, ob] = origin(k);
    const j = Math.round((b - ob) / rowH);
    const i = Math.round((a - oa) / s - (((j % 2) + 2) % 2) / 2);
    return `${i},${j}`;
  };
  // In-plane triangle edges on the top layer (and the bottom layer, tied into the outsole).
  for (const k of n > 0 ? [0, n] : [0]) {
    const map = layerMaps[k];
    for (const [key, id] of map) {
      const [i, j] = key.split(',').map(Number);
      const odd = ((j % 2) + 2) % 2;
      addEdge(id, map.get(`${i + 1},${j}`));
      addEdge(id, map.get(`${i + odd},${j + 1}`));
      addEdge(id, map.get(`${i + odd - 1},${j + 1}`));
    }
  }
  // Between layers: each node of layer k+1 to the 3 nodes of the triangle below it.
  for (let k = 0; k < n; k++) {
    for (const [key, id] of layerMaps[k + 1]) {
      const [i, j] = key.split(',').map(Number);
      const [a, b] = pos2(k + 1, i, j);
      const ca = a - s / 2, cb = b - (s * Math.sqrt(3)) / 6; // lower-left vertex of the triangle below
      for (const [da, db] of [[0, 0], [s, 0], [s / 2, rowH]]) addEdge(id, layerMaps[k].get(index(k, ca + da, cb + db)));
    }
  }
  return out;
}

/**
 * Triangulated lattice on an offset of the foot surface (shoe upper). `keep(vertex)` selects
 * the scan vertices that belong to the upper; each is offset along its outward normal by
 * `offset`. Vertices are clustered in cubes of `cell`; a cluster's node is the offset vertex
 * nearest to the cluster mean (so nodes stay exactly on the offset surface), and scan
 * triangles whose corners fall in three different clusters become lattice triangles.
 * Returns the lattice plus the boundary nodes (edges used by only one lattice triangle).
 */
export function surfaceLattice(opts: {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  keep: (x: number, y: number, z: number) => boolean;
  offset: number;
  cell: number;
  radius: number;
}): Lattice & { boundaryEdges: number[] } {
  const { positions: P, normals: N, indices, keep, offset, cell, radius } = opts;
  const nv = P.length / 3;
  const off = new Float32Array(P.length);
  const cluster = new Int32Array(nv).fill(-1);
  const keyToCluster = new Map<string, number>();
  const sums: number[] = [];
  for (let v = 0; v < nv; v++) {
    const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
    if (!keep(x, y, z)) continue;
    const ox = x + N[3 * v] * offset, oy = y + N[3 * v + 1] * offset, oz = z + N[3 * v + 2] * offset;
    off[3 * v] = ox;
    off[3 * v + 1] = oy;
    off[3 * v + 2] = oz;
    const key = `${Math.floor(ox / cell)},${Math.floor(oy / cell)},${Math.floor(oz / cell)}`;
    let c = keyToCluster.get(key);
    if (c === undefined) {
      c = sums.length / 4;
      keyToCluster.set(key, c);
      sums.push(0, 0, 0, 0);
    }
    cluster[v] = c;
    sums[4 * c] += ox;
    sums[4 * c + 1] += oy;
    sums[4 * c + 2] += oz;
    sums[4 * c + 3]++;
  }
  const nc = sums.length / 4;
  const best = new Int32Array(nc).fill(-1);
  const bestD = new Float64Array(nc).fill(Infinity);
  for (let v = 0; v < nv; v++) {
    const c = cluster[v];
    if (c < 0) continue;
    const w = sums[4 * c + 3];
    const d = (off[3 * v] - sums[4 * c] / w) ** 2 + (off[3 * v + 1] - sums[4 * c + 1] / w) ** 2 + (off[3 * v + 2] - sums[4 * c + 2] / w) ** 2;
    if (d < bestD[c]) {
      bestD[c] = d;
      best[c] = v;
    }
  }
  const out = { ...emptyLattice(), boundaryEdges: [] as number[] };
  for (let c = 0; c < nc; c++) out.nodes.push(off[3 * best[c]], off[3 * best[c] + 1], off[3 * best[c] + 2]);
  const triSeen = new Set<string>();
  const edgeUse = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    const a = cluster[indices[t]], b = cluster[indices[t + 1]], c = cluster[indices[t + 2]];
    if (a < 0 || b < 0 || c < 0 || a === b || b === c || a === c) continue;
    const s = [a, b, c].sort((x, y) => x - y);
    const tk = s.join(',');
    if (triSeen.has(tk)) continue;
    triSeen.add(tk);
    for (const [p, q] of [[s[0], s[1]], [s[1], s[2]], [s[0], s[2]]]) {
      const ek = `${p},${q}`;
      edgeUse.set(ek, (edgeUse.get(ek) ?? 0) + 1);
    }
  }
  for (const [ek, count] of edgeUse) {
    const [p, q] = ek.split(',').map(Number);
    out.edges.push(p, q);
    out.radii.push(radius);
    if (count === 1) out.boundaryEdges.push(out.edges.length / 2 - 1);
  }
  return out;
}

/**
 * Mesh of a lattice: a closed `sides`-gon prism per edge and a closed octahedral joint per
 * node (radius = the largest incident strut radius × 1.12, filling the gaps at the joints).
 */
export function latticeToMesh(l: Lattice, sides = 6, joints = true): MeshData {
  const nNodes = l.nodes.length / 3, nEdges = l.edges.length / 2;
  const nodeR = new Float32Array(nNodes);
  const degree = new Uint16Array(nNodes);
  for (let e = 0; e < nEdges; e++) {
    for (const v of [l.edges[2 * e], l.edges[2 * e + 1]]) {
      nodeR[v] = Math.max(nodeR[v], l.radii[e]);
      degree[v]++;
    }
  }
  let jointCount = 0;
  if (joints) for (let v = 0; v < nNodes; v++) if (degree[v]) jointCount++;
  const vertsPerStrut = 2 * sides + 2, trisPerStrut = 4 * sides;
  const positions = new Float32Array((nEdges * vertsPerStrut + jointCount * 6) * 3);
  const indices = new Uint32Array((nEdges * trisPerStrut + jointCount * 8) * 3);
  let pv = 0, pi = 0;
  const P = l.nodes;
  for (let e = 0; e < nEdges; e++) {
    const p = l.edges[2 * e], q = l.edges[2 * e + 1], r = l.radii[e];
    const ax = P[3 * p], ay = P[3 * p + 1], az = P[3 * p + 2];
    let dx = P[3 * q] - ax, dy = P[3 * q + 1] - ay, dz = P[3 * q + 2] - az;
    const len = Math.hypot(dx, dy, dz) || 1e-6;
    dx /= len; dy /= len; dz /= len;
    // perpendicular basis
    let ux = -dy, uy = dx, uz = 0;
    if (Math.abs(dz) > 0.9) { ux = 0; uy = -dz; uz = dy; }
    const ul = Math.hypot(ux, uy, uz);
    ux /= ul; uy /= ul; uz /= ul;
    const wx = dy * uz - dz * uy, wy = dz * ux - dx * uz, wz = dx * uy - dy * ux;
    const base = pv;
    for (let end = 0; end < 2; end++) {
      const cx = ax + dx * len * end, cy = ay + dy * len * end, cz = az + dz * len * end;
      for (let s = 0; s < sides; s++) {
        const t = (2 * Math.PI * s) / sides, c = Math.cos(t) * r, sn = Math.sin(t) * r;
        positions[3 * pv] = cx + ux * c + wx * sn;
        positions[3 * pv + 1] = cy + uy * c + wy * sn;
        positions[3 * pv + 2] = cz + uz * c + wz * sn;
        pv++;
      }
    }
    const c0 = pv, c1 = pv + 1;
    positions.set([ax, ay, az], 3 * c0);
    positions.set([ax + dx * len, ay + dy * len, az + dz * len], 3 * c1);
    pv += 2;
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      const a0 = base + s, a1 = base + s2, b0 = base + sides + s, b1 = base + sides + s2;
      indices.set([a0, a1, b1, a0, b1, b0], pi);
      pi += 6;
      indices.set([c0, a1, a0], pi); // start cap faces −d
      indices.set([c1, b0, b1], pi + 3); // end cap faces +d
      pi += 6;
    }
  }
  const OCT = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const OCT_F = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  for (let v = 0; v < nNodes && joints; v++) {
    if (!degree[v]) continue;
    const r = nodeR[v] * 1.12, base = pv;
    for (const [x, y, z] of OCT) {
      positions[3 * pv] = P[3 * v] + x * r;
      positions[3 * pv + 1] = P[3 * v + 1] + y * r;
      positions[3 * pv + 2] = P[3 * v + 2] + z * r;
      pv++;
    }
    for (const [a, b, c] of OCT_F) {
      indices.set([base + a, base + b, base + c], pi);
      pi += 3;
    }
  }
  return makeMesh(positions, indices);
}

/** Concatenates meshes (no welding). */
export function concatMeshes(meshes: MeshData[]): MeshData {
  let nv = 0, ni = 0;
  for (const m of meshes) {
    nv += m.positions.length;
    ni += m.indices.length;
  }
  const positions = new Float32Array(nv), indices = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const m of meshes) {
    positions.set(m.positions, ov);
    const base = ov / 3;
    for (let i = 0; i < m.indices.length; i++) indices[oi + i] = m.indices[i] + base;
    ov += m.positions.length;
    oi += m.indices.length;
  }
  return makeMesh(positions, indices);
}
