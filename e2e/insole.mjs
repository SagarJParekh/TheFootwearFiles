/**
 * Browser test of the insole designer: landmarks → align → create insole → modifications →
 * MT bar types → foot arch between AS/AE → undo → 3/4 shell → download. Uses the synthetic
 * closed foot sample.
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
  await page.waitForFunction(() => window.__app?.landmarks);
  await page.selectOption('select', 'foot-closed.stl');
  await page.click('[data-testid=scan-setup-ok]');
  // Base plane: placing heel centre, M1, M5 aligns and locks the model
  for (const [id, p] of [['heelCentre', [4, 38, 0.2]], ['met1Head', [-26, 182, 0.3]], ['met5Head', [44, 165, 0.3]]]) {
    await page.evaluate(([id, p]) => window.__app.landmarks.placeLandmark(id, p), [id, p]);
  }
  await page.click('[data-testid=tab-insole]');
  const archDisabled = () => page.isDisabled('[data-testid=foot-arch]');
  check(await archDisabled(), 'arch adjustment waits for the arch start/end landmarks');
  for (const [id, p] of [['archStart', [-12, 70, 3]], ['archEnd', [-22, 150, 1]]]) {
    await page.evaluate(([id, p]) => window.__app.landmarks.placeLandmark(id, p), [id, p]);
  }
  check(!(await archDisabled()), 'arch adjustment enabled once AS and AE are placed');

  // 1) Full length (FDM)
  await page.check('[data-testid=type-full]');
  await page.click('[data-testid=create-insole] + span');
  await page.waitForFunction(() => window.__app.useStore.getState().insole, null, { timeout: 60000 });
  await settle();
  const flatBase = () => page.evaluate(() => {
    const o = window.__app.useStore.getState().insole.output, p = o.mesh.positions;
    let lo = Infinity, hi = -Infinity;
    for (let i = p.length / 2 + 2; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); }
    return { kind: o.kind, spread: hi - lo, minT: o.minThickness };
  });
  let f = await flatBase();
  check(f.kind === 'full' && f.spread < 1e-3 && Math.abs(f.minT - 2) < 1e-3, `full-length insole has a flat base (spread ${f.spread.toExponential(1)} mm, thinnest ${f.minT.toFixed(2)} mm)`);

  const display = () => page.evaluate(() => window.__app.useStore.getState().view.scanDisplay);
  check((await display()) === 'transparent', 'foot becomes transparent when the insole is created');
  await page.click('.viewport-overlay [data-testid=scan-hidden]');
  check((await display()) === 'hidden', 'viewport toggle hides the foot');
  await page.click('.viewport-overlay [data-testid=scan-transparent]');

  // padding clearance slider (keyboard)
  const keyBefore = (await state()).key;
  await page.focus('[data-testid=padding]');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await settle();
  const clearance = await page.evaluate(() => window.__app.useStore.getState().doc.insole.paddingClearance);
  check(Math.abs(clearance - 3) < 1e-6 && (await state()).key !== keyBefore, `padding clearance slider → ${clearance} mm (insole regenerated)`);

  for (const id of ['wedge', 'mt-pad', 'fascia', 'mt-bar']) await page.click(`[data-testid=${id}] + span`);
  await settle();
  f = await flatBase();
  check(f.spread < 1e-3 && !(await state()).err, 'features applied, base still flat');
  await page.selectOption('select:has(option[value=anatomical])', 'anatomical');
  await page.selectOption('select:has(option[value=rays2to4])', 'rays2to4');
  await settle();
  const bar = await page.evaluate(() => window.__app.useStore.getState().doc.insole.mtBar);
  check(bar.path === 'anatomical' && bar.coverage === 'rays2to4' && !(await state()).err, 'MT bar type anatomical, coverage MT 2–4');

  // arch on the foot: modifies the scan, one undo step
  const meshId = () => page.evaluate(() => window.__app.useStore.getState().doc.mesh.id);
  const idBefore = await meshId();
  await page.fill('.slider-row input[type=number] >> nth=0', '6');
  await page.press('.slider-row input[type=number] >> nth=0', 'Enter');
  await page.waitForFunction(() => window.__app.useStore.getState().doc.footArchAdjust === 6, null, { timeout: 30000 });
  await settle();
  check((await meshId()) !== idBefore, 'arch +6 mm applied to the foot scan (new mesh), insole regenerated');
  const ends = await page.evaluate(() => {
    const l = window.__app.useStore.getState().doc.landmarks;
    return [l.archStart.local, l.archEnd.local];
  });
  check(Math.abs(ends[0][2] - 3) < 1e-6 && Math.abs(ends[1][2] - 1) < 1e-6, 'arch start and end points did not move');
  await page.keyboard.press('Control+z');
  check((await meshId()) === idBefore, 'undo restores the original foot');

  // 2) Switch to 3/4 (powder): uniform 2.5 mm shell (features off so the shell is plain)
  for (const id of ['wedge', 'mt-pad', 'fascia', 'mt-bar']) await page.click(`[data-testid=${id}] + span`);
  await settle();
  await page.check('[data-testid=type-threeQuarter]');
  await settle();
  let s = await state();
  check(s.kind === 'threeQuarter' && Math.abs(s.min - 2.5) < 1e-3, `3/4 insole: shell ${s.min?.toFixed(2)}–${s.max?.toFixed(2)} mm`);
  await page.focus('[data-testid=tq-thickness]');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await settle();
  s = await state();
  check(Math.abs(s.min - 3.0) < 1e-3, `3/4 thickness slider → ${s.min?.toFixed(2)} mm`);

  const dl = page.waitForEvent('download');
  await page.click('[data-testid=download-insole]');
  const name = (await dl).suggestedFilename();
  check(/threeQuarter-UK[\d.]+\.stl$/.test(name), `download ${name}`);
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
