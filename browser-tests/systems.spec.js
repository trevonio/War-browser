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
  expect(errors).toEqual([]);
});
