import { expect, test } from '@playwright/test';

const openPage = async (page, route = '/') => {
  await page.goto(route, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-rht-toaster]')).toBeAttached();
  await expect(page.locator('.editorial-motion')).toHaveAttribute('data-motion', /enabled|reduced/);
  // The cursor intentionally pauses when its browser window loses focus.
  await page.bringToFront();
};

test('the green cursor glow follows the mouse without blocking import in the shorter hero', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openPage(page);
  const field = page.locator('.motion-cursor');
  await page.mouse.move(120, 180);
  await expect.poll(() => field.evaluate((node) => Number(getComputedStyle(node).opacity))).toBeGreaterThan(0.95);
  await page.mouse.move(1040, 520);
  await expect.poll(() => field.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return Math.hypot(bounds.x + bounds.width / 2 - 1040, bounds.y + bounds.height / 2 - 520);
  })).toBeLessThan(1);
  expect(Math.abs(await page.locator('.landing-hero').evaluate((node) => node.getBoundingClientRect().bottom) - 900 * .88)).toBeLessThan(1);
  await page.getByRole('link', { name: 'Import a dataset', exact: true }).first().click();
  await expect(page.getByLabel('Choose a data file', { exact: true })).toBeAttached();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.motion-ambient')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('reduced motion starts still and changing the preference cancels active effects', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPage(page, '/how-it-works');
  const field = page.locator('.motion-ambient');
  await expect(field).toBeHidden();
  expect(await page.locator('.editorial-motion').evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  await page.getByRole('link', { name: /04.*Export and back up/ }).click();
  await expect(page.getByRole('heading', { name: 'Optional encrypted backups' })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.editorial-motion')).toHaveAttribute('data-motion', 'enabled');
  await expect(field).toBeVisible();
  await page.mouse.move(100, 120);
  await expect.poll(() => page.locator('.motion-cursor').evaluate((node) => Number(getComputedStyle(node).opacity))).toBeGreaterThan(0.95);
  await page.mouse.move(1100, 650);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.editorial-motion')).toHaveAttribute('data-motion', 'reduced');
  await expect(field).toBeHidden();
  await expect.poll(() => page.locator('.motion-cursor').evaluate((node) => Number(getComputedStyle(node).opacity))).toBe(0);
  await expect.poll(() => page.locator('.editorial-motion').evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  await page.mouse.move(900, 300);
  await expect(page.locator('.motion-cursor')).not.toHaveAttribute('data-active');
  await expect(page.getByRole('heading', { name: 'Optional encrypted backups' })).toBeVisible();
});

test('public content is readable with JavaScript disabled', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'A clearer view of your data.' })).toBeVisible();
    await page.getByRole('link', { name: 'See everything you can do', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Good questions\.\s*Clearer answers\./ })).toBeVisible();
    await page.getByRole('link', { name: 'Import your first dataset', exact: true }).click();
    await expect(page).toHaveURL(/\/upload$/);
  } finally { await context.close(); }
});
