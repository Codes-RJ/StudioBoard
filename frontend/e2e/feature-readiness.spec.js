import { expect, test } from '@playwright/test';
import { approveImportedData } from './review-helpers.js';

test('conversation preserves analytical context and RAG still returns source evidence without model downloads', async ({ page }) => {
  const downloads = [];
  page.on('request', (request) => { if (/huggingface\.co|raw\.githubusercontent\.com/.test(request.url())) downloads.push(request.url()); });
  await page.goto('/upload');
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({
    name: 'conversation.csv', mimeType: 'text/csv', buffer: Buffer.from('Region,Revenue,Notes\nWest,10,verified-west-marker\nEast,20,other\n'),
  });
  await page.getByRole('button', { name: /visualize dashboard/i }).click();
  await approveImportedData(page);
  const ask = async (question) => {
    await page.getByRole('textbox', { name: 'Ask a question about this dataset' }).fill(question);
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
  };
  await ask('Hello!');
  await expect(page.getByText(/Hello! What would you like to explore/)).toBeVisible();
  await ask('Hi, total Revenue by Region');
  await expect(page.getByText(/East leads with 20 Total Revenue/)).toBeVisible();
  await ask('Thank you');
  await expect(page.getByText(/welcome! We can continue with the same analysis/)).toBeVisible();
  await ask('What about West?');
  await expect(page.getByText(/West leads with 10 Total Revenue/)).toBeVisible();
  await ask('Bye');
  await expect(page.getByText(/Goodbye! Your conversation stays here/)).toBeVisible();
  await page.getByRole('button', { name: 'Browser AI and local search', exact: true }).click();
  await page.getByLabel('Assistant mode').selectOption('search');
  await page.keyboard.press('Escape');
  await ask('Hello');
  // Each assistant mode has its own persisted thread.
  await expect(page.getByText(/Hello! What would you like to explore/)).toBeVisible();
  await ask('verified-west-marker');
  await expect(page.getByText(/Matching local evidence is listed below/)).toBeVisible();
  await expect(page.getByText(/verified-west-marker/).last()).toBeVisible();
  expect(downloads).toEqual([]);
});

test('Smart Layout avoids summing rates and explains when a trend is unavailable', async ({ page }) => {
  await page.goto('/upload');
  const rows = Array.from({ length: 100 }, (_, index) => `customer-${index},${index % 2 ? 'East' : 'West'},${index % 2 ? 0.3 : 0.1}`);
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({
    name: 'rates.csv', mimeType: 'text/csv', buffer: Buffer.from('Customer,Region,ConversionRate\n' + rows.join('\n')),
  });
  await page.getByRole('button', { name: /visualize dashboard/i }).click();
  await approveImportedData(page);
  await page.getByRole('button', { name: 'Smart Layout', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Choose an analysis goal' });
  await review.getByLabel('Analysis goal').selectOption('trends');
  const trend = review.locator('article').filter({ has: page.getByRole('heading', { name: 'Trends dashboard', exact: true }) });
  await expect(trend).toContainText('No usable date field');
  await review.getByLabel('Analysis goal').selectOption('comparisons');
  const comparison = review.locator('article').filter({ has: page.getByRole('heading', { name: 'Comparisons dashboard', exact: true }) });
  await expect(comparison).toContainText('Average ConversionRate by Region');
  await expect(comparison).toContainText('unweighted');
  await expect(comparison).toContainText('100 of 100 rows');
  await expect(comparison).not.toContainText('by Customer');
  await comparison.getByRole('button', { name: 'Use this layout' }).click();
  await expect(page.getByRole('figure', { name: /Average ConversionRate by Region\. bar chart.*using average/i })).toBeVisible();
});

test('Smart Layout switches keep workspace controls mounted and settle chart positions', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Exit Smart', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Smart Layout', exact: true })).toBeVisible();
  const before = await page.evaluate(() => {
    window.__workspaceControls = document.querySelector('.workspace-command-bar');
    return window.__workspaceControls.getBoundingClientRect().x;
  });
  await page.getByRole('button', { name: 'Smart Layout', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Choose an analysis goal' });
  await review.getByLabel('Analysis goal').selectOption('comparisons');
  await review.locator('article').filter({ has: page.getByRole('heading', { name: 'Comparisons dashboard', exact: true }) })
    .getByRole('button', { name: 'Use this layout' }).click();
  await expect(review).toBeHidden();
  await expect(page.getByRole('button', { name: 'Exit Smart', exact: true })).toBeVisible();
  const after = await page.evaluate(() => ({
    sameControls: document.querySelector('.workspace-command-bar') === window.__workspaceControls,
    x: document.querySelector('.workspace-command-bar').getBoundingClientRect().x,
    transition: getComputedStyle(document.querySelector('.react-grid-item')).transitionDuration,
  }));
  expect(after.sameControls).toBe(true);
  expect(Math.abs(after.x - before)).toBeLessThan(2);
  expect(after.transition).toBe('0s');
  await page.getByRole('button', { name: 'Smart Layout', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Choose an analysis goal' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileX = await page.evaluate(() => document.querySelector('.workspace-command-bar').getBoundingClientRect().x);
  const mobileReview = page.getByRole('dialog', { name: 'Choose an analysis goal' });
  await mobileReview.getByLabel('Analysis goal').selectOption('trends');
  await mobileReview.locator('article').filter({ has: page.getByRole('heading', { name: 'Trends dashboard', exact: true }) })
    .getByRole('button', { name: 'Use this layout' }).click();
  await expect(mobileReview).toBeHidden();
  expect(await page.evaluate(() => document.querySelector('.workspace-command-bar') === window.__workspaceControls)).toBe(true);
  expect(Math.abs(await page.evaluate(() => document.querySelector('.workspace-command-bar').getBoundingClientRect().x) - mobileX)).toBeLessThan(2);
});
