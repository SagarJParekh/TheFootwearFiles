/**
 * Browser test of the insole designer: landmarks → align → create insole → modifications →
 * orthosis → undo → download. Uses the synthetic closed foot sample.
 */
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const server = await createServer({ server: { port: 5197, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) failures++; };
const state = () => page.evaluate(() => {
  const s = window.__app.useStore.getState();
  const o = s.insole?.output;
  return { kind: o?.kind, tris: o ? o.mesh.indices.length / 3 : 0, min: o?.minThickness, max: o?.maxThickness, key: s.insole?.key, busy: s.insoleBusy, err: s.insoleError, size: s.doc?.insole?.shoeSizeUK };
});
// Wait until the generated insole corresponds to the current design parameters.
const settle = () => page.waitForFunction(() => {
  const s = window.__app.useStore.getState();
  if (s.busy || s.insoleBusy || !s.doc?.insole) return !s.busy && !s.insoleBusy;
  return !!s.insole && s.insole.key.endsWith(JSON.stringify(s.doc.insole) + ']');
}, null, { timeout: 60000 });

try {
  await page.goto('http://localhost:5197/');
  await page.waitForFunction(() => window.__app);
  await page.selectOption('select', 'foot-closed.stl');
  await page.click('[data-testid=scan-setup-ok]');
  await page.evaluate(() => {
    const st = window.__app.useStore; const d = st.getState().doc; const now = new Date().toISOString();
    st.setState({ doc: { ...d, landmarks: { heelCentre: { local: [4, 38, 0.2], placedAt: now }, met1Head: { local: [-26, 182, 0.3], placedAt: now }, met5Head: { local: [44, 165, 0.3], placedAt: now } } } });
  });
  await page.click('[data-testid=tab-insole]');
  await page.click('[data-testid=set-base-plane] >> nth=0');
  await page.click('[data-testid=create-insole] + span');
  await page.waitForFunction(() => window.__app.useStore.getState().insole, null, { timeout: 60000 });
  await settle();
  let s = await state();
  check(s.kind === 'insole' && s.tris > 1000 && Math.abs(s.min - 2.5) < 1e-3, `insole created (UK${s.size}, ${s.tris} tris, ${s.min?.toFixed(2)} mm padding)`);

  const display = () => page.evaluate(() => window.__app.useStore.getState().view.scanDisplay);
  check((await display()) === 'transparent', 'foot becomes transparent when the insole is created');
  await page.click('.viewport-overlay [data-testid=scan-hidden]');
  check((await display()) === 'hidden', 'viewport toggle hides the foot');
  await page.click('.viewport-overlay [data-testid=scan-solid]');
  check((await display()) === 'solid', 'viewport toggle shows the foot again');
  await page.click('.viewport-overlay [data-testid=scan-transparent]');

  // padding slider via keyboard
  await page.focus('[data-testid=padding]');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await settle();
  s = await state();
  check(Math.abs(s.min - 3.0) < 1e-3, `padding thickness slider → ${s.min?.toFixed(2)} mm`);

  for (const id of ['wedge', 'mt-pad', 'fascia', 'mt-bar']) await page.click(`[data-testid=${id}] + span`);
  await settle();
  s = await state();
  check(s.max > 6 && !s.err, `wedge + MT pad + fascia groove + MT bar applied (thickness ${s.min?.toFixed(1)}–${s.max?.toFixed(1)} mm)`);

  await page.click('[data-testid=orthosis] + span');
  await settle();
  s = await state();
  check(s.kind === 'orthosis', `"Add thickness" → orthosis (${s.tris} tris)`);

  await page.keyboard.press('Control+z');
  await settle();
  check((await state()).kind === 'insole', 'undo returns to the soft insole');

  const dl = page.waitForEvent('download');
  await page.click('[data-testid=download-insole]');
  const name = (await dl).suggestedFilename();
  check(/insole-UK[\d.]+\.stl$/.test(name), `download ${name}`);
  check(errors.length === 0, `no page errors ${errors.join('; ')}`);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `${failures} insole check(s) failed` : 'insole designer test passed');
process.exit(failures ? 1 : 0);
