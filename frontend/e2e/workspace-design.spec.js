import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openWorkspaceActions } from './review-helpers.js';

const captureRoot = path.resolve('../audit-results/public-page-upgrades-2026-10-11/workspace');

for (const width of [1440, 390, 360]) {
  test(`workspace information and actions stay usable at ${width}px`, async ({ page }, testInfo) => {
    const captures = path.join(captureRoot, testInfo.project.name);
    await mkdir(captures, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const withinScreen = async locator => {
      const bounds = await locator.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    };
    await page.goto('/upload');
    const dropzone = page.getByRole('button', { name: 'Choose a CSV, Excel or document file' });
    await expect(dropzone).toBeVisible();
    const zone = await dropzone.boundingBox();
    expect(zone.y + zone.height).toBeLessThan(900);
    await withinScreen(dropzone);
    await page.screenshot({ path: path.join(captures, `import-${width}.png`), fullPage: true });
    const limits = page.getByRole('button', { name: 'Import and analysis limits', exact: true });
    await limits.click();
    await withinScreen(page.getByRole('region', { name: 'Import and analysis limits', exact: true }));
    await page.getByRole('button', { name: 'Close import and analysis limits' }).focus();
    await page.keyboard.press('Escape');
    await expect(limits).toBeFocused();
    await page.getByRole('button', { name: 'URL / Google Sheets' }).click();
    await expect(limits).toBeVisible();
    await page.getByRole('button', { name: 'Local files' }).click();
    await page.getByRole('button', { name: 'Explore sample data' }).click();
    await expect(page.getByRole('heading', { name: /SaaS Growth/ })).toBeVisible();
    await expect(page.locator('.recharts-line-curve').first()).toBeVisible();
    await expect(page.getByText('Loaded sample SaaS Growth dataset!', { exact: true })).toBeHidden();
    if (width === 1440) expect((await page.locator('.react-grid-item').first().boundingBox()).y).toBeLessThan(750);
    await expect(page.getByLabel('Default graph color')).toHaveCount(0);
    await expect(page.locator('summary').filter({ hasText: 'Browser import and analysis limits' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Expand assistant details' })).toHaveAttribute('aria-expanded', 'false');
    await page.screenshot({ path: path.join(captures, `dashboard-${width}.png`), fullPage: true });
    const info = page.getByRole('button', { name: 'Workspace information', exact: true });
    await info.click();
    const panel = page.getByRole('region', { name: 'Workspace information', exact: true });
    await expect(panel.getByRole('note', { name: 'Browser import and analysis limits' })).toBeVisible();
    await withinScreen(panel);
    await page.screenshot({ path: path.join(captures, `workspace-info-${width}.png`) });
    await page.getByRole('button', { name: 'Close workspace information' }).focus();
    await page.keyboard.press('Escape');
    await expect(info).toBeFocused();
    await openWorkspaceActions(page);
    await withinScreen(page.getByRole('region', { name: 'More actions', exact: true }));
    await expect(page.getByRole('button', { name: 'Backup', exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(captures, `workspace-actions-${width}.png`) });
    await page.getByRole('heading', { name: /SaaS Growth/ }).click();
    await expect(page.getByRole('region', { name: 'More actions', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Browser AI and local search', exact: true }).click();
    await withinScreen(page.getByRole('region', { name: 'Browser AI and local search', exact: true }));
    await expect(page.getByLabel('Assistant mode')).toBeVisible();
    await page.screenshot({ path: path.join(captures, `assistant-info-${width}.png`) });
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('compact assistant expands for answers and keeps conversation when collapsed', async ({ page }) => {
  await page.goto('/dashboard');
  const query = page.getByRole('textbox', { name: 'Ask a question about this dataset' });
  await query.fill('How many rows?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const answer = page.getByText(/There are .* rows in the current analytical scope/);
  await expect(answer).toBeVisible();
  await page.getByRole('button', { name: 'Collapse assistant details' }).click();
  await expect(answer).toBeHidden();
  await expect(query).toBeVisible();
  await page.getByRole('button', { name: 'Expand assistant details' }).click();
  await expect(answer).toBeVisible();
});

test('temporary portfolio link returns home from public and workspace footers', async ({ page }) => {
  for (const route of ['/privacy', '/upload', '/dashboard']) {
    await page.goto(route);
    await expect(page.locator('[data-rht-toaster]')).toBeAttached();
    const visit = page.getByRole('link', { name: /Visit me/ });
    await expect(visit).toHaveAttribute('href', '/');
    await visit.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.landing-hero')).toBeVisible();
  }
});
