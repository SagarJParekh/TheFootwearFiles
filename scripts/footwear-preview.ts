/**
 * Writes the generated footwear for the synthetic closed foot as binary STL files (parts
 * concatenated, not merged) for offline inspection: `npx tsx scripts/footwear-preview.ts <outDir> [style…]`.
 * Styles: slide, thong, splitToe, shoe.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closedFoot } from '../src/core/fixtures/footShapes';
import { samplePlantarSurface } from '../src/core/insole/generate';
import { generateFootwear, prepareFootData } from '../src/core/footwear/generate';
import { concatMeshes, latticeToMesh } from '../src/core/footwear/lattice';
import { defaultFootwearParams, type ChappalStyle } from '../src/core/footwear/params';
import type { MeshData } from '../src/core/types';

function stl(m: MeshData): Buffer {
  const n = m.indices.length / 3, buf = Buffer.alloc(84 + 50 * n);
  buf.writeUInt32LE(n, 80);
  for (let t = 0; t < n; t++) {
    const o = 84 + 50 * t;
    for (let k = 0; k < 3; k++) {
      const v = m.indices[3 * t + k];
      for (let c = 0; c < 3; c++) buf.writeFloatLE(m.positions[3 * v + c], o + 12 + 12 * k + 4 * c);
    }
  }
  return buf;
}

const out = process.argv[2] ?? 'preview';
const styles = process.argv.length > 3 ? process.argv.slice(3) : ['slide', 'thong', 'splitToe', 'shoe'];
mkdirSync(out, { recursive: true });
const scan = closedFoot(3);
const lm = { heelCentre: [4, 38, 0.2], met1Head: [-26, 182, 0.3], met5Head: [44, 165, 0.3] } as { heelCentre: [number, number, number]; met1Head: [number, number, number]; met5Head: [number, number, number] };
const foot = prepareFootData(samplePlantarSurface(scan.positions, scan.indices, lm), scan.positions, scan.indices);
writeFileSync(join(out, 'foot.stl'), stl(scan));
for (const s of styles) {
  const p = defaultFootwearParams(6, s === 'shoe' ? 'shoe' : 'chappal');
  if (s !== 'shoe') p.chappalStyle = s as ChappalStyle;
  const t0 = Date.now();
  const r = generateFootwear(foot, p);
  const m = concatMeshes([...r.parts.solids, latticeToMesh(r.parts.lattice, 6, true)]);
  writeFileSync(join(out, `${s}.stl`), stl(m));
  console.log(s, `${Date.now() - t0} ms`, `${r.length.toFixed(0)}×${r.width.toFixed(0)}`, r.rules.map((x) => `${x.ok ? 'ok' : 'FAIL'} ${x.value}`).join(' | '), r.warnings.join(' / '));
}
