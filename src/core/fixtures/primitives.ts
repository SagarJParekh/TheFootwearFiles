/**
 * Procedural test geometry (used by unit tests and scripts/generate-fixtures.ts).
 */
import { makeMesh, type MeshData, type Vec3 } from '../types';
import { compactMesh } from '../mesh/weld';

export function box(size: Vec3 = [10, 10, 10], center: Vec3 = [0, 0, 0]): MeshData {
  const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const [cx, cy, cz] = center;
  const positions = new Float32Array([
    -hx, -hy, -hz, hx, -hy, -hz, hx, hy, -hz, -hx, hy, -hz,
    -hx, -hy, hz, hx, -hy, hz, hx, hy, hz, -hx, hy, hz,
  ]);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += cx; positions[i + 1] += cy; positions[i + 2] += cz;
  }
  // CCW when viewed from outside
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, // bottom (-z)
    4, 5, 6, 4, 6, 7, // top (+z)
    0, 1, 5, 0, 5, 4, // -y
    2, 3, 7, 2, 7, 6, // +y
    1, 2, 6, 1, 6, 5, // +x
    3, 0, 4, 3, 4, 7, // -x
  ]);
  return makeMesh(positions, indices);
}

/** Geodesic icosphere with outward-facing CCW triangles. subdivisions=4 → 5120 triangles. */
export function icosphere(radius = 50, subdivisions = 4, center: Vec3 = [0, 0, 0]): MeshData {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: number[][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((v) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  });
  let faces: number[][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < subdivisions; s++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number): number => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const va = verts[a], vb = verts[b];
      const m = [va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]];
      const l = Math.hypot(m[0], m[1], m[2]);
      verts.push([m[0] / l, m[1] / l, m[2] / l]);
      cache.set(key, verts.length - 1);
      return verts.length - 1;
    };
    const next: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const positions = new Float32Array(verts.length * 3);
  verts.forEach((v, i) => {
    positions[3 * i] = v[0] * radius + center[0];
    positions[3 * i + 1] = v[1] * radius + center[1];
    positions[3 * i + 2] = v[2] * radius + center[2];
  });
  return makeMesh(positions, Uint32Array.from(faces.flat()));
}

/** Removes every triangle for which `predicate(centroid)` is true, then drops unused vertices. */
export function removeTriangles(mesh: MeshData, predicate: (centroid: Vec3, tri: number) => boolean): MeshData {
  const { positions: p, indices: idx } = mesh;
  const kept: number[] = [];
  for (let t = 0; t < idx.length / 3; t++) {
    const a = idx[3 * t] * 3, b = idx[3 * t + 1] * 3, c = idx[3 * t + 2] * 3;
    const centroid: Vec3 = [
      (p[a] + p[b] + p[c]) / 3,
      (p[a + 1] + p[b + 1] + p[c + 1]) / 3,
      (p[a + 2] + p[b + 2] + p[c + 2]) / 3,
    ];
    if (!predicate(centroid, t)) kept.push(idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]);
  }
  return compactMesh(p, Uint32Array.from(kept));
}

/** Removes triangles whose centroid direction (from `center`) is within `angleDeg` of `dir`. */
export function punchHole(mesh: MeshData, dir: Vec3, angleDeg: number, center: Vec3 = [0, 0, 0]): MeshData {
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  const d: Vec3 = [dir[0] / l, dir[1] / l, dir[2] / l];
  const cosLimit = Math.cos((angleDeg * Math.PI) / 180);
  return removeTriangles(mesh, (c) => {
    const v: Vec3 = [c[0] - center[0], c[1] - center[1], c[2] - center[2]];
    const vl = Math.hypot(v[0], v[1], v[2]) || 1;
    return (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / vl > cosLimit;
  });
}

/** Sphere (r=50mm) with three holes of different sizes – the standard hole-fill fixture. */
export function sphereWithHoles(radius = 50, subdivisions = 4): MeshData {
  let m = icosphere(radius, subdivisions);
  m = punchHole(m, [1, 0.2, 0.1], 12);
  m = punchHole(m, [-0.3, 1, 0.2], 20);
  m = punchHole(m, [0.1, -0.2, -1], 30);
  return m;
}
