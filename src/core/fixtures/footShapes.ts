/**
 * Synthetic foot / lower-limb shapes for testing. Right foot in the app's convention:
 * Z up, +Y anterior (heel → toe), +X to the patient's right (lateral for a right foot).
 * Heel near y = 0, toes near y = 250, plantar surface near z = 0.
 */
import type { MeshData, Vec3 } from '../types';
import { polygonize, sdCapsule, sdEllipsoid, smoothSubtract, smoothUnion, type Sdf } from './marchingTets';
import { removeTriangles } from './primitives';

function footSdf(p: Vec3): number {
  let d = sdEllipsoid(p, [0, 40, 32], [32, 40, 34]); // heel / hindfoot
  d = smoothUnion(d, sdEllipsoid(p, [6, 110, 28], [40, 70, 28]), 18); // midfoot
  d = smoothUnion(d, sdEllipsoid(p, [8, 185, 20], [48, 45, 21]), 18); // forefoot
  d = smoothUnion(d, sdEllipsoid(p, [2, 228, 12], [40, 26, 12]), 12); // toes
  // Medial longitudinal arch: carve from the medial (-X) plantar side.
  d = smoothSubtract(d, sdEllipsoid(p, [-34, 112, -2], [22, 50, 14]), 8);
  // Flatten the plantar surface at z = 0.
  d = smoothSubtract(d, p[2], 3);
  return d;
}

function legSdf(p: Vec3): number {
  let d = footSdf(p);
  d = smoothUnion(d, sdCapsule(p, [2, 45, 50], [2, 45, 420], 36), 24);
  // Malleoli bumps (medial higher and more anterior than lateral, like a real ankle).
  d = smoothUnion(d, sdEllipsoid(p, [-33, 52, 88], [9, 12, 12]), 6);
  d = smoothUnion(d, sdEllipsoid(p, [37, 40, 76], [9, 12, 12]), 6);
  return d;
}

const toSdf = (f: (p: Vec3) => number): Sdf => (x, y, z) => f([x, y, z]);

/** Closed (watertight) foot. */
export function closedFoot(cell = 4): MeshData {
  return polygonize(toSdf(footSdf), [-60, -10, -6], [70, 265, 75], cell);
}

/** Plantar surface scan: only the underside of the foot (an open "sheet" with one large boundary). */
export function plantarScan(cell = 3.5, cutHeight = 22): MeshData {
  const m = polygonize(toSdf(footSdf), [-60, -10, -6], [70, 265, cutHeight + 10], cell);
  return removeTriangles(m, (c) => c[2] > cutHeight);
}

/** Lower-limb scan: foot + leg with an open top at `topZ`, plus two small scanner holes. */
export function lowerLimbScan(cell = 4.5, topZ = 330): MeshData {
  const m = polygonize(toSdf(legSdf), [-60, -10, -6], [70, 265, topZ + 12], cell);
  return removeTriangles(m, (c) => {
    if (c[2] > topZ) return true; // open top of the leg
    const d1 = Math.hypot(c[0] - 8, c[1] - 150, c[2] - 0.5); // hole in the sole
    const d2 = Math.hypot(c[0] - 40, c[1] - 100, c[2] - 30); // hole on the lateral side
    return d1 < 9 || d2 < 7;
  });
}
