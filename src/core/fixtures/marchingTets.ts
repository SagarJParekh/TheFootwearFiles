/**
 * Marching tetrahedra polygoniser for signed distance functions (negative inside).
 * Only used to generate test shapes (foot, leg), so clarity beats speed.
 * Each grid cube is split into 6 tetrahedra around the main diagonal (consistent across
 * neighbouring cubes), so the resulting surface is closed after welding.
 */
import type { MeshData, Vec3 } from '../types';
import { weldSoup } from '../mesh/weld';

export type Sdf = (x: number, y: number, z: number) => number;

const CUBE_CORNERS: Vec3[] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
// Six tetrahedra sharing the diagonal 0–6.
const TETS = [
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
  [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
];

export function polygonize(sdf: Sdf, min: Vec3, max: Vec3, cell: number): MeshData {
  const nx = Math.ceil((max[0] - min[0]) / cell);
  const ny = Math.ceil((max[1] - min[1]) / cell);
  const nz = Math.ceil((max[2] - min[2]) / cell);
  const sx = nx + 1, sy = ny + 1;
  const values = new Float64Array(sx * sy * (nz + 1));
  for (let k = 0; k <= nz; k++)
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++)
        values[i + sx * (j + sy * k)] = sdf(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);

  const out: number[] = [];
  const pos = (i: number, j: number, k: number): Vec3 => [min[0] + i * cell, min[1] + j * cell, min[2] + k * cell];

  // Interpolate with canonical endpoint order so shared edges give bit-identical points.
  const interp = (pa: Vec3, va: number, pb: Vec3, vb: number): Vec3 => {
    const swap = pa[0] > pb[0] || (pa[0] === pb[0] && (pa[1] > pb[1] || (pa[1] === pb[1] && pa[2] > pb[2])));
    if (swap) [pa, va, pb, vb] = [pb, vb, pa, va];
    const t = va / (va - vb);
    return [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1]), pa[2] + t * (pb[2] - pa[2])];
  };

  const emit = (a: Vec3, b: Vec3, c: Vec3) => {
    // Orient so the normal follows the SDF gradient (outward).
    const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
    const e = cell * 0.25;
    const g: Vec3 = [
      sdf(cx + e, cy, cz) - sdf(cx - e, cy, cz),
      sdf(cx, cy + e, cz) - sdf(cx, cy - e, cz),
      sdf(cx, cy, cz + e) - sdf(cx, cy, cz - e),
    ];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (n[0] * g[0] + n[1] * g[1] + n[2] * g[2] < 0) out.push(...a, ...c, ...b);
    else out.push(...a, ...b, ...c);
  };

  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const cp: Vec3[] = [];
        const cv: number[] = [];
        for (const [di, dj, dk] of CUBE_CORNERS) {
          cp.push(pos(i + di, j + dj, k + dk));
          cv.push(values[i + di + sx * (j + dj + sy * (k + dk))]);
        }
        for (const tet of TETS) {
          const inside = tet.filter((c) => cv[c] < 0);
          const outside = tet.filter((c) => cv[c] >= 0);
          if (inside.length === 0 || inside.length === 4) continue;
          const P = (a: number, b: number) => interp(cp[a], cv[a], cp[b], cv[b]);
          if (inside.length === 1 || inside.length === 3) {
            const lone = inside.length === 1 ? inside[0] : outside[0];
            const others = inside.length === 1 ? outside : inside;
            emit(P(lone, others[0]), P(lone, others[1]), P(lone, others[2]));
          } else {
            const [a, b] = inside;
            const [c, d] = outside;
            const p1 = P(a, c), p2 = P(a, d), p3 = P(b, d), p4 = P(b, c);
            emit(p1, p2, p3);
            emit(p1, p3, p4);
          }
        }
      }
  return weldSoup(Float32Array.from(out), 1e-3);
}

// --- SDF building blocks -----------------------------------------------------

export function sdEllipsoid(p: Vec3, c: Vec3, r: Vec3): number {
  const q = [(p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]];
  const k0 = Math.hypot(q[0], q[1], q[2]);
  const k1 = Math.hypot(q[0] / r[0], q[1] / r[1], q[2] / r[2]);
  return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r);
}

export function sdCapsule(p: Vec3, a: Vec3, b: Vec3, r: number): number {
  const pa = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const h = Math.max(0, Math.min(1, (pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2)));
  return Math.hypot(pa[0] - ba[0] * h, pa[1] - ba[1] * h, pa[2] - ba[2] * h) - r;
}

export function smoothUnion(a: number, b: number, k: number): number {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b * (1 - h) + a * h - k * h * (1 - h);
}

export function smoothSubtract(a: number, b: number, k: number): number {
  // removes b from a
  return -smoothUnion(-a, b, k);
}
