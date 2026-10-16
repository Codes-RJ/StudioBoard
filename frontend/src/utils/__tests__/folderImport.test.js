import { describe, expect, it, vi } from 'vitest';
vi.mock('../localDatasetStore', () => ({ archiveLocalSourceFile: vi.fn(async (file) => ({ id: file.name, name: file.name, size: file.size })) }));
import * as XLSX from 'xlsx';

import { inspectFolderFiles, parseLocalFileWorkspace, parseLocalFolder } from '../folderImport';

const withPath = (file, path) => {
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
};

describe('parseLocalFolder', () => {
  it('creates an overview and separate datasets from nested files and workbook sheets', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Cost: 4 }]), 'Costs');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Budget: 8 }]), 'Budget');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const files = [
      withPath(new File(['Revenue\n10\n20\n'], 'sales.csv'), 'Quarter 1/West/sales.csv'),
      withPath(new File([bytes], 'finance.xlsx'), 'Quarter 1/Finance/finance.xlsx'),
      withPath(new File(['notes'], 'notes.md'), 'Quarter 1/notes.md'),
    ];

    const result = await parseLocalFolder(files);

    expect(result.datasets).toHaveLength(3);
    expect(result.overview.isFolderOverview).toBe(true);
    expect(result.overview.totalSourceRows).toBe(4);
    expect(result.overview.rawRows.map(({ Source, Worksheet, Rows }) => ({ Source, Worksheet, Rows }))).toEqual([
      { Source: 'Quarter 1/Finance/finance.xlsx', Worksheet: 'Costs', Rows: 1 },
      { Source: 'Quarter 1/Finance/finance.xlsx', Worksheet: 'Budget', Rows: 1 },
      { Source: 'Quarter 1/West/sales.csv', Worksheet: '', Rows: 2 },
    ]);
    expect(result.datasets.every(({ folderId }) => folderId === result.overview.folderId)).toBe(true);
    expect(result.ignoredCount).toBe(1);
    expect(inspectFolderFiles(files).folderName).toBe('Quarter 1');
  });

  it('keeps valid files when another spreadsheet cannot be read', async () => {
    const files = [
      withPath(new File(['value\n1\n'], 'good.csv'), 'Job/good.csv'),
      withPath(new File(['bad workbook'], 'bad.xlsx'), 'Job/bad.xlsx'),
    ];

    const result = await parseLocalFolder(files);

    expect(result.datasets).toHaveLength(1);
    expect(result.failures).toEqual([{ path: 'Job/bad.xlsx', message: expect.any(String) }]);
    expect(result.overview.importFailures).toEqual(result.failures);
  });

  it('rejects a folder exceeding the total row budget instead of silently skipping a file', async () => {
    const files = [
      withPath(new File(['a'], 'first.csv'), 'Job/first.csv'),
      withPath(new File(['b'], 'second.csv'), 'Job/second.csv'),
    ];
    const parseFileDatasets = async (file) => [{ rowCount: file.name === 'first.csv' ? 600_000 : 400_001 }];

    await expect(parseLocalFolder(files, { parseFileDatasets })).rejects.toThrow(/at most .* data rows in total/);
  });

  it('rejects a workbook whose sheets exceed the combined row budget', async () => {
    const file = new File(['workbook'], 'job.xlsx');
    const parseFileDatasets = async () => [{ rowCount: 600_000 }, { rowCount: 400_001 }];

    await expect(parseLocalFileWorkspace(file, { parseFileDatasets })).rejects.toThrow(/at most .* data rows in total/);
  });

  it('groups all workbook sheets under one overview', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Revenue: 10 }]), 'Sales');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Cost: 4 }]), 'Costs');
    const file = new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], 'job.xlsx');

    const result = await parseLocalFileWorkspace(file);

    expect(result.selected.isFolderOverview).toBe(true);
    expect(result.selected.collectionKind).toBe('workbook');
    expect(result.datasets.map(({ name }) => name)).toEqual(['job · Workbook overview', 'job · Sales', 'job · Costs']);
    expect(result.datasets.every(({ folderId }) => folderId === result.selected.folderId)).toBe(true);
  });
});
