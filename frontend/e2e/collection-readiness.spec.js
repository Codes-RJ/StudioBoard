import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createCollection } from '../fixtures/collection.mjs';
import { approveCollectionRelationships, findFixtureSource, importFixtureCollection, readFixtureCatalog, selectFixtureSource } from './collection-helpers.mjs';
import { approveImportedData, openWorkspaceActions } from './review-helpers.js';

test('30 datasets retain originals and recover from a damaged backup with accessible editing', async ({ page }) => {
  test.skip(process.env.E2E_SERVER_WORKSPACE === 'true', 'Personal collection.'); test.setTimeout(360_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const fixtures = createCollection(); const catalog = await importFixtureCollection(page, fixtures);
  for (const fixture of fixtures) await selectFixtureSource(page, findFixtureSource(catalog, fixture));
  await openWorkspaceActions(page);
  await expect(page.getByRole('combobox', { name: 'Export format', exact: true })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
  const edit = page.getByRole('button', { name: 'Edit dashboard', exact: true }); await edit.click();
  const dialog = page.getByRole('dialog', { name: 'Edit dashboard' }); await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab'); await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Manage graphs', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await openWorkspaceActions(page);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Backup', exact: true }).click();
  const file = await download; const path = await file.path(); const bytes = await readFile(path);
  const records = bytes.toString('utf8').trim().split('\n').map((line) => JSON.parse(line).payload);
  expect(records[0].originalFiles).toHaveLength(30);
  for (const fixture of fixtures) {
    const original = records[0].originalFiles.find((original) => original.name === fixture.filename);
    expect(original).toBeTruthy();
    expect(Buffer.concat(records.filter((record) => record.type === 'file' && record.fileId === original.id).map((record) => Buffer.from(record.base64, 'base64')))).toEqual(Buffer.from(fixture.csv));
  }
  const ids = (await readFixtureCatalog(page)).map((source) => source.id).sort();
  await openWorkspaceActions(page);
  await page.getByLabel('Choose workspace backup').setInputFiles({ name: 'damaged.workspace.jsonl', mimeType: 'application/octet-stream', buffer: bytes.subarray(0, bytes.length - 100) });
  await expect(page.getByText(/incomplete|checksum|completion|truncat|invalid|damaged/i).last()).toBeVisible({ timeout: 60_000 });
  expect((await readFixtureCatalog(page)).map((source) => source.id).sort()).toEqual(ids);
  await openWorkspaceActions(page);
  await page.getByLabel('Choose workspace backup').setInputFiles(path);
  await expect(page.getByRole('heading', { name: 'Review data before visualization' })).toBeVisible({ timeout: 60_000 });
  const restored = (await readFixtureCatalog(page)).filter((source) => !ids.includes(source.id));
  // A restored individual selection requires that source's review. Select the
  // restored overview explicitly to review the entire collection before switching.
  await page.getByRole('combobox', { name: 'Switch dataset during review' }).selectOption(restored.find((source) => source.isFolderOverview).id);
  await approveImportedData(page);
  for (const fixture of fixtures) await selectFixtureSource(page, findFixtureSource(restored, fixture));
  expect(errors).toEqual([]);
});

test('a quota failure midway through a 30-file import publishes nothing and can be retried', async ({ page }) => {
  test.skip(process.env.E2E_SERVER_WORKSPACE === 'true', 'Personal collection.'); test.setTimeout(240_000);
  await page.addInitScript(() => {
    let staged = 0; window.fixtureFailQuota = true; const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'stagedFiles' && window.fixtureFailQuota && ++staged === 17) throw new DOMException('Fixture collection quota exhausted', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  const fixtures = createCollection(); await page.goto('/upload');
  await page.getByLabel('Choose several data files').setInputFiles(fixtures.map((fixture) => ({ name: fixture.filename, mimeType: 'text/csv', buffer: Buffer.from(fixture.csv) })));
  const analyze = page.getByRole('button', { name: 'Analyze whole folder' }); await analyze.click();
  await expect(page.getByText('Fixture collection quota exhausted')).toBeVisible({ timeout: 60_000 });
  expect(await readFixtureCatalog(page)).toEqual([]); await expect(analyze).toBeEnabled();
  const staged = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('analytics-dashboard-local-data'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result; const names = ['stagedFiles', 'stagedDatasets', 'workspaceImports']; const tx = db.transaction(names); const counts = {};
      for (const name of names) { const request = tx.objectStore(name).count(); request.onsuccess = () => { counts[name] = request.result; }; }
      tx.oncomplete = () => { db.close(); resolve(counts); }; };
  }));
  expect(staged).toEqual({ stagedFiles: 0, stagedDatasets: 0, workspaceImports: 0 });
  await page.evaluate(() => { window.fixtureFailQuota = false; }); await analyze.click();
  await expect(page.getByRole('heading', { name: 'Review data before visualization' })).toBeVisible({ timeout: 60_000 });
  await approveImportedData(page);
  expect((await readFixtureCatalog(page)).filter((source) => !source.isFolderOverview)).toHaveLength(30);
});

test('thirty sources can review twenty relationships and compute a joined measure', async ({ page }) => {
  test.skip(process.env.E2E_SERVER_WORKSPACE === 'true', 'Personal collection.'); test.setTimeout(240_000);
  const fixtures = createCollection(); const catalog = await importFixtureCollection(page, fixtures);
  await approveCollectionRelationships(page, fixtures, catalog);
  const events = findFixtureSource(catalog, fixtures[0]); const entities = findFixtureSource(catalog, fixtures[1]);
  const candidate = page.getByRole('region', { name: 'Folder overview' }).locator('article').filter({ hasText: events.sourcePath || events.name }).filter({ hasText: entities.sourcePath || entities.name });
  await candidate.getByLabel('Calculation', { exact: true }).selectOption('sum');
  await candidate.getByLabel('Measure', { exact: true }).selectOption(`${events.id}::Revenue`);
  await candidate.getByLabel('Group by', { exact: true }).selectOption(`${entities.id}::Label`);
  await candidate.getByRole('button', { name: 'Run analysis', exact: true }).click();
  await expect(candidate).toContainText('Matched joined rows: 37');
  for (const entity of fixtures[1].rows) {
    const expected = fixtures[0].rows.filter((row) => row.EntityKey === entity.EntityKey).reduce((sum, row) => sum + (row.Revenue ?? 0), 0);
    await expect(candidate.locator('li').filter({ hasText: entity.Label })).toContainText(String(expected));
  }
});
