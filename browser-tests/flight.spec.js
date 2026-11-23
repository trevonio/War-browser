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

test('mouse pitch stays in the current roll hemisphere through vertical corrections', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 });
  await page.addInitScript(() => localStorage.setItem('war-browser:settings', JSON.stringify({ preset: 'low' })));
  await page.goto('http://127.0.0.1:4174/');
  // Read attitude from the same fixed steps driven by the real input handlers.
  await page.evaluate(async () => {
    const { Flight } = await import('/src/sim/flight.js');
    const step = Flight.prototype.step;
    const sample = window.flightSample = { elapsed: 0, travel: 0, minBankCosine: 1, releaseAt: Infinity };
    Flight.prototype.step = function (...args) {
      const before = this.elapsed;
      step.apply(this, args);
      if (before < sample.elapsed) {
        sample.travel = 0;
        sample.minBankCosine = 1;
      }
      const { x, y, z, w } = this.orientation;
      const forwardY = 2 * (y * z - w * x);
      sample.bankCosine = (1 - 2 * (x * x + z * z)) / Math.sqrt(Math.max(1e-8, 1 - forwardY ** 2));
      sample.minBankCosine = Math.min(sample.minBankCosine, sample.bankCosine);
      sample.verticalSpeed = this.velocity.y;
      sample.elapsed = this.elapsed;
      sample.travel += this.rates.z * (this.elapsed - before);
      if (sample.travel >= sample.releaseAt) {
        sample.releaseAt = Infinity;
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
      }
    };
  });
  const sample = () => page.evaluate(() => window.flightSample);
  await startFlight(page);

  await relativeMouse(page, 0, 620);
  await expect.poll(async () => (await sample()).verticalSpeed, { timeout: 9000 }).toBeLessThan(-26);
  expect(Math.abs((await aimState(page)).y - 0.5)).toBeLessThan(0.21);
  for (const [dx, dy] of [[16, -1160], [-29, 1160], [29, -1160]]) {
    await relativeMouse(page, dx, dy);
    await expect.poll(async () => (await sample()).verticalSpeed * -Math.sign(dy), { timeout: 10000 }).toBeGreaterThan(12);
  }
  expect((await sample()).minBankCosine).toBeGreaterThan(0.94);

  await page.keyboard.press('r');
  await expect.poll(async () => (await sample()).elapsed).toBeLessThan(2);
  await page.evaluate(() => { window.flightSample.releaseAt = 2.85; });
  await page.keyboard.down('d');
  await expect.poll(async () => (await sample()).bankCosine, { timeout: 8000 }).toBeLessThan(-0.95);
  await page.keyboard.up('d');
  await relativeMouse(page, 0, 490);
  await expect.poll(async () => (await sample()).verticalSpeed, { timeout: 9000 }).toBeLessThan(-25);
  expect((await sample()).bankCosine).toBeLessThan(-0.89);
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
  await page.getByRole('button', { name: 'Dogfight', exact: true }).click();
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
  await page.keyboard.press('c');
  await page.keyboard.press('m');
  await expect(state).toHaveText(/^VALID · \d+ M$/);
  await expect(page.locator('#sight-mode')).toHaveText('TRAINING LEAD');
  await expect(marker).toBeVisible();

  await page.keyboard.press('m');
  await expect(state).toHaveText('NO IMPACT');
  await expect(marker).toBeHidden();
  await relativeMouse(page, 0, 930);
  await expect(state).toHaveText(/^VALID · \d+ M$/, { timeout: 18000 });
  await expect(marker).toHaveAttribute('data-mode', 'impact');
  await page.keyboard.press('c');
  await expect(readout).toBeHidden();
  await expect(marker).toBeHidden();
});

test('BVR scope finds and locks an inbound contact and supports a radar missile', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('war-browser:settings', JSON.stringify({ preset: 'low' })));
  await page.goto('/');
  await page.getByRole('button', { name: 'BVR intercept' }).click({ timeout: 20000 });
  await page.getByLabel('Opponent difficulty').selectOption('rookie');
  await startFlight(page);
  const mode = page.locator('#radar-mode');
  const contacts = page.locator('#radar-contacts');
  const flightState = page.locator('#cannon-state');
  await expect(mode).toHaveText('OFF');
  await expect(flightState).toHaveText('STT REQUIRED');
  await page.keyboard.press('Space');
  await expect(page.locator('#cannon-ammo')).toHaveText('2');
  await page.keyboard.press('p');
  await expect(contacts).toHaveText('1 CONTACT');
  await page.keyboard.press('u');
  await expect(page.locator('#radar-range')).toHaveText('3.2');
  await expect(contacts).toHaveText('0 CONTACTS');
  await page.keyboard.press('u');
  await page.keyboard.press('u');
  await page.keyboard.press('y');
  await expect(mode).toHaveText('TWS');
  await expect(contacts).toHaveText('1 CONTACT');
  await page.keyboard.press('t');
  await page.keyboard.press('l');
  await expect(mode).toHaveText('STT');
  await expect(page.locator('#radar-track')).toHaveText(/^LOCK \d+\.\d KM$/);
  await expect(flightState).toHaveText('CLEARED');
  const instruments = await page.locator('.readout-right').boundingBox();
  const avionics = await page.locator('#combat-avionics').boundingBox();
  const deck = await page.locator('#flight-deck').boundingBox();
  expect(instruments.y + instruments.height).toBeLessThan(avionics.y);
  expect(avionics.y + avionics.height).toBeLessThan(deck.y);
  await page.keyboard.press('Space');
  await expect(page.locator('#cannon-ammo')).toHaveText('1');
  await expect(page.locator('#missile-telemetry')).toHaveText('MIDCOURSE · LINK');
  await page.keyboard.press('n');
  await expect(page.locator('#camera-view-label')).toHaveText(/^Missile chase · MISSILE \d+$/);
  await page.keyboard.press('n');
  await expect(page.locator('#camera-view-label')).toHaveText(/^Missile tracking · MISSILE \d+$/);
  await page.keyboard.press('v');
  await expect(page.locator('#camera-status')).toBeHidden();
  expect(await locked(page)).toBe('viewport');
  await page.keyboard.press('l');
  await expect(mode).toHaveText('TWS');
  await expect(page.locator('#missile-telemetry')).toHaveText('MIDCOURSE · COAST');
  await page.keyboard.press('l');
  await expect(mode).toHaveText('STT');
  await expect(page.locator('#rwr-contact')).toHaveText(/TRACK|ACTIVE SEEKER/);
  await expect(page.locator('#missile-telemetry')).toHaveText(/SEEKER (ACTIVE|SEARCHING)/, { timeout: 18000 });
});

test('close-range missile exercise spends a store and releases finite countermeasures', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('war-browser:settings', JSON.stringify({ preset: 'low' })));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Missile dogfight' }).click({ timeout: 20000 });
  await page.getByLabel('Opponent difficulty').selectOption('rookie');
  await startFlight(page);
  await expect(page.locator('#cannon-state')).toHaveText('CLEARED');
  await page.keyboard.press('h');
  await expect(page.locator('#stores-state')).toHaveText('Off');
  await page.mouse.click(640, 360);
  await expect(page.locator('#cannon-ammo')).toHaveText('1');
  await expect(page.locator('#missile-telemetry')).toHaveText('IR MISSILE IN FLIGHT');
  await expect(page.locator('#rwr-contact')).toHaveText('CLEAR');
  await page.keyboard.press('j');
  await page.keyboard.press('k');
  await expect(page.locator('#remaining-flare')).toHaveText('7');
  await expect(page.locator('#remaining-chaff')).toHaveText('3');
  await page.keyboard.press('i');
  await expect(page.locator('#radar-panel')).toBeHidden();
  await page.keyboard.press('1');
  await expect(page.locator('#cannon-label')).toHaveText('M61A1 · 20 MM');
  await page.keyboard.press('c');
  await expect(page.locator('#sight-mode')).toBeVisible();
  await page.keyboard.press('2');
  await expect(page.locator('#cannon-label')).toHaveText('SIDEWINDER · IR');
  await expect(page.locator('#sight-mode')).toBeHidden();
  expect(errors).toEqual([]);
});

test('Outnumbered tracks two opponents, preserves aim in target view, and records real results', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('war-browser:settings', JSON.stringify({ preset: 'low' })));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Outnumbered' }).click();
  await expect(page.locator('#start-detail')).toHaveText(/two incoming F-16Cs.*260 rounds/);
  await page.getByLabel('Opponent difficulty').selectOption('rookie');
  await page.setViewportSize({ width: 800, height: 520 });
  await page.locator('#launch').click({ trial: true, timeout: 5000 });
  await page.setViewportSize({ width: 1280, height: 720 });
  await startFlight(page);
  await page.keyboard.press('p');
  await expect(page.locator('#radar-contacts')).toHaveText('2 CONTACTS');
  await page.keyboard.press('t');
  await expect(page.locator('#contact-label')).toHaveText(/F-16C 01 · .* KM · SEARCH/);
  await page.keyboard.press('z');
  await expect(page.locator('#camera-view-label')).toHaveText('Target view · F-16C 01');
  await relativeMouse(page, 950, -350);
  expect(await locked(page)).toBe('viewport');
  await page.keyboard.press('v');
  await expect(page.locator('#camera-status')).toBeHidden();
  const { x, y } = await aimState(page);
  expect(Math.abs(x - 0.5)).toBeLessThan(0.12);
  expect(Math.abs(y - 0.5)).toBeLessThan(0.14);

  await page.keyboard.press('1');
  await expect(page.locator('#cannon-ammo')).toHaveText('260');
  await page.keyboard.down('Space');
  await expect(page.locator('#cannon-ammo')).not.toHaveText('260');
  await page.keyboard.up('Space');
  await relativeMouse(page, 0, 750);
  await expect(page.getByRole('heading', { name: 'Mission lost' })).toBeVisible({ timeout: 36000 });
  await expect(page.locator('#result-enemies')).toHaveText('0 / 2');
  await expect(page.locator('#result-guns')).toHaveText(/^[1-9]\d* fired · 0 hits$/);
  await expect(page.locator('#result-missiles')).toHaveText('0 launched · 0 hits');
  await expect(page.locator('#result-time')).toHaveText(/^\d+:\d{2}$/);
  await page.getByRole('button', { name: 'Back to briefing' }).click();
  await expect(page.getByRole('button', { name: 'Outnumbered' })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('selects, previews, and flies the Eagle, then launches in a mixed intercept', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('war-browser:settings', JSON.stringify({ preset: 'low' })));
  const errors = [];
  let eagleRequested = false;
  page.on('request', (request) => { if (/f15-visual/.test(request.url())) eagleRequested = true; });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const chooser = page.getByRole('button', { name: 'Choose aircraft' });
  await expect(chooser).toBeVisible({ timeout: 20000 });
  expect(eagleRequested).toBe(false);
  await chooser.click();
  const dialog = page.getByRole('dialog', { name: 'Choose aircraft' });
  await expect(dialog.getByRole('heading', { name: 'F-16C Fighting Falcon' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'F-15C Eagle' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Preview F-15C Eagle' }).click();
  await expect(page.locator('#preview-name')).toHaveText('F-15C Eagle');
  const prior = await page.locator('#hangar-preview').getAttribute('src');
  await dialog.getByRole('button', { name: 'Rotate preview right' }).click();
  await expect.poll(() => page.locator('#hangar-preview').getAttribute('src')).not.toBe(prior);
  await dialog.getByRole('button', { name: 'Fly F-15C' }).click();
  await expect(chooser).toContainText('F-15C');
  expect(eagleRequested).toBe(true);
  await expect(page.getByRole('button', { name: 'Ground attack range' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Measurements' }).check();
  await startFlight(page);
  await expect(page.locator('#test-overlay')).toBeVisible();
  await expect(page.locator('#test-engine-1')).toHaveText(/\d+%.*kN/);
  await expect(page.locator('#cannon-ammo')).toHaveText('940');
  await page.keyboard.press('b');
  await expect(page.locator('#engine-state')).toHaveText('AFTERBURNER', { timeout: 11000 });
  await page.keyboard.press('g');
  await expect(page.locator('#gear-state')).toHaveText('Down');
  await page.keyboard.press('c');
  await expect(page.locator('#sight-mode')).toHaveText('CCIP');
  await relativeMouse(page, 105, 30);
  expect(await locked(page)).toBe('viewport');
  await pauseFlight(page);
  await page.getByRole('button', { name: 'Back to briefing' }).click();
  await page.getByRole('button', { name: 'BVR intercept' }).click();
  await page.getByLabel('Opponent difficulty').selectOption('rookie');
  await startFlight(page);
  await page.keyboard.press('p');
  await expect(page.locator('#radar-range')).toHaveText('16.0');
  await expect(page.locator('#radar-contacts')).toHaveText('1 CONTACT');
  await page.keyboard.press('t');
  await expect(page.locator('#contact-label')).toContainText('F-16C 01');
  await page.keyboard.press('l');
  await expect(page.locator('#cannon-state')).toHaveText('CLEARED');
  await expect(page.locator('#cannon-ammo')).toHaveText('4');
  await page.keyboard.press('Space');
  await expect(page.locator('#cannon-ammo')).toHaveText('3');
  await page.keyboard.press('j');
  await expect(page.locator('#remaining-flare')).toHaveText('9');
  await page.keyboard.press('r');
  await expect(page.locator('#cannon-ammo')).toHaveText('4');
  await pauseFlight(page);
  await page.getByRole('button', { name: 'Back to briefing' }).click();
  await chooser.click();
  await dialog.getByRole('button', { name: 'Fly F-16C' }).click();
  await expect(chooser).toContainText('F-16C');
  await page.getByLabel('Opponent aircraft').selectOption('f15c');
  await expect(page.locator('#start-detail')).toContainText('inbound F-15C');
  expect(errors).toEqual([]);
});

test('edits and restores a loadout, launches range stores, and records ground results', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('war-browser:settings', JSON.stringify({ preset: 'low' })));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const open = page.getByRole('button', { name: 'Loadout', exact: true });
  const dialog = page.getByRole('dialog', { name: 'F-16C loadout' });
  const preset = dialog.getByRole('combobox', { name: 'Preset', exact: true });
  await open.click({ timeout: 20000 });
  await expect(dialog.locator('#loadout-stations select')).toHaveCount(7);
  await preset.selectOption('Ground Attack');
  await expect(dialog.locator('#loadout-totals')).toContainText('760 kg payload');
  await dialog.getByRole('combobox', { name: 'Centerline' }).selectOption('tank');
  await expect(dialog.locator('#loadout-totals')).toContainText('1488 kg payload');
  const picture = dialog.locator('#loadout-preview');
  await expect(picture).toHaveAttribute('src', /^data:image\/jpeg/);
  const original = await picture.getAttribute('src');
  await dialog.getByRole('button', { name: 'Rotate preview' }).click();
  await expect(picture).not.toHaveAttribute('src', original);
  await dialog.getByLabel('Name', { exact: true }).fill('Coastal test');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.locator('#loadout-status')).toHaveText('Loadout saved.');
  await dialog.getByRole('button', { name: 'Apply to aircraft' }).click();
  await page.reload();
  await open.click();
  await dialog.getByRole('combobox', { name: 'Saved', exact: true }).selectOption('Coastal test');
  await expect(dialog.getByRole('combobox', { name: 'Centerline' })).toHaveValue('tank');
  await dialog.getByRole('button', { name: 'Apply to aircraft' }).click();
  await page.getByRole('button', { name: 'Ground attack range' }).click();
  await page.getByLabel('Rocket release').selectOption('burst');
  await page.setViewportSize({ width: 1050, height: 650 });
  await startFlight(page);
  const rounds = page.locator('#cannon-ammo');
  await expect(rounds).toHaveText('2');
  await expect(page.locator('#ground-remaining')).toHaveText('5 / 5 TARGETS ACTIVE');
  await expect(page.locator('#external-fuel')).toHaveText(/KG EXTERNAL FUEL/);
  await page.keyboard.press('c');
  await expect(page.locator('#sight-mode')).toHaveText('BOMB CCIP');
  await expect.poll(() => page.evaluate(() => document.querySelector('#sight-readout').getBoundingClientRect().bottom
    < document.querySelector('#flight-deck').getBoundingClientRect().top)).toBe(true);
  await expect(page.locator('#sight-state')).toHaveText(/^(VALID|OFFSCREEN) · \d+ M$/);
  await page.keyboard.press('Space');
  await expect(rounds).toHaveText('1');
  await page.keyboard.press('6');
  await expect(page.locator('#sight-mode')).toHaveText('ROCKET CCIP');
  await expect(rounds).toHaveText('14');
  await page.keyboard.press('Space');
  await expect(rounds).toHaveText('9');
  await page.keyboard.press('8');
  await expect(page.locator('#ground-feedback')).toHaveText('TANK RELEASED');
  await expect(page.locator('#external-fuel')).toHaveText('');
  await page.keyboard.press('9');
  await expect(rounds).toHaveText('14');
  await relativeMouse(page, 0, 790);
  await expect(page.getByRole('heading', { name: 'Ground range ended' })).toBeVisible({ timeout: 26000 });
  await expect(page.locator('#result-bombs')).toHaveText('1');
  await expect(page.locator('#result-rockets')).toHaveText('5');
  await expect(page.locator('#result-targets')).toHaveText(/\d+ hit · \d+ of 5 disabled/);
  await page.getByRole('button', { name: 'Back to briefing' }).click();
  await open.click();
  await dialog.getByRole('combobox', { name: 'Saved', exact: true }).selectOption('Coastal test');
  await dialog.getByRole('button', { name: 'Delete saved' }).click();
  await expect(dialog.locator('#loadout-status')).toHaveText('Saved loadout deleted.');
  await dialog.getByRole('button', { name: 'Restore mission default' }).click();
  expect(errors).toEqual([]);
});

test('flies both dynamic ground missions with visual contacts and the existing CCIP weapons', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('war-browser:settings', JSON.stringify({ preset: 'low' })));
  await page.setViewportSize({ width: 1040, height: 650 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Battlefield support' }).click();
  await page.getByRole('checkbox', { name: 'Mark all visually identified ground contacts' }).check();
  await expect(page.locator('#start-detail')).toContainText('Help the friendly column secure Relay crossing');
  await startFlight(page);
  await expect(page.locator('#ground-range-caption')).toHaveText('RELAY CROSSING');
  await expect(page.locator('#battle-objective')).toHaveText(/CONTROL · FRIENDLY 0% · HOSTILE 0%/);
  await expect(page.locator('#ground-rearm-hint')).toBeHidden();
  await expect(page.locator('#battle-debug')).toBeHidden();
  const marker = page.locator('#ground-contact-marker');
  await expect(marker).toBeVisible({ timeout: 10000 });
  await expect(marker).toContainText(/(FRIENDLY|HOSTILE) .+ · \d+ M/);
  await expect.poll(() => page.evaluate(() => {
    const { width, bottom } = document.querySelector('#ground-contact-label').getBoundingClientRect();
    return width > 100 && bottom < document.querySelector('#flight-deck').getBoundingClientRect().top;
  })).toBe(true);
  const selected = await marker.getAttribute('data-contact');
  await page.keyboard.press('t');
  await expect(marker).not.toHaveAttribute('data-contact', selected);
  await page.keyboard.press('c');
  await expect(page.locator('#sight-mode')).toHaveText('BOMB CCIP');
  await expect(page.locator('#sight-state')).toHaveText(/^(VALID|OFFSCREEN) · \d+ M$/);
  await page.keyboard.press('Space');
  await expect(page.locator('#cannon-ammo')).toHaveText('1');
  await page.keyboard.press('6');
  await expect(page.locator('#sight-mode')).toHaveText('ROCKET CCIP');
  await page.keyboard.press('Space');
  await expect(page.locator('#cannon-ammo')).toHaveText('13');
  await pauseFlight(page);
  await page.getByRole('button', { name: 'Back to briefing' }).click();
  await page.getByRole('button', { name: 'Convoy interdiction' }).click();
  await expect(page.locator('#start-detail')).toContainText('three designated transports');
  await startFlight(page);
  await expect(page.locator('#ground-range-caption')).toHaveText('CONVOY EXIT');
  await expect(page.locator('#battle-objective')).toHaveText(/0 \/ 3 TRANSPORTS STOPPED/);
  await expect(page.locator('#battle-losses')).toHaveText('LOSSES · FRIENDLY 0 · HOSTILE 0');
  await expect(page.locator('#cannon-ammo')).toHaveText('2');
  expect(errors).toEqual([]);
});

test('prepares seeded CAS, accepts a ground call, and restores pointer lock without carrying mouse input', async ({ page, browserName }, testInfo) => {
  const sample = () => page.evaluate(() => new Promise((resolve) => {
    const samples = [];
    requestAnimationFrame(function collect(start) {
      let last = start;
      requestAnimationFrame(function frame(now) {
        samples.push(now - last);
        last = now;
        if (now - start < 1400) requestAnimationFrame(frame);
        else {
          samples.sort((a, b) => a - b);
          resolve({ fps: +(1000 * samples.length / (now - start)).toFixed(1),
            p95: +samples[Math.floor((samples.length - 1) * .95)].toFixed(1) });
        }
      });
    });
  }));
  await page.addInitScript(() => localStorage.setItem('war-browser:settings', JSON.stringify({ preset: 'low' })));
  await page.setViewportSize({ width: 1050, height: 650 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Close Air Support' }).click();
  const mission = page.getByLabel('CAS mission');
  const seed = page.getByLabel('Mission seed');
  await expect(mission.locator('option')).toHaveCount(4);
  const originalSeed = await seed.inputValue();
  await page.getByRole('button', { name: 'Generate scenario', exact: true }).click();
  await expect(seed).not.toHaveValue(originalSeed);
  await mission.selectOption('emergency');
  await seed.fill('123457');
  await seed.press('Tab');
  await expect(page.locator('#cas-primary')).toHaveText('Relieve the friendly group');
  await expect(page.locator('#cas-intelligence')).toContainText('stronger armored group');
  const timings = browserName === 'chromium' ? { briefing: await sample() } : null;
  await page.getByRole('button', { name: 'Loadout', exact: true }).click();
  const loadout = page.getByRole('dialog', { name: 'F-16C loadout' });
  await loadout.getByRole('combobox', { name: 'Preset', exact: true }).selectOption('Ground Attack');
  await loadout.getByRole('button', { name: 'Apply to aircraft' }).click();
  await page.getByRole('button', { name: /Start mission/ }).click();
  await expect.poll(() => locked(page)).toBe('viewport');
  await expect(page.locator('#cas-call-count')).toContainText('support', { timeout: 12000 });
  if (timings) timings.flight = await sample();
  await page.keyboard.press('c');
  await expect(page.locator('#sight-mode')).toHaveText('BOMB CCIP');
  await page.keyboard.press('Tab');
  const map = page.getByRole('dialog', { name: 'Tactical map' });
  await expect(map).toBeVisible();
  await expect.poll(() => locked(page)).toBeNull();
  const elapsed = await page.locator('#elapsed').textContent();
  const heading = await page.locator('#heading').textContent();
  const pixels = await map.locator('canvas').evaluate((canvas) => canvas.toDataURL());
  await map.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => map.locator('canvas').evaluate((canvas) => canvas.toDataURL())).not.toBe(pixels);
  await map.locator('canvas').press('ArrowRight');
  await map.getByRole('button', { name: /^Accept Urgent/ }).first().click();
  await expect(map.locator('#cas-map-selection')).toContainText('Reported area');
  await expect(map.locator('#cas-map-radio')).toContainText('Support request accepted');
  if (timings) {
    timings.map = await sample();
    await page.screenshot({ path: testInfo.outputPath('tactical-map.png') });
  }
  await expect(page.locator('#elapsed')).toHaveText(elapsed);
  await expect(page.locator('#heading')).toHaveText(heading);
  await map.getByRole('button', { name: 'Return to flight' }).click();
  await expect.poll(() => locked(page)).toBe('viewport');
  await expect(page.locator('#cas-designation')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.locator('#cannon-ammo')).toHaveText('1');
  await page.keyboard.press('r');
  await expect(page.locator('#cannon-ammo')).toHaveText('2');
  await pauseFlight(page);
  await page.getByRole('button', { name: 'Back to CAS briefing' }).click();
  await expect(seed).toHaveValue('123457');
  await expect(mission).toHaveValue('emergency');
  await page.getByRole('button', { name: /Start mission/ }).click();
  await expect.poll(() => locked(page)).toBe('viewport');
  await relativeMouse(page, 0, 835);
  await expect(page.locator('#mission-results')).toBeVisible({ timeout: 26000 });
  await expect(page.locator('#result-cas-objectives')).toContainText('Seed 123457');
  await expect(page.locator('#result-damage')).toContainText('components damaged');
  await expect(page.locator('#result-bombs')).toHaveText('0');
  await expect(page.getByRole('button', { name: /Restart same scenario/ })).toBeVisible();
  if (timings) {
    timings.debrief = await sample();
    console.log('Stage 2.9 CAS game screens, Low 1050×650', JSON.stringify(timings));
  }
  await page.getByRole('button', { name: 'Generate another scenario' }).click();
  await expect(seed).not.toHaveValue('123457');
  await page.getByRole('button', { name: /Choose aircraft/ }).click();
  await page.getByRole('button', { name: 'Fly F-15C' }).click();
  await expect(page.getByRole('button', { name: /Start mission/ })).toBeDisabled();
  await expect(page.locator('#cas-aircraft-status')).toContainText('F-15C is configured for air combat');
  expect(errors).toEqual([]);
});

test('small horizontal mouse corrections use sideslip and little bank while a large move commands a turn', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('war-browser:settings', JSON.stringify({ preset: 'low' })));
  await page.setViewportSize({ width: 1030, height: 650 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: 'Measurements', exact: true }).check();
  await startFlight(page);
  const bank = page.locator('#test-bank');
  const heading = page.locator('#heading');
  const initialHeading = Number(await heading.textContent());
  await relativeMouse(page, 56, 0);
  await expect.poll(async () => Math.abs(Number(await bank.textContent())), { timeout: 4000 }).toBeGreaterThan(1);
  await expect.poll(async () => (Number(await heading.textContent()) - initialHeading + 360) % 360, { timeout: 6000 }).toBeGreaterThan(1);
  expect(Math.abs(Number(await bank.textContent()))).toBeLessThan(14);
  expect(Math.abs(Number(await page.locator('#test-slip').textContent()))).toBeLessThan(8);
  for (const offset of [-105, 105, -105, 105]) {
    await relativeMouse(page, offset, 0);
    expect(Math.abs(Number(await bank.textContent()))).toBeLessThan(16);
  }
  await relativeMouse(page, 1257, 0);
  await expect.poll(async () => Math.abs(Number(await bank.textContent())), { timeout: 10000 }).toBeGreaterThan(55);
  await expect.poll(async () => (Number(await heading.textContent()) - initialHeading + 360) % 360, { timeout: 14000 }).toBeGreaterThan(65);
});
