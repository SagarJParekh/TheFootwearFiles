import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { applyTransform } from '../core/math/transform';
import type { Side } from '../core/landmarks/definitions';
import type { Vec3 } from '../core/types';
import { useStore, type ViewPreset } from '../state/store';

type OrbitLike = { target: THREE.Vector3; update: () => void };

/** Direction from the target towards the camera for each preset (Z up, +Y anterior, +X right). */
export function presetDirection(preset: ViewPreset, side: Side): Vec3 {
  const lateralX = side === 'right' ? 1 : -1;
  switch (preset) {
    case 'top': return [0, -1e-3, 1];
    case 'bottom': return [0, 1e-3, -1]; // plantar view, toes pointing up on screen
    case 'front': return [0, 1, 0.15];
    case 'back': return [0, -1, 0.15];
    case 'lateral': return [lateralX, 0, 0.1];
    case 'medial': return [-lateralX, 0, 0.1];
    case 'iso': return [lateralX, -1, 0.8];
  }
}

/** Responds to camera requests from the store (fit-to-view and preset views). */
export function CameraController() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const request = useStore((s) => s.camera);
  const derivedId = useStore((s) => s.derived?.meshId);
  const handledNonce = useRef(-1);

  useEffect(() => {
    const { doc, derived } = useStore.getState();
    // Wait until analysis for the current mesh is available, then serve the latest request once.
    if (!doc || !derived || derived.meshId !== doc.mesh.id || !controls) return;
    if (handledNonce.current === request.nonce) return;
    handledNonce.current = request.nonce;
    const { min, max } = derived.stats.bounds;
    // World-space bounding sphere from the 8 transformed box corners.
    const box = new THREE.Box3();
    for (let i = 0; i < 8; i++) {
      const corner: Vec3 = [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
      box.expandByPoint(new THREE.Vector3(...applyTransform(doc.transform, corner)));
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 1);
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;

    let dir: THREE.Vector3;
    if (request.kind === 'preset' && request.preset) {
      dir = new THREE.Vector3(...presetDirection(request.preset, doc.scan?.side ?? 'right')).normalize();
    } else {
      dir = camera.position.clone().sub(controls.target);
      if (dir.lengthSq() < 1e-9) dir.set(1, -1, 0.8);
      dir.normalize();
    }
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(dir, dist);
    camera.near = Math.max(dist / 1000, 0.01);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.update();
  }, [request, controls, derivedId, camera]);

  return null;
}
