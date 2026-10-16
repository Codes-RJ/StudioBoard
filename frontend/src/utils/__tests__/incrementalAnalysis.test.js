import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { computeScopedMetric, createScopedMetricAccumulator, MAX_MEDIAN_VALUES } from '../analysisScope';
import { approveQualityRevision } from '../qualityReview';
import { saveLocalDataset, deleteLocalDataset, scanLocalDatasetRows } from '../localDatasetStore';
import { encodeDatasetPayload } from '../datasetWorkerPayload';
import { calculateDatasetPayload } from '../localAI/savedAnalysis';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); localStorage.clear(); });
const source = (rows) => approveQualityRevision({ id: 'incremental', name: 'Incremental source', revision: 'r1', isLocal: true,
  columns: [{ name: 'group' }, { name: 'value', type: 'number' }, { name: 'weight', type: 'number' }], rawRows: rows });
const rows = () => Array.from({ length: 1539 }, (_, i) => ({ group: i % 7 ? 'A' : null, value: i % 11 ? i / 10 : '', weight: i % 13 ? 2 : -1 }));

describe('incremental saved-source calculations', () => {
  it.each(['sum', 'average', 'median', 'min', 'max', 'count', 'weighted_average'])('matches full scope across saved pages for %s', async (aggregation) => {
    const dataset = source(rows()); await saveLocalDataset(dataset);
    const reference = encodeDatasetPayload({ dataset }).dataset;
    const options = { metric: 'value', dimension: 'group', weight: 'weight', aggregation, limit: 1 };
    const progress = [];
    expect(await calculateDatasetPayload(reference, options, { onProgress: (entry) => progress.push(entry) })).toEqual(computeScopedMetric(dataset, options));
    expect(progress.map((entry) => entry.scanned)).toEqual([512, 1024, 1536, 1539]);
    expect(progress.every((entry) => entry.total === 1539)).toBe(true);
  });
  it('reads only working pages, with aligned source pages when provenance is needed, and no legacy snapshots', async () => {
    const originalRows = rows(); originalRows[1025].value = '';
    const dataset = { ...source(originalRows.map((row, i) => i === 1025 ? { ...row, value: 25 } : row)), sourceRows: originalRows,
      cleaningLog: [{ operations: [{ kind: 'fill', column: 'value', method: 'mean', value: 25 }] }],
      cleaningHistory: [{ rawRows: originalRows }] };
    await saveLocalDataset(dataset);
    const streams = [];
    const originalGet = IDBObjectStore.prototype.get;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (key) {
      if (this.name === 'datasetRows') streams.push(key[2]);
      return originalGet.call(this, key);
    });
    try {
      const result = await calculateDatasetPayload(encodeDatasetPayload({ dataset }).dataset, { metric: 'value' });
      expect(result).toEqual(computeScopedMetric(dataset, { metric: 'value' }));
      expect(result.imputedMeasureRows).toBe(1);
      expect(streams).toEqual(Array.from({ length: 4 }, () => ['rawRows', 'sourceRows']).flat());
    } finally { spy.mockRestore(); }
  });
  it('does not substitute stored rows for an unsaved or explicitly filtered record', async () => {
    const dataset = source(rows()); await saveLocalDataset(dataset);
    const draft = { ...dataset, rawRows: [dataset.rawRows[1538]] };
    const scan = vi.fn();
    expect(await calculateDatasetPayload(encodeDatasetPayload({ dataset: draft }).dataset, {}, { scan })).toMatchObject({ sourceRows: 1, contributingRows: 1 });
    expect(scan).not.toHaveBeenCalled();
  });
  it('rejects stale storage revisions even if quality identity did not change, and rejects deleted sources', async () => {
    const dataset = source(rows()); await saveLocalDataset(dataset);
    const reference = encodeDatasetPayload({ dataset }).dataset;
    await saveLocalDataset({ ...dataset, relationshipNote: 'new storage generation' });
    await expect(calculateDatasetPayload(reference)).rejects.toThrow('changed during this scan');
    await deleteLocalDataset(dataset.id);
    await expect(calculateDatasetPayload(reference)).rejects.toThrow('deleted during this scan');
  });
  it('rejects cancellation and edits made during the final visitor, not just between pages', async () => {
    const dataset = source([{ group: 'A', value: 7, weight: 1 }]); await saveLocalDataset(dataset);
    const controller = new AbortController();
    await expect(scanLocalDatasetRows(dataset.id, () => controller.abort(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(scanLocalDatasetRows(dataset.id, () => saveLocalDataset({ ...dataset, rawRows: [{ group: 'A', value: 9, weight: 1 }] }))).rejects.toThrow('changed during this scan');
  });
  it('keeps all-missing groups distinct from zero counts and supports finite means above the sum range', () => {
    const dataset = source([{ group: 'A', value: '' }, { group: 'B', value: 0 }]);
    expect(computeScopedMetric(dataset, { metric: 'value', dimension: 'group' }).results).toEqual([
      { group: 'B', value: 0, rowCount: 1 }, { group: 'A', value: null, rowCount: 1 }]);
    expect(computeScopedMetric(source([{ value: 1e308 }, { value: 1e308 }]), { metric: 'value', aggregation: 'average' }).results[0].value).toBe(1e308);
  });
  it('applies an explicit global exact-median bound without sampling while ordinary totals remain incremental', () => {
    const dataset = source([]);
    const median = createScopedMetricAccumulator(dataset, { metric: 'value', aggregation: 'median' });
    const page = Array.from({ length: 1000 }, () => ({ value: 1 }));
    for (let offset = 0; offset < MAX_MEDIAN_VALUES; offset += page.length) median.consume(page);
    expect(median.finish(MAX_MEDIAN_VALUES).results[0].value).toBe(1);
    expect(() => median.consume([{ value: 2 }])).toThrow('no sampled result');
    const sum = createScopedMetricAccumulator(dataset, { metric: 'value' });
    for (let offset = 0; offset <= MAX_MEDIAN_VALUES; offset += page.length) sum.consume(page);
    expect(sum.finish(MAX_MEDIAN_VALUES + 1000).results[0].value).toBe(MAX_MEDIAN_VALUES + 1000);
  });
  it('enforces field/role/group limits independently of input page boundaries', () => {
    const dataset = source([]);
    expect(() => createScopedMetricAccumulator(dataset, { metric: 'invented' })).toThrow('Unknown field');
    const accumulator = createScopedMetricAccumulator(dataset, { dimension: 'group' });
    accumulator.consume(Array.from({ length: 10_000 }, (_, i) => ({ group: String(i) })));
    expect(() => accumulator.consume([{ group: 'extra' }])).toThrow('10,000-group');
  });
});
