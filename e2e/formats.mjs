/**
 * Browser test of every import format: each fixture in fixtures/formats is the same closed
 * foot (mm, Z up) written in a different format/unit/axis convention, so after import every
 * file must give the same size and orientation. STEP/IGES use OCCT's own test cubes.
 *   npm run e2e   (runs smoke.mjs then this file; regenerate fixtures with `npm run fixtures`)
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const server = await createServer({ server: { port: 5198, strictPort: true }, logLevel: process.env.VITE_LOG ?? 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5198/');
await page.waitForFunction(() => window.__app);

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) failures++; };

async function load(path) {
  await page.evaluate(() => window.__app.useStore.setState({ doc: null, derived: null, error: null, scanDialogOpen: false }));
  await page.setInputFiles('[data-testid=file-input]', path);
  await page.waitForFunction(() => {
    const s = window.__app.useStore.getState();
    return s.error || (s.scanDialogOpen && s.derived && s.doc && s.derived.meshId === s.doc.mesh.id);
  }, null, { timeout: 60000 });
  const r = await page.evaluate(() => {
    const s = window.__app.useStore.getState();
    if (s.error) return { error: s.error };
    const b = s.derived.stats.bounds;
    return { tris: s.derived.stats.triangleCount, size: b.max.map((v, i) => v - b.min[i]), min: b.min, info: s.doc.meta.import };
  });
  if (!r.error) await page.click('[data-testid=scan-setup-ok]');
  return r;
}

const dir = 'fixtures/formats';
const ref = await load(join(dir, 'foot.stl'));
console.log('reference', ref.tris, 'tris, size', ref.size.map((v) => v.toFixed(1)).join(' × '));
const close = (a, b, tol = 0.5) => a.every((v, i) => Math.abs(v - b[i]) < tol);

for (const [file, expectUnits] of [
  ['foot.obj', 'mm'], ['foot-binary.ply', 'mm'], ['foot-ascii.ply', 'mm'], ['foot.off', 'mm'],
  ['foot-mm.3mf', 'mm'], ['foot-cm.3mf', 'cm'], ['foot-inch.amf', 'mm'], ['foot.gltf', 'm'], ['foot.glb', 'm'],
  ['foot.dae', 'm'], ['foot.wrl', 'm'], ['foot.3dm', 'mm'],
]) {
  const r = await load(join(dir, file));
  if (r.error) { check(false, `${file}: ${r.error}`); continue; }
  check(r.tris === ref.tris && close(r.size, ref.size) && close(r.min, ref.min, 1),
    `${file}: ${r.tris} tris, ${r.size.map((v) => v.toFixed(1)).join(' × ')} mm, units ${r.info.units} (${r.info.unitsSource}), ${r.info.upAxis}-up`);
  check(r.info.units === expectUnits, `${file}: units interpreted as ${expectUnits}`);
}

const occt = 'node_modules/occt-import-js/test/testfiles';
for (const f of ['cube-10x10mm/Cube 10x10.stp', 'cube-10x10mm/Cube 10x10.igs', 'cube-units/cube-in.step']) {
  const r = await load(join(occt, f));
  const expected = f.includes('cube-in') ? 1000 : 10;
  check(!r.error && r.size.every((v) => Math.abs(v - expected) < 0.01), `${f}: ${r.error ?? r.size.map((v) => v.toFixed(2)).join(' × ') + ' mm'}`);
}

// A metre-scale unit-less file gets its units guessed, and the user can correct them.
const tiny = join(tmpdir(), 'foot-in-metres.obj');
writeFileSync(tiny, 'v 0 0 0\nv 0.25 0 0\nv 0 0.1 0\nv 0 0 0.08\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n');
await page.evaluate(() => window.__app.useStore.setState({ doc: null, derived: null }));
await page.setInputFiles('[data-testid=file-input]', tiny);
await page.waitForSelector('[data-testid=units-select]');
check((await page.inputValue('[data-testid=units-select]')) === 'm', 'unit-less tiny OBJ: units guessed as metres');
await page.selectOption('[data-testid=units-select]', 'cm');
await page.click('[data-testid=scan-setup-ok]');
await page.waitForFunction(() => { const s = window.__app.useStore.getState(); return s.derived?.meshId === s.doc?.mesh.id; });
const cmSize = await page.evaluate(() => { const b = window.__app.useStore.getState().derived.stats.bounds; return b.max[0] - b.min[0]; });
check(Math.abs(cmSize - 2.5) < 1e-3, `user override to centimetres rescales (x size ${cmSize.toFixed(3)} mm)`);

// Proprietary formats give actionable advice
const f3d = join(tmpdir(), 'shoe.f3d');
writeFileSync(f3d, 'PK');
await page.setInputFiles('[data-testid=file-input]', f3d);
await page.waitForFunction(() => window.__app.useStore.getState().error);
check((await page.evaluate(() => window.__app.useStore.getState().error)).includes('File → Export'), '.f3d explains how to export from Fusion 360');

check(errors.length === 0, `no page errors ${errors.join('; ')}`);
await browser.close();
await server.close();
console.log(failures ? `${failures} format check(s) failed` : 'format import test passed');
process.exit(failures ? 1 : 0);
