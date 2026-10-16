import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import Papa from 'papaparse';
import { approveImportedData, openWorkspaceActions } from './review-helpers';
import { readStreamBackup } from './backup-helpers';

test.skip(process.env.E2E_SERVER_WORKSPACE === 'true', 'Source preservation targets the personal workspace.');

test('CSV worker preserves prototype-shaped headers through exports and portable restore', async ({ page }) => {
  const bytes = Buffer.from('__proto__,constructor,toString,Value\n01,alpha,first,10\n02,beta,second,20\n');
  const expected = JSON.parse('[{"__proto__":"01","constructor":"alpha","toString":"first","Value":"10"},{"__proto__":"02","constructor":"beta","toString":"second","Value":"20"}]');
  const workers = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.goto('/upload');
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({ name: 'hostile-headers.csv', mimeType: 'text/csv', buffer: bytes });
  await page.getByRole('button', { name: /visualize dashboard/i }).click();
  await approveImportedData(page);
  expect(workers.some((url) => url.includes('delimitedParser.worker'))).toBe(true);
  const preview = page.getByRole('table').last();
  await expect(preview.getByRole('cell', { name: '01', exact: true })).toBeVisible();
  await preview.getByRole('columnheader', { name: '__proto__', exact: true }).click();
  await preview.getByRole('columnheader', { name: '__proto__', exact: true }).click();
  await expect(preview.locator('tbody tr').first().getByRole('cell').first()).toHaveText('02');
  await page.getByRole('button', { name: 'Toggle table filters' }).click();
  await page.getByLabel('Filter __proto__', { exact: true }).selectOption('01');
  await expect(preview.getByRole('cell', { name: '02', exact: true })).toHaveCount(0);
  await expect(preview.getByRole('cell', { name: '01', exact: true })).toBeVisible();
  await page.getByLabel('Filter __proto__', { exact: true }).selectOption('');

  for (const format of ['JSON', 'CSV']) {
    await openWorkspaceActions(page);
    await page.getByRole('combobox', { name: 'Export format', exact: true }).selectOption(format.toLowerCase());
    const download = page.waitForEvent('download');
    await openWorkspaceActions(page);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const text = await readFile(await (await download).path(), 'utf8');
    if (format === 'JSON') expect(JSON.parse(text)).toEqual(expected);
    else expect(Papa.parse(text).data).toEqual([Object.keys(expected[0]), ...expected.map(Object.values)]);
  }

  const backupDownload = page.waitForEvent('download');
  await openWorkspaceActions(page);
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  const backupPath = await (await backupDownload).path();
  const backup = await readStreamBackup(backupPath);
  expect(backup.dataset.rawRows).toEqual(expected);
  expect(backup.dataset.sourceRows).toEqual(expected);

  await openWorkspaceActions(page);
  await page.getByLabel('Choose workspace backup').setInputFiles(backupPath);
  await approveImportedData(page);
  const restoredDownload = page.waitForEvent('download');
  await openWorkspaceActions(page);
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  const restoredPath = await (await restoredDownload).path();
  expect((await readStreamBackup(restoredPath)).dataset.rawRows).toEqual(expected);
  const records = (await readFile(restoredPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line).payload);
  expect(Buffer.concat(records.filter((record) => record.type === 'file').map((record) => Buffer.from(record.base64, 'base64')))).toEqual(bytes);
});
