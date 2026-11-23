import { expect, test } from '@playwright/test';

test('the supplied A-10C GLB loads in the hangar and completes a qualification launch sequence', async ({ page }, testInfo) => {
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-screen','ready',{timeout:25000});
  await page.locator('#open-aircraft').click();
  await expect(page.getByRole('button',{name:/Fly A-10C/})).toBeVisible();
  await page.getByRole('button',{name:/Fly A-10C/}).click();
  await expect(page.locator('#briefing-aircraft')).toHaveText('A-10C',{timeout:25000});
  await expect(page.locator('#start-qualification')).toBeVisible();
  await expect(page.locator('#toggle-burner')).toBeHidden();
  await page.locator('#start-qualification').click();
  await expect(page.locator('#briefing-mode')).toHaveText('A-10C QUALIFICATION');
  await page.screenshot({path:testInfo.outputPath('a10-qualification-briefing.png')});
  await page.locator('#launch').click();
  await expect(page.locator('#flight-hud')).toBeVisible();
  await expect(page.locator('#gear-state')).toHaveText('Down');
  await expect(page.locator('#airspeed')).toHaveText(/^0$/);
  await page.keyboard.down('Shift');
  await expect.poll(async()=>Number(await page.locator('#throttle').innerText())).toBeGreaterThan(20);
  await page.keyboard.up('Shift');
  expect(errors).toEqual([]);
});

test('A-10C remains CAS-capable while F-15C keeps its air-superiority restriction', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-screen','ready',{timeout:25000});
  await page.locator('#open-aircraft').click();
  await page.getByRole('button',{name:/Fly A-10C/}).click();
  await expect(page.locator('#start-cas')).toBeEnabled();
  await page.locator('#open-aircraft').click();
  await page.getByRole('button',{name:/Fly F-15C/}).click();
  await expect(page.locator('#start-cas')).toBeVisible();
  await page.locator('#start-cas').click();
  await expect(page.locator('#launch')).toBeDisabled();
});
