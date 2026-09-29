/**
 * End-to-end smoke test: starts Vite, drives the app in headless Chromium and checks the
 * main workflow (load → landmarks → clip/cut → fill holes → save/export).
 *   npm run e2e
 * Uses PLAYWRIGHT_CHROMIUM (or /opt/pw-browsers/chromium if present) as the browser.
 */
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const state = () => page.evaluate(() => {
  const s = window.__app.useStore.getState();
  return {
    tris: s.derived?.stats.triangleCount, watertight: s.derived?.stats.watertight, holes: s.holes?.loops.length,
    landmarks: Object.keys(s.doc?.landmarks ?? {}), busy: s.busy, error: s.error, undo: s.history.past.length,
  };
});
const idle = () => page.waitForFunction(() => {
  const s = window.__app.useStore.getState();
  return !s.busy && s.derived?.meshId === s.doc?.mesh.id && s.holes?.meshId === s.doc?.mesh.id;
}, null, { timeout: 60000 });
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) failures++; };

try {
  await page.goto('http://localhost:5199/');
  await page.waitForFunction(() => window.__app);
  await page.selectOption('select', 'leg-open-top.stl');
  await page.waitForSelector('[data-testid=scan-setup-ok]');
  await page.click('.modal label.radio:has-text("Lower limb")');
  await page.click('[data-testid=scan-setup-ok]');
  await idle();
  let s = await state();
  check(s.tris === 48478 && s.watertight === false && s.holes === 3, `loaded leg scan (${s.tris} tris, ${s.holes} holes)`);

  // Landmark: in the top view the canvas centre ray hits the dorsum of the foot
  await page.click('.toolbar button:text-is("Top")');
  await page.waitForTimeout(500);
  await page.click('[data-testid=lm-lateralMalleolus]');
  const box = await (await page.$('canvas')).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  s = await state();
  check(s.landmarks.includes('lateralMalleolus'), 'placed a landmark by clicking the surface');

  // Fill holes (rim excluded)
  await page.click('[data-testid=fill-all]');
  await idle();
  s = await state();
  check(s.holes === 1, `filled scanner holes, rim left open (${s.holes} loop left)`);

  // Cut the top off with a capped cut → closed mesh
  await page.click('text=Clipping plane (non-destructive)');
  await page.click('[data-testid=cut-button]');
  await idle();
  s = await state();
  check(s.watertight === true && s.holes === 0, 'capped cut closed the mesh');

  // Undo / redo
  await page.keyboard.press('Control+z');
  await idle();
  check((await state()).holes === 1, 'undo restored the pre-cut mesh');
  await page.keyboard.press('Control+Shift+z');
  await idle();
  check((await state()).watertight === true, 'redo re-applied the cut');

  // Export STL + save project
  const dl1 = page.waitForEvent('download');
  await page.click('[data-testid=export-stl]');
  check((await dl1).suggestedFilename().endsWith('.stl'), 'exported STL');
  const dl2 = page.waitForEvent('download');
  await page.click('text=Save project');
  check((await dl2).suggestedFilename().endsWith('.tffproj'), 'saved project');

  check(errors.length === 0 && !(await state()).error, `no page errors ${errors.join('; ')}`);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `${failures} check(s) failed` : 'e2e smoke test passed');
process.exit(failures ? 1 : 0);
