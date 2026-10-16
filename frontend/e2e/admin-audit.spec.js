import { expect, test } from '@playwright/test';
test.skip(process.env.E2E_SERVER_WORKSPACE !== 'true', 'Accounts and admin are excluded from the personal build.');

test('administrator login errors, configuration persistence, refresh and mobile controls', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('e2e-admin@example.com');
  await page.getByLabel('Password', { exact: true }).fill('incorrect-audit-password');
  await page.getByRole('button', { name: /^sign in/i }).click();
  await expect(page.getByText(/invalid|incorrect|credentials/i).last()).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Password', { exact: true }).fill('e2e-admin-password-change-me');
  await page.getByRole('button', { name: /^sign in/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText('e2e-admin@example.com', { exact: true })).toBeVisible();
  const original = await page.getByLabel('Homepage title', { exact: true }).inputValue();
  try {
    await page.getByLabel('Homepage title', { exact: true }).fill('Browser audit temporary title');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('Site settings saved.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Homepage title', { exact: true })).toHaveValue('Browser audit temporary title');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('mobile-admin.png'), fullPage: true });
  } finally {
    await page.getByLabel('Homepage title', { exact: true }).fill(original);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('Site settings saved.', { exact: true })).toBeVisible();
  }
});
