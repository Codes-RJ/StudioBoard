import { describe, it, expect } from 'vitest';
import {
  analyzeDataQuality,
  cleanDatasetRows,
  computeColumnStats,
  DEFAULT_CLEAN_OPTIONS,
  replayCleaningRecipe,
  summarizeCleaningPreview
} from '../dataCleaner';

const makeDataset = () => ({
  id: 'ds_test',
  name: 'Test Dataset',
  columns: [
    { name: 'Name', type: 'string' },
    { name: 'Score', type: 'number' },
    { name: 'Empty', type: 'string' }
  ],
  rawRows: [
    { Name: ' Alice ', Score: 10, Empty: null },
    { Name: 'Bob', Score: '', Empty: null },
    { Name: 'Alice', Score: 30, Empty: null },
    { Name: 'Alice', Score: 30, Empty: null }, // exact duplicate of row above
    { Name: null, Score: null, Empty: null }   // fully empty row
  ]
});

describe('analyzeDataQuality', () => {
  it('detects missing cells, duplicates, empty rows, whitespace and empty columns', () => {
    const q = analyzeDataQuality(makeDataset());

    expect(q.totalRows).toBe(5);
    expect(q.duplicateRows).toBe(1);
    expect(q.emptyRows).toBe(1);
    expect(q.emptyColumns).toEqual(['Empty']);
    expect(q.missingByColumn.Name).toBeGreaterThanOrEqual(1);
    expect(q.missingByColumn.Score).toBeGreaterThanOrEqual(1);
    expect(q.whitespaceCells).toBeGreaterThanOrEqual(1);
    expect(q.hasIssues).toBe(true);
    expect(q.qualityScore).toBeLessThan(100);
  });

  it('reports a perfect score for clean data', () => {
    const clean = {
      columns: [{ name: 'A', type: 'string' }],
      rawRows: [{ A: 'x' }, { A: 'y' }]
    };
    const q = analyzeDataQuality(clean);
    expect(q.hasIssues).toBe(false);
    expect(q.qualityScore).toBe(100);
  });
});

describe('cleanDatasetRows', () => {
  it('does not invent identifiers while imputing missing measures', () => {
    const rows = [{ ID: '001', amount: 10 }, { ID: '', amount: null }];
    expect(cleanDatasetRows(rows, ['ID', 'amount'], { missingNumeric: 'mean', missingCategorical: 'mode' }).rawRows)
      .toEqual([{ ID: '001', amount: 10 }, { ID: '', amount: 10 }]);
  });
  it('preserves blank records, repeated records and empty columns by default', () => {
    const source = makeDataset();
    const result = cleanDatasetRows(source.rawRows, source.columns);
    expect(result.rawRows).toHaveLength(5);
    expect(result.columns).toEqual(['Name', 'Score', 'Empty']);
    expect(result.rawRows[4]).toEqual({ Name: null, Score: null, Empty: null });
    expect(source.rawRows[0].Name).toBe(' Alice ');
  });

  it('fills missing and fully blank records using mean and mode without deleting rows', () => {
    const source = makeDataset();
    const result = cleanDatasetRows(source.rawRows, source.columns, { missingNumeric: 'mean', missingCategorical: 'mode' });
    expect(result.rawRows).toHaveLength(5);
    expect(result.rawRows[1].Score).toBeCloseTo(70 / 3, 12);
    expect(result.rawRows[4]).toEqual({ Name: 'Alice', Score: 70 / 3, Empty: null });
    expect(result.changes.every(({ type }) => !['rows', 'dedupe', 'columns'].includes(type))).toBe(true);
    expect(source.rawRows[4].Score).toBeNull();
  });

  it('trims whitespace, dedupes, drops empty rows/columns and fills missing values', () => {
    const ds = makeDataset();
    const result = cleanDatasetRows(ds.rawRows, ds.columns, {
      ...DEFAULT_CLEAN_OPTIONS,
      removeDuplicates: true,
      removeEmptyRows: true,
      dropEmptyColumns: true,
      missingNumeric: 'median',
      missingCategorical: 'unknown'
    });

    expect(result.rawRows.every((r) => r.Name === null || r.Name === r.Name.trim())).toBe(true);
    expect(result.rawRows.length).toBe(3);
    expect(result.columns).not.toContain('Empty');

    const scores = result.rawRows.map((r) => Number(r.Score));
    expect(scores.every((s) => Number.isFinite(s))).toBe(true);

    const types = result.changes.map((c) => c.type);
    expect(types).toContain('trim');
    expect(types).toContain('dedupe');
    expect(types).toContain('fill');
  });

  it('fills numeric missing values with the mean when requested', () => {
    const rows = [
      { v: 10, tag: 'a' },
      { v: '', tag: 'b' },
      { v: 20, tag: 'c' }
    ];
    const result = cleanDatasetRows(rows, ['v', 'tag'], { ...DEFAULT_CLEAN_OPTIONS, missingNumeric: 'mean' });
    expect(result.rawRows.length).toBe(3);
    expect(result.rawRows.filter((r) => Number(r.v) === 15).length).toBe(1);
  });

  it('preserves missing values by default instead of imputing measures', () => {
    const rows = [{ revenue: 12, region: 'West' }, { revenue: '', region: '' }];
    const result = cleanDatasetRows(rows, ['revenue', 'region'], {
      ...DEFAULT_CLEAN_OPTIONS,
      removeEmptyRows: false,
      removeDuplicates: false
    });
    expect(result.rawRows).toEqual(rows);
    expect(result.changes).toEqual([]);
  });

  it('replays a recipe from source rows without mutating them and reports preview counts', () => {
    const rows = [{ name: ' A ', revenue: 4 }, { name: 'A', revenue: 4 }, { name: 'B', revenue: 8 }];
    const columns = ['name', 'revenue'];
    const recipe = [{ ...DEFAULT_CLEAN_OPTIONS, removeDuplicates: true, missingNumeric: 'keep', missingCategorical: 'keep' }];
    const replay = replayCleaningRecipe(rows, columns, recipe);
    const preview = summarizeCleaningPreview(rows, columns, replay);
    expect(replay.rawRows).toEqual([{ name: 'A', revenue: 4 }, { name: 'B', revenue: 8 }]);
    expect(replay.steps).toHaveLength(1);
    expect(preview).toMatchObject({ rowsBefore: 3, rowsAfter: 2, rowsRemoved: 1, columnsBefore: 2, columnsAfter: 2 });
    expect(rows[0].name).toBe(' A ');
  });

  it('drops rows with missing values when strategy is dropRow', () => {
    const rows = [{ v: 10, tag: 'a' }, { v: '', tag: 'b' }, { v: 20, tag: 'c' }];
    const result = cleanDatasetRows(
      rows,
      ['v', 'tag'],
      { ...DEFAULT_CLEAN_OPTIONS, missingNumeric: 'dropRow', removeEmptyRows: false, removeDuplicates: false }
    );
    expect(result.rawRows.length).toBe(2);
    expect(result.rawRows.map((r) => r.tag)).toEqual(['a', 'c']);
    expect(result.rawRows.every((r) => Number.isFinite(Number(r.v)))).toBe(true);
    expect(result.changes.some((change) => change.label.includes('Dropped 1 row'))).toBe(true);
  });

  it('drops missing categories before calculating numeric fill values', () => {
    const rows = [
      { amount: 10, region: 'West' },
      { amount: '', region: 'East' },
      { amount: 100, region: '' }
    ];
    const result = cleanDatasetRows(rows, ['amount', 'region'], {
      ...DEFAULT_CLEAN_OPTIONS,
      missingNumeric: 'median',
      missingCategorical: 'dropRow',
      removeEmptyRows: false,
      removeDuplicates: false
    });

    expect(result.rawRows).toEqual([
      { amount: 10, region: 'West' },
      { amount: 10, region: 'East' }
    ]);
  });

  it('never mutates the input rows', () => {
    const rows = [{ a: ' x ' }, { a: 'x' }];
    const snapshot = JSON.stringify(rows);
    cleanDatasetRows(rows, ['a'], DEFAULT_CLEAN_OPTIONS);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it('keeps every cell when standardized headers collide', () => {
    const rows = [{ 'A B': 1, 'A-B': 2, a_b_2: 3 }];
    const result = cleanDatasetRows(rows, ['A B', 'A-B', 'a_b_2'], {
      ...DEFAULT_CLEAN_OPTIONS,
      standardizeHeaders: true
    });

    expect(new Set(result.columns).size).toBe(3);
    expect(result.rawRows[0]).toEqual({ a_b: 1, a_b_2: 2, a_b_2_2: 3 });
    expect(rows[0]).toEqual({ 'A B': 1, 'A-B': 2, a_b_2: 3 });
  });
});

describe('computeColumnStats', () => {
  it('preserves identifier and ignored roles through every recipe step and header normalization', () => {
    const rows = [{ 'Account Number': 101, Hidden: 'secret', Revenue: 10 }, { 'Account Number': null, Hidden: null, Revenue: null }];
    const columns = [{ name: 'Account Number', role: 'identifier' }, { name: 'Hidden', role: 'ignore' }, { name: 'Revenue', role: 'measure' }];
    const recipe = [{ missingNumeric: 'mean', missingCategorical: 'mode', standardizeHeaders: true }, { missingNumeric: 'mean', missingCategorical: 'mode' }];
    const result = replayCleaningRecipe(rows, columns, recipe);
    expect(result.rawRows[1]).toEqual({ account_number: null, hidden: null, revenue: 10 });
    expect(rows[1].Revenue).toBeNull();
  });

  it('computes numeric statistics correctly', () => {
    const stats = computeColumnStats([{ n: 2 }, { n: 4 }, { n: 6 }], ['n']);
    expect(stats.n.type).toBe('number');
    expect(stats.n.mean).toBe(4);
    expect(stats.n.median).toBe(4);
    expect(stats.n.min).toBe(2);
    expect(stats.n.max).toBe(6);
    expect(stats.n.sum).toBe(12);
  });

  it('summarizes categorical columns with frequency ranking', () => {
    const stats = computeColumnStats([{ c: 'red' }, { c: 'red' }, { c: 'blue' }], ['c']);
    expect(stats.c.type).toBe('category');
    expect(stats.c.unique).toBe(2);
    expect(stats.c.top[0]).toEqual({ value: 'red', count: 2 });
  });
});
