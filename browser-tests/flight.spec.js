import { expect, test } from '@playwright/test';

test('the production build flies, operates aircraft systems, and restarts', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Fighting\s+Falcon/ })).toBeVisible();
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('briefing.png') });

  await page.getByRole('button', { name: /Start flight/ }).click();
  await expect(page.locator('#airspeed')).toHaveText(/^3\d{2}$/);
  await page.mouse.move(950, 335);
  await expect.poll(async () => Number(await page.locator('#heading').innerText())).toBeGreaterThan(2);
  await page.mouse.move(640, 360);

  const altitude = async () => Number((await page.locator('#altitude').innerText()).replaceAll(',', ''));
  const initialAltitude = await altitude();
  await page.keyboard.down('w');
  await expect.poll(altitude).toBeGreaterThan(initialAltitude + 20);
  await page.keyboard.up('w');

  await page.keyboard.down('Shift');
  await expect.poll(async () => Number(await page.locator('#throttle').innerText())).toBeGreaterThan(58);
  await page.keyboard.up('Shift');

  await page.keyboard.press('b');
  await expect(page.locator('#engine-state')).toHaveText('AFTERBURNER');
  await page.keyboard.press('g');
  await expect(page.locator('#gear-state')).toHaveText('Down');
  await page.keyboard.press('h');
  await expect(page.locator('#stores-state')).toHaveText('Off');
  await page.screenshot({ path: testInfo.outputPath('aircraft-systems.png') });

  await page.keyboard.press('b');
  await expect(page.locator('#burner-state')).toHaveText('Off');
  await page.keyboard.press('g');
  await expect(page.locator('#gear-state')).toHaveText('Up');
  await page.keyboard.press('h');
  await expect(page.locator('#stores-state')).toHaveText('On');
  await page.keyboard.press('x');
  await expect(page.locator('#brake-state')).toHaveText('On');

  await page.keyboard.press('v');
  await expect(page.locator('#camera-name')).toHaveText('HUD camera');
  await page.keyboard.press('v');
  await expect(page.locator('#camera-name')).toHaveText('Chase camera');

  const timing = await page.evaluate(async () => {
    const changes = [];
    let previous = await new Promise(requestAnimationFrame);
    for (let i = 0; i < 24; i++) {
      const time = await new Promise(requestAnimationFrame);
      changes.push(time - previous);
      previous = time;
    }
    const average = changes.reduce((sum, frame) => sum + frame, 0) / changes.length;
    return { averageMs: Number(average.toFixed(1)), fps: Number((1000 / average).toFixed(1)),
      p95Ms: changes.sort((a, b) => a - b)[22], width: innerWidth, height: innerHeight };
  });
  console.log('Headless Chromium frame timing (software WebGL)', JSON.stringify(timing));

  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await page.keyboard.press('r');
  await expect(page.locator('#heading')).toHaveText('000');
  await expect(page.locator('#elapsed')).toHaveText('00:00');

  await page.setViewportSize({ width: 500, height: 760 });
  await expect(page.getByRole('button', { name: 'Settings' })).toBeInViewport();
  await expect(page.getByRole('button', { name: /Pause/ })).toBeInViewport();
  await expect(page.locator('#altitude')).toBeInViewport();
  await expect(page.locator('#viewport canvas')).toHaveAttribute('width', '500');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Quality preset').selectOption('low');
  await page.getByLabel('Control mode').selectOption('direct');
  await page.getByRole('button', { name: /External stores/ }).click();
  await page.keyboard.press('j');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('#viewport canvas')).toHaveAttribute('width', '400');
  await expect(page.locator('#aim-cursor')).toBeHidden();
  await page.keyboard.press('j');
  await expect(page.locator('#stores-state')).toHaveText('Off');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to briefing' }).click();
  await page.getByRole('button', { name: 'Runway 36' }).click();
  await page.getByRole('button', { name: /Start flight/ }).click();
  await expect(page.locator('#airspeed')).toHaveText('0');
  await expect(page.locator('#gear-state')).toHaveText('Down');
  await expect(page.locator('#toggle-gear')).toBeDisabled();
  expect(errors).toEqual([]);
});
