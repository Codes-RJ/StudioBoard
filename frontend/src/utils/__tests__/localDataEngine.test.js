import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { computeDatasetMetrics, exportLocalDataset, parseLocalFile, parseLocalFileDatasets, planLocalSmartLayout } from '../localDataEngine';
import { validateGraphConfiguration } from '../graphConfiguration';
vi.mock('../localDatasetStore', () => ({ archiveLocalSourceFile: vi.fn(async (file) => ({ id: 'archived-source', name: file.name, size: file.size })) }));

vi.mock('xlsx', async (importOriginal) => ({
  ...(await importOriginal()),
  writeFile: vi.fn()
}));

describe('local dataset metrics', () => {
  it('excludes blank measures from averages while retaining real zero values', () => {
    const rows = [10, 20, 0, null, undefined, '  ', '', 'n/a'].map((Revenue) => ({ Revenue }));
    expect(computeDatasetMetrics(rows, ['Revenue'])).toMatchObject({
      primaryMetricColumn: 'Revenue', primaryMean: 10, missingValues: 4, completeness: 50,
    });
  });

  it('builds valid initial layouts for categorical-only and numeric-only sources', () => {
    for (const rows of [[{ Region: 'West' }, { Region: 'East' }], [{ Revenue: 10 }, { Revenue: 20 }]]) {
      const groups = computeDatasetMetrics(rows, Object.keys(rows[0])).columnGroups;
      const layout = planLocalSmartLayout('new-import', groups);
      expect(layout.length).toBeGreaterThan(0);
      expect(layout.every((card) => validateGraphConfiguration(card, groups).valid)).toBe(true);
      expect(layout.some(({ chartType }) => chartType === 'gauge' || chartType === 'funnel')).toBe(false);
    }
    expect(planLocalSmartLayout('unprofiled')[0].chartType).toBe('table');
  });
});

describe('parseLocalFile', () => {
  it('keeps IDs in the source while choosing revenue for automatic analysis', async () => {
    const dataset = await parseLocalFile(new File(['ID,Revenue,Region\n001,10,West\n002,20,East\n'], 'keys.csv'));
    expect(dataset.rawRows[0].ID).toBe('001');
    expect(dataset.metrics.primaryMetricColumn).toBe('Revenue');
    expect(dataset.metrics.columnGroups.identifiers).toEqual(['ID']);
    expect(dataset.smartLayout.some((card) => card.preferredY === 'ID')).toBe(false);
  });
  it('normalizes whitespace and duplicate headers without losing cell values', async () => {
    const file = new File(
      [' Revenue ,Revenue\n10,20\n'],
      'metrics.csv',
      { type: 'text/csv' }
    );

    const dataset = await parseLocalFile(file);

    expect(dataset.columns.map((column) => column.name)).toEqual(['Revenue', 'Revenue (2)']);
    expect(dataset.rawRows).toEqual([{ Revenue: '10', 'Revenue (2)': '20' }]);
    expect(dataset.rowCount).toBe(1);
  });
});

describe('local Excel workflows', () => {
  it('imports a workbook when a spreadsheet worker is unavailable', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Revenue: 10 }]), 'Data');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const dataset = await parseLocalFile(new File([bytes], 'metrics.xlsx'));

    expect(dataset.rawRows).toEqual([{ Revenue: 10 }]);
  });

  it('imports every nonempty worksheet as a separate dataset', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Revenue: 10 }]), 'Sales');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Cost: 4 }]), 'Costs');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), 'Empty');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

    const datasets = await parseLocalFileDatasets(new File([bytes], 'finance.xlsx'));

    expect(datasets.map(({ name }) => name)).toEqual(['finance · Sales', 'finance · Costs']);
    expect(datasets.map(({ sheetName }) => sheetName)).toEqual(['Sales', 'Costs']);
    expect(datasets[1].rawRows).toEqual([{ Cost: 4 }]);
    expect(new Set(datasets.map(({ id }) => id)).size).toBe(2);
  });

  it('exports local rows as an Excel workbook', async () => {
    expect(await exportLocalDataset({ name: 'metrics', rawRows: [{ Revenue: 10 }] }, 'xlsx')).toBe(true);
    expect(XLSX.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ SheetNames: ['Data'] }),
      'metrics_export.xlsx'
    );
  });
});
