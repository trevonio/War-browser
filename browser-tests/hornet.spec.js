import { expect, test } from '@playwright/test';

const ready = { timeout: 45000 };
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('war-browser:settings', JSON.stringify({ preset: 'low' })));
});

async function chooseHornet(page) {
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'ready', ready);
  await page.getByRole('button', { name: /Choose aircraft/ }).click();
  await page.getByRole('button', { name: 'Fly F/A-18C', exact: true }).click(ready);
  await expect(page.locator('#briefing-aircraft')).toHaveText('F/A-18C', ready);
}

async function lock(page) {
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id), ready).toBe('viewport');
}

test('loads all three Hornet LODs, rotates the licensed model and persists a custom loadout', async ({ page }, info) => {
  const errors = [];
  const lods = new Set();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    const level = /\/lod([012])(?:-[^/?]+)?\.glb(?:\?|$)/.exec(response.url());
    if (response.ok() && level) lods.add(level[1]);
  });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'ready', ready);
  await page.getByRole('button', { name: /Choose aircraft/ }).click();
  await expect(page.locator('#aircraft-cards article h3')).toHaveText([
    'F-16C Fighting Falcon', 'F-15C Eagle', 'A-10C Thunderbolt II', 'F/A-18C Hornet',
  ]);
  await page.getByRole('button', { name: 'Preview F/A-18C Hornet' }).click();
  const preview = page.getByRole('img', { name: 'Rotatable preview of F/A-18C Hornet' });
  await expect(preview).toHaveAttribute('src', /^data:image/, ready);
  await expect(page.getByRole('link', { name: 'Model by HeriFajar' })).toBeVisible();
  const first = await preview.getAttribute('src');
  await page.getByRole('button', { name: 'Rotate preview right' }).click();
  await expect(preview).not.toHaveAttribute('src', first);
  await page.screenshot({ path: info.outputPath('hornet-hangar.png') });
  await page.getByRole('button', { name: 'Fly F/A-18C', exact: true }).click(ready);
  await page.getByRole('button', { name: 'Loadout', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'F/A-18C loadout' });
  await expect(editor.locator('#loadout-stations select')).toHaveCount(9);
  for (const name of ['Air Superiority', 'Dogfight', 'Precision Strike', 'Multirole', 'Clean']) {
    await expect(editor.locator('#loadout-preset option', { hasText: name })).toHaveCount(1);
  }
  await editor.getByRole('combobox', { name: 'Preset', exact: true }).selectOption('Precision Strike');
  await editor.getByRole('button', { name: 'Apply to aircraft' }).click();
  await page.reload();
  await expect(page.locator('#briefing-aircraft')).toHaveText('F/A-18C', ready);
  const active = await page.evaluate(() => JSON.parse(localStorage.getItem('war-browser:loadouts')).aircraft.fa18c.active);
  expect(active.HP_04).toBe('pod');
  expect(active.HP_07).toBe('optical');
  await page.getByRole('button', { name: 'Close Air Support' }).click();
  await expect(page.locator('#launch')).toBeEnabled();
  expect([...lods].sort()).toEqual(['0', '1', '2']);
  expect(errors).toEqual([]);
});

test('the Hornet targeting pod tracks and guides a live strike in dynamic CAS', async ({ page }, info) => {
  await page.setViewportSize({ width: 880, height: 550 });
  await page.goto('/');
  await chooseHornet(page);
  await page.getByRole('button', { name: 'Close Air Support' }).click();
  await page.getByLabel('CAS mission').selectOption('precision');
  await page.getByRole('button', { name: 'Loadout', exact: true }).click();
  await page.locator('#loadout-preset').selectOption('Precision Strike');
  await page.getByRole('button', { name: 'Apply to aircraft' }).click();
  await page.locator('#launch').click();
  await lock(page);
  await page.keyboard.press('c');
  await expect(page.locator('#pod-view')).toBeVisible();
  await page.keyboard.press('Equal');
  await expect(page.locator('#pod-zoom')).toHaveText('MEDIUM');
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
  await page.getByRole('region', { name: 'Targeting pod' }).getByRole('button', { name: 'Zoom out' }).click();
  await expect(page.locator('#pod-zoom')).toHaveText('WIDE');
  await page.getByRole('button', { name: 'Resume slew' }).click();
  await lock(page);
  await page.keyboard.press('0');
  await expect(page.locator('#pod-mode')).toHaveText('WHITE HOT');
  await page.keyboard.press('m');
  const map = page.getByRole('dialog', { name: 'Tactical map' });
  await map.locator('#cas-map-objective').click();
  await map.getByRole('button', { name: 'Return to flight' }).click();
  await lock(page);
  await expect(page.locator('#pod-track')).toHaveText('AREA TRACK');
  await expect(page.locator('#pod-target')).toContainText('HOSTILE', ready);
  await page.keyboard.press('r');
  await expect(page.locator('#pod-track')).toHaveText('POINT TRACK');
  await page.keyboard.press('o');
  await expect(page.locator('#pod-designation')).toHaveText(/^FIX /);
  for (let i = 0; i < 3; i++) {
    if ((await page.locator('#cannon-label').textContent()).includes('OPTICAL')) break;
    await page.keyboard.press('q');
  }
  await expect(page.locator('#strike-readiness')).toHaveText('CLEARED');
  await page.screenshot({ path: info.outputPath('hornet-cas-pod.png') });
  await page.keyboard.press('Space');
  await expect(page.locator('#cannon-ammo')).toHaveText('0');
  await expect(page.locator('#battle-objective')).toContainText('1 / 2 TARGETS DISABLED', ready);
});

test('completes Hornet qualification through takeoff, radar interception and two real strike impacts', async ({ page }, info) => {
  test.setTimeout(195000);
  await page.goto('http://127.0.0.1:4174/');
  await page.evaluate(async () => {
    const { setUpQualification } = await import('/browser-tests/hornet-pilot.js');
    window.hornetRun = setUpQualification();
  });
  await chooseHornet(page);
  await page.getByRole('button', { name: 'F/A-18C Multirole Qualification', exact: true }).click();
  await expect(page.locator('#start-detail')).toContainText('MULTIROLE MISSION LOADOUT');
  await page.locator('#launch').click();
  await page.setViewportSize({ width: 740, height: 480 });
  await lock(page);
  await expect(page.locator('#ground-range-caption')).toHaveText('PHASE A · AIR-TO-AIR');
  await expect.poll(() => page.evaluate(() => window.hornetRun.tookOff), { timeout: 85000 }).toBe(true);
  await page.keyboard.press('g');
  await expect(page.locator('#gear-state')).toHaveText('Up', ready);
  await page.evaluate(() => { window.hornetRun.input = 'missile'; });
  await expect(page.locator('#cannon-label')).toContainText('AMRAAM');
  await page.keyboard.press('r');
  await expect.poll(async () => {
    if (await page.locator('#cannon-state').textContent() === 'CLEARED') return true;
    await page.keyboard.press('Space');
    return false;
  }, { timeout: 20000, intervals: [850] }).toBe(true);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.hornetRun.combat.missilesLaunched)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.hornetRun.combat.missileHits), ready).toBe(1);
  if ((await page.locator('#ground-range-caption').textContent()).startsWith('PHASE A')) {
    await page.evaluate(() => { window.hornetRun.input = 'gun'; });
    await page.mouse.move(370, 240);
    await page.mouse.down();
    try {
      await expect(page.locator('#ground-range-caption')).toHaveText('PHASE B · AIR-TO-GROUND', ready);
    } finally {
      await page.mouse.up();
    }
  }
  await expect(page.locator('#battle-objective')).toContainText('0 / 2 DISABLED');
  const ammo = Number(await page.locator('#cannon-count').textContent());
  await page.evaluate(() => { window.hornetRun.input = 'gps'; });
  await page.keyboard.press('q');
  await expect(page.locator('#cannon-label')).toContainText('COORDINATE');
  await page.keyboard.press('c');
  await expect(page.locator('#pod-target')).toContainText('HOSTILE', ready);
  await page.keyboard.press('r');
  await expect(page.locator('#pod-track')).toHaveText('POINT TRACK');
  await page.keyboard.press('o');
  await expect(page.locator('#pod-designation')).toHaveText(/^FIX /);
  await expect(page.locator('#strike-readiness')).toHaveText('CLEARED');
  await page.keyboard.press('Space');
  await expect(page.locator('#battle-objective')).toContainText('1 / 2 DISABLED', ready);
  await page.keyboard.press('c');

  await page.evaluate(() => { window.hornetRun.input = 'bomb'; });
  for (let i = 0; i < 4; i++) {
    if (await page.locator('#cannon-label').textContent() === 'RANGE BOMB') break;
    await page.keyboard.press('q');
  }
  await expect(page.locator('#cannon-label')).toHaveText('RANGE BOMB');
  await expect.poll(async () => Number(await page.locator('#cannon-count').textContent())).toBeLessThanOrEqual(ammo);
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: 'F/A-18C Multirole Qualification complete' })).toBeVisible(ready);
  await expect(page.locator('#result-enemies')).toHaveText('1 / 1');
  await expect(page.locator('#result-missiles')).toHaveText('1 launched · 1 hits');
  await expect(page.locator('#result-targets')).toHaveText('2 damaged · 2 / 2 disabled');
  await expect(page.locator('#result-precision')).toContainText('1 released');
  await expect(page.locator('#result-bombs')).toHaveText('1');
  await expect(page.locator('#result-friendly-fire')).toHaveText('0 damaging hits');
  const releases = await page.evaluate(() => window.hornetRun.releases);
  expect(releases.map(({ kind, station }) => [kind, station])).toEqual([['gps', 'HP_07'], ['bomb', 'HP_08']]);
  expect(releases.every(({ error }) => error < 1e-8)).toBe(true);
  await page.screenshot({ path: info.outputPath('hornet-qualification.png') });
});
