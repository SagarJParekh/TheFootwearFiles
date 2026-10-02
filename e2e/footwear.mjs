/**
 * Browser test of the footwear designer: landmarks → Footwear → chappal (slide, thong,
 * split-toe) → design rules (strut 1.2–1.8 mm, clearance 1–2 mm) → shoe → undo → download
 * (overlapping parts and merged watertight solid). Uses the synthetic closed foot sample.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) failures++; };
const state = () => page.evaluate(() => {
  const s = window.__app.useStore.getState();
  const o = s.footwear?.output;
  return { kind: o?.kind, struts: o?.strutCount, rules: o?.rules, warnings: o?.warnings, clearance: o?.clearance, upperGap: o?.upperGap, strut: o?.strut, err: s.footwearError, p: s.doc?.footwear, insoleShown: !!s.doc?.insole && s.designCategory === 'insole' };
});
const settle = () => page.waitForFunction(() => {
  const s = window.__app.useStore.getState();
  if (s.busy || s.footwearBusy || !s.doc?.footwear) return !s.busy && !s.footwearBusy;
  return !!s.footwear && s.footwear.key.endsWith(JSON.stringify(s.doc.footwear) + ']');
}, null, { timeout: 90000 });
const rulesOk = (s) => s.rules?.length === 3 && s.rules.every((r) => r.ok);

try {
  await page.goto('http://localhost:5199/');
  await page.waitForFunction(() => window.__app?.landmarks);
  await page.selectOption('select', 'foot-closed.stl');
  await page.click('[data-testid=scan-setup-ok]');
  for (const [id, p] of [['heelCentre', [4, 38, 0.2]], ['met1Head', [-26, 182, 0.3]], ['met5Head', [44, 165, 0.3]]]) {
    await page.evaluate(([id, p]) => window.__app.landmarks.placeLandmark(id, p), [id, p]);
  }
  await page.click('[data-testid=tab-insole]');

  // 3rd category: footwear → it asks for the malleoli straight away (click on the scan)
  await page.check('[data-testid=type-footwear]');
  const placing = () => page.evaluate(() => { const s = window.__app.useStore.getState(); return s.tool === 'landmark' ? s.activeLandmark : null; });
  check((await placing()) === 'medialMalleolus' && (await page.isVisible('[data-testid=fw-ankle-placing]')) && (await page.isVisible('[data-testid=ankle-banner]')) && /medial malleolus/.test(await page.evaluate(() => window.__app.useStore.getState().notice ?? '')),
    'choosing Footwear asks for the medial malleolus (placing mode, message)');
  await page.click('.toolbar button:text-is("Medial")');
  await page.waitForTimeout(500);
  const cv = await (await page.$('canvas')).boundingBox();
  await page.mouse.click(cv.x + cv.width / 2, cv.y + cv.height / 2);
  await page.waitForTimeout(300);
  check((await placing()) === 'lateralMalleolus' && /lateral malleolus/.test(await page.evaluate(() => window.__app.useStore.getState().notice ?? '')), 'after MM it asks for the lateral malleolus');
  await page.click('.toolbar button:text-is("Lateral")');
  await page.waitForTimeout(500);
  await page.mouse.click(cv.x + cv.width / 2, cv.y + cv.height / 2);
  await page.waitForTimeout(300);
  const ank = await page.evaluate(() => Object.keys(window.__app.useStore.getState().doc.landmarks));
  check(ank.includes('medialMalleolus') && ank.includes('lateralMalleolus') && (await placing()) === null && (await page.locator('[data-testid=fw-place-ankle]').count()) === 0,
    'both malleoli placed by clicking the scan; placing stops');
  // (the synthetic foot has no ankle: remove them again for the rest of the test)
  await page.evaluate(() => { window.__app.landmarks.deleteLandmark('medialMalleolus'); window.__app.landmarks.deleteLandmark('lateralMalleolus'); });
  check(await page.isVisible('[data-testid=fw-place-ankle]'), 'missing malleoli: "Place MM and LM now" button');
  await page.keyboard.press('Escape');
  await page.check('[data-testid=fw-kind-chappal]');
  await page.click('[data-testid=create-footwear] + span');
  await page.waitForFunction(() => window.__app.useStore.getState().footwear, null, { timeout: 90000 });
  await settle();
  let s = await state();
  check(s.kind === 'chappal' && s.p.chappalStyle === 'slide' && s.struts > 2000, `slide chappal created (${s.struts} struts)`);
  check(rulesOk(s), `design rules met: ${s.rules?.map((r) => `${r.rule} = ${r.value}`).join('; ')}`);
  check(s.strut.min === 1.5 && s.clearance.min >= 1 && s.clearance.max <= 2.05, `measured strut ${s.strut.min} mm, clearance ${s.clearance.min.toFixed(2)}–${s.clearance.max.toFixed(2)} mm`);
  check(await page.isVisible('[data-testid=footwear-rules]'), 'rule check shown in the panel');
  check((await page.evaluate(() => window.__app.useStore.getState().view.scanDisplay)) === 'transparent', 'foot becomes transparent');

  // Sliders cannot leave the design-rule ranges
  await page.focus('[data-testid=fw-strut]');
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  await settle();
  s = await state();
  check(s.p.strutDiameter === 1.8 && s.strut.max === 1.8 && rulesOk(s), `strut slider stops at 1.8 mm (${s.p.strutDiameter})`);
  await page.focus('[data-testid=fw-clearance]');
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowLeft');
  await settle();
  s = await state();
  check(s.p.clearance === 1 && rulesOk(s), `clearance slider stops at 1 mm (measured ${s.clearance.min.toFixed(2)}–${s.clearance.max.toFixed(2)})`);

  // Chappal styles
  for (const style of ['thong', 'splitToe']) {
    await page.selectOption('select:has(option[value=splitToe])', style);
    await settle();
    s = await state();
    check(s.p.chappalStyle === style && !s.err && s.rules.every((r) => r.ok), `${style}: generated, rules met${s.warnings.length ? ` (note: ${s.warnings[0].slice(0, 50)}…)` : ''}`);
  }

  // Footwear asks for the malleoli (the shoe collar is kept below them)
  await page.click('[data-testid=tab-landmarks]');
  check((await page.locator('[data-testid=lm-medialMalleolus]').count()) === 1 && (await page.locator('[data-testid=lm-lateralMalleolus]').count()) === 1 && (await page.isVisible('[data-testid=ankle-landmarks-hint]')),
    'footwear: the landmark list asks for the medial and lateral malleolus');
  await page.click('[data-testid=tab-insole]');

  // Reference designs (presets modelled on the team's reference STLs)
  await page.selectOption('[data-testid=fw-design]', 'latticeSlide');
  await settle();
  s = await state();
  check(s.p.design === 'latticeSlide' && s.p.chappalStyle === 'slide' && s.p.strapPattern === 'lattice' && rulesOk(s), `reference design "Lattice-vamp slide": lattice strap panel, rules met (${s.struts} struts)`);
  await page.selectOption('[data-testid=fw-design]', 'splitToeThong');
  await settle();
  s = await state();
  check(s.p.chappalStyle === 'splitToe' && rulesOk(s), 'reference design "Split-toe lattice thong", rules met');

  // Shoe
  await page.check('[data-testid=fw-kind-shoe]');
  await settle();
  s = await state();
  check(s.kind === 'shoe' && s.p.shoe.finish === 'solid' && s.struts === 0 && rulesOk(s), `shoe: designed as one smooth solid first, rules met (footbed ${s.clearance.min.toFixed(2)}–${s.clearance.max.toFixed(2)} mm)`);
  check((await page.locator('[data-testid=fw-lattice-settings]').count()) === 0, 'solid shoe: no lattice questions yet');
  await page.click('[data-testid=fw-to-lattice] + span');
  await settle();
  s = await state();
  check(await page.isVisible('[data-testid=fw-lattice-settings]') && await page.isVisible('[data-testid=fw-convert-summary]'), 'convert to lattice: the lattice settings and what the conversion does are shown');
  const doubleStruts = s.struts;
  await page.selectOption('[data-testid=fw-skins]', 'single');
  await settle();
  const single = await state();
  check(single.p.shoe.skins === 'single' && single.struts < doubleStruts && rulesOk(single), `single-skin lattice: fewer struts (${single.struts} vs ${doubleStruts}), rules met`);
  await page.keyboard.press('Control+z');
  await settle();
  s = await state();
  check(s.p.shoe.finish === 'lattice' && s.struts > 3000 && s.upperGap?.min >= 0.97 && rulesOk(s), `shoe: lattice finish at the end (${s.struts} struts, upper ${s.upperGap?.min.toFixed(1)}–${s.upperGap?.max.toFixed(1)} mm from the foot), rules met`);
  await page.keyboard.press('Control+z');
  await settle();
  check(await page.isVisible('[data-testid=fw-malleoli-missing]'), 'shoe: prompts for the malleolus landmarks');
  await page.selectOption('[data-testid=fw-design]', 'knitSlipOn');
  await settle();
  s = await state();
  check(s.kind === 'shoe' && s.p.upperPattern === 'diamond' && rulesOk(s), `reference design "Knit slip-on": diamond lattice upper, rules met (${s.struts} struts)`);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await settle();
  s = await state();
  check(s.kind === 'chappal', 'undo returns to the chappal');

  // Insole category still works independently
  await page.check('[data-testid=type-full]');
  check((await page.locator('[data-testid=create-insole]').count()) === 1 && (await page.locator('[data-testid=create-footwear]').count()) === 0, 'insole category shows the insole designer');
  await page.check('[data-testid=type-footwear]');

  // Downloads: overlapping parts (fast) and merged watertight solid (coarser lattice to keep the test quick)
  let dl = page.waitForEvent('download');
  await page.click('[data-testid=download-footwear]');
  let d = await dl;
  check(/-chappal-splitToe-UK[\d.]+\.stl$/.test(d.suggestedFilename()), `download ${d.suggestedFilename()}`);
  await page.selectOption('select:has(option[value=splitToe])', 'slide');
  await page.evaluate(() => {
    const st = window.__app.useStore.getState();
    window.__app.useStore.setState({ doc: { ...st.doc, footwear: { ...st.doc.footwear, cellSize: 10 } } });
  });
  await settle();
  await page.click('[data-testid=fw-merge] + span');
  dl = page.waitForEvent('download', { timeout: 240000 });
  await page.click('[data-testid=download-footwear]');
  d = await dl;
  const bytes = await readFile(await d.path());
  const tris = bytes.readUInt32LE(80);
  check(/-merged\.stl$/.test(d.suggestedFilename()) && bytes.length === 84 + 50 * tris && tris > 10000, `merged download ${d.suggestedFilename()} (${tris} triangles)`);
  // Sole-only (plantar) scan: straps and the upper are built on an estimated top of the foot
  await page.goto('http://localhost:5199/');
  await page.waitForFunction(() => window.__app?.landmarks);
  await page.selectOption('select', 'foot-plantar.stl');
  await page.click('[data-testid=scan-setup-ok]');
  for (const [id, p] of [['heelCentre', [4, 38, 0.2]], ['met1Head', [-26, 182, 0.3]], ['met5Head', [44, 165, 0.3]], ['archEnd', [-22, 150, 1]]]) {
    await page.evaluate(([id, p]) => window.__app.landmarks.placeLandmark(id, p), [id, p]);
  }
  await page.click('[data-testid=tab-insole]');
  await page.check('[data-testid=type-footwear]');
  await page.check('[data-testid=fw-kind-chappal]');
  await page.click('[data-testid=create-footwear] + span');
  await page.waitForFunction(() => window.__app.useStore.getState().footwear, null, { timeout: 90000 });
  await settle();
  s = await state();
  check(s.warnings.some((w) => /estimated foot shape/.test(w)) && rulesOk(s), 'plantar scan: slide strap built on the estimated top of the foot, rules met');
  await page.selectOption('select:has(option[value=splitToe])', 'thong');
  await settle();
  s = await state();
  check(s.p.chappalStyle === 'thong' && rulesOk(s), 'plantar scan: thong wings (down to the sole at the arch end), rules met');
  await page.check('[data-testid=fw-kind-shoe]');
  await settle();
  s = await state();
  check(s.kind === 'shoe' && s.struts === 0 && rulesOk(s), `plantar scan: enclosed solid shoe ( clearance ${s.clearance.min.toFixed(2)}–${s.clearance.max.toFixed(2)} mm)`);
  check(errors.length === 0, `no page errors ${errors.join('; ')}`);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `${failures} footwear check(s) failed` : 'footwear designer test passed');
process.exit(failures ? 1 : 0);
