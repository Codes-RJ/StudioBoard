import { expect, test } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { readFile } from 'node:fs/promises';
import { approveImportedData, openWorkspaceActions } from './review-helpers';
test.skip(process.env.E2E_SERVER_WORKSPACE === 'true', 'Personal application upgrades.');
const pdfFixture = () => {
  const content = 'BT /F1 12 Tf 50 740 Td (Document sentinel nebula) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let text = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(text); text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(text);
};
const docxFixture = () => Buffer.from(zipSync({ 'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Document sentinel nebula Zoë</w:t></w:r></w:p></w:body></w:document>') }));
for (const extension of ['pdf', 'docx', 'md']) {
  test(`${extension} text is searchable with block citations and exact original download`, async ({ page }) => {
    const bytes = extension === 'pdf' ? pdfFixture() : extension === 'docx' ? docxFixture() : Buffer.from('Document sentinel nebula Zoë\n\nSecond paragraph.');
    await page.goto('/upload');
    await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({ name: `document.${extension}`, mimeType: 'application/octet-stream', buffer: bytes });
    await page.getByRole('button', { name: /visualize dashboard/i }).click();
    // The PDF parser/worker is loaded on first use; await import completion
    // before asking the shared helper to approve the resulting source.
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
    await approveImportedData(page);
    await page.getByRole('button', { name: 'Browser AI and local search', exact: true }).click();
    await page.getByLabel('Assistant mode').selectOption('search');
    await page.getByRole('textbox', { name: 'Ask a question about this dataset' }).fill('sentinel nebula');
    await page.getByRole('button', { name: /^Ask$/ }).click();
    await page.getByText(/Source evidence \(/).click();
    await expect(page.getByText(/Document (page 1, )?block 1/)).toBeVisible();
    await expect(page.getByText(/Document sentinel nebula/).last()).toBeVisible();
    await openWorkspaceActions(page);
    await page.getByRole('button', { name: 'Data Health' }).click();
    const original = page.waitForEvent('download'); await page.getByRole('button', { name: 'Original File', exact: true }).click();
    expect(await readFile(await (await original).path())).toEqual(bytes);
  });
}
test('another tab cannot overwrite an editing draft; copy recovery keeps both layouts', async ({ page, context }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
  await page.getByRole('dialog', { name: 'Edit dashboard' }).getByRole('button', { name: /^View / }).first().click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  const other = await context.newPage(); await other.goto('/dashboard');
  await expect(other.locator('.react-grid-item').first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
  await page.getByRole('dialog', { name: 'Edit dashboard' }).getByRole('button', { name: /^View / }).first().click();
  await page.getByLabel('Chart title', { exact: true }).first().fill('Retained tab draft');
  await page.getByLabel('Chart title', { exact: true }).first().press('Enter');
  await other.getByRole('button', { name: 'New Layout', exact: true }).click();
  await other.getByRole('textbox', { name: 'Layout name', exact: true }).fill('Second tab saved layout');
  await other.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Keep layout draft as a copy' })).toBeVisible();
  await expect(page.getByLabel('Chart title', { exact: true }).first()).toHaveValue('Retained tab draft');
  await page.getByRole('button', { name: 'Keep layout draft as a copy' }).click();
  await expect(page.getByRole('combobox', { name: 'Select dashboard layout' })).toContainText('draft copy');
  await expect(page.getByRole('button', { name: 'Keep layout draft as a copy' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('figure', { name: /^Retained tab draft\./ })).toBeVisible();
  await other.close();
});
test('keyboard chart value tables and phone review controls remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/dashboard');
  const summary = page.getByText('View chart values as a table', { exact: true }).first();
  await summary.focus(); await summary.press('Enter');
  await expect(summary.locator('..').getByRole('table')).toBeVisible();
  await expect(summary.locator('..').getByRole('columnheader', { name: 'value', exact: true })).toBeVisible();
  await summary.press('Enter'); await expect(summary.locator('..').getByRole('table')).toBeHidden();
  await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit dashboard' }); await expect(editor).toBeVisible();
  await page.keyboard.press('Escape'); await expect(editor).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('large integer measures require review and calculate without lost digits or downloaded models', async ({ page }) => {
  const requests = []; page.on('request', (request) => requests.push(request.url()));
  await page.goto('/upload');
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({ name: 'exact-values.csv', mimeType: 'text/csv', buffer: Buffer.from('Amount,Region\n9007199254740993,West\n1,West\n') });
  await page.getByRole('button', { name: /visualize dashboard/i }).click();
  await page.getByRole('button', { name: 'Review Data', exact: true }).first().click();
  const review = page.getByRole('dialog', { name: 'Data Quality & Cleaning' });
  await review.getByRole('button', { name: 'Approve Data' }).click();
  await expect(review.getByText(/Review Amount's precision before approving/)).toBeVisible();
  await review.getByLabel('Amount precision').selectOption('exact');
  await review.getByRole('button', { name: 'Approve Data' }).click(); await expect(review).toBeHidden();
  await page.getByRole('button', { name: 'Expand assistant details', exact: true }).click();
  await page.getByText(/Exact decimal calculator/).click();
  await page.getByRole('button', { name: 'Calculate exact values' }).click();
  await expect(page.getByText('All rows: 9007199254740994', { exact: true })).toBeVisible();
  expect(requests.filter((url) => /huggingface|mlc-ai|model.*\.(?:bin|wasm)/i.test(url))).toEqual([]);
});
