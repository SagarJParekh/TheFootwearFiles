import { makeMesh, type MeshData } from '../types';

/**
 * Converts a triangle soup (9 floats per triangle) into an indexed mesh by merging
 * vertices that fall into the same quantisation cell (`tolerance` in mm).
 * Uses an open-addressing hash table on integer cell coordinates so it scales to
 * millions of triangles without allocating string keys.
 * Degenerate triangles (two or more identical welded vertices) are dropped.
 */
export function weldSoup(soup: Float32Array, tolerance = 1e-4): MeshData {
  const vertCount = soup.length / 3;
  const inv = 1 / tolerance;

  let capacity = 1;
  while (capacity < vertCount * 2) capacity <<= 1;
  const mask = capacity - 1;
  const table = new Int32Array(capacity).fill(-1);

  // Unique vertex storage (upper bound = vertCount)
  const qx = new Int32Array(vertCount);
  const qy = new Int32Array(vertCount);
  const qz = new Int32Array(vertCount);
  const outPos = new Float32Array(vertCount * 3);
  let unique = 0;
  const remap = new Uint32Array(vertCount);

  for (let v = 0; v < vertCount; v++) {
    const x = soup[3 * v], y = soup[3 * v + 1], z = soup[3 * v + 2];
    const ix = Math.round(x * inv) | 0, iy = Math.round(y * inv) | 0, iz = Math.round(z * inv) | 0;
    let h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask;
    for (;;) {
      const slot = table[h];
      if (slot === -1) {
        table[h] = unique;
        qx[unique] = ix; qy[unique] = iy; qz[unique] = iz;
        outPos[3 * unique] = x; outPos[3 * unique + 1] = y; outPos[3 * unique + 2] = z;
        remap[v] = unique++;
        break;
      }
      if (qx[slot] === ix && qy[slot] === iy && qz[slot] === iz) {
        remap[v] = slot;
        break;
      }
      h = (h + 1) & mask;
    }
  }

  const triCount = vertCount / 3;
  const indices = new Uint32Array(triCount * 3);
  let n = 0;
  for (let t = 0; t < triCount; t++) {
    const a = remap[3 * t], b = remap[3 * t + 1], c = remap[3 * t + 2];
    if (a === b || b === c || a === c) continue;
    indices[n++] = a; indices[n++] = b; indices[n++] = c;
  }
  return makeMesh(outPos.slice(0, unique * 3), indices.slice(0, n));
}

/** Expands an indexed mesh back to a soup (used when merging meshes / for tests). */
export function unweld(mesh: Pick<MeshData, 'positions' | 'indices'>): Float32Array {
  const { positions, indices } = mesh;
  const soup = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i] * 3;
    soup[3 * i] = positions[v];
    soup[3 * i + 1] = positions[v + 1];
    soup[3 * i + 2] = positions[v + 2];
  }
  return soup;
}

/** Removes vertices not referenced by any triangle, returning a compacted mesh. */
export function compactMesh(positions: Float32Array, indices: Uint32Array): MeshData {
  const vertCount = positions.length / 3;
  const map = new Int32Array(vertCount).fill(-1);
  let n = 0;
  for (let i = 0; i < indices.length; i++) {
    if (map[indices[i]] === -1) map[indices[i]] = n++;
  }
  const outPos = new Float32Array(n * 3);
  for (let v = 0; v < vertCount; v++) {
    const m = map[v];
    if (m >= 0) {
      outPos[3 * m] = positions[3 * v];
      outPos[3 * m + 1] = positions[3 * v + 1];
      outPos[3 * m + 2] = positions[3 * v + 2];
    }
  }
  const outIdx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) outIdx[i] = map[indices[i]];
  return makeMesh(outPos, outIdx);
}
