import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { approveImportedData, openWorkspaceActions } from './review-helpers';

test.skip(process.env.E2E_SERVER_WORKSPACE === 'true', 'Local archive checks target the personal workspace.');

for (const extension of ['csv', 'xlsx']) {
  test(`original ${extension} bytes survive review, cleaning, portable backup and restore`, async ({ page }) => {
    let bytes = Buffer.from('\uFEFFID,Revenue,Region\r\n001,10, West \r\n002,,East\r\n003,30,West\r\n');
    if (extension === 'xlsx') {
      const workbook = XLSX.utils.book_new();
      const sales = XLSX.utils.aoa_to_sheet([['ID', 'Revenue', 'Region'], ['001', 10, ' West '], ['002', null, 'East'], ['003', 30, 'West']]);
      sales.B2.f = '5+5';
      sales.B2.z = '0.00';
      XLSX.utils.book_append_sheet(workbook, sales, 'Sales');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Notes'], ['Keep workbook metadata']]), 'Hidden notes');
      workbook.Workbook = { Sheets: [{ name: 'Sales', Hidden: 0 }, { name: 'Hidden notes', Hidden: 1 }] };
      bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    }
    await page.goto('/upload');
    await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({ name: `original.${extension}`, mimeType: 'application/octet-stream', buffer: bytes });
    await page.getByRole('button', { name: /visualize dashboard/i }).click();
    await approveImportedData(page);
    const backupDownload = page.waitForEvent('download');
    await openWorkspaceActions(page);
    await page.getByRole('button', { name: 'Backup', exact: true }).click();
    const backupFile = await backupDownload;
    const records = (await readFile(await backupFile.path(), 'utf8')).trim().split('\n').map((line) => JSON.parse(line).payload);
    expect(records[0].version).toBe(6);
    expect(records[0].originalFiles).toHaveLength(1);
    expect(Buffer.concat(records.filter((record) => record.type === 'file').map((record) => Buffer.from(record.base64, 'base64')))).toEqual(bytes);
    // A fresh browser archive ID proves restoration does not reuse the original record.
    await openWorkspaceActions(page);
    await page.getByLabel('Choose workspace backup').setInputFiles(await backupFile.path());
    await approveImportedData(page);
    if (extension === 'xlsx') {
      await page.keyboard.press('Escape');
      await page.getByRole('region', { name: 'Workbook overview' }).getByRole('button', { name: /original.xlsx \/ Sales/ }).click();
    }
    await openWorkspaceActions(page);
    await page.getByRole('button', { name: 'Data Health' }).click();
    const review = page.getByRole('dialog', { name: 'Data Quality & Cleaning' });
    await review.getByLabel('Missing numbers', { exact: true }).selectOption('mean');
    await expect(review.getByText(/Filled 1 missing value in "Revenue" with mean/)).toBeVisible();
    await review.getByRole('button', { name: 'Apply Preview' }).click();
    await page.reload();
    await expect(page.getByRole('heading', { name: /original/ }).first()).toBeVisible();
    await openWorkspaceActions(page);
    if (extension === 'xlsx' && !(await page.getByRole('button', { name: 'Data Health' }).isEnabled())) {
      await page.keyboard.press('Escape');
      await page.getByRole('region', { name: 'Workbook overview' }).getByRole('button', { name: /original.xlsx \/ Sales/ }).click();
    }
    await openWorkspaceActions(page);
    await page.getByRole('button', { name: 'Data Health' }).click();
    const originalDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Original File', exact: true }).click();
    const originalFile = await originalDownload;
    expect(originalFile.suggestedFilename()).toBe(`original.${extension}`);
    expect(await readFile(await originalFile.path())).toEqual(bytes);
  });
}
