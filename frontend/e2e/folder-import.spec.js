import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import * as XLSX from 'xlsx';
import { approveImportedData, openWorkspaceActions } from './review-helpers';

test('imports a nested folder and backs up its datasets in the browser', async ({ page }) => {
  test.skip(process.env.E2E_SERVER_WORKSPACE === 'true', 'Preserving source review targets the personal workspace.');
  test.setTimeout(60_000);
  const apiWrites = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      apiWrites.push(`${request.method()} ${request.url()}`);
    }
  });
  const folder = test.info().outputPath('job-folder');
  await mkdir(path.join(folder, 'West'), { recursive: true });
  await mkdir(path.join(folder, 'East'), { recursive: true });
  await writeFile(path.join(folder, 'West', 'sales.csv'), 'Customer ID,Region,Revenue\nc1,West,10\nc2,West,20\nc2,West,20\n');
  await writeFile(path.join(folder, 'East', 'sales.csv'), 'Customer ID,Region,Revenue\nc2,East,30\n');

  await page.goto('/upload');
  await page.getByLabel('Choose a folder of data files').setInputFiles(folder);
  await expect(page.getByText(/job-folder: 2 supported files/i)).toBeVisible();
  await page.getByRole('button', { name: /analyze whole folder/i }).click();

  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  await approveImportedData(page);
  const overview = page.getByRole('region', { name: 'Folder overview' });
  await expect(overview).toContainText('2 datasets from 2 files');
  await expect(overview).toContainText('4 source rows');
  await overview.getByRole('button', { name: 'Review possible relationships' }).click();
  const relationship = page.locator('article').filter({ hasText: /Customer ID.*Customer ID/ });
  await expect(relationship).toContainText('one-to-many');
  await relationship.getByRole('button', { name: 'Approve relationship' }).click();
  await expect(relationship).toContainText('Approved for deterministic cross-file analysis');
  await relationship.getByLabel('Calculation').selectOption('sum');
  await relationship.getByLabel('Measure', { exact: true }).selectOption({ label: 'job-folder/West/sales.csv · Revenue' });
  await relationship.getByLabel('Group by').selectOption({ label: 'job-folder/East/sales.csv · Region' });
  await relationship.getByRole('button', { name: 'Run analysis' }).click();
  await expect(relationship).toContainText('Sources: job-folder/East/sales.csv + job-folder/West/sales.csv');
  await expect(relationship).toContainText('40');
  await overview.getByRole('button', { name: /West\/sales.csv/i }).click();
  await expect(page.getByRole('button', { name: 'Back to folder overview' })).toBeVisible();
  await openWorkspaceActions(page);
  await page.getByRole('button', { name: 'Data Health' }).click();
  const health = page.getByRole('heading', { name: 'Data Quality & Cleaning' });
  await expect(health).toBeVisible();
  await expect(page.getByText(/Rows before/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Remove duplicate rows/ })).toHaveCount(0);
  await expect(page.getByText('Rows before → after', { exact: true }).locator('..')).toContainText('3 → 3');
  await expect(page.getByRole('button', { name: 'Undo last step' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo last step' }).click();
  await approveImportedData(page);
  await page.getByRole('button', { name: 'Back to folder overview' }).click();
  await expect(page.getByRole('region', { name: 'Folder overview' })).toContainText('4 source rows');
  await expect(page.getByText('needs review')).toBeVisible();

  // Local IndexedDB writes are debounced so folder metadata and the source update persist together.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Folder overview' })).toContainText('4 source rows');

  const downloadPromise = page.waitForEvent('download');
  await openWorkspaceActions(page);
  await page.getByRole('button', { name: /^backup$/i }).click();
  const download = await downloadPromise;
  const backup = JSON.parse((await readFile(await download.path(), 'utf8')).split('\n')[0]).payload;
  expect(backup.version).toBe(6);
  expect(backup.datasets).toHaveLength(3);
  expect(backup.datasets.filter(({ isFolderOverview }) => !isFolderOverview).map(({ sourcePath }) => sourcePath).sort()).toEqual([
    'job-folder/East/sales.csv',
    'job-folder/West/sales.csv',
  ]);

  await openWorkspaceActions(page);
  await page.getByLabel('Choose workspace backup').setInputFiles(await download.path());
  await expect(page.getByRole('status').filter({ hasText: 'Restoring workspace' })).toContainText('Restored 4 source rows');
  await approveImportedData(page);
  await expect(page.getByRole('region', { name: 'Folder overview' })).toContainText('2 datasets from 2 files');
  await expect(page.getByText('needs review')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Folder overview' })).toContainText('2 datasets from 2 files');
  expect(apiWrites).toEqual([]);
});

test('imports every sheet of a single Excel workbook', async ({ page }) => {
  let aiProfile = null;
  await page.route('**/api/config', (route) => route.fulfill({ json: {
    branding: { siteName: 'Analytics Dashboard', homeTitle: 'Analytics Dashboard', homeDescription: 'Turn spreadsheets into practical dashboards and direct answers.', primaryColor: '#2563EB', template: 'standard' },
    sections: { showCapabilities: true, showDashboard: true, showUpload: true },
    features: { localUpload: true, urlImport: true, dataAssistant: true, reports: true, exports: true, serverWorkspace: 'admin', serverAnalytics: 'admin', serverLayouts: 'admin', serverExports: 'admin', aiLayoutSuggestions: 'authenticated' },
  } }));
  await page.route('**/api/ai/status', (route) => route.fulfill({ json: { available: true } }));
  await page.route('**/api/ai/dashboard-plan', async (route) => {
    aiProfile = route.request().postDataJSON();
    await route.fulfill({ json: {
      title: 'AI sourced workbook view', summary: 'Compare rows by source.',
      cards: [{ title: 'Rows by source', chartType: 'bar', xField: 'Source', yField: 'Rows', aggregation: 'sum' }],
    } });
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Revenue: 10 }]), 'Sales');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Cost: 4 }]), 'Costs');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  await page.goto('/upload');
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({
    name: 'job.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  });
  await page.getByRole('button', { name: /visualize dashboard/i }).click();

  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  await approveImportedData(page);
  const overview = page.getByRole('region', { name: 'Workbook overview' });
  await expect(overview).toContainText('2 datasets from 1 file');
  await expect(overview).toContainText('job.xlsx / Sales');
  await expect(overview).toContainText('job.xlsx / Costs');
  await page.getByRole('button', { name: 'Smart Layout' }).click();
  const layoutReview = page.getByRole('dialog', { name: 'Choose an analysis goal' });
  await expect(layoutReview.getByText(/Score \d+\/100/).first()).toBeVisible();
  await expect(layoutReview.getByRole('article').first()).toContainText('Fields:');
  await layoutReview.getByRole('button', { name: 'Not useful' }).first().click();
  await expect(layoutReview.getByRole('status')).toContainText('Saved 1 response');
  const aiConsent = layoutReview.getByLabel(/Send column names, inferred types and roles/);
  if (process.env.E2E_SERVER_WORKSPACE === 'true') {
    await aiConsent.check();
    await layoutReview.getByRole('button', { name: 'Request AI layout ideas' }).click();
    await expect(layoutReview.getByRole('heading', { name: 'AI sourced workbook view' })).toBeVisible();
    expect(aiProfile.goal).toBe('overview');
    expect(aiProfile.columns.map(({ name }) => name)).toContain('Rows');
    expect(JSON.stringify(aiProfile)).not.toContain('Sales');
    expect(JSON.stringify(aiProfile)).not.toContain('10');
  } else {
    await expect(aiConsent).toHaveCount(0);
    await expect(layoutReview.getByText(/These recommendations are calculated on your device/)).toBeVisible();
    expect(aiProfile).toBeNull();
  }
  await layoutReview.getByRole('button', { name: 'Use this layout' }).first().click();
  await expect(layoutReview).toBeHidden();
});
