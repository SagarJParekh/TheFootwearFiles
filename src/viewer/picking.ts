import * as THREE from 'three';
import type { Vec3 } from '../core/types';
import { sceneRefs } from './sceneRefs';

/** True if a world-space point is removed by any active clipping plane. */
export function isClipped(point: THREE.Vector3): boolean {
  return sceneRefs.clipPlanes.some((p) => p.distanceToPoint(point) < 0);
}

/** First intersection with the model surface that is not hidden by the clipping plane. */
export function firstVisibleHit(hits: THREE.Intersection[]): THREE.Intersection | null {
  for (const h of hits) {
    if (h.object === sceneRefs.modelMesh && !isClipped(h.point)) return h;
  }
  return null;
}

export function worldToLocal(point: THREE.Vector3): Vec3 | null {
  const space = sceneRefs.localSpace;
  if (!space) return null;
  space.updateWorldMatrix(true, false);
  const p = space.worldToLocal(point.clone());
  return [p.x, p.y, p.z];
}

const raycaster = new THREE.Raycaster();

/** Raycasts the model from a client (screen) position. Returns the local-space hit. */
export function pickSurface(clientX: number, clientY: number, camera: THREE.Camera, dom: HTMLElement): Vec3 | null {
  const mesh = sceneRefs.modelMesh;
  if (!mesh) return null;
  const rect = dom.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  // All hits (not firstHitOnly) so we can skip the ones hidden by the clipping plane.
  const hit = firstVisibleHit(raycaster.intersectObject(mesh, false));
  return hit ? worldToLocal(hit.point) : null;
}
