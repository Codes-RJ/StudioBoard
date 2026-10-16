import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { approveQualityRevision } from '../qualityReview';
import { saveLocalDataset, scanLocalDatasetRows } from '../localDatasetStore';
import { encodeDatasetPayload } from '../datasetWorkerPayload';
import { analyzeReportDataset } from '../reportAnalysis';
import { scopeDataset } from '../analysisScope';
import { computeReportAnalysisPayload, REPORT_MEMORY_LIMITS } from '../savedReportAnalysis';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); localStorage.clear(); });
const fixture = () => {
  const rawRows = Array.from({ length: 1027 }, (_, i) => ({ rowID: `row-${i}`, day: i % 13 ? `2026-01-${String(i % 9 + 1).padStart(2, '0')}` : 'invalid date',
    region: i % 7 === 0 ? '__proto__' : i % 3 ? 'East' : 'West', value: i % 11 ? i / 10 : '',
    label: i % 17 ? ' padded ' : null, constant: 'same', blank: '' }));
  rawRows[512] = { ...rawRows[0] }; rawRows[1026] = Object.fromEntries(Object.keys(rawRows[0]).map((key) => [key, null]));
  return approveQualityRevision({ id: 'report-source', name: 'Report source', isLocal: true, revision: 'r1',
    columns: Object.keys(rawRows[0]), rawRows, sourceRows: rawRows.map((row) => ({ ...row })),
    cleaningHistory: [{ rows: rawRows.map((row) => ({ ...row })) }],
    metrics: { columnGroups: { numeric: ['value'], date: ['day'], dimensions: ['day', 'region'] } } });
};
const expected = (dataset, filters) => {
  const scoped = scopeDataset(dataset, filters);
  return { ...analyzeReportDataset(scoped), analysisScope: scoped.analysisScope };
};

describe('saved exact report scans', () => {
  it.each([{}, { region: 'East' }, { region: 'absent' }])('matches complete quality, statistics and insights for scope %j', async (filters) => {
    const dataset = fixture(); await saveLocalDataset(dataset); const progress = [];
    const result = await computeReportAnalysisPayload({ dataset: encodeDatasetPayload({ dataset }).dataset, filters }, { onProgress: (entry) => progress.push(entry) });
    expect(result).toEqual(expected(dataset, filters));
    expect(progress.map(({ phase, scanned }) => [phase, scanned])).toEqual([
      ['quality', 512], ['quality', 1024], ['quality', 1027], ['statistics', 512], ['statistics', 1024], ['statistics', 1027],
    ]);
    if (!Object.keys(filters).length) {
      expect(result.quality).toMatchObject({ duplicateRows: 1, emptyRows: 1, constantColumns: ['label', 'constant'], emptyColumns: ['blank'] });
      expect(result.stats.region.top[0].value).toBe('East');
      expect(result.insights.find(({ kind }) => kind === 'trend')).toHaveProperty('firstCount');
    }
  });
  it('preserves explicit draft scope and classification boundaries with nonnumeric populated values', async () => {
    const dataset = fixture(); await saveLocalDataset(dataset);
    const draft = { ...dataset, rawRows: dataset.rawRows.slice(0, 10).map((row, i) => ({ ...row, boundary: i < 7 ? String(i) : 'text' })), columns: [...dataset.columns, 'boundary'] };
    expect((await computeReportAnalysisPayload({ dataset: draft })).stats.boundary).toMatchObject({ type: 'number', count: 7, missing: 3, median: 3 });
    const savedBoundary = approveQualityRevision(draft); await saveLocalDataset(savedBoundary);
    expect((await computeReportAnalysisPayload({ dataset: encodeDatasetPayload({ dataset: savedBoundary }).dataset })).stats.boundary)
      .toMatchObject({ type: 'number', count: 7, missing: 3, median: 3 });
    draft.rawRows[6].boundary = 'text';
    const result = await computeReportAnalysisPayload({ dataset: draft, filters: { region: 'East' } });
    expect(result).toEqual(expected(draft, { region: 'East' }));
    expect(result.analysisScope.sourceRows).toBe(10);
    const savedCategory = approveQualityRevision(draft); await saveLocalDataset(savedCategory);
    const savedResult = await computeReportAnalysisPayload({ dataset: encodeDatasetPayload({ dataset: savedCategory }).dataset });
    expect(savedResult).toEqual(expected(savedCategory, {}));
    expect(savedResult.stats.boundary).toMatchObject({ type: 'category', count: 10, unique: 7, top: [{ value: 'text', count: 4 }, { value: '0', count: 1 }, { value: '1', count: 1 }] });
  });
  it('keeps input order when fewer than four dates parse and handles tied dates stably', async () => {
    const dataset = fixture(); dataset.rawRows = [
      { day: 'bad', region: 'A', value: 100 }, { day: '2026-02-01', region: 'B', value: 10 },
      { day: '2026-01-01', region: 'A', value: 20 }, { day: '2026-01-01', region: 'B', value: 30 },
      { day: 'bad', region: 'A', value: 40 },
    ];
    delete dataset.sourceRows; delete dataset.cleaningHistory; await saveLocalDataset(dataset);
    const result = await computeReportAnalysisPayload({ dataset: encodeDatasetPayload({ dataset }).dataset });
    expect(result.insights.find(({ kind }) => kind === 'trend')).toMatchObject({ firstCount: 2, firstTotal: 110, secondCount: 3, secondTotal: 90 });
    expect(result).toEqual(expected(dataset, {}));
  });
  it('rejects storage changes between the two scans instead of mixing revisions', async () => {
    const dataset = fixture(); await saveLocalDataset(dataset); const reference = encodeDatasetPayload({ dataset }).dataset;
    let passes = 0;
    const scan = async (id, visit, options) => {
      const result = await scanLocalDatasetRows(id, visit, options);
      if (++passes === 1) await saveLocalDataset({ ...dataset, note: 'storage-only change' });
      return result;
    };
    await expect(computeReportAnalysisPayload({ dataset: reference }, { scan })).rejects.toThrow('changed during this scan');
  });
  it('does not return completed quality as a successful report when statistics are cancelled', async () => {
    const dataset = fixture(); await saveLocalDataset(dataset); const controller = new AbortController();
    await expect(computeReportAnalysisPayload({ dataset: encodeDatasetPayload({ dataset }).dataset }, { signal: controller.signal,
      onProgress: ({ phase }) => { if (phase === 'statistics') controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it.each(['signatures', 'trend', 'numbers', 'groups', 'bytes'])('rejects exact %s work above policy without a sampled substitute', async (kind) => {
    const dataset = fixture(); await saveLocalDataset(dataset);
    await expect(computeReportAnalysisPayload({ dataset: encodeDatasetPayload({ dataset }).dataset }, {
      limits: { ...REPORT_MEMORY_LIMITS, [kind]: kind === 'bytes' ? 100 : 2 },
    })).rejects.toThrow('working-memory limit');
  });
});
