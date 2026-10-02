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
  /** 'tetra': the regular tetrahedral lattice; 'voronoi': open organic cells (see voronoiLattice) */
  pattern?: 'tetra' | 'voronoi';
}): Lattice & { topNodes: number[] } {
  if (opts.pattern === 'voronoi') return voronoiLattice(opts);
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

/** Deterministic pseudo-random number in [−1, 1) from integer coordinates. */
const hash3 = (i: number, j: number, k: number, salt: number) => {
  let h = (i * 374761393 + j * 668265263 + k * 2147483647 + salt * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
};

/**
 * Voronoi (organic, open-cell) lattice between `lower` and `upper`: on every layer, the Voronoi
 * cells of jittered seeds on a triangular grid (struts = the cell edges, nodes = the Voronoi
 * vertices, i.e. the circumcentres of the seed triangles), the layers offset against each other
 * and joined by posts from each vertex to the two nearest vertices of the layer below.
 */
function voronoiLattice(opts: Parameters<typeof conformalLattice>[0]): Lattice & { topNodes: number[] } {
  const { grid: g, lower, upper, inside, cell: s, radius: r, layers: n, toWorld } = opts;
  const rowH = (s * Math.sqrt(3)) / 2;
  const aMin = g.a0, aMax = g.a0 + (g.nx - 1) * g.h, bMin = g.b0, bMax = g.b0 + (g.ny - 1) * g.h;
  const out = { ...emptyLattice(), topNodes: [] as number[] };
  const ni = Math.ceil((aMax - aMin) / s) + 3, nj = Math.ceil((bMax - bMin) / rowH) + 3;
  const nodeZ = (k: number, a: number, b: number) => {
    const lo = sampleGrid(g, lower, a, b), hi = sampleGrid(g, upper, a, b);
    return lo + (Math.max(0, hi - lo) * k) / n;
  };
  const addEdge = (p: number, q: number) => {
    out.edges.push(p, q);
    out.radii.push(r);
  };
  const layers: { pts: [number, number][]; ids: number[] }[] = [];
  for (let k = 0; k <= n; k++) {
    const oa = aMin - s + ((k * s) / 2) % s, ob = bMin - rowH + ((k * s * Math.sqrt(3)) / 6) % (rowH * 2);
    const seed = (i: number, j: number): [number, number] => {
      const odd = ((j % 2) + 2) % 2;
      return [oa + (i + odd / 2) * s + 0.22 * s * hash3(i, j, k, 1), ob + j * rowH + 0.22 * s * hash3(i, j, k, 2)];
    };
    // seed triangles → Voronoi vertices
    const vert = new Map<string, number>(); // triangle key → node id
    const pts: [number, number][] = [], ids: number[] = [];
    const tri = (key: string, A: [number, number], B: [number, number], C: [number, number]) => {
      const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
      const a2 = A[0] ** 2 + A[1] ** 2, b2 = B[0] ** 2 + B[1] ** 2, c2 = C[0] ** 2 + C[1] ** 2;
      const cx = (A[0] + B[0] + C[0]) / 3, cy = (A[1] + B[1] + C[1]) / 3;
      let x = cx, y = cy;
      if (Math.abs(d) > 1e-9) {
        // circumcentre, pulled a little towards the centroid (obtuse triangles)
        x = 0.75 * ((a2 * (B[1] - C[1]) + b2 * (C[1] - A[1]) + c2 * (A[1] - B[1])) / d) + 0.25 * cx;
        y = 0.75 * ((a2 * (C[0] - B[0]) + b2 * (A[0] - C[0]) + c2 * (B[0] - A[0])) / d) + 0.25 * cy;
      }
      if (!inside(x, y)) return;
      const id = out.nodes.length / 3;
      out.nodes.push(...toWorld(x, y, nodeZ(k, x, y)));
      vert.set(key, id);
      pts.push([x, y]);
      ids.push(id);
      if (k === n) out.topNodes.push(id);
    };
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const odd = ((j % 2) + 2) % 2;
        tri(`${i},${j},u`, seed(i, j), seed(i + 1, j), seed(i + odd, j + 1));
        tri(`${i},${j},d`, seed(i, j), seed(i + odd, j + 1), seed(i + odd - 1, j + 1));
      }
    // Voronoi edges: between the triangles that share a seed pair
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const odd = ((j % 2) + 2) % 2;
        const u = vert.get(`${i},${j},u`), d = vert.get(`${i},${j},d`);
        const join = (p?: number, q?: number) => p !== undefined && q !== undefined && addEdge(p, q);
        join(u, d); // shared (i,j)–(i+odd,j+1)
        join(u, vert.get(`${i + 1},${j},d`)); // shared (i+1,j)–(i+odd,j+1)
        // u's edge (i,j)–(i+1,j) is shared with the down triangle of row j−1 whose top seeds they are
        join(u, vert.get(`${i + odd},${j - 1},d`));
      }
    layers.push({ pts, ids });
  }
  // posts: each vertex to the two nearest vertices of the layer below
  for (let k = 1; k <= n; k++) {
    const below = layers[k - 1], cellOf = (x: number, y: number) => `${Math.floor(x / s)},${Math.floor(y / s)}`;
    const hash = new Map<string, number[]>();
    below.pts.forEach((p, m) => (hash.get(cellOf(p[0], p[1])) ?? hash.set(cellOf(p[0], p[1]), []).get(cellOf(p[0], p[1]))!).push(m));
    layers[k].pts.forEach((p, m) => {
      const cand: [number, number][] = [];
      const ci = Math.floor(p[0] / s), cj = Math.floor(p[1] / s);
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++)
          for (const q of hash.get(`${ci + di},${cj + dj}`) ?? []) cand.push([Math.hypot(below.pts[q][0] - p[0], below.pts[q][1] - p[1]), q]);
      cand.sort((x, y) => x[0] - y[0]);
      for (const [d, q] of cand.slice(0, 2)) if (d < 0.9 * s) addEdge(layers[k].ids[m], below.ids[q]);
    });
  }
  return out;
}

/**
 * Mesh of a lattice, rounded: each strut is a closed tube whose radius flares out near both ends
 * (a fillet into the joint), and each node is a sphere (radius = the largest incident strut
 * radius × 1.15), so the junctions are smooth knuckles rather than facets. `sides` = segments
 * round each strut (and the spheres). `joints` off: no spheres; `fillet` off: plain round tubes.
 */
export function latticeToMesh(l: Lattice, sides = 8, joints = true, fillet = joints): MeshData {
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
  // fillet profile from each end: (distance along the strut, radius) in units of the strut radius
  // (standard detail: one fillet ring per end; finer detail: a curved fillet)
  const FILLET: [number, number][] = !fillet ? [[0, 1]] : sides <= 8 ? [[0, 1.1], [1, 1]] : [[0, 1.1], [0.5, 1.06], [1.2, 1]];
  const rings = 2 * FILLET.length;
  const lat = Math.max(3, Math.round(sides / 2)); // sphere: latitude bands
  const sphereVerts = (lat - 1) * sides + 2, sphereTris = 2 * sides * (lat - 1);
  const vertsPerStrut = rings * sides + 2, trisPerStrut = 2 * sides * (rings - 1) + 2 * sides;
  const positions = new Float32Array((nEdges * vertsPerStrut + jointCount * sphereVerts) * 3);
  const indices = new Uint32Array((nEdges * trisPerStrut + jointCount * sphereTris) * 3);
  let pv = 0, pi = 0;
  const P = l.nodes;
  for (let e = 0; e < nEdges; e++) {
    const p = l.edges[2 * e], q = l.edges[2 * e + 1], r = l.radii[e];
    const ax = P[3 * p], ay = P[3 * p + 1], az = P[3 * p + 2];
    let dx = P[3 * q] - ax, dy = P[3 * q + 1] - ay, dz = P[3 * q + 2] - az;
    let len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) [len, dx, dy, dz] = [1e-6, 0, 0, 1e-6]; // (degenerate strut: any axis)
    dx /= len; dy /= len; dz /= len;
    // perpendicular basis
    let ux = -dy, uy = dx, uz = 0;
    if (Math.abs(dz) > 0.9) { ux = 0; uy = -dz; uz = dy; }
    const ul = Math.hypot(ux, uy, uz);
    ux /= ul; uy /= ul; uz /= ul;
    const wx = dy * uz - dz * uy, wy = dz * ux - dx * uz, wz = dx * uy - dy * ux;
    // ring stations: the fillet at the start, then mirrored at the end (squeezed on short struts)
    const reach = FILLET[FILLET.length - 1][0] * r, squeeze = Math.min(1, (0.45 * len) / (reach || 1));
    const stations: [number, number][] = [];
    for (const [d, k] of FILLET) stations.push([d * r * squeeze, k * r]);
    for (let i = FILLET.length - 1; i >= 0; i--) stations.push([len - FILLET[i][0] * r * squeeze, FILLET[i][1] * r]);
    const base = pv;
    for (const [d, rr] of stations) {
      const cx = ax + dx * d, cy = ay + dy * d, cz = az + dz * d;
      for (let s = 0; s < sides; s++) {
        const t = (2 * Math.PI * s) / sides, c = Math.cos(t) * rr, sn = Math.sin(t) * rr;
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
    for (let k = 0; k < rings - 1; k++)
      for (let s = 0; s < sides; s++) {
        const s2 = (s + 1) % sides;
        const a0 = base + k * sides + s, a1 = base + k * sides + s2, b0 = a0 + sides, b1 = a1 + sides;
        indices.set([a0, a1, b1, a0, b1, b0], pi);
        pi += 6;
      }
    const last = base + (rings - 1) * sides;
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      indices.set([c0, base + s2, base + s], pi); // start cap faces −d
      indices.set([c1, last + s, last + s2], pi + 3); // end cap faces +d
      pi += 6;
    }
  }
  for (let v = 0; v < nNodes && joints; v++) {
    if (!degree[v]) continue;
    const r = nodeR[v] * 1.15, base = pv;
    const x0 = P[3 * v], y0 = P[3 * v + 1], z0 = P[3 * v + 2];
    positions.set([x0, y0, z0 + r], 3 * pv++);
    for (let i = 1; i < lat; i++) {
      const th = (Math.PI * i) / lat, st = Math.sin(th) * r, ct = Math.cos(th) * r;
      for (let s = 0; s < sides; s++) {
        const ph = (2 * Math.PI * s) / sides;
        positions.set([x0 + st * Math.cos(ph), y0 + st * Math.sin(ph), z0 + ct], 3 * pv++);
      }
    }
    positions.set([x0, y0, z0 - r], 3 * pv++);
    const ring = (i: number, s: number) => base + 1 + (i - 1) * sides + (s % sides);
    const south = base + 1 + (lat - 1) * sides;
    for (let s = 0; s < sides; s++) {
      indices.set([base, ring(1, s), ring(1, s + 1)], pi);
      pi += 3;
      for (let i = 1; i < lat - 1; i++) {
        indices.set([ring(i, s), ring(i + 1, s), ring(i + 1, s + 1), ring(i, s), ring(i + 1, s + 1), ring(i, s + 1)], pi);
        pi += 6;
      }
      indices.set([south, ring(lat - 1, s + 1), ring(lat - 1, s)], pi);
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
