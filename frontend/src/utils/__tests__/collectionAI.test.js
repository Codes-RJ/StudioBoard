import { describe, expect, it, vi } from 'vitest';
import { createCollection, collectionRelationships } from '../../../fixtures/collection.mjs';
import { approveQualityRevision, qualityRevisionKey } from '../qualityReview';
import { computeScopedMetric } from '../analysisScope';
import { buildEvidenceIndex, retrieveSourceEvidence } from '../localAI/evidence';
import { buildEvidenceGraph, computeGraphMetric } from '../localAI/graph';
import { runLocalAgent } from '../localAI/agent';
import { datasetCatalogMetadata } from '../datasetCatalogMetadata';
import { decodeDatasetPayload, encodeDatasetPayload, rememberStoredDataset } from '../datasetWorkerPayload';

const fixtures = createCollection();
const sources = fixtures.map((fixture) => approveQualityRevision({ id: fixture.id, name: fixture.name, revision: 'fixture-r1', updatedAt: '2026-10-08', isLocal: true,
  columns: Object.keys(fixture.rows[0]).map((name) => ({ name, type: fixture.numeric.includes(name) ? 'number' : 'string' })), rawRows: structuredClone(fixture.rows),
  metrics: { columnGroups: { all: Object.keys(fixture.rows[0]), numeric: fixture.numeric, measures: fixture.numeric, dimensions: ['Region'], categorical: ['Region'], date: [] } } }));
const relationships = collectionRelationships(sources, qualityRevisionKey);
const graph = buildEvidenceGraph(sources, relationships);
const run = (selected, actions, extra = {}) => runLocalAgent({ query: 'Answer the fixture question', datasets: sources, selectedId: selected.id, graph,
  generate: vi.fn(async () => JSON.stringify(actions.shift())), retrieve: async (source, query, options) => retrieveSourceEvidence(source, buildEvidenceIndex(source), query, options),
  graphRetrieve: async () => ({ paths: [] }), ...extra });

describe('30-source collection contracts', () => {
  it('retains all thirty reviewed sources and twenty relationships after saved rows are evicted', async () => {
    const saved = sources.map((source, index) => rememberStoredDataset({ ...source }, `saved-generation-${index}`));
    const summaries = saved.map(datasetCatalogMetadata);
    const encoded = encodeDatasetPayload({ datasets: summaries });
    expect(encoded.datasets.every((source) => source.kind === 'local-dataset-reference' && source.storageRevision)).toBe(true);
    const hydrated = await decodeDatasetPayload(encoded, async (id, expected) => {
      const index = saved.findIndex((source) => source.id === id);
      expect(expected).toEqual({ expectedRevision: qualityRevisionKey(saved[index]), expectedStorageRevision: `saved-generation-${index}` });
      return saved[index];
    });
    const current = buildEvidenceGraph(hydrated.datasets, relationships);
    expect(current.coverage).toMatchObject({ approvedSources: 30, acceptedEdges: 20, excludedEdges: 0 });
  });
  it.each(fixtures)('$id preserves identifiers, counts every row and retrieves exact source evidence', (fixture) => {
    const source = sources.find((item) => item.id === fixture.id);
    expect(computeScopedMetric(source, { metric: '__rows__', aggregation: 'count' }).results[0].value).toBe(fixture.rows.length);
    const field = fixture.metric ? 'Notes' : fixture.id.endsWith('entities') ? 'Label' : 'Zone';
    const query = String(fixture.rows.at(-1)[field]);
    const found = retrieveSourceEvidence(source, buildEvidenceIndex(source), query, { limit: 8 });
    expect(found.hits.some((hit) => hit.sourceRowId?.endsWith(`:row:${fixture.rows.length}`))).toBe(true);
    expect(found.hits.every((hit) => hit.datasetId === source.id && hit.revision === qualityRevisionKey(source))).toBe(true);
    if (fixture.metric) {
      expect(source.rawRows[0].ID).toBe(fixture.rows[0].ID);
      expect(source.rawRows[0].EntityKey).toBe('000');
      expect(computeScopedMetric(source, { metric: fixture.metric, aggregation: 'sum' }).results[0].value).toBe(fixture.expected.sum);
      const average = computeScopedMetric(source, { metric: fixture.metric, aggregation: 'average' });
      expect(average.results[0].value).toBeCloseTo(fixture.expected.average, 10);
      expect(Object.fromEntries(computeScopedMetric(source, { metric: fixture.metric, dimension: 'Region', aggregation: 'sum' }).results.map((row) => [row.group, row.value]))).toEqual(fixture.expected.groups);
    }
  });
  it.each(fixtures.filter((fixture) => fixture.metric))('$id computes an approved two-hop relationship without measure duplication', async (fixture) => {
    const source = sources.find((item) => item.id === fixture.id); const domain = fixture.id.replace('-events', '');
    const edgeIds = [`${domain}-events->${domain}-entities`, `${domain}-entities->${domain}-zones`];
    const options = { sourceId: source.id, edgeIds, metric: `${source.id}::${fixture.metric}`, dimension: `${domain}-zones::Zone`, aggregation: 'sum' };
    const expected = Object.fromEntries(['North', 'South'].map((zone) => [zone, fixture.rows.filter((row) => ((Number(row.EntityKey) % 2) ? 'South' : 'North') === zone).reduce((sum, row) => sum + (row[fixture.metric] ?? 0), 0)]));
    expect(Object.fromEntries(computeGraphMetric(sources, graph, options).results.map((row) => [row.group, row.value]))).toEqual(expected);
    const answer = await run(source, [{ type: 'tool', name: 'graph_calculate', args: options }, { type: 'final', evidenceIds: ['calculation:1'] }]);
    expect(answer.steps[0].success).toBe(true); expect(answer.computations[0].results).toHaveLength(2);
    expect(answer.citations[0].revision).toBe(qualityRevisionKey(source));
  });
  it('discovers the thirtieth source and a measure beyond the first schema page', async () => {
    const selected = sources[0]; const target = sources.find((source) => source.id === 'research-events');
    const answer = await run(selected, [
      { type: 'tool', name: 'list_sources', args: { query: 'research-events' } },
      { type: 'tool', name: 'inspect_schema', args: { sourceId: target.id, query: 'Measurement' } },
      { type: 'tool', name: 'calculate', args: { sourceId: target.id, metric: 'Measurement', aggregation: 'sum' } },
      { type: 'final', evidenceIds: ['calculation:1'] },
    ]);
    expect(answer.computations[0].results[0].value).toBe(fixtures.find((fixture) => fixture.id === target.id).expected.sum);
    const last = await run(selected, [{ type: 'tool', name: 'list_sources', args: { offset: 29 } }, { type: 'final', evidenceIds: [], message: 'Found research zones.' }]);
    expect(last.steps[0].success).toBe(true); expect(sources[29].id).toBe('research-zones');
  });
  it('cancels an active planning turn and rejects source changes before executing its chosen tool', async () => {
    const controller = new AbortController(); const calculate = vi.fn();
    await expect(run(sources[0], [], { signal: controller.signal, calculate, generate: async () => { controller.abort(); return { type: 'tool', name: 'calculate', args: { metric: 'Revenue' } }; } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calculate).not.toHaveBeenCalled();
    const changing = structuredClone(sources); const selected = changing[0];
    await expect(run(selected, [], { datasets: changing, calculate, generate: async () => { changing[29].revision = 'changed'; return { type: 'final', evidenceIds: [] }; } })).rejects.toThrow('source changed');
    expect(calculate).not.toHaveBeenCalled();
  });
});
