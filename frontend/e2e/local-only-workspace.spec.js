import { openWorkspaceActions } from './review-helpers.js';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.skip(process.env.E2E_SERVER_WORKSPACE === 'true', 'These checks require the default personal build.');

for (const width of [1440, 390]) {
  test(`private import, cleaning, chat, layout and backup work without an API at ${width}px`, async ({ page }) => {
    const requests = [];
    const sockets = [];
    page.on('request', (request) => requests.push({ url: request.url(), method: request.method(), body: request.postData() }));
    page.on('websocket', (socket) => sockets.push(socket.url()));
    await page.route('**/api/**', (route) => route.abort());
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/upload');
    await expect(page.getByRole('link', { name: 'Login', exact: true })).toHaveCount(0);
    await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({
      name: 'private-sentinel-source.csv', mimeType: 'text/csv',
      buffer: Buffer.from('ID,PrivateRevenue,PrivateRegion\n001,10,sentinel-west\n002,,sentinel-east\n003,30,sentinel-west\n'),
    });
    await page.getByRole('button', { name: /visualize dashboard/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('textbox', { name: 'Ask a question about this dataset' })).toHaveCount(0);
    await expect(page.locator('.recharts-wrapper')).toHaveCount(0);
    await page.getByRole('button', { name: 'Review Data' }).click();
    const quality = page.getByRole('dialog', { name: 'Data Quality & Cleaning' });
    await quality.getByLabel('Missing numbers', { exact: true }).selectOption('mean');
    await expect(quality.getByText(/Filled 1 missing value in "PrivateRevenue" with mean/)).toBeVisible();
    await quality.getByRole('button', { name: 'Approve Data' }).click();
    await expect(quality).toBeHidden();
    await page.getByRole('textbox', { name: 'Ask a question about this dataset' }).fill('Sum of PrivateRevenue');
    await page.getByRole('button', { name: /^Ask$/ }).click();
    await expect(page.getByText(/Total.*PrivateRevenue|PrivateRevenue.*60/i).last()).toBeVisible();
    await page.getByRole('button', { name: 'Smart Layout', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Choose an analysis goal' });
    await expect(review.getByText(/These recommendations are calculated on your device/)).toBeVisible();
    await expect(review.getByRole('button', { name: 'Request AI layout ideas' })).toHaveCount(0);
    await review.getByRole('button', { name: 'Use this layout' }).first().click();
    await page.getByRole('button', { name: 'New Layout', exact: true }).click();
    await page.getByRole('textbox', { name: 'Layout name', exact: true }).fill('private-sentinel-layout');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Select dashboard layout' })).toContainText('private-sentinel-layout');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('guest_dashboard_layouts'))).toContain('private-sentinel-layout');
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Select dashboard layout' })).toContainText('private-sentinel-layout');
    const download = page.waitForEvent('download');
    await openWorkspaceActions(page);
    await page.getByRole('button', { name: 'Backup', exact: true }).click();
    const records = (await readFile(await (await download).path(), 'utf8')).trim().split('\n').map((line) => JSON.parse(line).payload);
    const working = records.filter((record) => record.type === 'rows' && record.stream === 'rawRows').flatMap((record) => record.rows);
    const original = records.filter((record) => record.type === 'rows' && record.stream === 'sourceRows').flatMap((record) => record.rows);
    expect(working).toHaveLength(3);
    expect(working[1].PrivateRevenue).toBe(20);
    expect(original[1].PrivateRevenue).toBe('');
    expect(working[0].ID).toBe('001');
    expect(sockets).toEqual([]);
    expect(requests.filter(({ url }) => new URL(url).pathname.startsWith('/api'))).toEqual([]);
    expect(requests.filter(({ method }) => !['GET', 'HEAD'].includes(method))).toEqual([]);
    for (const request of requests) {
      expect(`${request.url} ${request.body || ''}`).not.toMatch(/private-sentinel|PrivateRevenue|PrivateRegion|sentinel-west|sentinel-east/);
      expect(new URL(request.url).origin).toBe(new URL(test.info().project.use.baseURL).origin);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('login and admin URLs cannot enable server behavior in the personal build', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api')) requests.push(request.url()); });
  await page.route('**/api/**', (route) => route.abort());
  for (const path of ['/login', '/admin']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveCount(0);
  }
  await page.goto('/privacy');
  await expect(page.getByText(/do not upload files or row values to an application server/)).toBeVisible();
  expect(requests).toEqual([]);
});

test('the personal preview rejects direct API requests without a backend proxy', async ({ request }) => {
  for (const path of ['/api', '/api/config', '/api/datasets/upload', '/metrics']) {
    const response = await request.get(path);
    expect(response.status()).toBe(404);
  }
});
