import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js';
import type { MeshData } from '../core/types';

// Patch Three.js once so every mesh raycast uses the BVH when available.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

let bvhWorker: GenerateMeshBVHWorker | null = null;
let bvhQueue: Promise<unknown> = Promise.resolve();

/** Builds the BVH in a worker (serialised – the helper handles one job at a time). */
function buildBvh(geometry: THREE.BufferGeometry): Promise<void> {
  const job = bvhQueue.then(async () => {
    try {
      bvhWorker ??= new GenerateMeshBVHWorker();
      geometry.boundsTree = await bvhWorker.generate(geometry, { maxLeafTris: 10 });
    } catch (e) {
      console.warn('BVH worker failed, building on main thread', e);
      geometry.computeBoundsTree();
    }
  });
  bvhQueue = job.catch(() => undefined);
  return job;
}

/**
 * Creates render geometry for a mesh version. The geometry owns *copies* of the
 * document arrays: the BVH build reorders the index buffer and transfers buffers
 * to its worker, which must never touch the (immutable) document data.
 * Returns null until the BVH is ready.
 */
export function useMeshGeometry(mesh: MeshData | undefined, normals: Float32Array | undefined): THREE.BufferGeometry | null {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const normalsMatch = !!mesh && !!normals && normals.length === mesh.positions.length;

  useEffect(() => {
    if (!mesh || !normals || !normalsMatch) return;
    let cancelled = false;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions.slice(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals.slice(), 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices.slice(), 1));
    void buildBvh(g).then(() => {
      if (cancelled) {
        g.dispose();
        return;
      }
      g.computeBoundingBox();
      g.computeBoundingSphere();
      setGeometry(g); // the previous geometry is disposed by the effect below
    });
    return () => {
      cancelled = true;
    };
  }, [mesh, normals, normalsMatch]);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  return geometry;
}
