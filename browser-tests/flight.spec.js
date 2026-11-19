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

test('records medium and low frame pacing under software WebGL', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Start flight/ })).toBeVisible();
  await page.getByRole('button', { name: /Start flight/ }).click();
  await page.locator('#airspeed').waitFor();

  async function measure(preset) {
    const timing = await page.evaluate(() => new Promise((resolve) => {
      const samples = [];
      const start = performance.now();
      let previous;
      let handle;
      function collect(time) {
        if (previous !== undefined) samples.push(time - previous);
        previous = time;
        handle = requestAnimationFrame(collect);
      }
      handle = requestAnimationFrame(collect);
      setTimeout(() => {
        cancelAnimationFrame(handle);
        const duration = performance.now() - start;
        const canvas = document.querySelector('#viewport canvas');
        samples.sort((a, b) => a - b);
        resolve({
          frames: samples.length,
          medianMs: samples[Math.floor(samples.length * 0.5)]?.toFixed(1),
          p95Ms: samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)]?.toFixed(1),
          fps: Number((samples.length * 1000 / duration).toFixed(1)),
          viewport: innerWidth + '×' + innerHeight,
          render: canvas.width + '×' + canvas.height,
        });
      }, 4500);
    }));
    console.log('Chromium software WebGL ' + preset, JSON.stringify(timing));
    expect(timing.frames).toBeGreaterThan(0);
  }

  await measure('medium');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Quality preset').selectOption('low');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('#viewport canvas')).toHaveAttribute('width', '1024');
  await measure('low');
});
