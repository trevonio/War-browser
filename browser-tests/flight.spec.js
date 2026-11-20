import { expect, test } from '@playwright/test';

const flightPanel = (page) => page.locator('#flight-hud');
const locked = (page) => page.evaluate(() => document.pointerLockElement?.id ?? null);

async function startFlight(page) {
  await page.getByRole('button', { name: /Start flight/ }).click();
  await expect.poll(() => locked(page)).toBe('viewport');
  await expect(flightPanel(page)).toBeVisible();
}

async function resumeFlight(page) {
  await page.getByRole('button', { name: /Resume flight/ }).click();
  await expect.poll(() => locked(page)).toBe('viewport');
  await expect(flightPanel(page)).toBeVisible();
}

async function pauseFlight(page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await expect.poll(() => locked(page)).toBeNull();
}

async function relativeMouse(page, dx, dy, steps = 20) {
  await page.evaluate(({ dx, dy, steps }) => {
    for (let i = 0; i < steps; i++) {
      document.pointerLockElement.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, movementX: dx / steps, movementY: dy / steps,
      }));
    }
  }, { dx, dy, steps });
}

function aimState(page) {
  return page.locator('#aim-cursor').evaluate((marker) => {
    const { x, y, width, height } = marker.getBoundingClientRect();
    return {
      x: (x + width / 2) / innerWidth,
      y: (y + height / 2) / innerHeight,
      heading: Number(document.querySelector('#heading').textContent),
      load: Number(document.querySelector('#g-force').textContent),
    };
  });
}

test('the production build flies, operates aircraft systems, and restarts', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.location().url + ' ' + message.text());
  });

  await page.goto('/');
  // The first context in a software WebGL runner can take longer to start.
  await expect(page.locator('body')).toHaveAttribute('data-screen', /^(ready|unavailable)$/, { timeout: 20000 });
  await expect(page.getByRole('heading', { name: /Fighting\s+Falcon/ }), errors.join('\n')).toBeVisible();
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('briefing.png') });

  await startFlight(page);
  await expect(page.locator('#airspeed')).toHaveText(/^3\d{2}$/);

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

  await pauseFlight(page);
  await page.getByRole('button', { name: /Restart flight/ }).click();
  await expect.poll(() => locked(page)).toBe('viewport');
  await expect(page.locator('#heading')).toHaveText('000');
  await expect(page.locator('#elapsed')).toHaveText(/^00:0[0-4]$/);

  await page.setViewportSize({ width: 500, height: 760 });
  await expect(page.getByRole('button', { name: 'Settings' })).toBeInViewport();
  await expect(page.getByRole('button', { name: /Pause/ })).toBeInViewport();
  await expect(page.locator('#altitude')).toBeInViewport();
  await expect(page.locator('#viewport canvas')).toHaveAttribute('width', '500');

  await pauseFlight(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Quality preset').selectOption('low');
  await page.getByLabel('Control mode').selectOption('direct');
  await page.getByRole('button', { name: /External stores/ }).click();
  await page.keyboard.press('j');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await resumeFlight(page);
  await expect(page.locator('#viewport canvas')).toHaveAttribute('width', '400');
  await expect(page.locator('#aim-cursor')).toBeHidden();
  await page.keyboard.press('j');
  await expect(page.locator('#stores-state')).toHaveText('Off');

  await pauseFlight(page);
  await page.getByRole('button', { name: 'Back to briefing' }).click();
  await page.getByRole('button', { name: 'Runway 36' }).click();
  await startFlight(page);
  await expect.poll(async () => Number(await page.locator('#airspeed').innerText())).toBeLessThan(10);
  await expect(page.locator('#gear-state')).toHaveText('Down');
  await expect(page.locator('#toggle-gear')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('records medium and low frame pacing under software WebGL', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Compare against the existing Chromium benchmark.');
  await page.goto('/');
  await startFlight(page);
  await page.locator('#airspeed').waitFor();

  async function measure(preset, duration = 4500) {
    const timing = await page.evaluate((sampleDuration) => new Promise((resolve) => {
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
      }, sampleDuration);
    }), duration);
    console.log('Chromium software WebGL ' + preset, JSON.stringify(timing));
    expect(timing.frames).toBeGreaterThan(0);
  }

  await measure('medium idle');
  await page.mouse.down({ button: 'left' });
  await expect(page.locator('#cannon-state')).toHaveText('FIRING');
  await measure('medium firing', 2600);
  await page.mouse.up({ button: 'left' });
  await expect.poll(async () => Number(await page.locator('#cannon-ammo').innerText())).toBeLessThan(400);
  await pauseFlight(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Quality preset').selectOption('low');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await resumeFlight(page);
  await expect(page.locator('#viewport canvas')).toHaveAttribute('width', '1024');
  await measure('low idle');
});

test('captures relative input, pauses on Escape or lost focus, and recaptures', async ({ page, context }) => {
  await page.goto('/');
  await startFlight(page);
  const reticle = page.locator('#aim-cursor');
  const heading = () => page.locator('#heading').innerText();
  await expect(reticle).toHaveAttribute('style', /translate/);
  const initial = await reticle.getAttribute('style');
  await page.mouse.move(900, 370, { steps: 5 });
  await expect(reticle).not.toHaveAttribute('style', initial);
  await expect.poll(async () => {
    const value = Number(await heading());
    return Math.min(value, 360 - value);
  }, { timeout: 12000 }).toBeGreaterThan(1);
  await expect.poll(() => locked(page)).toBe('viewport');

  // Keep steering through multiple revolutions with native capture active.
  await relativeMouse(page, 10500, -280);
  await expect.poll(async () => {
    const aim = await aimState(page);
    return aim.x >= 0.26 && aim.x <= 0.74 && aim.y >= 0.27 && aim.y <= 0.73;
  }).toBe(true);
  await expect.poll(() => locked(page)).toBe('viewport');
  await pauseFlight(page);
  await resumeFlight(page);

  await page.keyboard.down('Shift');
  const other = await context.newPage();
  await other.bringToFront();
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await expect.poll(() => locked(page)).toBeNull();
  await other.close();
  await page.bringToFront();
  const throttle = await page.locator('#throttle').innerText();
  await resumeFlight(page);
  await expect.poll(async () => page.locator('#throttle').innerText()).toBe(throttle);
  await page.keyboard.up('Shift');

  await pauseFlight(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const sensitivity = page.getByLabel('Mouse sensitivity');
  await sensitivity.fill('2.2');
  await page.getByLabel('Mouse aim responsiveness').fill('1.5');
  await page.getByLabel('Chase camera smoothing').fill('1.3');
  await page.getByLabel('Mouse camera response').fill('1.2');
  await expect(page.locator('#camera-turn-value')).toHaveText('1.2');
  await expect(page.locator('#mouse-value')).toHaveText('2.2');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await resumeFlight(page);
  await expect(reticle).toBeVisible();


  await pauseFlight(page);
});

test('shows a recovery option when capture is denied', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLElement.prototype.requestPointerLock = () => Promise.reject(new DOMException('Denied', 'SecurityError'));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Start flight/ }).click();
  await expect(page.locator('#pause-description')).toContainText('not allowed to capture the mouse');
  await page.getByRole('button', { name: 'Fly with keyboard' }).click();
  await expect(flightPanel(page)).toBeVisible();
  await expect.poll(() => locked(page)).toBeNull();
  await expect(page.locator('#aim-cursor')).toBeHidden();
  await page.keyboard.press('b');
  await expect(page.locator('#engine-state')).toHaveText('AFTERBURNER');
  await pauseFlight(page);
});

test('mouse-only turns lead the aircraft with the view and sustain positive G', async ({ page }, testInfo) => {
  await page.goto('/');
  await startFlight(page);
  await expect(page.locator('#aim-cursor')).toHaveAttribute('style', /translate/);

  await relativeMouse(page, 1260, 0);
  await expect.poll(async () => {
    const { heading, x } = await aimState(page);
    return heading > 2 && heading < 55 && Math.abs(x - 0.5) < 0.13;
  }, { timeout: 12000 }).toBe(true);
  await expect.poll(async () => (await aimState(page)).load, { timeout: 12000 }).toBeGreaterThan(5);
  await page.screenshot({ path: testInfo.outputPath('mouse-turn.png') });
  await expect.poll(async () => (await aimState(page)).heading, { timeout: 18000 }).toBeGreaterThan(82);

  await relativeMouse(page, 2510, 0);
  await expect.poll(async () => {
    const { heading } = await aimState(page);
    return heading >= 259 && heading <= 281;
  }, { timeout: 27500 }).toBe(true);

  await pauseFlight(page);
  await page.getByRole('button', { name: /Restart flight/ }).click();
  await expect.poll(() => locked(page)).toBe('viewport');
  await relativeMouse(page, 360, 670);
  await expect.poll(async () => {
    const verticalSpeed = Number(await page.locator('#vertical-speed').innerText());
    const { heading } = await aimState(page);
    return verticalSpeed < -5000 && heading > 8 && heading < 35;
  }, { timeout: 14000 }).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mouse-dive.png') });
  await pauseFlight(page);
});

test('cannon range fires under Pointer Lock, hits a drone, exhausts ammunition, and restarts', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.location().url + ' ' + message.text());
  });
  await page.addInitScript(() => {
    window.gunAudio = { starts: 0, stops: 0 };
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      return resume.call(this).then(() => {
        window.gunAudio.context = this.state;
      }, (error) => {
        window.gunAudio.context = error.name + ' ' + error.message;
        throw error;
      });
    };
    const prototype = AudioBufferSourceNode.prototype;
    const start = prototype.start;
    const stop = prototype.stop;
    prototype.start = function (...args) {
      if (this.loop) window.gunAudio.starts++;
      return start.apply(this, args);
    };
    prototype.stop = function (...args) {
      if (this.loop) window.gunAudio.stops++;
      return stop.apply(this, args);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Cannon range' }).click();
  await startFlight(page);
  await expect(page.locator('#cannon-ammo')).toHaveText('510');
  await expect(page.locator('#targets-remaining')).toHaveText('3');
  await expect(page.locator('#boresight')).toHaveAttribute('title', 'Fixed cannon sight');
  await expect.poll(() => page.evaluate(() => window.gunAudio.starts)).toBe(0);

  await page.mouse.down({ button: 'left' });
  await expect(page.locator('#cannon-state')).toHaveText('FIRING');
  await expect.poll(async () => Number(await page.locator('#cannon-ammo').innerText())).toBeLessThan(505);
  await page.screenshot({ path: testInfo.outputPath('cannon-firing.png') });
  await expect(page.locator('#targets-remaining')).toHaveText('2', { timeout: 10000 });
  await expect.poll(() => page.evaluate(() => window.gunAudio)).toMatchObject({ starts: 1 });
  await page.mouse.up({ button: 'left' });
  await expect(page.locator('#cannon-state')).toHaveText('READY');
  await expect.poll(() => page.evaluate(() => window.gunAudio.stops)).toBe(1);
  // Allow the fixed steps covering pre-release input to finish before
  // checking that later steps do not consume ammunition.
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const remaining = await page.locator('#cannon-ammo').innerText();
  const elapsed = await page.locator('#elapsed').innerText();
  await expect(page.locator('#elapsed')).not.toHaveText(elapsed);
  await expect(page.locator('#cannon-ammo')).toHaveText(remaining);

  // Change aim during a sustained burst so steering and the trigger share the
  // real viewport input path while the jet banks.
  await page.mouse.down({ button: 'left' });
  await relativeMouse(page, 950, 0);
  await expect.poll(async () => (await aimState(page)).load, { timeout: 10000 }).toBeGreaterThan(4);
  await expect.poll(() => locked(page)).toBe('viewport');
  await expect(page.locator('#cannon-ammo')).toHaveText('0', { timeout: 18000 });
  await expect(page.locator('#cannon-state')).toHaveText('AMMO EMPTY');
  await expect.poll(() => page.evaluate(() => window.gunAudio.stops)).toBe(2);
  await page.mouse.up({ button: 'left' });
  await pauseFlight(page);
  await page.getByRole('button', { name: /Restart flight/ }).click();
  await expect.poll(() => locked(page)).toBe('viewport');
  await expect(page.locator('#targets-remaining')).toHaveText('3');
  await expect(page.locator('#cannon-ammo')).toHaveText('510');
  await page.mouse.down({ button: 'left' });
  await expect(page.locator('#cannon-state')).toHaveText('FIRING');
  await pauseFlight(page);
  await page.mouse.up({ button: 'left' });
  const pausedAmmo = await page.locator('#cannon-ammo').textContent();
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await page.mouse.click(1050, 420, { button: 'left' });
  await expect.poll(() => locked(page)).toBe('viewport');
  await expect(page.locator('#cannon-state')).toHaveText('READY');
  await expect(page.locator('#cannon-ammo')).toHaveText(pausedAmmo);
  await page.mouse.click(640, 360, { button: 'left' });
  await expect.poll(async () => Number(await page.locator('#cannon-ammo').innerText())).toBeLessThan(Number(pausedAmmo));
  expect(errors).toEqual([]);
});

test('dogfight briefing selects opponents, scores a cannon win, and restarts', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const opponent = page.getByLabel('AI opponent');
  await expect(opponent).toBeHidden();
  await page.getByRole('button', { name: 'Dogfight' }).click();
  await expect(opponent).toHaveValue('aggressive');

  await opponent.selectOption('passive');
  await expect(page.locator('#start-detail')).toContainText('Holds fire');
  await startFlight(page);
  await expect(page.locator('#opponent-marker')).toBeVisible();
  await expect(page.locator('#opponent-status')).toHaveText('PATROL');
  await page.keyboard.press('c');
  await page.keyboard.press('m');
  await expect(page.locator('#sight-mode')).toHaveText('VISUAL LEAD');
  await expect(page.locator('#sight-state')).toHaveText(/^VALID/, { timeout: 8000 });
  await page.mouse.down({ button: 'left' });
  await expect(page.getByRole('heading', { name: 'Dogfight won' })).toBeVisible({ timeout: 12000 });
  await page.mouse.up({ button: 'left' });
  await expect.poll(() => locked(page)).toBeNull();
  await expect(page.getByRole('button', { name: /Resume flight/ })).toBeHidden();

  await page.getByRole('button', { name: /Restart flight/ }).click();
  await expect.poll(() => locked(page)).toBe('viewport');
  await expect(page.locator('#opponent-integrity')).toHaveText('100');
  await expect(page.locator('#player-integrity')).toHaveText('100');
  await expect(page.locator('#cannon-ammo')).toHaveText('510');

  const backToBriefing = async () => {
    await pauseFlight(page);
    await page.getByRole('button', { name: 'Back to briefing' }).click();
  };
  await backToBriefing();
  await opponent.selectOption('defensive');
  await startFlight(page);
  await expect(page.locator('#opponent-status')).toHaveText('EVADING');

  await backToBriefing();
  await opponent.selectOption('aggressive');
  await startFlight(page);
  await expect(page.locator('#opponent-status')).toHaveText('INTERCEPT');
  await expect.poll(async () => Number(await page.locator('#opponent-distance').innerText())).toBeLessThan(1.75);
  expect(errors).toEqual([]);
});

test('gun computer displays training lead and a valid CCIP in a dive', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cannon range' }).click({ timeout: 20000 });
  await startFlight(page);
  const readout = page.locator('#sight-readout');
  const marker = page.locator('#sight-marker');
  const state = page.locator('#sight-state');
  await expect(readout).toBeHidden();
  await page.keyboard.press('c');
  await expect(state).toHaveText('NO IMPACT');
  await expect(marker).toBeHidden();
  await page.keyboard.press('m');
  await expect(page.locator('#sight-mode')).toHaveText('TRAINING LEAD');
  await expect(state).toHaveText(/^VALID · \d+ M$/);
  await expect(marker).toBeVisible();

  await page.keyboard.press('m');
  await relativeMouse(page, 0, 930);
  await expect(state).toHaveText(/^VALID · \d+ M$/, { timeout: 18000 });
  await expect(marker).toHaveAttribute('data-mode', 'impact');
  await page.keyboard.press('c');
  await expect(readout).toBeHidden();
  await expect(marker).toBeHidden();
});
