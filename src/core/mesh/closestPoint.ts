import type { MeshData, Vec3 } from '../types';

/**
 * Squared distance from p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5).
 */
export function pointTriangleDistanceSq(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let qx: number, qy: number, qz: number;
  if (d1 <= 0 && d2 <= 0) {
    qx = ax; qy = ay; qz = az;
  } else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    const vc = d1 * d4 - d3 * d2;
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) {
      qx = bx; qy = by; qz = bz;
    } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz;
    } else if (d6 >= 0 && d5 <= d6) {
      qx = cx; qy = cy; qz = cz;
    } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz;
    } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz);
    } else {
      const denom = 1 / (va + vb + vc);
      const v = vb * denom, w = vc * denom;
      qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
    }
  }
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Distance from each point to the nearest point of the mesh surface (brute force with a
 * cheap bounding-box rejection; fine for a handful of landmarks, run in the worker).
 */
export function distancesToSurface(mesh: Pick<MeshData, 'positions' | 'indices'>, points: Vec3[]): number[] {
  const { positions: p, indices: idx } = mesh;
  return points.map(([px, py, pz]) => {
    let best = Infinity;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      // bbox rejection
      const minX = Math.min(p[a], p[b], p[c]), maxX = Math.max(p[a], p[b], p[c]);
      const dxb = px < minX ? minX - px : px > maxX ? px - maxX : 0;
      if (dxb * dxb >= best) continue;
      const minY = Math.min(p[a + 1], p[b + 1], p[c + 1]), maxY = Math.max(p[a + 1], p[b + 1], p[c + 1]);
      const dyb = py < minY ? minY - py : py > maxY ? py - maxY : 0;
      if (dxb * dxb + dyb * dyb >= best) continue;
      const minZ = Math.min(p[a + 2], p[b + 2], p[c + 2]), maxZ = Math.max(p[a + 2], p[b + 2], p[c + 2]);
      const dzb = pz < minZ ? minZ - pz : pz > maxZ ? pz - maxZ : 0;
      if (dxb * dxb + dyb * dyb + dzb * dzb >= best) continue;
      const d = pointTriangleDistanceSq(px, py, pz, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  });
}
