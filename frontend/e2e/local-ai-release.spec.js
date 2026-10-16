import { expect, test } from '@playwright/test';
import { approveImportedData } from './review-helpers';

test('release keeps evidence search and calculations without offering LLM downloads', async ({ page }) => {
  test.skip(process.env.E2E_SERVER_WORKSPACE === 'true', 'Personal release only.');
  const modelRequests = [];
  page.on('request', (request) => { if (/huggingface\.co|raw\.githubusercontent\.com/.test(request.url())) modelRequests.push(request.url()); });
  await page.goto('/upload');
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({ name: 'release.csv', mimeType: 'text/csv', buffer: Buffer.from('ID,Revenue,Notes\n001,10,release-marker\n002,20,other\n') });
  await page.getByRole('button', { name: /visualize dashboard/i }).click(); await approveImportedData(page);
  await page.getByRole('button', { name: 'Browser AI and local search', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download / load LLM', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download / load semantic search', exact: true })).toBeVisible();
  const mode = page.getByLabel('Assistant mode');
  await expect(mode.locator('option')).toHaveText(['Deterministic calculations', 'Evidence search / RAG retrieval']);
  await mode.selectOption('search');
  await page.getByRole('textbox', { name: 'Ask a question about this dataset' }).fill('release-marker');
  await page.getByRole('button', { name: /^Ask$/ }).click();
  await expect(page.getByText('Matching local evidence is listed below.', { exact: false })).toBeVisible();
  expect(modelRequests).toEqual([]);
});
