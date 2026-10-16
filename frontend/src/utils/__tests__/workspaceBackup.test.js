import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { vi } from 'vitest';

import { parseWorkspaceBackup, parseVerifiedWorkspaceBackup, readWorkspaceBackup, serializeWorkspaceBackup, serializeWorkspaceBackupWithSources } from '../workspaceBackup';
vi.stubGlobal('crypto', webcrypto);

const dataset = {
  id: 'local_original',
  name: 'Sales',
  isLocal: true,
  rowCount: 2,
  columns: [{ name: 'Region', type: 'string' }, { name: 'Revenue', type: 'number' }],
  rawRows: [{ Region: 'West', Revenue: 10 }, { Region: 'East', Revenue: 20 }]
};
const layout = {
  id: 'layout_local_original',
  name: 'Sales layout',
  source: 'planner',
  sourceDatasetId: dataset.id,
  layout: [{ i: 'revenue', x: 0, y: 0, w: 6, h: 3, chartType: 'bar', preferredX: 'Region', preferredY: 'Revenue' }]
};

describe('private workspace backup', () => {
  it('includes exact original bytes and invalidates approval when restoring the portable archive', async () => {
    const bytes = new Blob(['ID,Value\r\n001,7\r\n']);
    const sourceFile = { id: 'archive', name: 'source.csv', type: 'text/csv', size: bytes.size };
    const content = await serializeWorkspaceBackupWithSources({ dataset: { ...dataset, sourceFile }, layout }, {
      loadSource: async () => ({ ...sourceFile, blob: bytes }),
    });
    const backup = JSON.parse(content);
    expect(backup.version).toBe(5);
    expect(backup.integrity.payloadVersion).toBe(3);
    expect(atob(backup.originalFiles[0].base64)).toBe('ID,Value\r\n001,7\r\n');
    const restored = await parseVerifiedWorkspaceBackup(content);
    expect(restored.sourceFiles[0].blob.size).toBe(bytes.size);
    expect(restored.dataset.sourceFile.id).toBe(restored.sourceFiles[0].id);
    expect(restored.dataset.sourceFile.id).not.toBe(sourceFile.id);
    expect(restored.dataset.qualityReviewRequired).toBe(true);
    expect(restored.dataset.qualityReview).toBeUndefined();
    await expect(parseVerifiedWorkspaceBackup(JSON.stringify({ ...backup, originalFiles: [{ ...backup.originalFiles[0], base64: 'bad!' }] }))).rejects.toThrow('integrity check failed');
    await expect(parseVerifiedWorkspaceBackup(JSON.stringify({ ...backup, dataset: { ...backup.dataset, rawRows: [{ Region: 'West', Revenue: 99 }, backup.dataset.rawRows[1]] } }))).rejects.toThrow('integrity check failed');
  });

  it('refuses a complete backup when an archived original is missing', async () => {
    await expect(serializeWorkspaceBackupWithSources({ dataset: { ...dataset,
      sourceFile: { id: 'missing', name: 'lost.xlsx', size: 10 } }, layout }, { loadSource: async () => null }))
      .rejects.toThrow('unavailable');
  });

  it('round trips a dataset, layout, filters, and palette with new local IDs', () => {
    const content = serializeWorkspaceBackup({
      dataset,
      layout,
      filters: { Region: 'West', Unknown: 'ignored' },
      palette: 'blue'
    });
    const restored = parseWorkspaceBackup(content);

    expect(restored.dataset).toMatchObject({ name: 'Sales', isLocal: true, rowCount: 2, rawRows: dataset.rawRows });
    expect(restored.dataset.id).not.toBe(dataset.id);
    expect(restored.layout).toMatchObject({ localOnly: true, source: 'planner', sourceDatasetId: restored.dataset.id });
    expect(restored.layout.id).not.toBe(layout.id);
    expect(restored.layout.layout[0]).toMatchObject({ preferredX: 'Region', preferredY: 'Revenue' });
    expect(restored.filters).toEqual({ Region: 'West' });
    expect(restored.palette).toBe('blue');
    expect(restored.dataset.metrics.rows).toBe(2);
  });

  it('rejects unsupported and oversized backups before restoring anything', async () => {
    expect(() => parseWorkspaceBackup('{}')).toThrow('not a supported');
    await expect(readWorkspaceBackup({ size: 201 * 1024 * 1024, text: () => Promise.resolve('{}') }))
      .rejects.toThrow('200 MB');
  });

  it('preserves source rows and the cleaning recipe so restored data can be undone', () => {
    const options = {
      trimWhitespace: true,
      removeDuplicates: true,
      removeEmptyRows: true,
      dropEmptyColumns: true,
      standardizeHeaders: false,
      missingNumeric: 'keep',
      missingCategorical: 'keep'
    };
    const cleaned = {
      ...dataset,
      rowCount: 1,
      rawRows: [{ Region: 'West', Revenue: 10 }],
      sourceRows: dataset.rawRows,
      sourceColumns: dataset.columns,
      columnOverrides: { Revenue: { type: 'number', role: 'measure' }, Region: { type: 'string', role: 'dimension' } },
      cleaningRecipe: [options],
      cleaningLog: [{ options, beforeRows: 2, afterRows: 1, changes: [{ type: 'dedupe', label: 'Removed 1 duplicate row' }] }]
    };
    const restored = parseWorkspaceBackup(serializeWorkspaceBackup({ dataset: cleaned, layout }));
    expect(restored.dataset.sourceRows).toEqual(dataset.rawRows);
    expect(restored.dataset.sourceColumns).toEqual(dataset.columns);
    expect(restored.dataset.columnOverrides).toEqual(cleaned.columnOverrides);
    expect(restored.dataset.cleaningRecipe).toEqual([options]);
    expect(restored.dataset.cleaningLog[0]).toMatchObject({ beforeRows: 2, afterRows: 1, options });
    expect(Number.isNaN(Date.parse(restored.dataset.cleaningLog[0].at))).toBe(false);
  });

  it('round trips a whole folder with new IDs and preserved source paths', () => {
    const folderId = 'folder_original';
    const overview = {
      ...dataset, id: 'overview', name: 'Job · Folder overview', folderId,
      folderName: 'Job', collectionKind: 'folder', isFolderOverview: true,
      sourceFileCount: 1, sourceDatasetCount: 1, totalSourceRows: 2,
      sourcePath: '',
      relationships: [{ id: 'source:Region->source:Region', leftDatasetId: 'source', leftColumn: 'Region', rightDatasetId: 'source', rightColumn: 'Region', status: 'approved' }],
    };
    const source = {
      ...dataset, id: 'source', name: 'West/sales', folderId,
      folderName: 'Job', collectionKind: 'folder', sourcePath: 'Job/West/sales.csv',
    };
    const sourceLayout = { ...layout, id: 'source-layout', sourceDatasetId: source.id };
    const overviewLayout = { ...layout, id: 'overview-layout', sourceDatasetId: overview.id };
    const backup = serializeWorkspaceBackup({
      dataset: source, datasets: [overview, source], layout: sourceLayout,
      layouts: [overviewLayout], filters: { Region: 'West' }, palette: 'blue',
    });

    const restored = parseWorkspaceBackup(backup);

    expect(restored.datasets).toHaveLength(2);
    expect(restored.dataset.sourcePath).toBe('Job/West/sales.csv');
    expect(restored.dataset.id).not.toBe(source.id);
    expect(restored.datasets[0].folderId).toBe(restored.dataset.folderId);
    expect(restored.dataset.folderId).not.toBe(folderId);
    expect(restored.layouts).toHaveLength(2);
    expect(restored.layout.sourceDatasetId).toBe(restored.dataset.id);
    expect(restored.filters).toEqual({ Region: 'West' });
    expect(restored.datasets[0].isFolderOverview).toBe(true);
    expect(restored.datasets[0].relationships[0]).toMatchObject({
      leftDatasetId: restored.datasets[1].id,
      rightDatasetId: restored.datasets[1].id,
      status: 'needs_review',
    });
  });

  it('restores a collection with several saved layouts per source', () => {
    const folderId = 'many-layouts';
    const overview = { ...dataset, id: 'overview-many', folderId, isFolderOverview: true };
    const source = { ...dataset, id: 'source-many', folderId };
    const sourceLayouts = Array.from({ length: 202 }, (_, index) => ({
      ...layout, id: `layout-${index}`, sourceDatasetId: source.id,
    }));
    const backup = serializeWorkspaceBackup({
      dataset: source, datasets: [overview, source], layout: sourceLayouts[0], layouts: sourceLayouts,
    });

    const restored = parseWorkspaceBackup(backup);
    expect(restored.layouts).toHaveLength(202);
    expect(restored.layouts.every((item) => item.sourceDatasetId === restored.dataset.id)).toBe(true);
  });
});
