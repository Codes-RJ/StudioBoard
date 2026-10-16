import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { approveQualityRevision, qualityRevisionKey } from '../qualityReview';
import { saveLocalDataset, loadLocalDataset } from '../localDatasetStore';
import { encodeDatasetPayload } from '../datasetWorkerPayload';
import { runSavedGraph } from '../localAI/savedGraph';
import { buildEvidenceGraph, computeGraphMetric } from '../localAI/graph';
const source = (id, rows) => approveQualityRevision({ id, name: id, isLocal: true, revision: 'r1', rawRows: rows,
  columns: Object.keys(rows[0]).map((name) => ({ name, type: name === 'value' ? 'number' : 'string' })) });
describe('saved reviewed graph projections', () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
  it('matches in-memory graph and calculation without unrelated fields or sources', async () => {
    const a = source('a', Array.from({ length: 2101 }, (_, i) => ({ key: `k${i % 2}`, value: i, irrelevant: 'x'.repeat(400) })));
    const b = source('b', [{ key: 'k0', group: 'West' }, { key: 'k1', group: 'East' }]);
    await saveLocalDataset(a); await saveLocalDataset(b);
    const loaded = await Promise.all([a, b].map((dataset) => loadLocalDataset(dataset.id)));
    const edge = { id: 'ab', status: 'approved', leftDatasetId: a.id, rightDatasetId: b.id, leftColumn: 'key', rightColumn: 'key', leftUpdatedAt: null, rightUpdatedAt: null, leftRevisionKey: qualityRevisionKey(a), rightRevisionKey: qualityRevisionKey(b) };
    const references = encodeDatasetPayload({ datasets: loaded }).datasets;
    const graph = await runSavedGraph('graph', { datasets: references, relationships: [edge] });
    expect(graph).toEqual(buildEvidenceGraph(loaded, [edge]));
    const options = { sourceId: 'a', edgeIds: ['ab'], metric: 'a::value', dimension: 'b::group' };
    expect(await runSavedGraph('graph-calculate', { datasets: [...references, { kind: 'local-dataset-reference', id: 'unavailable' }], graph, options })).toEqual(computeGraphMetric(loaded, graph, options));
  });
  it('rejects changed saved generations and cancellation', async () => {
    const data = source('stale', [{ key: '001', value: 7 }]); await saveLocalDataset(data);
    const loaded = await loadLocalDataset(data.id); const references = encodeDatasetPayload({ datasets: [loaded] }).datasets;
    await saveLocalDataset({ ...data, revision: 'r2' });
    await expect(runSavedGraph('graph', { datasets: references })).rejects.toThrow('changed');
    const controller = new AbortController(); controller.abort();
    await expect(runSavedGraph('graph', { datasets: [data] }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
