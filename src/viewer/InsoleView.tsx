import { Html } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../state/store';

/** The generated insole / orthosis (world coordinates). */
export function InsoleView() {
  const insole = useStore((s) => s.insole);
  const enabled = useStore((s) => !!s.doc?.insole);
  const geometry = useMemo(() => {
    if (!insole) return null;
    const { mesh, normals } = insole.output;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    g.computeBoundingSphere();
    return g;
  }, [insole]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!enabled || !geometry) return null;
  const orth = insole!.output.kind === 'threeQuarter';
  return (
    <mesh geometry={geometry} raycast={() => null} renderOrder={1}>
      <meshStandardMaterial color={orth ? '#b9bec6' : '#e9ebee'} roughness={0.55} metalness={0.05} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Arrow on the floor showing the toe direction (+Y), as in "Toes aligned in the arrow direction". */
export function ToeArrow() {
  const show = useStore((s) => s.view.showToeArrow && !!s.doc);
  const arrow = useMemo(() => new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -40, 0.3), 120, 0x2f9e44, 24, 14), []);
  if (!show) return null;
  return (
    <>
      <primitive object={arrow} />
      <Html position={[0, 92, 0]} center style={{ pointerEvents: 'none' }}>
        <div className="toe-label">toes</div>
      </Html>
    </>
  );
}
