import { expect, test } from '@playwright/test';

test('public content is readable without JavaScript and workspace/error responses are noindex', async ({ request }) => {
  for (const [route, content] of [['/', 'A clearer'], ['/how-it-works', 'Spreadsheets and delimited files'], ['/privacy', 'Privacy Policy'], ['/terms', 'Terms of Service']]) {
    const response = await request.get(route); expect(response.status()).toBe(200);
    expect(await response.text()).toContain(content);
  }
  const workspace = await request.get('/dashboard?source=private-sentinel');
  expect(workspace.headers()['x-robots-tag']).toContain('noindex');
  expect(await workspace.text()).not.toContain('private-sentinel');
  expect(await workspace.text()).toContain('noindex,follow');
  const missing = await request.get('/missing-public-page');
  expect(missing.status()).toBe(404); expect(await missing.text()).toContain('Page Not Found');
  expect((await request.get('/robots.txt')).headers()['content-type']).toContain('text/plain');
  expect(await (await request.get('/sitemap.xml')).text()).not.toMatch(/dashboard|upload|login|admin/);
});

test('navigation updates titles and prevents workspace indexing without duplicate head tags', async ({ page }) => {
  await page.goto('/privacy');
  // Static legal HTML precedes the client router; wait for its handlers.
  await expect(page.locator('[data-rht-toaster]')).toBeAttached();
  await expect(page).toHaveTitle(/Privacy Policy/);
  await page.getByRole('link', { name: 'Terms', exact: true }).click(); await expect(page).toHaveTitle(/Terms of Service/);
  await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click(); await expect(page).toHaveTitle(/Local Dashboard/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,follow');
  await expect(page.locator('meta[name="description"]')).toHaveCount(1);
  await expect(page.locator('script[data-site-schema]')).toHaveCount(0);
});
