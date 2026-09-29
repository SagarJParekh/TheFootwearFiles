import { TransformControls } from '@react-three/drei';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { rotateVector } from '../core/math/transform';
import type { Quat, Vec3 } from '../core/types';
import { beginGesture, endGesture, updateLive, useStore } from '../state/store';
import { sceneRefs } from './sceneRefs';

/**
 * Scene hierarchy:
 *   pivot  (world position = model centre, quaternion = model rotation)  ← gizmo attaches here
 *     localSpace (position = -centre)  ← mesh-local coordinates; mesh, landmarks, overlays live here
 *
 * which is equivalent to world = R * local + t with t = P - R * c. Rotating with the gizmo
 * therefore pivots about the bounding-box centre instead of the (arbitrary) scan origin.
 */
export function ModelGroup({ children }: { children: ReactNode }) {
  const transform = useStore((s) => s.doc?.transform);
  const bounds = useStore((s) => s.derived?.stats.bounds);
  const gizmo = useStore((s) => s.view.gizmo);
  const [pivot, setPivot] = useState<THREE.Group | null>(null);
  const dragging = useRef(false);

  const centre: Vec3 = bounds
    ? [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2]
    : [0, 0, 0];

  const setLocalSpace = useCallback((g: THREE.Group | null) => {
    sceneRefs.localSpace = g;
  }, []);

  if (!transform) return null;
  const rc = rotateVector(transform.quaternion, centre);
  const pivotPos: Vec3 = [transform.position[0] + rc[0], transform.position[1] + rc[1], transform.position[2] + rc[2]];

  const onObjectChange = () => {
    if (!pivot || !dragging.current) return;
    const q: Quat = [pivot.quaternion.x, pivot.quaternion.y, pivot.quaternion.z, pivot.quaternion.w];
    const rcNew = rotateVector(q, centre);
    const t: Vec3 = [pivot.position.x - rcNew[0], pivot.position.y - rcNew[1], pivot.position.z - rcNew[2]];
    updateLive((d) => ({ ...d, transform: { position: t, quaternion: q } }));
  };

  return (
    <>
      <group ref={setPivot} position={pivotPos} quaternion={transform.quaternion}>
        <group ref={setLocalSpace} position={[-centre[0], -centre[1], -centre[2]]}>
          {children}
        </group>
      </group>
      {pivot && gizmo !== 'none' && (
        <TransformControls
          object={pivot}
          mode={gizmo}
          space="world"
          onMouseDown={() => {
            dragging.current = true;
            beginGesture();
          }}
          onMouseUp={() => {
            dragging.current = false;
            endGesture(gizmo === 'translate' ? 'Move' : 'Rotate');
          }}
          onObjectChange={onObjectChange}
        />
      )}
    </>
  );
}
