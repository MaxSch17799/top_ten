import { test, expect } from '@playwright/test';

test('interface language synchronizes between games and tabs while content preferences stay independent', async ({ context, page }) => {
  await page.goto('/sounds-fishy');
  await page.evaluate(() => {
    localStorage.setItem('just-one-language', 'en');
    localStorage.setItem('fishy-bank', 'content-preference-fishy');
    localStorage.setItem('wave-pack', 'content-preference-wave');
  });
  const wave = await context.newPage();
  await wave.goto('/wavelength');
  await expect(wave.locator('nav select')).toHaveValue('en');
  await page.locator('nav select').selectOption('de');
  await expect(wave.locator('nav select')).toHaveValue('de');
  await wave.locator('nav select').selectOption('en');
  await expect(page.locator('nav select')).toHaveValue('en');
  expect(await page.evaluate(() => ['just-one-language', 'fishy-bank', 'wave-pack'].map(key => localStorage.getItem(key))))
    .toEqual(['en', 'content-preference-fishy', 'content-preference-wave']);
  await page.reload();
  await expect(page.locator('nav select')).toHaveValue('en');
});
