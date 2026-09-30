/**
 * Generates footwear for a real scan outside the app (for design work):
 *   npx tsx scripts/scan-preview.ts <scan.obj|.stl> <outDir> [turnDeg] [style…]
 * The scan must lie on the floor (Z up). `turnDeg` turns it about Z first (e.g. 180 when the
 * toes point to −Y). Heel centre and metatarsal heads are picked automatically from the sole.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { finishImport } from '../src/formats/finishImport';
import { formatForFile } from '../src/formats/registry';
import { parseObjModel, parseStlModel } from '../src/formats/workerParsers';
import { samplePlantarSurface } from '../src/core/insole/generate';
import { generateFootwear, prepareFootData } from '../src/core/footwear/generate';
import { concatMeshes, latticeToMesh } from '../src/core/footwear/lattice';
import { defaultFootwearParams, type ChappalStyle } from '../src/core/footwear/params';
import { makeMesh, type MeshData, type Vec3 } from '../src/core/types';

function stl(m: Pick<MeshData, 'positions' | 'indices'>): Buffer {
  const n = m.indices.length / 3, buf = Buffer.alloc(84 + 50 * n);
  buf.writeUInt32LE(n, 80);
  for (let t = 0; t < n; t++)
    for (let k = 0; k < 3; k++)
      for (let c = 0; c < 3; c++) buf.writeFloatLE(m.positions[3 * m.indices[3 * t + k] + c], 84 + 50 * t + 12 + 12 * k + 4 * c);
  return buf;
}

const [file, out, turnArg, ...styleArgs] = process.argv.slice(2);
const turn = Number(turnArg ?? 0);
const styles = styleArgs.length ? styleArgs : ['slide', 'thong', 'splitToe', 'shoe'];
mkdirSync(out, { recursive: true });
const raw = readFileSync(file);
const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
const parsed = file.toLowerCase().endsWith('.obj') ? parseObjModel(buffer) : parseStlModel(buffer);
const { mesh } = finishImport(parsed, formatForFile(file)!, {});
const P = mesh.positions;
const c = Math.round(Math.cos((turn * Math.PI) / 180)), s = Math.round(Math.sin((turn * Math.PI) / 180));
let zmin = Infinity;
for (let i = 0; i < P.length; i += 3) {
  const x = P[i], y = P[i + 1];
  P[i] = c * x - s * y;
  P[i + 1] = s * x + c * y;
  zmin = Math.min(zmin, P[i + 2]);
}
for (let i = 2; i < P.length; i += 3) P[i] -= zmin;
// landmarks from the sole
let y0 = Infinity, y1 = -Infinity;
for (let i = 0; i < P.length; i += 3) if (P[i + 2] < 40) { y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); }
const L = y1 - y0;
const sole: Vec3[] = [];
for (let i = 0; i < P.length; i += 3) if (P[i + 2] < 12) sole.push([P[i], P[i + 1], P[i + 2]]);
const near = (x: number, y: number) => sole.reduce((b, p) => (Math.hypot(p[0] - x, p[1] - y) + 0.5 * p[2] < Math.hypot(b[0] - x, b[1] - y) + 0.5 * b[2] ? p : b));
const band = (y: number) => sole.filter((p) => Math.abs(p[1] - y) < 4).map((p) => p[0]);
const x1 = band(y0 + 0.72 * L), x5 = band(y0 + 0.64 * L), xh = band(y0 + 0.15 * L).sort((a, b) => a - b);
let tipX = 0, tipY = -Infinity;
for (const p of sole) if (p[1] > tipY) [tipX, tipY] = [p[0], p[1]];
const right = tipX < (Math.min(...xh) + Math.max(...xh)) / 2; // big toe medial
const mn = (a: number[]) => a.reduce((p, q) => Math.min(p, q), Infinity), mx = (a: number[]) => a.reduce((p, q) => Math.max(p, q), -Infinity);
const lm = {
  heelCentre: near(xh[xh.length >> 1], y0 + 0.15 * L),
  met1Head: near(right ? mn(x1) + 10 : mx(x1) - 10, y0 + 0.72 * L),
  met5Head: near(right ? mx(x5) - 8 : mn(x5) + 8, y0 + 0.64 * L),
};
console.log(`foot ${L.toFixed(0)} mm, ${right ? 'right' : 'left'}`);
writeFileSync(join(out, 'foot.stl'), stl(mesh));
const foot = prepareFootData(samplePlantarSurface(P, mesh.indices, lm), P, mesh.indices);
for (const st of styles) {
  const p = defaultFootwearParams(8, st === 'shoe' ? 'shoe' : 'chappal');
  if (st !== 'shoe') p.chappalStyle = st as ChappalStyle;
  const r = generateFootwear(foot, p);
  const m = concatMeshes([...r.parts.solids, latticeToMesh(r.parts.lattice, 6, true)]);
  writeFileSync(join(out, `${st}.stl`), stl(makeMesh(m.positions, m.indices)));
  console.log(st, `${r.length.toFixed(0)}×${r.width.toFixed(0)}`, r.rules.map((x) => `${x.ok ? 'ok' : 'FAIL'} ${x.value}`).join(' | '), r.upperGap ? `upper gap ${r.upperGap.min.toFixed(1)}–${r.upperGap.max.toFixed(1)}` : '');
}
