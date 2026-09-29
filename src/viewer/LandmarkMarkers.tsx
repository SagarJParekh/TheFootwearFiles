import { Html } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { LANDMARK_BY_ID, landmarksForScanType, type LandmarkId } from '../core/landmarks/definitions';
import { dragLandmark, selectLandmark } from '../state/landmarkActions';
import { beginGesture, useStore } from '../state/store';
import { endLandmarkGesture } from '../state/basePlaneActions';
import { pickSurface } from './picking';

type ControlsLike = { enabled: boolean } | null;

/**
 * Landmark spheres + labels, rendered inside the mesh-local group so they follow the
 * model transform. Markers can be dragged; the drag raycasts the surface so the point
 * stays snapped to the mesh.
 */
export function LandmarkMarkers({ radius }: { radius: number }) {
  const landmarks = useStore((s) => s.doc?.landmarks);
  const scan = useStore((s) => s.doc?.scan);
  const active = useStore((s) => s.activeLandmark);
  const showLabels = useStore((s) => s.view.showLabels);
  const offSurface = useStore((s) => s.offSurface);
  const { camera, gl, controls } = useThree();
  const [dragging, setDragging] = useState<LandmarkId | null>(null);
  const [hovered, setHovered] = useState<LandmarkId | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (!dragging) return;
    const c = controls as unknown as ControlsLike;
    if (c) c.enabled = false;
    const onMove = (e: PointerEvent) => {
      const hit = pickSurface(e.clientX, e.clientY, camera, gl.domElement);
      if (hit) {
        moved.current = true;
        dragLandmark(dragging, hit);
      }
    };
    const onUp = () => {
      if (moved.current) endLandmarkGesture(`Move ${LANDMARK_BY_ID[dragging].label}`);
      else useStore.setState({ gestureStart: null });
      setDragging(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (c) c.enabled = true;
    };
  }, [dragging, camera, gl, controls]);

  if (!landmarks || !scan) return null;
  const defs = landmarksForScanType(scan.type);

  return (
    <group>
      {defs.map((def) => {
        const l = landmarks[def.id];
        if (!l) return null;
        const highlight = def.id === active || def.id === hovered || def.id === dragging;
        const off = offSurface[def.id] !== undefined;
        return (
          <group key={def.id} position={l.local}>
            <mesh
              renderOrder={2}
              onPointerDown={(e: ThreeEvent<PointerEvent>) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                moved.current = false;
                beginGesture();
                setDragging(def.id);
                selectLandmark(def.id);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHovered(def.id);
                gl.domElement.style.cursor = 'grab';
              }}
              onPointerOut={() => {
                setHovered(null);
                gl.domElement.style.cursor = '';
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <sphereGeometry args={[radius * (highlight ? 1.35 : 1), 20, 14]} />
              <meshStandardMaterial
                color={def.colour}
                emissive={def.colour}
                emissiveIntensity={highlight ? 0.6 : 0.25}
                transparent={off}
                opacity={off ? 0.55 : 1}
              />
            </mesh>
            {showLabels && (
              <Html style={{ pointerEvents: 'none' }} zIndexRange={[5, 0]}>
                <div className="marker-label" style={{ background: def.colour }}>
                  {def.shortLabel}
                  {off ? ' ⚠' : ''}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}
