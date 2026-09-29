import type { MeshData } from '../types';

/** Writes an indexed mesh as binary STL (little-endian, 50 bytes per triangle). */
export function writeBinaryStl(mesh: Pick<MeshData, 'positions' | 'indices'>, header = 'Footwear Files export (mm)'): ArrayBuffer {
  const { positions: p, indices: idx } = mesh;
  const triCount = idx.length / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  const headerBytes = new TextEncoder().encode(header.slice(0, 80));
  new Uint8Array(buffer, 0, 80).set(headerBytes);
  view.setUint32(80, triCount, true);
  let o = 84;
  for (let t = 0; t < triCount; t++) {
    const a = idx[3 * t] * 3, b = idx[3 * t + 1] * 3, c = idx[3 * t + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    view.setFloat32(o, nx, true); view.setFloat32(o + 4, ny, true); view.setFloat32(o + 8, nz, true);
    o += 12;
    for (const v of [a, b, c]) {
      view.setFloat32(o, p[v], true); view.setFloat32(o + 4, p[v + 1], true); view.setFloat32(o + 8, p[v + 2], true);
      o += 12;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return buffer;
}

/** ASCII STL writer (used for fixtures/tests; binary is preferred for export). */
export function writeAsciiStl(mesh: Pick<MeshData, 'positions' | 'indices'>, name = 'mesh'): string {
  const { positions: p, indices: idx } = mesh;
  const lines: string[] = [`solid ${name}`];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    lines.push(`  facet normal ${n[0] / l} ${n[1] / l} ${n[2] / l}`, '    outer loop');
    for (const v of [a, b, c]) lines.push(`      vertex ${p[v]} ${p[v + 1]} ${p[v + 2]}`);
    lines.push('    endloop', '  endfacet');
  }
  lines.push(`endsolid ${name}`);
  return lines.join('\n') + '\n';
}
