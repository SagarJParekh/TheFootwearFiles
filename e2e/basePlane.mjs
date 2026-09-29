/**
 * Browser test of the base plane: placing heel centre, M1 and M5 on a tilted scan sets the
 * plane automatically (points on the floor) and locks rotation; release/undo restore it.
 */
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const server = await createServer({ server: { port: 5196, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) failures++; };
const info = () => page.evaluate(() => {
  const s = window.__app.useStore.getState(); const d = s.doc;
  const q = d.transform.quaternion, p = d.transform.position;
  const rot = (v) => { const [x, y, z, w] = q; const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty) + p[0], v[1] + w * ty + (z * tx - x * tz) + p[1], v[2] + w * tz + (x * ty - y * tx) + p[2]]; };
  const z = ['heelCentre', 'met1Head', 'met5Head'].filter((k) => d.landmarks[k]).map((k) => rot(d.landmarks[k].local)[2]);
  return { locked: !!d.basePlaneLocked, q: [...q], z, gizmo: s.view.gizmo, undo: s.history.past.map((e) => e.label) };
});

try {
  await page.goto('http://localhost:5196/');
  await page.waitForFunction(() => window.__app?.landmarks);
  await page.selectOption('select', 'foot-closed.stl');
  await page.click('[data-testid=scan-setup-ok]');
  // Tilt the scan first so the base plane has real work to do
  await page.click('.button-row button:text-is("X+")');
  await page.click('.button-row button:text-is("Z+")');
  const place = (id, p) => page.evaluate(([id, p]) => window.__app.landmarks.placeLandmark(id, p), [id, p]);
  await place('heelCentre', [4, 38, 0.2]);
  await place('met1Head', [-26, 182, 0.3]);
  check(!(await info()).locked, 'not locked with only two points');
  await place('met5Head', [44, 165, 0.3]);
  let s = await info();
  check(s.locked, 'base plane set automatically after the third point');
  check(s.z.every((z) => Math.abs(z) < 1e-3), `heel centre, M1, M5 lie on the floor (z = ${s.z.map((z) => z.toFixed(4)).join(', ')})`);
  check(await page.isVisible('[data-testid=base-plane-locked]'), 'lock banner shown');

  // Rotation attempts are refused
  const before = JSON.stringify(s.q);
  check(await page.isDisabled('.button-row button:text-is("Rotate")'), 'Rotate button disabled');
  check(await page.isDisabled('.button-row button:text-is("Z+")'), 'quick-rotate disabled');
  await page.click('canvas', { position: { x: 20, y: 20 } });
  await page.keyboard.press('r');
  check((await info()).gizmo === 'none', 'R key does not open the rotate gizmo');
  await page.evaluate(() => { window.__app.actions.rotateStep(2, 90); window.__app.actions.setRotationDeg([10, 0, 0]); });
  check(JSON.stringify((await info()).q) === before, 'programmatic rotation is refused while locked');

  // Moving a base-plane landmark re-aligns (plane follows the points), still locked
  await place('met5Head', [44, 165, 5]);
  s = await info();
  check(s.locked && s.z.every((z) => Math.abs(z) < 1e-3), 're-placing M5 re-aligns the plane');

  // Release and undo
  await page.click('text=Release base plane >> nth=0');
  s = await info();
  check(!s.locked && !(await page.isDisabled('.button-row button:text-is("Rotate")')), 'release unlocks rotation');
  await page.keyboard.press('Control+z');
  check((await info()).locked, 'undo restores the lock');
  check(errors.length === 0, `no page errors ${errors.join('; ')}`);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `${failures} base-plane check(s) failed` : 'base plane test passed');
process.exit(failures ? 1 : 0);
