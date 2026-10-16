/* Runs Excel decoding in a module worker so large workbooks do not freeze React. */
import * as XLSX from 'xlsx';
import { readSpreadsheetSheets } from './tabularImport';
import { validateWorkbookArchive } from './workbookArchivePolicy';

self.onmessage = async ({ data }) => {
  const { id, file } = data;
  try {
    const buffer = await file.arrayBuffer();
    validateWorkbookArchive(buffer, { requireZip: /\.xlsx$/i.test(file.name) });
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
    if (!workbook.SheetNames.length) throw new Error('The workbook contains no worksheets.');
    if (workbook.SheetNames.length > 50) throw new Error('A workbook can contain at most 50 worksheets for browser import.');
    const sheets = readSpreadsheetSheets(XLSX.utils.sheet_to_json, workbook);
    self.postMessage({ id, sheets });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Unable to parse workbook.' });
  }
};
