import { openWorkspaceActions } from './review-helpers.js';
import { expect, test } from '@playwright/test';

test('clearing the selected source hides the assistant and allows selecting again', async ({ page }) => {
  await page.goto('/dashboard');
  const selector = page.getByRole('combobox', { name: 'Select dataset', exact: true });
  await expect(selector).toHaveValue(/.+/);
  const sourceId = await selector.inputValue();
  await selector.selectOption('');
  await expect(selector).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Ask a question about this dataset' })).toHaveCount(0);
  await expect(page.getByText('Let’s get you back to your data.', { exact: true })).toHaveCount(0);
  await selector.selectOption(sourceId);
  await expect(page.getByRole('textbox', { name: 'Ask a question about this dataset' })).toBeVisible();
});
import { readFile } from 'node:fs/promises';
import { readStreamBackup } from './backup-helpers';

test.skip(process.env.E2E_SERVER_WORKSPACE === 'true', 'Requires the personal workspace.');

test('migrates an old catalog and reads rows only for the selected source', async ({ page }) => {
  test.setTimeout(90_000);
  // A text resource gives the fresh test origin without mounting app providers.
  await page.goto('/robots.txt');
  const fixture = await page.evaluate(async () => {
    const datasets = Array.from({ length: 3 }, (_, index) => {
      const id = `catalog-${index + 1}`;
      const rawRows = Array.from({ length: 10_000 }, (_, row) => ({ ID: String(row).padStart(6, '0'), Amount: index + 1, Region: 'West' }));
      return { id, name: `Catalog source ${index + 1}`, isLocal: true, revision: 'r1', rowCount: rawRows.length,
        columns: [{ name: 'ID', type: 'string' }, { name: 'Amount', type: 'number' }, { name: 'Region', type: 'string' }],
        rawRows, sourceRows: rawRows, qualityReviewRequired: true,
        qualityReview: { approvedAt: '2026-10-03', rows: rawRows.length, revisionKey: `${id}::r1::10000::ID|Amount|Region::[]` } };
    });
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('analytics-dashboard-local-data', 4);
      request.onupgradeneeded = () => {
        const rows = request.result.createObjectStore('datasets', { keyPath: 'id' });
        const metadata = request.result.createObjectStore('datasetMetadata', { keyPath: 'id' });
        for (const dataset of datasets) { rows.put(dataset); metadata.put({ id: dataset.id, rowCount: dataset.rowCount }); }
      };
      request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
    });
    return { sources: datasets.length, rowsPerSource: 10_000, serializedSourceBytes: new Blob([JSON.stringify(datasets)]).size };
  });
  await page.addInitScript(() => {
    window.catalogReads = [];
    for (const method of ['getAll', 'get', 'openCursor']) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args) {
        const entry = { store: this.name, method, key: args[0], started: performance.now() };
        window.catalogReads.push(entry);
        const request = original.apply(this, args);
        request.addEventListener('success', () => { entry.elapsedMs = performance.now() - entry.started; });
        return request;
      };
    }
  });
  await page.goto('/dashboard');
  const selector = page.getByRole('combobox', { name: 'Select dataset', exact: true });
  // This cold fixture upgrades 30,000 legacy rows and originals in one
  // transaction. Its completion is a correctness check, not a 5s SLA.
  await expect(selector).toHaveValue('catalog-1', { timeout: 30_000 });
  await expect(page.getByRole('textbox', { name: 'Ask a question about this dataset' })).toBeVisible();
  // The upgrade necessarily visits existing rows once. Subsequent startup uses
  // summaries, and recovery-control discovery must not load all restored rows.
  await page.reload();
  await expect(selector).toHaveValue('catalog-1');
  const startup = await page.evaluate(() => ({
    readyMs: performance.now(), reads: window.catalogReads.filter((entry) => entry.store === 'datasets'),
  }));
  expect(startup.reads.map(({ method, key }) => [method, key])).toEqual([['get', 'catalog-1']]);
  await selector.selectOption('catalog-2');
  await expect(selector).toHaveValue('catalog-2');
  const reads = await page.evaluate(() => window.catalogReads.filter((entry) => entry.store === 'datasets'));
  expect(reads.map(({ method, key }) => [method, key])).toEqual([['get', 'catalog-1'], ['get', 'catalog-2']]);
  await page.getByRole('textbox', { name: 'Ask a question about this dataset' }).fill('Sum of Amount');
  await page.getByRole('button', { name: /^Ask$/ }).click();
  await expect(page.getByText(/20,000/).last()).toBeVisible();
  const download = page.waitForEvent('download');
  await openWorkspaceActions(page);
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  const backup = await readStreamBackup(await (await download).path());
  expect(backup.dataset.rawRows).toHaveLength(10_000);
  expect(backup.dataset.rawRows[9999]).toEqual({ ID: '009999', Amount: 2, Region: 'West' });
  const catalogBytes = await page.evaluate(async () => {
    const request = indexedDB.open('analytics-dashboard-local-data');
    const database = await new Promise((resolve) => { request.onsuccess = () => resolve(request.result); });
    const read = database.transaction('datasetMetadata').objectStore('datasetMetadata').getAll();
    const catalog = await new Promise((resolve) => { read.onsuccess = () => resolve(read.result); });
    database.close(); return new Blob([JSON.stringify(catalog)]).size;
  });
  const metrics = { ...fixture, serializedCatalogBytes: catalogBytes, startupReadyMs: startup.readyMs, selectedReads: reads };
  console.log('Catalog fixture measurements:', JSON.stringify(metrics));
  expect(catalogBytes).toBeLessThan(fixture.serializedSourceBytes / 100);
  await test.info().attach('catalog-measurements.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
});
