import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { approveImportedData, openWorkspaceActions } from './review-helpers';
import { readStreamBackup } from './backup-helpers';

const input = (page) => page.locator('input[type="file"]:not([webkitdirectory])').first();
const readCatalog = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('analytics-dashboard-local-data');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const database = request.result;
    const transaction = database.transaction(database.objectStoreNames.contains('datasetRows') ? ['datasets', 'datasetRows'] : ['datasets'], 'readonly');
    let catalog = [];
    const rows = transaction.objectStore('datasets').getAll();
    rows.onsuccess = () => {
      catalog = rows.result;
      for (const source of catalog) for (const stream of ['rawRows', 'sourceRows']) {
        const spec = source.rowStorage?.streams?.[stream]; if (!spec) continue;
        source[stream] = new Array(spec.length);
        for (let index = 0; index < spec.chunks; index++) {
          const page = transaction.objectStore('datasetRows').get([source.id, source.rowStorage.generation, stream, index]);
          page.onsuccess = () => {
            if (!page.result?.rows) { transaction.abort(); return; }
            for (const [offset, row] of page.result.rows.entries()) source[stream][index * 512 + offset] = row;
          };
        }
      }
    };
    transaction.oncomplete = () => { database.close(); resolve(catalog); };
    transaction.onabort = () => { database.close(); reject(transaction.error || new Error('Incomplete stored rows')); };
  };
}));

const openFile = async (page, file, { review = true } = {}) => {
  await page.goto('/upload');
  await input(page).setInputFiles(file);
  await page.getByRole('button', { name: /visualize dashboard/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  if (review) await approveImportedData(page);
};

for (const extension of ['csv', 'tsv', 'txt', 'xlsx', 'xls']) {
  test(`single ${extension} import keeps blank rows, partial records, duplicates and empty columns`, async ({ page }) => {
    const requests = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && request.method() !== 'HEAD') requests.push(request.url());
    });
    let buffer;
    const rows = [['ID', 'Revenue', 'Region', 'Empty'], ['001', 10, 'West', null], [null, null, null, null], ['002', null, 'East', null], ['003', 30, 'West', null], ['003', 30, 'West', null]];
    if (['xlsx', 'xls'].includes(extension)) {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sales');
      buffer = XLSX.write(workbook, { type: 'buffer', bookType: extension === 'xls' ? 'biff8' : 'xlsx' });
    } else {
      buffer = Buffer.from(rows.map((row) => row.join(extension === 'tsv' ? '\t' : ',')).join('\n') + '\n');
    }
    await openFile(page, { name: `audit-${extension}.${extension}`, mimeType: 'application/octet-stream', buffer }, { review: false });
    await expect.poll(async () => (await readCatalog(page)).find(({ name }) => name === `audit-${extension}`)?.rawRows.length).toBe(5);
    let dataset = (await readCatalog(page)).find(({ name }) => name === `audit-${extension}`);
    expect(dataset.columns.map(({ name }) => name)).toEqual(['ID', 'Revenue', 'Region', 'Empty']);
    expect(dataset.rawRows[0].ID).toBe('001');
    if (process.env.E2E_SERVER_WORKSPACE === 'true') await openWorkspaceActions(page);
    await page.getByRole('button', { name: process.env.E2E_SERVER_WORKSPACE === 'true' ? 'Data Health' : 'Review Data' }).click();
    const health = page.getByRole('dialog', { name: 'Data Quality & Cleaning' });
    await expect(health.getByText('Rows before → after').locator('..')).toContainText('5 → 5');
    await health.getByLabel('Missing numbers', { exact: true }).selectOption('mean');
    await health.getByLabel('Missing categories', { exact: true }).selectOption('mode');
    await expect(health.getByText(/Filled 2 missing values in "Revenue" with mean/)).toBeVisible();
    await health.getByRole('button', { name: process.env.E2E_SERVER_WORKSPACE === 'true' ? 'Apply Preview' : 'Approve Data' }).click();
    await expect(health).toBeHidden();
    await expect(page.locator('table').filter({ has: page.locator('th[title="Toggle SortBy"]') }).getByRole('cell', { name: (70 / 3).toLocaleString('en-US'), exact: true })).toHaveCount(2);
    await expect.poll(async () => (await readCatalog(page)).find(({ name }) => name === `audit-${extension}`)?.cleaningRecipe?.length).toBe(1);
    dataset = (await readCatalog(page)).find(({ name }) => name === `audit-${extension}`);
    expect(dataset.rawRows).toHaveLength(5);
    expect(dataset.rawRows[1].Revenue).toBeCloseTo(70 / 3, 12);
    expect(dataset.rawRows[1].Region).toBe('West');
    expect(dataset.sourceRows).toHaveLength(5);
    await expect(page.getByText('Completeness', { exact: true }).locator('..').getByRole('paragraph')).toHaveText(/^70(?:\.0+)?%$/);
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Ask a question about this dataset' })).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await openWorkspaceActions(page);
    await page.getByRole('button', { name: /^Backup$/ }).click();
    const backup = await readStreamBackup(await (await downloadPromise).path());
    expect(backup.dataset.rawRows).toHaveLength(5);
    expect(backup.dataset.sourceRows[0].ID).toBe('001');
    expect(requests).toEqual([]);
    await openWorkspaceActions(page);
    await page.getByRole('button', { name: 'Data Health' }).click();
    await page.getByRole('button', { name: 'Reset to imported data' }).click();
    if (process.env.E2E_SERVER_WORKSPACE === 'true') await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    else await expect(page.getByRole('heading', { name: 'Review data before visualization' })).toBeVisible();
    await expect.poll(async () => (await readCatalog(page)).find(({ name }) => name === `audit-${extension}`)?.sourceRows).toBeUndefined();
  });
}

test('imports all 650 records, reloads them and exports complete data', async ({ page }) => {
  const source = 'ID,Revenue,Region\n' + Array.from({ length: 650 }, (_, index) => `${String(index).padStart(4, '0')},${index},${index % 2 ? 'East' : 'West'}`).join('\n') + '\n';
  await openFile(page, { name: 'large.csv', mimeType: 'text/csv', buffer: Buffer.from(source) });
  await expect.poll(async () => (await readCatalog(page)).find(({ name }) => name === 'large')?.rowCount).toBe(650);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Ask a question about this dataset' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Ask a question about this dataset' }).fill('How many rows?');
  await page.getByRole('button', { name: /^Ask$/ }).click();
  await expect(page.getByText(/650 rows/).last()).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await openWorkspaceActions(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const csv = await readFile(await (await downloadPromise).path(), 'utf8');
  expect(csv.trim().split(/\r?\n/)).toHaveLength(651);
  expect(csv).toContain('0649,649,East');
});

test('URL import validates HTTPS and analyzes a directly fetched CSV', async ({ page }) => {
  await page.route('https://audit.example/data.csv', (route) => route.fulfill({ contentType: 'text/csv', body: 'Region,Revenue\nWest,10\nEast,20\n' }));
  await page.goto('/upload');
  await page.getByRole('button', { name: /URL \/ Google Sheets/ }).click();
  await page.getByLabel('Public CSV or Google Sheets URL').fill('http://audit.example/data.csv');
  await page.getByRole('button', { name: 'Import & Visualize' }).click();
  await expect(page.getByText(/HTTPS/i).last()).toBeVisible();
  await page.getByLabel('Public CSV or Google Sheets URL').fill('https://audit.example/data.csv');
  await page.getByRole('button', { name: 'Import & Visualize' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect.poll(async () => (await readCatalog(page)).some(({ rowCount, isLocal }) => rowCount === 2 && isLocal)).toBe(true);
  await approveImportedData(page);
});

test('reports render actual dataset statistics and chart snapshots', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('.recharts-wrapper').first()).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  await openWorkspaceActions(page);
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  const report = await popupPromise;
  await expect(report.getByRole('heading', { name: 'SaaS Growth & Performance (Sample)' })).toBeVisible();
  await expect(report.getByRole('heading', { name: /Dashboard Charts/ })).toBeVisible();
  await expect(report.locator('svg').first()).toBeVisible();
  await expect(report.locator('figcaption').first()).toHaveText('Average MRR by Plan');
  await expect(report.getByText('87,666.6666667', { exact: false }).first()).toBeVisible();
});

for (const width of [360, 390, 768]) {
  test(`mobile and tablet navigation, analysis goals and graph editing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    if (width < 768) {
      await page.goto('/');
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.getByRole('button', { name: 'Close navigation' })).toHaveAttribute('aria-expanded', 'true');
      await page.locator('#mobile-navigation').getByRole('link', { name: 'Import data' }).click();
      await expect(page).toHaveURL(/\/upload$/);
      await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
    }
    await page.goto('/dashboard');
    await expect(page.getByRole('textbox', { name: 'Ask a question about this dataset' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Smart Layout' }).click();
    const review = page.getByRole('dialog', { name: 'Choose an analysis goal' });
    await review.getByLabel('Analysis goal').selectOption('trends');
    await review.getByRole('article').first().getByRole('button', { name: 'Use this layout' }).click();
    await page.getByRole('button', { name: 'Edit dashboard' }).click();
    await page.getByRole('dialog', { name: 'Edit dashboard' }).getByRole('button', { name: 'Add Bar graph', exact: true }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.react-grid-item').last().locator('.recharts-wrapper')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`mobile-${width}-dashboard.png`), fullPage: true });
  });
}

test('table pagination, sorting, filtering and refresh operate on all imported rows', async ({ page }) => {
  const source = 'ID,Revenue,Region\n' + Array.from({ length: 120 }, (_, index) => `${String(index).padStart(4, '0')},${index},${index % 2 ? 'East' : 'West'}`).join('\n');
  await openFile(page, { name: 'table-audit.csv', mimeType: 'text/csv', buffer: Buffer.from(source) });
  await expect(page.getByText('120 rows total', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Last', exact: true }).click();
  await expect(page.getByText('3 of 3', { exact: true })).toBeVisible();
  await expect(page.locator('tbody tr').filter({ hasText: '0100' })).toBeVisible();
  await page.getByLabel('Rows per page').selectOption('100');
  await expect(page.getByText('1 of 2', { exact: true })).toBeVisible();
  await page.locator('th[title="Toggle SortBy"]').filter({ hasText: /^Revenue$/ }).click();
  await expect(page.locator('tr[role="row"]').filter({ has: page.getByRole('cell', { name: '0000', exact: true }) })).toBeVisible();
  await page.locator('th[title="Toggle SortBy"]').filter({ hasText: /^Revenue$/ }).click();
  await expect(page.locator('tr[role="row"]').filter({ has: page.getByRole('cell', { name: '0119', exact: true }) })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle table filters' }).click();
  await page.getByLabel('Filter Region', { exact: true }).selectOption('East');
  await expect(page.getByText('60 rows total', { exact: true })).toBeVisible();
  await expect(page.getByText('1 of 1', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Filter Region', { exact: true }).locator('xpath=ancestor::table').locator('tbody').getByRole('cell', { name: 'West', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh table', exact: true }).click();
  await expect(page.getByText('60 rows total', { exact: true })).toBeVisible();
  await page.getByLabel('Filter Region', { exact: true }).selectOption('');
  await expect(page.getByText('120 rows total', { exact: true })).toBeVisible();
});

test('chat clarifies a missing measure and accepts the chosen column', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('textbox', { name: 'Ask a question about this dataset' }).fill('What is the average?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText(/could not confidently identify the columns/)).toBeVisible();
  await page.getByRole('button', { name: 'Use MRR', exact: true }).click();
  await expect(page.getByText(/Average MRR is/)).toContainText('87,666.6666667');
  await page.getByRole('button', { name: /Clear Chat/ }).click();
  await expect(page.getByText(/Average MRR is/)).toHaveCount(0);
});

test('malformed CSV and invalid backup fail visibly without replacing existing records', async ({ page }) => {
  await openFile(page, { name: 'retained.csv', mimeType: 'text/csv', buffer: Buffer.from('Region,Revenue\nWest,10\nEast,20\n') });
  await expect.poll(async () => (await readCatalog(page)).find(({ name }) => name === 'retained')?.rowCount).toBe(2);
  await page.goto('/upload');
  await input(page).setInputFiles({ name: 'malformed.csv', mimeType: 'text/csv', buffer: Buffer.from('Region,Revenue\nWest,10,unexpected\n') });
  await page.getByRole('button', { name: /visualize dashboard/i }).click();
  await expect(page.getByText(/Cannot safely import this file/).last()).toBeVisible();
  expect((await readCatalog(page)).find(({ name }) => name === 'retained')?.rowCount).toBe(2);
  expect((await readCatalog(page)).some(({ name }) => name === 'malformed')).toBe(false);
  await page.goto('/dashboard');
  await openWorkspaceActions(page);
  await page.getByLabel('Choose workspace backup').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.getByRole('status').filter({ hasText: 'Restoring workspace' })).toContainText(/failed|valid|JSON/i);
  expect((await readCatalog(page)).find(({ name }) => name === 'retained')?.rowCount).toBe(2);
});

test('reviewed identifiers remain unfilled through repeated cleaning recipes', async ({ page }) => {
  await openFile(page, { name: 'keys.csv', mimeType: 'text/csv', buffer: Buffer.from('Account Number,Revenue,Region\n101,10, West \n,,\n') }, { review: false });
  if (process.env.E2E_SERVER_WORKSPACE === 'true') await openWorkspaceActions(page);
  await page.getByRole('button', { name: process.env.E2E_SERVER_WORKSPACE === 'true' ? 'Data Health' : 'Review Data' }).click();
  await page.getByLabel('Account Number analysis role', { exact: true }).selectOption('identifier');
  for (let step = 0; step < 2; step++) {
    const health = page.getByRole('dialog', { name: 'Data Quality & Cleaning' });
    if (step === 1) {
      await health.getByLabel('Missing numbers', { exact: true }).selectOption('mean');
      await health.getByLabel('Missing categories', { exact: true }).selectOption('mode');
    }
    const applyName = step === 0 && process.env.E2E_SERVER_WORKSPACE !== 'true' ? 'Approve Data' : 'Apply Preview';
    await expect(health.getByRole('button', { name: applyName, exact: true })).toBeEnabled();
    await health.getByRole('button', { name: applyName, exact: true }).click();
    await expect(health).toBeHidden();
    await expect.poll(async () => (await readCatalog(page)).find(({ name }) => name === 'keys')?.cleaningRecipe?.length).toBe(step + 1);
    const dataset = (await readCatalog(page)).find(({ name }) => name === 'keys');
    expect(dataset.rawRows[1]).toEqual(step === 0
      ? { 'Account Number': '', Revenue: '', Region: '' }
      : { 'Account Number': '', Revenue: 10, Region: 'West' });
    if (step === 0) { await openWorkspaceActions(page); await page.getByRole('button', { name: 'Data Health' }).click(); }
  }
});

test('public page links and the missing-page recovery work on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/missing-page');
  const recovery = page.getByRole('link', { name: 'Go back home' });
  await expect(recovery).toBeVisible();
  expect(await recovery.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await recovery.click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible();
  await page.getByRole('contentinfo').getByRole('link', { name: 'Terms', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Terms of Service', exact: true })).toBeVisible();
  if (process.env.E2E_SERVER_WORKSPACE === 'true') {
    await page.getByRole('contentinfo').getByRole('link', { name: 'Login', exact: true }).click();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Login', exact: true })).toHaveCount(0);
    await page.goto('/login');
    await expect(page).toHaveURL(/\/dashboard$/);
  }
});
