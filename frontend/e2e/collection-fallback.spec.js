import { expect, test } from '@playwright/test';
import { approveImportedData } from './review-helpers';

test.skip(process.env.E2E_SERVER_WORKSPACE === 'true', 'Personal collection import.');
test('multi-file selection and manual composite-key review preserve identifiers', async ({ page }) => {
  await page.goto('/upload');
  await page.getByLabel('Choose several data files').setInputFiles([
    { name: 'orders.csv', mimeType: 'text/csv', buffer: Buffer.from('Code,Part,Revenue\n001,A,7\n001,B,11\n1,A,99\n') },
    { name: 'labels.csv', mimeType: 'text/csv', buffer: Buffer.from('Key,Segment,Region\n001,A,East\n001,B,West\n') },
  ]);
  await expect(page.getByText(/Selected files: 2 supported files/)).toBeVisible();
  await page.getByRole('button', { name: 'Analyze whole folder' }).click(); await approveImportedData(page);
  const overview = page.getByRole('region', { name: 'Folder overview' });
  await overview.getByText('Review a custom or composite key', { exact: true }).click();
  await overview.getByLabel('left relationship source', { exact: true }).selectOption({ label: 'orders.csv' });
  await overview.getByLabel('right relationship source', { exact: true }).selectOption({ label: 'labels.csv' });
  await overview.getByLabel('left key 1', { exact: true }).selectOption('Code'); await overview.getByLabel('right key 1', { exact: true }).selectOption('Key');
  await overview.getByRole('button', { name: 'Add key pair' }).click();
  await overview.getByLabel('left key 2', { exact: true }).selectOption('Part'); await overview.getByLabel('right key 2', { exact: true }).selectOption('Segment');
  await overview.getByRole('button', { name: 'Preview key relationship' }).click();
  const candidate = overview.locator('article').filter({ hasText: /Code \+ Part/ });
  await expect(candidate).toContainText('one-to-one'); await expect(candidate).toContainText('2 shared keys');
  await expect(candidate).toContainText('suggested'); await candidate.getByRole('button', { name: 'Approve relationship' }).click();
  await candidate.getByLabel('Calculation', { exact: true }).selectOption('sum');
  await candidate.getByLabel('Measure', { exact: true }).selectOption({ label: 'orders.csv · Revenue' });
  await candidate.getByLabel('Group by', { exact: true }).selectOption({ label: 'labels.csv · Region' });
  await candidate.getByRole('button', { name: 'Run analysis' }).click();
  await expect(candidate).toContainText('Matched joined rows: 2');
  await expect(candidate.locator('li').filter({ hasText: 'East' })).toContainText('7');
  await expect(candidate.locator('li').filter({ hasText: 'West' })).toContainText('11');
});
