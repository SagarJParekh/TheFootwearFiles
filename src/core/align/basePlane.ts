import type { ProjectDocument } from '../document';
import type { MeshData, RigidTransform, Vec3 } from '../types';
import { alignFromLandmarks } from './landmarkAlign';

/**
 * Base plane: the plane through the heel centre, 1st and 5th metatarsal heads. When it is
 * set, the model is aligned so that this plane is the floor (Z = 0), the heel centre is at the
 * origin and heel → toes points along +Y – and the transform is locked (no rotation/moving).
 * The lock lives in the document, so it is undoable and saved with projects.
 */

const centroidCache = new WeakMap<MeshData, Vec3>();
function meshCentroid(mesh: MeshData): Vec3 {
  let c = centroidCache.get(mesh);
  if (!c) {
    const p = mesh.positions;
    let x = 0, y = 0, z = 0;
    const n = p.length / 3 || 1;
    for (let i = 0; i < p.length; i += 3) {
      x += p[i];
      y += p[i + 1];
      z += p[i + 2];
    }
    c = [x / n, y / n, z / n];
    centroidCache.set(mesh, c);
  }
  return c;
}

export function hasBasePlaneLandmarks(doc: ProjectDocument): boolean {
  return !!(doc.landmarks.heelCentre && doc.landmarks.met1Head && doc.landmarks.met5Head);
}

/** Transform that makes the base plane the floor, or null if the three landmarks aren't all placed. */
export function basePlaneTransform(doc: ProjectDocument): RigidTransform | null {
  const hc = doc.landmarks.heelCentre?.local, m1 = doc.landmarks.met1Head?.local, m5 = doc.landmarks.met5Head?.local;
  if (!hc || !m1 || !m5) return null;
  // The foot lies above its sole: the arch peak (if placed) or the scan's centroid fixes "up".
  const above = doc.landmarks.archPeak?.local ?? meshCentroid(doc.mesh);
  return alignFromLandmarks({ heelCentre: hc, met1Head: m1, met5Head: m5, abovePoint: above });
}

/** Sets (locks) the base plane. Throws if the landmarks are missing or collinear. */
export function setBasePlane(doc: ProjectDocument): ProjectDocument {
  const t = basePlaneTransform(doc);
  if (!t) throw new Error('Place the heel centre and the 1st and 5th metatarsal heads first.');
  return { ...doc, transform: t, basePlaneLocked: true };
}

/**
 * Keeps a locked base plane consistent after landmark edits: re-aligns to the (moved) points,
 * or releases the lock if one of the three points was removed.
 */
export function syncBasePlane(doc: ProjectDocument): ProjectDocument {
  if (!doc.basePlaneLocked) return doc;
  if (!hasBasePlaneLandmarks(doc)) return { ...doc, basePlaneLocked: false };
  try {
    return { ...doc, transform: basePlaneTransform(doc)! };
  } catch {
    return { ...doc, basePlaneLocked: false };
  }
}
