import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('./dist', import.meta.url));
const origin = 'http://war-browser-aircraft.test';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const browser = await chromium.launch({
  executablePath: process.env.AIRCRAFT_VIEWER_CHROMIUM || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1260, height: 820 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep)) return route.abort();
    try {
      await route.fulfill({ contentType: types[extname(path)] ?? 'application/octet-stream', body: await readFile(path) });
    } catch {
      await route.fulfill({ status: 404, body: 'File not found' });
    }
  });
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('#canvas').dataset.lod === '0');
  const manifest = JSON.parse(await readFile(resolve(root, 'fa-18-hornet/manifest.json'), 'utf8'));
  assert.equal(await page.locator('#model-title').innerText(), manifest.title);
  assert.match(await page.locator('#attribution').innerText(), /HeriFajar.*CC-BY-4.0/);
  assert.equal(await page.locator('#controls input').count(), 5);
  assert.equal(await page.locator('#view-status').textContent(), '');

  const screenshots = process.env.AIRCRAFT_VIEWER_SCREENSHOTS;
  if (screenshots) await page.screenshot({ path: resolve(screenshots, 'orbit.png') });
  const canvas = page.locator('canvas');
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  await page.locator('[data-control="roll"]').fill('100');
  await page.locator('[data-control="pitch"]').fill('100');
  await page.locator('[data-control="yaw"]').fill('-100');
  await page.locator('[data-control="flaps"]').fill('100');
  await page.locator('[data-control="leadingEdge"]').fill('100');
  const deflected = await canvas.screenshot();
  if (screenshots) await page.screenshot({ path: resolve(screenshots, 'deflected.png') });
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  assert.notDeepEqual(await canvas.screenshot(), deflected, 'control motion must change rendered geometry');

  await page.getByRole('button', { name: 'Underside' }).click();
  const extended = await canvas.screenshot();
  if (screenshots) await page.screenshot({ path: resolve(screenshots, 'gear-down.png') });
  await page.getByRole('button', { name: 'Retract landing gear' }).click();
  await page.waitForFunction(() => document.querySelector('#canvas').dataset.gear === '1.000', undefined, { timeout: 30000 });
  assert.notDeepEqual(await canvas.screenshot(), extended, 'gear must visibly move');
  if (screenshots) await page.screenshot({ path: resolve(screenshots, 'gear-up.png') });
  await page.getByRole('button', { name: 'Deploy landing gear' }).click();
  await page.waitForFunction(() => document.querySelector('#canvas').dataset.gear === '0.000');

  await page.getByRole('button', { name: 'Orbit', exact: true }).click();
  for (const [index, level] of manifest.levels.entries()) {
    await page.getByRole('button', { name: `LOD ${index}`, exact: true }).click();
    await page.waitForFunction((i) => document.querySelector('#canvas').dataset.lod === i, String(index));
    assert.equal(Number((await page.locator('#triangle-count').innerText()).replace(/[^\d]/g, '')), level.triangles);
    console.log(`LOD ${index}: ${await page.locator('#triangle-count').innerText()} triangles, ${await page.locator('#draw-count').innerText()} draw calls, ${await page.locator('#fps').innerText()} FPS, ${await page.locator('#render-time').innerText()}`);
  }
  await page.getByRole('button', { name: 'Auto', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#canvas').dataset.lod === '0');
  for (let i = 0; i < 9; i++) await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#canvas').dataset.lod === '2');
  await page.getByRole('button', { name: 'Orbit', exact: true }).click();
  await page.getByLabel('Attachment points').check();
  assert.match(await page.locator('#anchor-info').innerText(), /9 stores.*1 muzzle.*2 exhausts/);
  await page.getByLabel('Attachment points').uncheck();
  await page.getByLabel('Wireframe').check();
  await page.getByLabel('Wireframe').uncheck();
  const files = ['manifest.json', ...manifest.levels.map(({ file }) => file)].map((file) => resolve(root, 'fa-18-hornet', file));
  await page.locator('#package-files').setInputFiles(files);
  await page.waitForFunction(() => !document.querySelector('#view-status').textContent && !document.querySelector('#model-files a'));
  assert.deepEqual(errors, []);
  console.log('Three.js viewer verified: GLBs, rig controls, landing gear, manual and distance LODs, overlays, and local package loading.');
} finally {
  await browser.close();
}
