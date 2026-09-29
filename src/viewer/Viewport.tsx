import { Canvas } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei';
import { useCallback } from 'react';
import * as THREE from 'three';
import { useStore } from '../state/store';
import { CameraController } from './CameraController';
import { ModelGroup } from './ModelGroup';
import { ModelMesh } from './ModelMesh';
import { sceneRefs } from './sceneRefs';
import { useMeshGeometry } from './useMeshGeometry';

// App convention: Z is up (+Y anterior, +X patient's right).
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const NO_PLANES: THREE.Plane[] = [];

function Scene() {
  const mesh = useStore((s) => s.doc?.mesh);
  const derived = useStore((s) => s.derived);
  const view = useStore((s) => s.view);
  const normals = derived && mesh && derived.meshId === mesh.id ? derived.normals : undefined;
  const geometry = useMeshGeometry(mesh, normals);
  const setMeshRef = useCallback((m: THREE.Mesh | null) => {
    sceneRefs.modelMesh = m;
  }, []);

  return (
    <>
      <ambientLight intensity={0.45} />
      <hemisphereLight args={['#ffffff', '#555566', 0.6]} />
      <directionalLight position={[300, -400, 600]} intensity={1.4} />
      <directionalLight position={[-300, 400, -200]} intensity={0.5} />

      {view.showGrid && (
        <Grid
          rotation={[Math.PI / 2, 0, 0]}
          args={[1000, 1000]}
          cellSize={10}
          sectionSize={100}
          cellColor="#9aa3ad"
          sectionColor="#5a6570"
          fadeDistance={2500}
          infiniteGrid
        />
      )}
      {view.showAxes && <axesHelper args={[100]} />}

      {geometry && (
        <ModelGroup>
          <ModelMesh
            geometry={geometry}
            flatShading={view.flatShading}
            wireframe={view.wireframe}
            clippingPlanes={NO_PLANES}
            meshRef={setMeshRef}
          />
        </ModelGroup>
      )}

      <OrbitControls makeDefault enableDamping={false} />
      <CameraController />
      <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
        <GizmoViewport axisColors={['#e04848', '#48b048', '#4868e0']} labelColor="white" />
      </GizmoHelper>
    </>
  );
}

export function Viewport() {
  return (
    <Canvas
      camera={{ position: [400, -400, 300], fov: 40, near: 0.5, far: 10000 }}
      gl={{ antialias: true, localClippingEnabled: true } as never}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true;
      }}
      style={{ background: 'linear-gradient(#f4f6f8, #d8dde3)' }}
    >
      <Scene />
    </Canvas>
  );
}
