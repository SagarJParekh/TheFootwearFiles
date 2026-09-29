import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';

const FRONT_COLOUR = new THREE.Color('#d9c7b0');
const BACK_COLOUR = new THREE.Color('#b0413e');

/**
 * Standard material whose back faces render in a contrasting colour, so the inside of
 * an open scan (or the interior exposed by a clipping plane) is easy to read.
 */
function createSurfaceMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: FRONT_COLOUR,
    roughness: 0.75,
    metalness: 0.0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.backColour = { value: BACK_COLOUR };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 backColour;')
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( gl_FrontFacing ? diffuse : backColour, opacity );',
      );
  };
  return m;
}

interface Props {
  geometry: THREE.BufferGeometry;
  flatShading: boolean;
  wireframe: boolean;
  clippingPlanes: THREE.Plane[];
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  meshRef?: (m: THREE.Mesh | null) => void;
  /** 1 = solid; < 1 renders the scan see-through (e.g. to inspect the insole under it). */
  opacity?: number;
}

export function ModelMesh({ geometry, flatShading, wireframe, clippingPlanes, onPointerDown, onPointerMove, onClick, meshRef, opacity = 1 }: Props) {
  const material = useMemo(createSurfaceMaterial, []);
  const wireMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#3a3a3a', wireframe: true, transparent: true, opacity: 0.35 }),
    [],
  );

  useEffect(() => {
    material.flatShading = flatShading;
    material.transparent = opacity < 1;
    material.opacity = opacity;
    material.depthWrite = opacity >= 1;
    material.clippingPlanes = clippingPlanes;
    wireMaterial.clippingPlanes = clippingPlanes;
    material.needsUpdate = true;
    wireMaterial.needsUpdate = true;
  }, [material, wireMaterial, flatShading, clippingPlanes, opacity]);

  useEffect(() => () => {
    material.dispose();
    wireMaterial.dispose();
  }, [material, wireMaterial]);

  return (
    <>
      <mesh
        ref={meshRef}
        geometry={geometry}
        material={material}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onClick={onClick}
      />
      {wireframe && <mesh geometry={geometry} material={wireMaterial} raycast={() => null} />}
    </>
  );
}
