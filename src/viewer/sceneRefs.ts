import type * as THREE from 'three';

/** Imperative handles into the scene, for code that must raycast or measure outside React. */
export const sceneRefs: {
  modelMesh: THREE.Mesh | null;
  /** Group whose world matrix maps mesh-local coordinates to world coordinates. */
  localSpace: THREE.Group | null;
  /** Active world-space clipping planes (points with negative distance are hidden). */
  clipPlanes: THREE.Plane[];
} = {
  modelMesh: null,
  localSpace: null,
  clipPlanes: [],
};
