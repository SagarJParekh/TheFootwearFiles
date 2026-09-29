import { TransformControls } from '@react-three/drei';
import { useRef, useState } from 'react';
import * as THREE from 'three';
import type { Vec3 } from '../core/types';
import { modelWorldCentre } from '../state/clipActions';
import { setClip, useStore } from '../state/store';

const Z = new THREE.Vector3(0, 0, 1);

/**
 * Visual for the clipping plane plus an optional gizmo to drag / rotate it freely.
 * The plane square is centred on the projection of the model centre onto the plane.
 */
export function ClipPlane({ size }: { size: number }) {
  const clip = useStore((s) => s.clip);
  useStore((s) => s.doc?.transform); // re-centre when the model moves
  const [obj, setObj] = useState<THREE.Group | null>(null);
  const dragging = useRef(false);

  if (!clip.enabled) return null;

  const n = new THREE.Vector3(...clip.normal).normalize();
  const c = new THREE.Vector3(...modelWorldCentre());
  const position = c.clone().addScaledVector(n, clip.constant - n.dot(c));
  const quaternion = new THREE.Quaternion().setFromUnitVectors(Z, n);

  const onChange = () => {
    if (!obj || !dragging.current) return;
    const n = Z.clone().applyQuaternion(obj.quaternion).normalize();
    const normal: Vec3 = [n.x, n.y, n.z];
    setClip({ normal, constant: n.dot(obj.position) });
  };

  return (
    <>
      <group
        ref={setObj}
        // while the gizmo drags the object, feed its own pose back so React doesn't fight it
        position={dragging.current && obj ? obj.position.clone() : position}
        quaternion={dragging.current && obj ? obj.quaternion.clone() : quaternion}
      >
        {clip.showPlane && (
          <>
            <mesh raycast={() => null} renderOrder={3}>
              <planeGeometry args={[size, size]} />
              <meshBasicMaterial color="#2f6fdd" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
            <lineSegments raycast={() => null}>
              <edgesGeometry args={[new THREE.PlaneGeometry(size, size)]} />
              <lineBasicMaterial color="#2f6fdd" />
            </lineSegments>
            <arrowHelper args={[Z, new THREE.Vector3(), size * 0.15, 0x2f6fdd]} />
          </>
        )}
      </group>
      {obj && clip.gizmo !== 'none' && (
        <TransformControls
          object={obj}
          mode={clip.gizmo}
          space={clip.gizmo === 'rotate' ? 'local' : 'world'}
          onMouseDown={() => {
            dragging.current = true;
          }}
          onMouseUp={() => {
            dragging.current = false;
            setClip({}); // re-render so the square re-centres on the model
          }}
          onObjectChange={onChange}
        />
      )}
    </>
  );
}
