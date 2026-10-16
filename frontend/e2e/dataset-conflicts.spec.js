import { expect, test } from '@playwright/test';
import { approveImportedData, openWorkspaceActions } from './review-helpers';

test.skip(process.env.E2E_SERVER_WORKSPACE === 'true', 'Requires the personal workspace.');

test('retains a stale tab draft and saves a reviewed copy without overwriting the other tab', async ({ page, context }) => {
  // Hold the ordinary autosave long enough to put a second tab's commit
  // deterministically between draft publication and persistence.
  await page.addInitScript(() => {
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => schedule(callback, delay === 400 ? 3000 : delay, ...args);
    // Simulate two simultaneously visible windows so focus changes in the
    // test runner do not trigger the separate hidden-page flush policy.
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
  });
  await page.goto('/upload');
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({
    name: 'conflicts.csv', mimeType: 'text/csv', buffer: Buffer.from('ID,Amount\n001,10\n002,\n')
  });
  await page.getByRole('button', { name: /visualize dashboard/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/); await approveImportedData(page);
  const second = await context.newPage(); await second.goto('/dashboard');
  await expect(second.getByRole('textbox', { name: 'Ask a question about this dataset' })).toBeVisible();
  await openWorkspaceActions(second);
  await second.getByRole('button', { name: 'Data Health' }).click();
  const currentReview = second.getByRole('dialog', { name: 'Data Quality & Cleaning' });
  await currentReview.getByLabel('Missing numbers', { exact: true }).selectOption('zero');
  await expect(currentReview.getByRole('button', { name: 'Apply Preview', exact: true })).toBeEnabled();
  await openWorkspaceActions(page);
  await page.getByRole('button', { name: 'Data Health' }).click();
  await page.getByLabel('Amount analysis role', { exact: true }).selectOption('ignore');
  await expect(page.getByRole('heading', { name: 'Review data before visualization' })).toBeVisible();
  await currentReview.getByRole('button', { name: 'Apply Preview', exact: true }).click();
  await expect(currentReview).toBeHidden();
  await expect(page.getByRole('button', { name: 'Save unsaved rows as a copy' })).toBeVisible();
  await page.getByRole('button', { name: 'Save unsaved rows as a copy' }).click();
  await expect(page.getByRole('heading', { name: 'Review data before visualization' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save unsaved rows as a copy' })).toHaveCount(0);
  const sources = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('analytics-dashboard-local-data');
    request.onsuccess = () => {
      const database = request.result; const transaction = database.transaction(['datasets', 'datasetRows']);
      const read = transaction.objectStore('datasets').getAll(); const results = [];
      read.onsuccess = () => {
        for (const source of read.result) {
          const rows = transaction.objectStore('datasetRows').get([source.id, source.rowStorage.generation, 'rawRows', 0]);
          rows.onsuccess = () => results.push({ name: source.name, rows: rows.result.rows, approved: Boolean(source.qualityReview), overrides: source.columnOverrides });
        }
      };
      transaction.oncomplete = () => { database.close(); resolve(results); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
  expect(sources).toHaveLength(2);
  expect(sources.find(({ name }) => name === 'conflicts').rows[1]).toEqual({ ID: '002', Amount: 0 });
  const copy = sources.find(({ name }) => name.includes('(unsaved copy)'));
  expect(copy.rows[1]).toEqual({ ID: '002', Amount: '' }); expect(copy.approved).toBe(false);
  expect(copy.overrides.Amount.role).toBe('ignore');
  await second.close();
});
