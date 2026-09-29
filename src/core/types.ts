/**
 * Core data types. Everything here is plain, serialisable data (typed arrays,
 * numbers, strings) with no Three.js or React objects, so the document model can
 * be moved to a worker, saved to disk, or processed by later pipeline stages.
 */

export type Vec3 = [number, number, number];
/** Quaternion as [x, y, z, w]. */
export type Quat = [number, number, number, number];

/**
 * Indexed triangle mesh in millimetres.
 * `positions` has 3 floats per vertex, `indices` 3 vertex indices per triangle (CCW = outward).
 * Treated as immutable: every edit produces a new MeshData.
 */
export interface MeshData {
  /** Unique id per mesh version (used for caching render geometry / analysis). */
  id: string;
  positions: Float32Array;
  indices: Uint32Array;
}

/** Rigid transform (no scale – units stay in mm). world = R * local + t */
export interface RigidTransform {
  position: Vec3;
  quaternion: Quat;
}

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

export interface MeshStats {
  vertexCount: number;
  triangleCount: number;
  bounds: BoundingBox;
  /** Edges used by exactly one triangle. */
  boundaryEdgeCount: number;
  /** Edges used by more than two triangles. */
  nonManifoldEdgeCount: number;
  /** Closed 2-manifold: no boundary edges and no non-manifold edges. */
  watertight: boolean;
  /** Mean edge length in mm (useful for sizing overlays / hole-fill refinement). */
  meanEdgeLength: number;
}

export interface Plane {
  /** Unit normal. */
  normal: Vec3;
  /** Signed offset: points p on the plane satisfy dot(normal, p) = constant. */
  constant: number;
}

export const IDENTITY_TRANSFORM: RigidTransform = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
};

let idCounter = 0;
export function newMeshId(): string {
  idCounter += 1;
  return `mesh-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeMesh(positions: Float32Array, indices: Uint32Array): MeshData {
  return { id: newMeshId(), positions, indices };
}
