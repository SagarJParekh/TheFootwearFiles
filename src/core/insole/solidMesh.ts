import { makeMesh, type MeshData } from '../types';
import type { Grid } from './heightfield';

/**
 * Builds a closed solid between two height fields over the region where `sdf < 0`.
 * The 2D region is triangulated with marching squares (corner nodes + edge crossings,
 * shared between neighbouring cells), so the outline is smooth rather than stair-stepped
 * and the result is watertight: top + bottom (reversed) + vertical side walls along the
 * region boundary. Output vertices are produced by `toWorld(a, b, z)`.
 */
export function buildSolid(
  g: Grid,
  sdf: Float32Array,
  top: Float32Array,
  bottom: Float32Array,
  toWorld: (a: number, b: number, z: number) => [number, number, number],
): MeshData {
  const { nx, ny, h, a0, b0 } = g;
  const pos2: number[] = []; // a, b per 2D vertex
  const zt: number[] = [];
  const zb: number[] = [];
  const nodeVert = new Int32Array(nx * ny).fill(-1);
  const hEdgeVert = new Int32Array(nx * ny).fill(-1); // edge (i,j)-(i+1,j)
  const vEdgeVert = new Int32Array(nx * ny).fill(-1); // edge (i,j)-(i,j+1)

  const node = (i: number, j: number) => {
    const k = j * nx + i;
    if (nodeVert[k] < 0) {
      nodeVert[k] = zt.length;
      pos2.push(a0 + i * h, b0 + j * h);
      zt.push(top[k]);
      zb.push(bottom[k]);
    }
    return nodeVert[k];
  };
  const crossing = (i: number, j: number, horizontal: boolean) => {
    const k = j * nx + i;
    const store = horizontal ? hEdgeVert : vEdgeVert;
    if (store[k] < 0) {
      const k2 = horizontal ? k + 1 : k + nx;
      const d1 = sdf[k], d2 = sdf[k2];
      let t = d1 / (d1 - d2);
      t = Math.min(0.97, Math.max(0.03, t)); // avoid sliver triangles
      store[k] = zt.length;
      pos2.push(a0 + (i + (horizontal ? t : 0)) * h, b0 + (j + (horizontal ? 0 : t)) * h);
      zt.push(top[k] + (top[k2] - top[k]) * t);
      zb.push(bottom[k] + (bottom[k2] - bottom[k]) * t);
    }
    return store[k];
  };

  const tris: number[] = []; // 2D triangles, CCW in (a, b)
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      // corners CCW: (i,j) (i+1,j) (i+1,j+1) (i,j+1)
      const ci = [i, i + 1, i + 1, i], cj = [j, j, j + 1, j + 1];
      const d = [sdf[j * nx + i], sdf[j * nx + i + 1], sdf[(j + 1) * nx + i + 1], sdf[(j + 1) * nx + i]];
      const inside = d.map((x) => x < 0);
      if (!inside.some(Boolean)) continue;
      const poly: number[] = [];
      for (let e = 0; e < 4; e++) {
        const f = (e + 1) % 4;
        if (inside[e]) poly.push(node(ci[e], cj[e]));
        if (inside[e] !== inside[f]) {
          // edges: 0 bottom (horizontal at j), 1 right (vertical at i+1), 2 top (horizontal at j+1), 3 left (vertical at i)
          if (e === 0) poly.push(crossing(i, j, true));
          else if (e === 1) poly.push(crossing(i + 1, j, false));
          else if (e === 2) poly.push(crossing(i, j + 1, true));
          else poly.push(crossing(i, j, false));
        }
      }
      for (let k = 1; k + 1 < poly.length; k++) tris.push(poly[0], poly[k], poly[k + 1]);
    }
  }

  // 3D vertices: top copy [0, n), bottom copy [n, 2n)
  const n = zt.length;
  const positions = new Float32Array(n * 6);
  for (let v = 0; v < n; v++) {
    const [x, y, z] = toWorld(pos2[2 * v], pos2[2 * v + 1], zt[v]);
    positions.set([x, y, z], 3 * v);
    const [xb, yb, zb2] = toWorld(pos2[2 * v], pos2[2 * v + 1], zb[v]);
    positions.set([xb, yb, zb2], 3 * (v + n));
  }

  // Frame (a, b, z) is right-handed with z up only if u × v = +z; toWorld preserves handedness
  // when it is a rotation about Z, so CCW-in-(a,b) triangles face +Z.
  const idx: number[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const [p, q, r] = [tris[t], tris[t + 1], tris[t + 2]];
    idx.push(p, q, r); // top faces up
    idx.push(r + n, q + n, p + n); // bottom faces down
  }
  // Boundary edges of the 2D triangulation → side walls (outward = right of the CCW boundary edge).
  const edgeCount = new Map<number, number>();
  const key = (p: number, q: number) => (p < q ? p * n + q : q * n + p);
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const k = key(tris[t + e], tris[t + ((e + 1) % 3)]);
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  }
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const p = tris[t + e], q = tris[t + ((e + 1) % 3)];
      if (edgeCount.get(key(p, q)) !== 1) continue;
      // wall quad p→q (top) down to bottom, facing outward
      idx.push(p, p + n, q + n, p, q + n, q);
    }
  }
  return makeMesh(positions, Uint32Array.from(idx));
}
