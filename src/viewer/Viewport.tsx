import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei';
import { useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../state/store';
import { CameraController } from './CameraController';
import { ModelGroup } from './ModelGroup';
import { ModelMesh } from './ModelMesh';
import { sceneRefs } from './sceneRefs';
import { useMeshGeometry } from './useMeshGeometry';
import { LandmarkMarkers } from './LandmarkMarkers';
import { firstVisibleHit, worldToLocal } from './picking';
import { placeLandmark } from '../state/landmarkActions';
import { ClipPlane } from './ClipPlane';
import { HoleOverlay } from './HoleOverlay';
import { InsoleView, ToeArrow } from './InsoleView';

/** Click on the surface → place the active landmark (ignored if the click was an orbit drag). */
function onSurfaceClick(e: ThreeEvent<MouseEvent>) {
  const { tool, activeLandmark } = useStore.getState();
  if (tool !== 'landmark' || !activeLandmark || e.delta > 4) return;
  const hit = firstVisibleHit(e.intersections);
  if (!hit) return;
  e.stopPropagation();
  const local = worldToLocal(hit.point);
  if (local) placeLandmark(activeLandmark, local);
}

// App convention: Z is up (+Y anterior, +X patient's right).
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

function Scene() {
  const mesh = useStore((s) => s.doc?.mesh);
  const derived = useStore((s) => s.derived);
  const view = useStore((s) => s.view);
  const normals = derived && mesh && derived.meshId === mesh.id ? derived.normals : undefined;
  const geometry = useMeshGeometry(mesh, normals);
  const setMeshRef = useCallback((m: THREE.Mesh | null) => {
    sceneRefs.modelMesh = m;
  }, []);
  const bounds = derived?.stats.bounds;
  const diag = bounds ? Math.hypot(...bounds.max.map((v, i) => v - bounds.min[i])) : 100;
  const markerRadius = Math.max(1.2, diag * 0.007);
  const clip = useStore((s) => s.clip);
  const clippingPlanes = useMemo(() => {
    const planes = clip.enabled ? [new THREE.Plane(new THREE.Vector3(...clip.normal).normalize(), -clip.constant)] : [];
    sceneRefs.clipPlanes = planes;
    return planes;
  }, [clip.enabled, clip.normal, clip.constant]);

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

      <ToeArrow />
      <InsoleView />
      {geometry && (
        <ModelGroup visible={view.showScan}>
          <ModelMesh
            geometry={geometry}
            flatShading={view.flatShading}
            wireframe={view.wireframe}
            clippingPlanes={clippingPlanes}
            meshRef={setMeshRef}
            onClick={onSurfaceClick}
          />
          <LandmarkMarkers radius={markerRadius} />
          <HoleOverlay />
        </ModelGroup>
      )}

      {geometry && <ClipPlane size={diag * 0.9} />}
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
