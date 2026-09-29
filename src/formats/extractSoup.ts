import * as THREE from 'three';

/**
 * Flattens every triangle mesh in a Three.js scene graph into one triangle soup
 * (9 floats per triangle) in scene coordinates. Node transforms are applied, and
 * mirroring transforms (negative determinant) flip the winding so normals stay outward.
 * Points and lines are ignored; `pointsOnly` reports files that contain only point clouds.
 */
export function extractSoup(root: THREE.Object3D): { soup: Float32Array; meshCount: number; pointsOnly: boolean } {
  root.updateMatrixWorld(true);
  const chunks: Float32Array[] = [];
  let total = 0;
  let meshCount = 0;
  let sawPoints = false;
  const v = new THREE.Vector3();

  root.traverse((obj) => {
    if ((obj as THREE.Points).isPoints) sawPoints = true;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geom = mesh.geometry as THREE.BufferGeometry;
    const pos = geom.getAttribute('position');
    if (!pos) return;
    const index = geom.getIndex();
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
    if (!triCount) return;

    const instances = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
    for (let inst = 0; inst < instances; inst++) {
      const m = mesh.matrixWorld.clone();
      if (instances > 1) {
        const im = new THREE.Matrix4();
        (mesh as THREE.InstancedMesh).getMatrixAt(inst, im);
        m.multiply(im);
      }
      const flip = m.determinant() < 0;
      const out = new Float32Array(triCount * 9);
      for (let t = 0; t < triCount; t++) {
        for (let k = 0; k < 3; k++) {
          const corner = flip ? [0, 2, 1][k] : k;
          const vi = index ? index.getX(3 * t + corner) : 3 * t + corner;
          v.fromBufferAttribute(pos, vi).applyMatrix4(m);
          out[9 * t + 3 * k] = v.x;
          out[9 * t + 3 * k + 1] = v.y;
          out[9 * t + 3 * k + 2] = v.z;
        }
      }
      chunks.push(out);
      total += out.length;
      meshCount++;
    }
  });

  const soup = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    soup.set(c, o);
    o += c.length;
  }
  return { soup, meshCount, pointsOnly: meshCount === 0 && sawPoints };
}

/** Same for a single BufferGeometry (e.g. PLY / OBJ loader output). */
export function geometryToSoup(geom: THREE.BufferGeometry): Float32Array {
  const mesh = new THREE.Mesh(geom);
  return extractSoup(mesh).soup;
}
