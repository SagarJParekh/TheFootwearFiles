import earcut from 'earcut';
import { planeBasis } from '../../math/plane';
import type { Vec3 } from '../../types';
import { restoreDroppedVertices } from '../polygon';

/**
 * Triangulates a closed 3D polygon given in the order the patch should follow
 * (i.e. the *reverse* of the boundary half-edge direction). Returns index triples
 * into `poly` with the same orientation as the polygon order.
 */
export function triangulateLoop(points: Vec3[], mwtMaxVertices = 300): number[] {
  const n = points.length;
  if (n < 3) return [];
  if (n === 3) return [0, 1, 2];
  if (n <= mwtMaxVertices) return minimumAreaTriangulation(points);
  return projectedTriangulation(points);
}

function triArea(a: Vec3, b: Vec3, c: Vec3): number {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

/**
 * Minimum-weight triangulation (Barequet & Sharir / Liepa step 1) with triangle area as
 * the weight. O(n³) dynamic programme – fine for typical scanner holes (≤ a few hundred edges).
 */
export function minimumAreaTriangulation(points: Vec3[]): number[] {
  const n = points.length;
  const W = new Float64Array(n * n);
  const K = new Int32Array(n * n).fill(-1);
  for (let gap = 2; gap < n; gap++) {
    for (let i = 0; i + gap < n; i++) {
      const j = i + gap;
      let best = Infinity, bestK = -1;
      for (let k = i + 1; k < j; k++) {
        const w = W[i * n + k] + W[k * n + j] + triArea(points[i], points[k], points[j]);
        if (w < best) {
          best = w;
          bestK = k;
        }
      }
      W[i * n + j] = best;
      K[i * n + j] = bestK;
    }
  }
  const out: number[] = [];
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    if (j - i < 2) continue;
    const k = K[i * n + j];
    out.push(i, k, j);
    stack.push([i, k], [k, j]);
  }
  return out;
}

/** Large loops: project onto the best-fit plane and earcut (keeps polygon orientation). */
export function projectedTriangulation(points: Vec3[]): number[] {
  const n = points.length;
  // Newell's method normal of the polygon
  const normal: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
    normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
    normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const [u, v] = planeBasis(normal);
  const coords: number[] = [];
  for (const p of points) coords.push(p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * v[0] + p[1] * v[1] + p[2] * v[2]);
  const tri = restoreDroppedVertices(earcut(coords, undefined, 2), coords);
  // earcut output orientation is not guaranteed – align with the polygon (CCW around `normal`).
  const out: number[] = [];
  for (let t = 0; t < tri.length; t += 3) {
    const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]];
    const cross = (coords[2 * b] - coords[2 * a]) * (coords[2 * c + 1] - coords[2 * a + 1]) -
      (coords[2 * b + 1] - coords[2 * a + 1]) * (coords[2 * c] - coords[2 * a]);
    if (cross >= 0) out.push(a, b, c);
    else out.push(a, c, b);
  }
  return out;
}
