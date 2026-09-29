import { Line } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../state/store';

/** Triangle through heel centre, 1st and 5th metatarsal heads (mesh-local, follows the model). */
export function BasePlaneOverlay() {
  const hc = useStore((s) => s.doc?.landmarks.heelCentre?.local);
  const m1 = useStore((s) => s.doc?.landmarks.met1Head?.local);
  const m5 = useStore((s) => s.doc?.landmarks.met5Head?.local);
  const locked = useStore((s) => !!s.doc?.basePlaneLocked);
  const geometry = useMemo(() => {
    if (!hc || !m1 || !m5) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...hc, ...m1, ...m5]), 3));
    return g;
  }, [hc, m1, m5]);
  if (!geometry || !hc || !m1 || !m5) return null;
  const colour = locked ? '#22a652' : '#8a94a0';
  return (
    <group>
      <mesh geometry={geometry} raycast={() => null} renderOrder={4}>
        <meshBasicMaterial color={colour} transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} depthTest={false} />
      </mesh>
      <Line points={[hc, m1, m5, hc]} color={colour} lineWidth={2} dashed={!locked} dashSize={4} gapSize={3} depthTest={false} renderOrder={4} />
    </group>
  );
}
