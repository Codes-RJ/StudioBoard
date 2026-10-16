import { expect, test } from '@playwright/test';

test('an original-file storage error leaves imports retryable and publishes no partial source', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === 'stagedFiles') throw new DOMException('Fixture original-file storage failure', 'UnknownError');
      return original.call(this, value, ...args);
    };
  });
  await page.goto('/upload');
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({ name: 'fixture.csv', mimeType: 'text/csv', buffer: Buffer.from('ID,Amount\n001,12\n') });
  const importButton = page.getByRole('button', { name: /visualize dashboard/i });
  await importButton.click();
  await expect(page.getByText('Fixture original-file storage failure')).toBeVisible();
  await expect(importButton).toBeEnabled();
  const counts = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('analytics-dashboard-local-data');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result; const names = ['datasets', 'stagedDatasets', 'stagedFiles', 'workspaceImports'];
      const transaction = db.transaction(names); const values = {};
      for (const name of names) { const request = transaction.objectStore(name).count(); request.onsuccess = () => { values[name] = request.result; }; }
      transaction.oncomplete = () => { db.close(); resolve(values); };
      transaction.onabort = () => reject(transaction.error);
    };
  }));
  expect(counts).toEqual({ datasets: 0, stagedDatasets: 0, stagedFiles: 0, workspaceImports: 0 });
});
