import { expect, test } from '@playwright/test';
test.skip(process.env.E2E_SERVER_WORKSPACE !== 'true', 'Legacy managed workspace requires a separately enabled server build.');

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'e2e-admin@example.com';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || 'e2e-admin-password-change-me';

test('health, local analysis, and managed workspace critical paths', async ({ page }) => {
  const health = await page.request.get('/api/health/ready');
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({ status: 'OK' });

  await page.goto('/upload');
  await page.getByRole('button', { name: /explore sample data/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('SaaS Growth', { exact: false }).first()).toBeVisible();

  await page.goto('/login');
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Password').fill(adminPassword);
  await page.getByRole('button', { name: /^sign in/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();

  const cookies = await page.context().cookies();
  const csrfToken = cookies.find((cookie) => cookie.name === 'csrf_token')?.value;
  expect(csrfToken).toBeTruthy();

  const upload = await page.request.post('/api/datasets/upload', {
    headers: { 'X-CSRF-Token': csrfToken },
    multipart: {
      name: 'Playwright dataset',
      file: {
        name: 'playwright.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('category,value\nA,10\nB,20\n'),
      },
    },
  });
  expect(upload.status()).toBe(201);
  const dataset = await upload.json();

  const analysis = await page.request.post('/api/analytics/descriptive', {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { datasetId: dataset.id },
  });
  expect(analysis.status()).toBe(200);
  await expect(analysis.json()).resolves.toHaveProperty('value.count', 2);

  const exported = await page.request.post(`/api/datasets/${dataset.id}/export`, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { format: 'csv' },
  });
  expect(exported.status()).toBe(200);
  expect(exported.headers()['content-disposition']).toContain('export.csv');

  await page.getByRole('button', { name: /sign out/i }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login$/);
});
