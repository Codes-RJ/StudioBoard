import { expect } from '@playwright/test';
import { approveImportedData, openWorkspaceActions } from './review-helpers.js';

export const readFixtureCatalog = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('analytics-dashboard-local-data'); open.onerror = () => reject(open.error);
  open.onsuccess = () => { const db = open.result; const read = db.transaction('datasetMetadata').objectStore('datasetMetadata').getAll();
    read.onsuccess = () => { resolve(read.result); db.close(); }; read.onerror = () => { reject(read.error); db.close(); }; };
}));
export const findFixtureSource = (catalog, fixture) => catalog.find((source) => !source.isFolderOverview &&
  (source.sourcePath?.endsWith(fixture.filename) || source.name === fixture.filename || source.name === fixture.name));
export async function importFixtureCollection(page, fixtures, { reviewTimeout } = {}) {
  await page.goto('/upload');
  await page.getByLabel('Choose several data files').setInputFiles(fixtures.map((fixture) => ({ name: fixture.filename, mimeType: 'text/csv', buffer: Buffer.from(fixture.csv) })));
  await page.getByRole('button', { name: 'Analyze whole folder' }).click();
  // Thirty sequential file workers can legitimately outlast the default 5s
  // assertion deadline, especially in WebKit. Wait for completed publication.
  await expect(page.getByRole('heading', { name: 'Review data before visualization' })).toBeVisible({ timeout: 60_000 });
  await approveImportedData(page, { timeout: reviewTimeout });
  const catalog = await readFixtureCatalog(page);
  expect(fixtures.every((fixture) => Boolean(findFixtureSource(catalog, fixture)))).toBe(true);
  return catalog;
}
export async function selectFixtureSource(page, source) {
  const selector = page.getByRole('combobox', { name: 'Select dataset', exact: true }); await selector.selectOption(source.id);
  await openWorkspaceActions(page);
  await expect(page.getByRole('button', { name: 'Data Health', exact: true, includeHidden: true })).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByRole('textbox', { name: 'Ask a question about this dataset' })).toBeEnabled();
  await expect(page.getByText(new RegExp(`Showing .* of ${source.rowCount}$`))).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[role="figure"][aria-busy="true"]')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('[role="figure"] [role="alert"]')).toHaveCount(0);
}

export async function approveCollectionRelationships(page, fixtures, catalog) {
  const overview = page.getByRole('region', { name: 'Folder overview' });
  await overview.getByText('Review a custom or composite key', { exact: true }).click();
  for (const fixture of fixtures.filter((fixture) => fixture.metric)) {
    const domain = fixture.id.replace('-events', '');
    for (const [leftName, rightName, key] of [[`${domain}-events`, `${domain}-entities`, 'EntityKey'], [`${domain}-entities`, `${domain}-zones`, 'ZoneKey']]) {
      const left = findFixtureSource(catalog, fixtures.find((item) => item.id === leftName));
      const right = findFixtureSource(catalog, fixtures.find((item) => item.id === rightName));
      await overview.getByLabel('left relationship source', { exact: true }).selectOption(left.id);
      await overview.getByLabel('right relationship source', { exact: true }).selectOption(right.id);
      await overview.getByLabel('left key 1', { exact: true }).selectOption(key); await overview.getByLabel('right key 1', { exact: true }).selectOption(key);
      await overview.getByRole('button', { name: 'Preview key relationship' }).click();
      await overview.getByRole('button', { name: 'Approve relationship', exact: true }).click();
    }
  }
  await expect(overview.getByText('Approved for deterministic cross-file analysis', { exact: false })).toHaveCount(20);
}
