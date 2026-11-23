import { expect, test } from '@playwright/test';

const hangarReady = { timeout: 30000 };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('war-browser:settings', JSON.stringify({ preset: 'low' })));
});

async function selectAircraft(page, name = 'A-10C') {
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'ready', hangarReady);
  await page.getByRole('button', { name: /Choose aircraft/ }).click();
  await page.getByRole('button', { name: 'Fly ' + name, exact: true }).click(hangarReady);
  await expect(page.locator('#briefing-aircraft')).toHaveText(name, hangarReady);
}

async function applyPreset(page, name) {
  await page.getByRole('button', { name: 'Loadout', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'A-10C loadout' });
  await editor.getByRole('combobox', { name: 'Preset', exact: true }).selectOption(name);
  await editor.getByRole('button', { name: 'Apply to aircraft' }).click();
}

async function locked(page) {
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('viewport');
}

test('loads the supplied A-10C and both LODs, rotates the hangar preview and starts qualification', async ({ page }, testInfo) => {
  const errors = [];
  const glbs = new Set();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.ok() && response.url().endsWith('.glb')) glbs.add(response.url().split('/').at(-1));
  });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'ready', hangarReady);
  await page.getByRole('button', { name: /Choose aircraft/ }).click();
  await page.getByRole('button', { name: 'Preview A-10C Thunderbolt II' }).click();
  const preview = page.getByRole('img', { name: 'Rotatable preview of A-10C Thunderbolt II' });
  await expect(preview).toHaveAttribute('src', /^data:image/, hangarReady);
  const first = await preview.getAttribute('src');
  await page.locator('#preview-left').click();
  await expect(preview).not.toHaveAttribute('src', first);
  await page.screenshot({ path: testInfo.outputPath('a10-hangar.png') });
  await page.getByRole('button', { name: 'Fly A-10C' }).click(hangarReady);
  await expect(page.locator('#briefing-aircraft')).toHaveText('A-10C');
  await expect(page.locator('#start-intercept')).toBeDisabled();
  await expect(page.locator('#toggle-burner')).toBeHidden();
  await page.getByRole('button', { name: 'A-10C Gun and Rocket Qualification' }).click();
  await expect(page.locator('#briefing-mode')).toHaveText('A-10C QUALIFICATION');
  await expect(page.locator('#airspeed')).toHaveText('0');
  await page.locator('#launch').click();
  await locked(page);
  await expect(page.locator('#gear-state')).toHaveText('Down');
  await expect(page.locator('#flaps-state')).toHaveText('Takeoff');
  await expect(page.locator('#battle-objective')).toContainText('0 / 4 DISABLED');
  await page.keyboard.down('Shift');
  await expect.poll(async () => Number(await page.locator('#throttle').innerText())).toBeGreaterThan(25);
  await page.keyboard.up('Shift');
  expect([...glbs].sort()).toEqual(['A10C.glb', 'A10C_LOD1.glb', 'A10C_LOD2.glb']);
  expect(errors).toEqual([]);
});

test('selects A-10C for CAS and retains F-15C air-superiority eligibility', async ({ page }) => {
  await page.goto('/');
  await selectAircraft(page);
  await page.getByRole('button', { name: 'Close Air Support' }).click();
  await expect(page.locator('#launch')).toBeEnabled();
  await selectAircraft(page, 'F-15C');
  await expect(page.locator('#launch')).toBeDisabled();
  await expect(page.locator('#cas-aircraft-status')).toContainText('F-15C is configured for air combat');
});

test('flies a clean A-10C from a runway start through landing and braking', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await page.goto('http://127.0.0.1:4174/');
  await page.evaluate(async () => {
    const { Flight } = await import('/src/sim/flight.js');
    const { runwayPilot } = await import('/browser-tests/a10-pilot.js');
    const original = Flight.prototype.step;
    const state = window.a10Circuit = { phase: 'roll', retracted: false, failure: '', finished: false };
    Flight.prototype.step = function (controls, dt) {
      if (this.spec.id !== 'a10c') return original.call(this, controls, dt);
      original.call(this, runwayPilot(this, state, controls), dt);
      state.failure = this.failure;
      state.finished = state.phase === 'stop' && this.grounded && this.airspeed < 1;
    };
  });
  await selectAircraft(page);
  await applyPreset(page, 'Clean');
  await page.getByRole('button', { name: 'Runway 36' }).click();
  await page.locator('#launch').click();
  await page.setViewportSize({ width: 760, height: 480 });
  await locked(page);
  await expect.poll(() => page.evaluate(() => window.a10Circuit.retracted), { timeout: 90000 }).toBe(true);
  await expect(page.locator('#flaps-state')).toHaveText('Landing');
  await expect.poll(() => page.evaluate(() => window.a10Circuit.finished || window.a10Circuit.failure), { timeout: 90000 }).toBe(true);
  await expect(page.locator('#gear-state')).toHaveText('Down');
  await expect(page.locator('#airspeed')).toHaveText(/^[01]$/);
  await page.screenshot({ path: testInfo.outputPath('a10-landed.png') });
});

test('flies Precision Strike in the A-10C and hits a live target after wheel-free pod zoom', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1040, height: 650 });
  await page.goto('/');
  await selectAircraft(page);
  await page.getByRole('button', { name: 'Close Air Support' }).click();
  await page.getByLabel('CAS mission').selectOption('precision');
  await applyPreset(page, 'Precision Support');
  await page.getByRole('button', { name: /Start mission/ }).click();
  await locked(page);
  await page.keyboard.press('c');
  const pod = page.getByRole('region', { name: 'Targeting pod' });
  await expect(pod).toBeVisible();
  await page.keyboard.press('Equal');
  await expect(page.locator('#pod-zoom')).toHaveText('MEDIUM');
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
  await pod.getByRole('button', { name: 'Zoom out' }).click();
  await expect(page.locator('#pod-zoom')).toHaveText('WIDE');
  await pod.getByRole('button', { name: 'Resume slew' }).click();
  await locked(page);
  await page.keyboard.press('0');
  await expect(page.locator('#pod-mode')).toHaveText('WHITE HOT');
  const map = page.getByRole('dialog', { name: 'Tactical map' });
  const cuePod = async () => {
    await page.keyboard.press('m');
    await map.locator('#cas-map-objective').click();
    await map.getByRole('button', { name: 'Return to flight' }).click();
    await locked(page);
    await expect(page.locator('#pod-track')).toHaveText('AREA TRACK');
    await expect(page.locator('#pod-target')).toContainText('HOSTILE', hangarReady);
  };
  await cuePod();
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
  await page.mouse.move(510, 250);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(574, 262);
  await page.mouse.up({ button: 'right' });
  await expect(page.locator('#pod-track')).toHaveText('FREE SLEW');
  await pod.getByRole('button', { name: 'Resume slew' }).click();
  await locked(page);
  await cuePod();
  await page.keyboard.press('r');
  await expect(page.locator('#pod-track')).toHaveText('POINT TRACK');
  await page.keyboard.press('o');
  await expect(page.locator('#pod-designation')).toHaveText(/^FIX /);
  await page.keyboard.press('q');
  await page.keyboard.press('q');
  await expect(page.locator('#cannon-label')).toHaveText('OPTICAL STRIKE MISSILE');
  await expect(page.locator('#weapon-station')).toHaveText('Station 5');
  await expect(page.locator('#strike-readiness')).toHaveText('CLEARED');
  await page.screenshot({ path: testInfo.outputPath('a10-precision.png') });
  await page.keyboard.press('Space');
  await expect(page.locator('#cannon-ammo')).toHaveText('0');
  await expect(page.locator('#weapon-station')).toHaveText('');
  await expect(page.locator('#battle-objective')).toContainText('1 / 2 TARGETS DISABLED', { timeout: 35000 });
});

async function instrumentQualification(page) {
  await page.evaluate(async () => {
    const { Flight } = await import('/src/sim/flight.js');
    const { GroundBattle } = await import('/src/sim/ground/battlefield.js');
    const { RangeOrdnance } = await import('/src/sim/range-ordnance.js');
    const { AttachedStores } = await import('/src/view/loadout-visual.js');
    const { runwayPilot, lineUpGunPass, Vector3 } = await import('/browser-tests/a10-pilot.js');
    const flightStep = Flight.prototype.step;
    const battleStep = GroundBattle.prototype.step;
    const spawn = RangeOrdnance.prototype.spawn;
    const mounts = AttachedStores.prototype.update;
    const forward = new Vector3(0, 0, 1);
    const aim = new Vector3();
    const path = new Vector3();
    const pilot = { phase: 'roll', retracted: false };
    const state = window.qualificationTest = { launched: false, releases: [], target: null, releasedRailHidden: false };
    GroundBattle.prototype.step = function (...args) {
      if (this.key === 'qualification') state.battle = this;
      return battleStep.apply(this, args);
    };
    Flight.prototype.step = function (controls, dt) {
      if (this.spec.id !== 'a10c') return flightStep.call(this, controls, dt);
      state.flight = this;
      if (!state.launched) {
        flightStep.call(this, runwayPilot(this, pilot, controls), dt);
        state.launched = !this.grounded && this.position.y > 28;
        return;
      }
      if (state.target && !state.target.disabled) lineUpGunPass(this, state.target, forward, aim, path);
      flightStep.call(this, controls, dt);
    };
    RangeOrdnance.prototype.spawn = function (kind, flight, station, pod) {
      const success = spawn.call(this, kind, flight, station, pod);
      if (success && flight.spec.id === 'a10c') {
        const expected = new Vector3().fromArray(station.offset).add(new Vector3().fromArray(station.release))
          .applyQuaternion(flight.orientation).add(flight.position);
        const round = this.rounds.find(({ serial, active }) => active && serial === this.serial);
        state.releases.push({ kind, station: station.name, error: round.position.distanceTo(expected) });
      }
      return success;
    };
    AttachedStores.prototype.update = function (flight) {
      mounts.call(this, flight);
      const released = this.mounts.find(({ station }) => station.name === 'HP_03' && station.type === 'bomb');
      if (released?.station.used) state.releasedRailHidden = !released.mesh.visible;
    };
  });
}

for (const penalized of [false, true]) {
  test(`qualification debrief scores real hits ${penalized ? 'with a friendly-fire penalty' : 'after a clean pass'}`, async ({ page }, testInfo) => {
    test.setTimeout(180000);
    await page.goto('http://127.0.0.1:4174/');
    await instrumentQualification(page);
    await selectAircraft(page);
    await page.getByRole('button', { name: 'A-10C Gun and Rocket Qualification' }).click();
    await page.locator('#launch').click();
    await page.setViewportSize({ width: 760, height: 480 });
    await locked(page);
    // The launch button may have left the automation cursor below the smaller viewport.
    await page.mouse.move(380, 240);
    await expect.poll(() => page.evaluate(() => window.qualificationTest.launched), { timeout: 90000 }).toBe(true);
    if (!penalized) {
      await page.evaluate(() => {
        const state = window.qualificationTest;
        state.rollAuthority = state.flight.damage.rollAuthority;
        state.flight.damage.hit('leftEngine', 28);
        state.flight.damage.hit('leftFlaperon', 13);
      });
      await expect(page.locator('#engine-balance')).toHaveText(/^L OUT · R \d+%$/);
      expect(await page.evaluate(() => {
        const { flight, rollAuthority } = window.qualificationTest;
        return flight.engines.states[0].thrust === 0 && flight.engines.states[1].thrust > 0
          && flight.damage.rollAuthority < rollAuthority && flight.grounded === false && !flight.failure;
      })).toBe(true);
      await page.evaluate(() => {
        const state = window.qualificationTest;
        state.target = state.battle.qualificationTargets[0];
      });
      await expect(page.locator('#weapon-station')).toHaveText('Station 3');
      await page.keyboard.press('Space');
      await expect(page.locator('#cannon-ammo')).toHaveText('1');
      await expect.poll(() => page.evaluate(() => window.qualificationTest.releasedRailHidden)).toBe(true);
      await page.keyboard.press('q');
      await expect(page.locator('#weapon-station')).toHaveText('Station 4');
      await page.keyboard.press('Space');
      await expect(page.locator('#cannon-ammo')).toHaveText('13');
      const releases = await page.evaluate(() => window.qualificationTest.releases);
      expect(releases).toEqual([
        { kind: 'bomb', station: 'HP_03', error: expect.any(Number) },
        { kind: 'rocket', station: 'HP_04', error: expect.any(Number) },
      ]);
      expect(releases.every(({ error }) => error < 1e-8)).toBe(true);
    }
    const passes = ['qual-static-tank', 'qual-static-ifv', 'qual-moving-truck', 'qual-moving-apc'];
    if (penalized) passes.unshift('qual-friendly-truck');
    for (const id of passes) {
      await page.evaluate((id) => {
        const state = window.qualificationTest;
        state.target = state.battle.targets.find((unit) => unit.id === id);
      }, id);
      if (await page.evaluate(() => window.qualificationTest.target.disabled)) continue;
      const ammo = Number(await page.locator('#cannon-count').textContent());
      await page.keyboard.down('Enter');
      try {
        await expect.poll(async () => {
          if (await page.locator('#mission-results').isVisible()) return true;
          return Number(await page.locator('#cannon-count').textContent()) < ammo;
        }, { timeout: 10000 }).toBe(true);
        if (id.startsWith('qual-friendly')) {
          await expect.poll(() => page.evaluate(() => window.qualificationTest.battle.friendlyFire), { timeout: 12000 }).toBeGreaterThan(0);
        } else {
          await expect.poll(() => page.evaluate(() => window.qualificationTest.target.disabled), { timeout: 12000 }).toBe(true);
        }
      } finally {
        await page.keyboard.up('Enter');
      }
    }
    const outcome = penalized ? 'ended' : 'complete';
    await expect(page.getByRole('heading', { name: 'A-10C Gun and Rocket Qualification ' + outcome })).toBeVisible();
    await expect(page.locator('#result-targets')).toHaveText('4 damaged · 4 / 4 disabled');
    await expect(page.locator('#result-guns')).toHaveText(/\d+ fired · [1-9]\d* hostile hits · .*% hostile hit rate/);
    await expect(page.locator('#result-friendly-fire')).toHaveText(penalized ? /^[1-9]\d* damaging hits$/ : '0 damaging hits');
    if (penalized) await expect(page.locator('#pause-description')).toContainText('Friendly-fire penalty');
    else {
      await expect(page.locator('#result-bombs')).toHaveText('1');
      await expect(page.locator('#result-rockets')).toHaveText('1');
    }
    await page.screenshot({ path: testInfo.outputPath('a10-qualification-debrief.png') });
  });
}
