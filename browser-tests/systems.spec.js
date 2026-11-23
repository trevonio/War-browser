import { expect, test } from '@playwright/test';

test('renders rigged surfaces and measures combat with damage and multiple aircraft', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Measure all scenarios on one browser and renderer.');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/browser-tests/systems-fixture.html');
  await page.waitForFunction(() => Boolean(window.flightSystemsTest), undefined, { timeout: 25000 });
  const rig = await page.evaluate(() => window.flightSystemsTest.checkRig());
  expect(rig.gearDeployed && rig.gearFolded && rig.burner && rig.storesOff).toBe(true);
  expect(rig.groundedFlap).toBeGreaterThan(15);
  expect(rig.pitch).toBeGreaterThan(5);
  expect(rig.differential).toBeGreaterThan(5);
  expect(rig.brake).toBeGreaterThan(15);
  expect(rig.jammedFlap).toBeCloseTo(rig.flaperon);
  expect(rig.separated && rig.sharedGeometry).toBe(true);
  expect(Math.abs(rig.ai)).toBeGreaterThan(1);
  expect(rig.muzzle).toEqual([0.71, 0.33, 3.42]);
  expect(await page.evaluate(() => window.flightSystemsTest.checkImpact())).toBeLessThan(0.1);

  const timings = {};
  for (const mode of ['idle', 'firing', 'combat', 'damaged', 'multi']) {
    timings[mode] = await page.evaluate((scenario) => window.flightSystemsTest.measure(scenario), mode);
    expect(timings[mode].fps).toBeGreaterThan(0);
  }
  expect(timings.firing.rounds).toBeGreaterThan(30);
  expect(timings.damaged.particles).toBeGreaterThan(timings.combat.particles + 5);
  expect(timings.multi.drawCalls).toBeGreaterThan(timings.combat.drawCalls);
  console.log('Stage 2.3 Chromium WebGL, medium 800×450', JSON.stringify(timings));
  const modern = {};
  for (const mode of ['scan', 'contacts', 'launch', 'salvo', 'decoys', 'ai', 'burst', 'trails', 'camera']) {
    modern[mode] = await page.evaluate((scenario) => window.flightSystemsTest.measureAirCombat(scenario), mode);
    expect(modern[mode].fps).toBeGreaterThan(0);
  }
  expect(modern.scan.contacts).toBe(1);
  expect(modern.contacts.contacts).toBe(3);
  expect(modern.launch.launches).toBeGreaterThan(0);
  expect(modern.salvo.missiles).toBeGreaterThan(1);
  expect(modern.decoys.decoys).toBeGreaterThan(3);
  expect(modern.ai.missiles).toBeGreaterThan(1);
  expect(modern.burst.particles).toBeGreaterThan(18);
  expect(modern.trails.ribbons).toBeGreaterThan(30);
  expect(modern.camera.missileCamera).toBe(true);
  console.log('Stage 2.5 Chromium WebGL, medium 800×450', JSON.stringify(modern));
  expect(errors).toEqual([]);
});

test('profiles both player airframes and four mixed aircraft at 1080p', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Profile on the same renderer.');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/browser-tests/systems-fixture.html');
  await page.waitForFunction(() => Boolean(window.flightSystemsTest), undefined, { timeout: 25000 });
  const report = await page.evaluate(() => window.flightSystemsTest.measureFleet());
  expect(report.scenarios.eagle.fps).toBeGreaterThan(0);
  expect(report.scenarios.four.draws).toBeGreaterThan(report.scenarios.eagle.draws);
  expect(report.scenarios.missiles.mostActive).toBeGreaterThan(1);
  expect(new Set(report.resourcesAfterSwitch.slice(2).map(String)).size).toBe(1);
  expect(errors).toEqual([]);
  console.log('Stage 2.6 software WebGL', JSON.stringify(report));
});

test('profiles clean and loaded flight, release, salvos, and the ground range', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Measure scenarios on one software renderer.');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/browser-tests/systems-fixture.html');
  await page.waitForFunction(() => Boolean(window.flightSystemsTest), undefined, { timeout: 25000 });
  const { report, changes, changeMs } = await page.evaluate(() => window.flightSystemsTest.measureGroundStores());
  console.log('Stage 2.7 Chromium WebGL, medium 800×450', JSON.stringify({ report, changes, changeMs }));
  expect(report.bombRelease.active).toBe(2);
  expect(report.rocketSalvo.active).toBeGreaterThan(2);
  expect(report.explosions.impacts).toBe(3);
  expect(report.explosions.particles).toBeGreaterThan(20);
  expect(new Set(changes.map(String)).size).toBe(1);
  expect(errors).toEqual([]);
});

test('profiles dynamic ground battles across forces, explosions, air support, and aircraft', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Measure scenarios on one software renderer.');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4174/browser-tests/systems-fixture.html');
  await page.waitForFunction(() => Boolean(window.flightSystemsTest), undefined, { timeout: 25000 });
  const report = await page.evaluate(() => window.flightSystemsTest.measureBattle());
  console.log('Stage 2.8 Chromium WebGL, medium 800×450', JSON.stringify(report));
  for (const [key, count] of [['empty', 0], ['five', 5], ['ten', 10], ['twenty', 20]]) {
    expect(report[key].ai).toBe(count);
    expect(report[key].fps).toBeGreaterThan(0);
    expect(report[key].p95ms).toBeGreaterThan(0);
  }
  expect(report.firing.groundShots).toBeGreaterThan(0);
  expect(report.firing.projectiles).toBeGreaterThan(0);
  expect(report.explosions.bombImpacts).toBe(4);
  expect(report.airSupport.bombImpacts).toBeGreaterThan(0);
  expect(report.airSupport.rocketImpacts).toBeGreaterThan(0);
  expect(report.mixedAircraft.aircraft).toBe(4);
  expect(report.mixedAircraft.draws).toBeGreaterThan(report.firing.draws);
  expect(errors).toEqual([]);
});

test('profiles dedicated CAS field activity, arrivals and mission resolution', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Measure scenarios on one software renderer.');
  await page.goto('http://127.0.0.1:4174/browser-tests/systems-fixture.html');
  await page.waitForFunction(() => Boolean(window.flightSystemsTest), undefined, { timeout: 25000 });
  const report = await page.evaluate(() => window.flightSystemsTest.measureCasBattle());
  console.log('Stage 2.9 CAS software WebGL, Medium 800×450', JSON.stringify(report));
  expect(report.ten.ai).toBe(10);
  expect(report.twenty.ai).toBe(20);
  expect(report.firing.projectiles).toBeGreaterThan(1);
  expect(report.firing.calls).toBeGreaterThan(0);
  expect(report.airSupport.bombImpacts).toBe(2);
  expect(report.airSupport.rocketImpacts).toBe(5);
  expect(report.reinforcements.relief).toBe('arrived');
  expect(report.completion.outcome).toMatch(/^(win|loss)$/);
});

test('profiles pod scenes with ground combat and active surface defenses', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Measure on a single software renderer.');
  await page.goto('http://127.0.0.1:4174/browser-tests/systems-fixture.html');
  await page.waitForFunction(() => Boolean(window.flightSystemsTest), undefined, { timeout: 25000 });
  const report = await page.evaluate(() => window.flightSystemsTest.measureStrikeBattle());
  console.log('Stage 3.0 contested pod scenes, software WebGL 800×450 at 0.79 scale', JSON.stringify(report));
  for (const scenario of Object.values(report)) {
    expect(scenario.fps).toBeGreaterThan(0);
    expect(scenario.draws).toBeGreaterThan(20);
    expect(scenario.ai).toBeGreaterThan(8);
    expect(scenario.surfaceLaunches).toBeGreaterThan(0);
    expect(scenario.aaaShots).toBeGreaterThan(0);
    expect(scenario.missiles).toBeGreaterThan(0);
  }
});
