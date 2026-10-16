import { expect, test } from '@playwright/test';
import * as XLSX from 'xlsx';
import { approveImportedData, openWorkspaceActions } from './review-helpers';

test('the homepage favicon is delivered as SVG without weakening personal route boundaries', async ({ request }) => {
  const home = await request.get('/');
  expect(await home.text()).toContain('href="/favicon.svg"');
  const favicon = await request.get('/favicon.svg');
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()['content-type']).toContain('image/svg+xml');
  expect(await favicon.text()).toContain('<svg');
  expect((await request.get('/missing-favicon.svg')).status()).toBe(404);
  expect((await request.get('/api/config')).status()).toBe(404);
});

test('a local Excel workbook imports and exports in the browser', async ({ page }) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Revenue: 10 }]), 'Data');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  await page.goto('/dashboard');
  await page.locator('input[type="file"][accept*="xlsx"]').first().setInputFiles({
    name: 'review-metrics.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer
  });
  await approveImportedData(page);
  await expect(page.getByRole('heading', { name: 'review-metrics' })).toBeVisible();

  await openWorkspaceActions(page);
  await page.getByLabel('Export format', { exact: true }).selectOption('xlsx');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('review-metrics_export.xlsx');
});

test('the homepage uses SVG artwork without raster hero or advanced renderer downloads', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('img', { name: /Sample monthly revenue/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Illustration of spreadsheet files/ })).toBeVisible();
  expect(requests.filter((url) => /\.(png|jpe?g|webp|avif)(\?|$)/i.test(url))).toEqual([]);
  expect(requests.filter((url) => /\/(plotly|vendor-xlsx)[^/]*\.js/.test(url))).toEqual([]);
});

test('advanced charts fetch capability-specific Plotly bundles', async ({ page }) => {
  test.setTimeout(60000);
  const plotlyRequests = [];
  page.on('response', (response) => {
    const assetName = new URL(response.url()).pathname.split('/').at(-1);
    if (assetName.startsWith('plotly')) plotlyRequests.push(assetName);
  });

  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Edit dashboard' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit dashboard' });
  await editor.getByRole('button', { name: 'Add Histogram graph' }).click();
  const histogram = page.locator('.react-grid-item').filter({
    has: page.locator('input[aria-label="Chart title"][value="Histogram chart"]')
  });
  await expect(histogram.getByRole('img', { name: 'Histogram chart interactive visualization' }).locator('.plot-container')).toBeVisible({ timeout: 15000 });
  expect(plotlyRequests.some((name) => name.startsWith('plotly-cartesian.min-'))).toBe(true);
  expect(plotlyRequests.some((name) => /^plotly\.min-/.test(name))).toBe(false);

  await page.getByRole('button', { name: 'Manage graphs' }).click();
  await editor.getByRole('button', { name: 'Add 4D bubble graph' }).click();
  const bubble = page.locator('.react-grid-item').filter({
    has: page.locator('input[aria-label="Chart title"][value="4D bubble chart"]')
  });
  await bubble.getByRole('button', { name: 'Configure 4D bubble chart' }).click();
  await bubble.scrollIntoViewIfNeeded();
  const bubbleChart = bubble.getByRole('img', { name: '4D bubble chart interactive visualization' });
  await expect(bubbleChart).toBeVisible({ timeout: 15000 });
  await expect(bubbleChart.locator('.gl-container canvas').first()).toBeVisible({ timeout: 15000 });
  expect(plotlyRequests.some((name) => name.startsWith('plotly-gl3d.min-'))).toBe(true);
  expect(plotlyRequests.some((name) => /^plotly\.min-/.test(name))).toBe(false);

  await page.getByRole('button', { name: 'Manage graphs' }).click();
  await editor.getByRole('button', { name: 'Add Candlestick graph' }).click();
  const candlestick = page.locator('.react-grid-item').filter({
    has: page.locator('input[aria-label="Chart title"][value="Candlestick chart"]')
  });
  await candlestick.getByRole('button', { name: 'Configure Candlestick chart' }).click();
  await candlestick.scrollIntoViewIfNeeded();
  await expect(candlestick.getByRole('img', { name: 'Candlestick chart interactive visualization' }).locator('.plot-container')).toBeVisible({ timeout: 15000 });
  expect(plotlyRequests.some((name) => name.startsWith('plotly-finance.min-'))).toBe(true);

  await page.getByRole('button', { name: 'Manage graphs' }).click();
  await editor.getByRole('button', { name: 'Add Radar graph' }).click();
  const radar = page.locator('.react-grid-item').filter({
    has: page.locator('input[aria-label="Chart title"][value="Radar chart"]')
  });
  await radar.getByRole('button', { name: 'Configure Radar chart' }).click();
  await radar.scrollIntoViewIfNeeded();
  await expect(radar.getByRole('img', { name: 'Radar chart interactive visualization' }).locator('.plot-container')).toBeVisible({ timeout: 15000 });
  expect(plotlyRequests.some((name) => /^plotly\.min-/.test(name))).toBe(true);
});
