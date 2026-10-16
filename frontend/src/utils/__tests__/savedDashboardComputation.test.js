import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { approveQualityRevision } from '../qualityReview';
import { saveLocalDataset } from '../localDatasetStore';
import { encodeDatasetPayload } from '../datasetWorkerPayload';
import { computeScopedMetricsPayload } from '../savedScopedMetrics';
import { computeSavedChartSeries, canScanChartSeries } from '../savedChartSeries';
import { computeChartSeries } from '../chartComputation';
import { computeScopedDatasetMetrics, filterAndPaginateLocalData } from '../localDataEngine';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); localStorage.clear(); });
const fixture = () => approveQualityRevision({ id: 'saved-dashboard', revision: 'r1', isLocal: true,
  columns: [{ name: 'ID', type: 'number' }, { name: 'category' }, { name: 'value', type: 'number' }, { name: 'tier', type: 'number' }, { name: 'day', type: 'date' }],
  rawRows: Array.from({ length: 1027 }, (_, i) => ({ ID: String(i).padStart(6, '0'), category: i % 3 === 0 ? null : i % 3 === 1 ? 'East' : 'West',
    value: i % 11 ? i / 10 : '', tier: i % 6, day: i % 2 ? '2026-02-01' : '2026-01-01' })) });

describe('saved dashboard scope and aggregation', () => {
  it.each([{}, { category: 'East' }, { ID: '999999' }])('keeps complete source classification and filtered KPI values for %j', async (filters) => {
    const dataset = fixture(); dataset.columnOverrides = { tier: { role: 'ignore' } }; await saveLocalDataset(dataset);
    const reference = encodeDatasetPayload({ dataset }).dataset; const progress = [];
    const result = await computeScopedMetricsPayload({ dataset: reference, filters }, { onProgress: (entry) => progress.push(entry) });
    expect(result).toEqual(computeScopedDatasetMetrics(dataset, filters));
    expect(result.columnGroups.identifiers).toEqual(['ID']); expect(result.primaryMetricColumn).toBe('value');
    expect(progress.map((entry) => entry.scanned)).toEqual([512, 1024, 1027]);
  });
  it('uses complete cardinality beyond the first 500 classification rows', async () => {
    const dataset = fixture(); dataset.rawRows.forEach((row, i) => { row.tier = i < 500 ? 1 : i; });
    await saveLocalDataset(dataset);
    const result = await computeScopedMetricsPayload({ dataset: encodeDatasetPayload({ dataset }).dataset });
    expect(result).toEqual(computeScopedDatasetMetrics(dataset));
    expect(result.columnGroups.measures).toContain('tier');
  });
  it.each(['sum', 'average', 'min', 'max', 'count'])('matches chart values, range and ordered series for %s', async (aggregation) => {
    const dataset = fixture(); await saveLocalDataset(dataset);
    const input = { rows: dataset.rawRows, selectedX: 'category', metricKey: 'value', visibleItems: 2, aggregation, chartType: 'bar' };
    const encoded = encodeDatasetPayload(input);
    expect(canScanChartSeries(encoded)).toBe(true);
    expect(await computeSavedChartSeries(encoded)).toEqual(computeChartSeries(input));
  });
  it('preserves date ordering, row-count previews, blanks and total scope', async () => {
    const dataset = fixture(); await saveLocalDataset(dataset);
    for (const selectedX of ['day', '']) for (const metricKey of ['__count__', 'value']) {
      const input = { rows: dataset.rawRows, selectedX, metricKey, visibleItems: 3, aggregation: 'sum', chartType: 'line' };
      expect(await computeSavedChartSeries(encodeDatasetPayload(input))).toEqual(computeChartSeries(input));
    }
    const full = filterAndPaginateLocalData(dataset.rawRows, { limit: 0 });
    expect(full.data).toBe(dataset.rawRows);
    expect(encodeDatasetPayload({ rows: full.data }).rows.kind).toBe('local-dataset-reference');
    for (const view of [filterAndPaginateLocalData(dataset.rawRows, { limit: 0, filters: { category: 'East' } }),
      filterAndPaginateLocalData(dataset.rawRows, { limit: 0, sort: 'value' }), filterAndPaginateLocalData(dataset.rawRows, { limit: 50 })]) {
      expect(Array.isArray(encodeDatasetPayload({ rows: view.data }).rows)).toBe(true);
    }
  });
  it('keeps medians, advanced charts and explicit previews on the existing path', async () => {
    const dataset = fixture(); await saveLocalDataset(dataset);
    const input = { rows: dataset.rawRows, selectedX: 'category', metricKey: 'value', visibleItems: 2, aggregation: 'average', chartType: 'bar' };
    expect(canScanChartSeries(encodeDatasetPayload({ ...input, aggregation: 'median' }))).toBe(false);
    expect(canScanChartSeries(encodeDatasetPayload({ ...input, chartType: 'heatmap' }))).toBe(false);
    expect(canScanChartSeries({ ...input, rows: dataset.rawRows.slice(0, 10) })).toBe(false);
  });
  it('rejects changed generations and prevents grouping from retaining unbounded categories', async () => {
    const dataset = fixture(); await saveLocalDataset(dataset);
    const input = encodeDatasetPayload({ rows: dataset.rawRows, selectedX: 'category', metricKey: 'value', visibleItems: 2, aggregation: 'sum', chartType: 'bar' });
    await saveLocalDataset({ ...dataset, note: 'new generation' });
    await expect(computeSavedChartSeries(input)).rejects.toThrow('changed during this scan');
    const scan = async (_, visit) => visit(Array.from({ length: 10_001 }, (_, i) => ({ category: String(i), value: 1 })), { offset: 0 });
    await expect(computeSavedChartSeries(input, { scan })).rejects.toThrow('10,000-group');
  });
});
