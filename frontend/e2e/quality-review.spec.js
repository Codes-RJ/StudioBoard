import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { approveImportedData, openWorkspaceActions } from './review-helpers';
import { readStreamBackup } from './backup-helpers';

test.skip(process.env.E2E_SERVER_WORKSPACE === 'true', 'Required review applies to the personal workspace.');

const importSource = async (page) => {
  await page.goto('/upload');
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({ name: 'review.csv', mimeType: 'text/csv',
    buffer: Buffer.from('ID,A,B,Empty\n001,1,10,\n002,2,30,\n003,2,100,\n,,,\n') });
  await page.getByRole('button', { name: /visualize dashboard/i }).click();
  await expect(page.getByRole('heading', { name: 'Review data before visualization' })).toBeVisible();
};

test('review preserves blank rows, exact statistics, per-column decisions and cell lineage on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await importSource(page);
  await expect(page.locator('.recharts-wrapper')).toHaveCount(0);
  await page.getByRole('button', { name: 'Review Data' }).click();
  const review = page.getByRole('dialog', { name: 'Data Quality & Cleaning' });
  // A page can fit the phone while a modal's fieldset still clips its controls.
  await expect(review.locator('fieldset').first()).toBeVisible();
  expect(await review.locator('fieldset').first().evaluate((form) => {
    const panel = form.parentElement.getBoundingClientRect();
    return form.scrollWidth <= form.clientWidth + 1 && [...form.querySelectorAll('input, select')].every((control) => {
      const rect = control.getBoundingClientRect();
      return rect.width === 0 || (rect.left >= panel.left && rect.right <= panel.right);
    });
  })).toBe(true);
  await review.getByLabel('A missing-value policy', { exact: true }).selectOption('mean');
  await review.getByLabel('B missing-value policy', { exact: true }).selectOption('median');
  await expect(review.getByText(/Filled 1 missing value in "A" with mean/)).toBeVisible();
  await expect(review.getByText(/Filled 1 missing value in "B" with median/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await review.getByRole('button', { name: 'Approve Data' }).click();
  await expect(review).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Ask a question about this dataset' })).toBeVisible();
  const download = page.waitForEvent('download');
  await openWorkspaceActions(page);
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  const backup = await readStreamBackup(await (await download).path());
  expect(backup.dataset.rawRows).toHaveLength(4);
  expect(backup.dataset.rawRows[3]).toEqual({ ID: '', A: 5 / 3, B: 30, Empty: '' });
  expect(backup.dataset.sourceRows[3]).toEqual({ ID: '', A: '', B: '', Empty: '' });
  expect(backup.dataset.qualityReview.rows).toBe(4);
  await openWorkspaceActions(page);
  await page.getByRole('button', { name: 'Data Health' }).click();
  await page.getByText('Inspect cell history', { exact: true }).click();
  await page.getByLabel('Inspect source row').fill('4');
  await page.getByLabel('Inspect source column').selectOption('A');
  await expect(page.getByText(/Step 1: mean/)).toContainText('1.6666666666666667');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Ask a question about this dataset' })).toBeVisible();
  await openWorkspaceActions(page);
  await page.getByRole('button', { name: 'Data Health' }).click();
  await page.getByLabel('A analysis role', { exact: true }).selectOption('identifier');
  await expect(page.getByRole('heading', { name: 'Review data before visualization' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Ask a question about this dataset' })).toHaveCount(0);
  await approveImportedData(page);
});

test('a failed local approval save keeps review open and can be retried', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (record, ...args) {
      if (window.failReviewSave && record?.qualityReview?.approvedAt) throw new DOMException('Local storage is full.', 'QuotaExceededError');
      return original.call(this, record, ...args);
    };
    window.failReviewSave = true;
  });
  await importSource(page);
  await page.getByRole('button', { name: 'Review Data' }).click();
  const review = page.getByRole('dialog', { name: 'Data Quality & Cleaning' });
  await review.getByRole('button', { name: 'Approve Data' }).click();
  await expect(review.getByRole('alert')).toContainText('Local storage is full.');
  await expect(page.locator('.recharts-wrapper')).toHaveCount(0);
  await page.evaluate(() => { window.failReviewSave = false; });
  await review.getByRole('button', { name: 'Approve Data' }).click();
  await expect(review).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Ask a question about this dataset' })).toBeVisible();
});

test('approval rejects a stored source revision changed during preview', async ({ page }) => {
  await importSource(page);
  await page.getByRole('button', { name: 'Review Data' }).click();
  const review = page.getByRole('dialog', { name: 'Data Quality & Cleaning' });
  await expect(review.getByRole('button', { name: 'Approve Data' })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('analytics-dashboard-local-data');
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('datasets', 'readonly');
      const rows = transaction.objectStore('datasets').getAll();
      rows.onsuccess = () => resolve(rows.result.some(({ name }) => name === 'review'));
      transaction.oncomplete = () => database.close();
    };
  }))).toBe(true);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('analytics-dashboard-local-data');
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('datasets', 'readwrite');
      const store = transaction.objectStore('datasets');
      const rows = store.getAll();
      rows.onsuccess = () => {
        const source = rows.result.find(({ name }) => name === 'review');
        store.put({ ...source, revision: 'changed-in-another-tab' });
      };
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }));
  await review.getByRole('button', { name: 'Approve Data' }).click();
  await expect(review.getByRole('alert')).toContainText('The saved source changed.');
  await expect(page.locator('.recharts-wrapper')).toHaveCount(0);
  await page.reload();
  await approveImportedData(page);
});

test('upgrading an existing version-one browser database preserves its rows and requires review', async ({ page }) => {
  await page.route('**/storage-seed', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage fixture</title>' }));
  await page.goto('/storage-seed');
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('analytics-dashboard-local-data', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('datasets', { keyPath: 'id' });
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('datasets', 'readwrite');
      transaction.objectStore('datasets').put({ id: 'local-legacy', name: 'Legacy rows', isLocal: true, rowCount: 3,
        columns: [{ name: 'ID', type: 'string' }, { name: 'Revenue', type: 'number' }],
        rawRows: [{ ID: '001', Revenue: 10 }, { ID: '', Revenue: '' }, { ID: '003', Revenue: 30 }] });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  }));
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Review data before visualization' })).toBeVisible();
  await expect(page.getByText('3 rows · 2 columns · Review required', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Ask a question about this dataset' })).toHaveCount(0);
  await approveImportedData(page);
  const download = page.waitForEvent('download');
  await openWorkspaceActions(page);
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  const backup = await readStreamBackup(await (await download).path());
  expect(backup.version).toBe(6);
  expect(backup.originalFiles).toEqual([]); // Old data has no invented original-file archive.
  expect(backup.dataset.rawRows).toEqual([{ ID: '001', Revenue: 10 }, { ID: '', Revenue: '' }, { ID: '003', Revenue: 30 }]);
});
