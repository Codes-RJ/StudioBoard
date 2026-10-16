import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { approveImportedData, openWorkspaceActions } from './review-helpers';

const openInteractivePage = async (page, route) => {
  await page.goto(route, { waitUntil: 'networkidle' });
  // Public HTML arrives before React replaces the prerendered tree. The
  // existing toaster mounts only in the client shell; wait before interacting.
  await expect(page.locator('[data-rht-toaster]')).toBeAttached();
};

test('homepage import opens a working file flow and sample exploration preserves imported data', async ({ page }) => {
  // Import, approval, a full reload, sample selection and original download.
  // Windows WebKit needs more time for the complete multi-navigation journey;
  // individual assertions keep their ordinary deadlines.
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openInteractivePage(page, '/');
  await page.getByRole('link', { name: 'Import a dataset', exact: true }).first().click();
  await expect(page).toHaveURL(/\/upload$/);
  await page.getByLabel('Choose a data file', { exact: true }).setInputFiles({ name: 'editorial-sales.csv', mimeType: 'text/csv', buffer: Buffer.from('region,revenue\nNorth,120\nSouth,230\nWest,340\n') });
  await expect(page.getByLabel('Dataset Name')).toHaveValue('editorial-sales');
  await page.getByRole('button', { name: 'Visualize Dashboard' }).click();
  await approveImportedData(page);
  await expect(page.getByRole('heading', { name: 'editorial-sales', exact: true })).toBeVisible();
  const source = await page.getByLabel('Select dataset', { exact: true }).inputValue();
  await page.getByRole('link', { name: 'Analytics Dashboard home', exact: true }).first().click();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('[data-rht-toaster]')).toBeAttached();
  await page.getByRole('link', { name: 'Explore sample', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: /SaaS Growth/ })).toBeVisible();
  await page.getByLabel('Select dataset', { exact: true }).selectOption(source);
  await expect(page.getByRole('heading', { name: 'editorial-sales', exact: true })).toBeVisible();
  await openWorkspaceActions(page);
  await page.getByRole('button', { name: 'Data Health', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Original File', exact: true }).click();
  const original = await download;
  expect(await readFile(await original.path(), 'utf8')).toBe('region,revenue\nNorth,120\nSouth,230\nWest,340\n');
  expect(errors).toEqual([]);
});

test('feature guide presents chart examples, SVG illustrations and working section links', async ({ page }) => {
  await openInteractivePage(page, '/how-it-works');
  await expect(page).toHaveTitle(/How It Works/);
  await expect(page.getByRole('img', { name: /Illustration of/ })).toHaveCount(5);
  await page.getByRole('link', { name: /04.*Export and back up/ }).click();
  await expect(page).toHaveURL(/#keep$/);
  await expect(page.getByRole('heading', { name: 'Optional encrypted backups' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '40+ ways to see it.' })).toBeVisible();
  await expect(page.locator('.chart-gallery svg')).toHaveCount(3);
  await expect(page.locator('.chart-type-list')).toHaveCount(0);
  await expect(page.getByRole('note', { name: 'Browser import and analysis limits' })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.getByRole('heading', { name: 'Ask. Check. Understand.' })).toBeVisible();
  await page.getByRole('link', { name: 'Import your first dataset', exact: true }).click();
  await expect(page.getByLabel('Choose a data file', { exact: true })).toBeAttached();
});

test('public pages stay within a narrow phone viewport and mobile navigation works', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openInteractivePage(page, '/');
  const menu = page.locator('.mobile-menu-toggle');
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#mobile-navigation').getByRole('link', { name: 'How it works', exact: true }).click();
  await expect(page).toHaveTitle(/How It Works/);
  await expect(page.locator('#mobile-navigation')).toHaveCount(0);
  for (const route of ['/', '/how-it-works', '/upload', '/privacy', '/terms', '/missing-editorial-page']) {
    await openInteractivePage(page, route);
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});

test('legal section navigation resolves and the keyboard skip link moves focus to content', async ({ page, browserName }) => {
  await openInteractivePage(page, '/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible();
  // The Windows WebKit port skips native links on Tab, including in a plain
  // HTML control fixture. Check activation there; Chromium/Firefox check order.
  if (browserName === 'webkit') await page.getByRole('link', { name: 'Skip to content', exact: true }).focus();
  else await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await page.getByRole('navigation', { name: 'Privacy Policy sections' }).getByRole('link', { name: 'Backups and restoration', exact: true }).click();
  await expect(page).toHaveURL(/#document-section-3$/);
  await expect(page.locator('#document-section-3')).toContainText('AES-256-GCM');
  await openInteractivePage(page, '/terms');
  await expect(page.getByRole('navigation', { name: 'Terms of Service sections' }).locator('a')).toHaveCount(10);
  const links = await page.getByRole('navigation', { name: 'Terms of Service sections' }).locator('a').evaluateAll((nodes) => nodes.map((node) => node.hash));
  expect(links).toHaveLength(10);
  for (const hash of links) await expect(page.locator(hash)).toHaveCount(1);
});
