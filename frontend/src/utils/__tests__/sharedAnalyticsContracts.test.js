import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import contracts from '../../../../fixtures/analytics-contracts.v1.json';
import { computeScopedMetric } from '../analysisScope';
import { approveQualityRevision, qualityRevisionKey } from '../qualityReview';
import { saveLocalDataset } from '../localDatasetStore';
import { encodeDatasetPayload } from '../datasetWorkerPayload';
import { calculateDatasetPayload } from '../localAI/savedAnalysis';
import { analyzeApprovedRelationship } from '../crossDatasetAnalysis';
import { buildHeatmapMatrix } from '../chartDataTransforms';
import { filterAndPaginateLocalData } from '../localDataEngine';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); localStorage.clear(); });
const source = (fixture) => approveQualityRevision({
  id: fixture.id, updatedAt: 'fixture-v1', isLocal: true,
  columns: [{ name: 'key', type: 'string' }, { name: 'value', type: 'number' }],
  columnOverrides: { value: { role: 'measure', precision: fixture.exact ? 'exact' : 'native' } },
  rawRows: fixture.values.map((value) => ({ key: 'a', value })),
});
const expectValue = (actual, expected) => {
  if (typeof expected === 'number') expect(actual).toBeCloseTo(expected, 12);
  else expect(actual).toBe(expected);
};

describe('shared analytics contracts v1', () => {
  it.each(contracts.metrics)('$id agrees through in-memory and saved-page calculations', async (fixture) => {
    const dataset = source(fixture); await saveLocalDataset(dataset);
    for (const aggregation of ['sum', 'average', 'min', 'max', 'count']) {
      const options = { metric: 'value', aggregation };
      const direct = computeScopedMetric(dataset, options);
      expectValue(direct.results[0].value, fixture.expected[aggregation]);
      expect(direct.contributingRows).toBe(fixture.expected.count);
      expect(direct.missingRows).toBe(fixture.expected.missing);
      expect(await calculateDatasetPayload(encodeDatasetPayload({ dataset }).dataset, options)).toEqual(direct);
    }
  });

  it.each(contracts.metrics.filter(({ exact }) => exact))('$id agrees through approved relationships', (fixture) => {
    const right = source(fixture);
    const left = approveQualityRevision({ id: 'lookup', updatedAt: 'fixture-v1', isLocal: true,
      columns: [{ name: 'key', type: 'string' }], rawRows: [{ key: 'a' }] });
    const relationship = { status: 'approved', leftDatasetId: left.id, rightDatasetId: right.id,
      leftColumn: 'key', rightColumn: 'key', leftUpdatedAt: left.updatedAt, rightUpdatedAt: right.updatedAt,
      leftRevisionKey: qualityRevisionKey(left), rightRevisionKey: qualityRevisionKey(right), cardinality: 'one-to-many' };
    for (const aggregation of ['sum', 'average']) {
      const result = analyzeApprovedRelationship({ datasets: [left, right], relationship, metric: `${right.id}::value`, aggregation });
      expect(result.results[0].value).toBe(fixture.expected[aggregation]);
    }
  });

  it.each(contracts.correlations)('$id preserves measured/unavailable correlation and pair counts', (fixture) => {
    const rows = fixture.pairs.map(([a, b]) => ({ a, b }));
    const entry = buildHeatmapMatrix(rows, ['a', 'b'])[0].values[1];
    expect(entry).toEqual({ key: 'b', value: fixture.value, pairCount: fixture.pairCount });
  });

  it('preserves source-row identity through literal text and documented numeric substring filtering', () => {
    const fixture = contracts.filtering;
    const ids = (filters) => filterAndPaginateLocalData(fixture.rows, { filters }).data.map(({ sourceRow }) => sourceRow);
    expect(ids(fixture.textFilter)).toEqual(fixture.textSourceRows);
    expect(ids(fixture.numericFilter)).toEqual(fixture.frontendNumericSourceRows);
    const selected = filterAndPaginateLocalData(fixture.rows, { filters: fixture.textFilter }).data;
    expect(computeScopedMetric({ id: 'filtered', columns: [{ name: 'value', type: 'number' }], rawRows: selected }, { metric: 'value', aggregation: 'average' }).results[0].value).toBe(11);
  });

  it('retains explicit nonconsecutive source identities when an outlier row is selected', () => {
    const fixture = contracts.outliers;
    const rows = fixture.values.map((value, index) => ({ sourceRow: fixture.sourceRows[index], value }));
    const page = filterAndPaginateLocalData(rows, { filters: { sourceRow: '101' } });
    expect(page.data.map(({ sourceRow }) => sourceRow)).toEqual(fixture.outlierSourceRows);
    expect(page.data.map(({ value }) => value)).toEqual(fixture.outlierValues);
  });
});
