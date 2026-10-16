import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { approveQualityRevision, qualityRevisionKey, isQualityApproved } from '../qualityReview';
import { reviewSourceGrain } from '../sourceGrain';
import { buildEntityPage, readEntityPage } from '../localAI/entities';
import { runLocalAgent } from '../localAI/agent';
import { saveLocalDataset, loadLocalDataset } from '../localDatasetStore';
import { encodeDatasetPayload } from '../datasetWorkerPayload';
import { computeScopedMetric } from '../analysisScope';
import { computeChartSeries } from '../chartComputation';
import { buildEvidenceGraph, computeGraphMetric } from '../localAI/graph';
import { sortedTablePage } from '../boundedTablePage';
import { plotDataAlternative } from '../plotDataAlternative';
import { analyzeQueryWithData } from '../aiQueryEngine';
const source = (id, rows, columnOverrides = {}) => approveQualityRevision({ id, name: id, revision: 'r1', isLocal: true,
  columns: Object.keys(rows[0]).map((name) => ({ name, type: name === 'value' ? 'number' : 'string' })), rawRows: rows, columnOverrides });
describe('reviewed application semantics', () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
  it('exposes matrix, financial and hierarchy values rather than empty or array-valued chart alternatives', () => {
    expect(plotDataAlternative([{ type: 'surface', x: [10, 20], y: [30], z: [[1, 2]] }]).rows).toEqual([{ series: 'surface', x: 10, y: 30, z: 1 }, { series: 'surface', x: 20, y: 30, z: 2 }]);
    expect(plotDataAlternative([{ type: 'candlestick', x: ['day'], open: [1], high: [4], low: [0], close: [3] }]).rows[0]).toMatchObject({ open: 1, high: 4, low: 0, close: 3 });
    expect(plotDataAlternative([{ type: 'sunburst', labels: ['West'], parents: [''], values: [5] }]).rows[0]).toMatchObject({ label: 'West', value: 5 });
    expect(plotDataAlternative([{ x: Array.from({ length: 10000 }, (_, i) => i) }]).rows).toHaveLength(100);
  });
  it('uses reviewed calendar groups in deterministic questions and directs exact measures to validated calculators', () => {
    const dataset = source('calendar', [{ value: 1, day: '2026-01-01T23:30:00Z' }, { value: 2, day: '2026-01-02T00:30:00Z' }], { day: { type: 'date', role: 'dimension', dateKind: 'instant-day', timeZone: 'Asia/Kolkata' } });
    expect(analyzeQueryWithData('total value by day', dataset).keyInsights).toEqual(['1. 2026-01-02: 3']);
    const exact = { ...dataset, columnOverrides: { ...dataset.columnOverrides, value: { type: 'number', role: 'measure', precision: 'exact' } } };
    expect(analyzeQueryWithData('total value', exact).intent).toBe('CLARIFICATION_REQUIRED');
  });
  it('checks grain without changing keys or deleting repeated source records', () => {
    const dataset = source('grain', [{ ID: '001' }, { ID: '1' }, { ID: '001' }, { ID: null }]);
    const rowGrain = reviewSourceGrain(dataset, { fields: ['ID'], description: 'One submitted observation' });
    expect(rowGrain).toMatchObject({ rows: 4, unique: false, repeatedKeyRows: 1, missingKeyRows: 1 });
    expect(isQualityApproved({ ...dataset, rowGrain })).toBe(false);
    expect(dataset.rawRows).toHaveLength(4);
  });
  it('indexes every saved identifier occurrence through page boundaries with stable citations', async () => {
    const dataset = source('entities', Array.from({ length: 1303 }, (_, i) => ({ ID: String(i).padStart(6, '0'), person: 'Zoë' })), { ID: { type: 'string', role: 'identifier' } });
    await saveLocalDataset(dataset); const loaded = await loadLocalDataset(dataset.id); const reference = encodeDatasetPayload({ dataset: loaded }).dataset;
    let cursor; let page; const records = [];
    do { page = await readEntityPage(reference, cursor); expect(page.records.length).toBeLessThanOrEqual(64); records.push(...page.records); cursor = page.cursor; } while (!page.complete);
    expect(records).toHaveLength(1303); expect(new Set(records.map(({ id }) => id)).size).toBe(1303);
    expect(records.at(-1)).toMatchObject({ value: '001302', sourceRowId: 'entities:row:1303', revision: qualityRevisionKey(dataset) });
    await saveLocalDataset({ ...dataset, revision: 'r2' }); await expect(readEntityPage(reference)).rejects.toThrow('changed');
  });
  it('requires reviewed identifiers and rejects invalid entity cursors', () => {
    const dataset = source('no-key', [{ prose: 'Long text' }]);
    expect(() => buildEntityPage(dataset)).toThrow('identifier');
    expect(() => buildEntityPage(dataset, { row: -1, column: 0 })).toThrow('cursor');
  });
  it('keeps graph exact decimals and native chart calendar groups consistent with calculation tools', () => {
    const left = source('left', [{ ID: '1', value: '0.1', day: '2026-01-01T23:30:00Z' }, { ID: '2', value: '0.2', day: '2026-01-02T00:30:00Z' }],
      { value: { type: 'number', role: 'measure', precision: 'exact', unit: 'USD' }, day: { type: 'date', role: 'dimension', dateKind: 'instant-day', timeZone: 'Asia/Kolkata' } });
    const right = source('right', [{ ID: '1' }, { ID: '2' }]);
    const edge = { id: 'join', status: 'approved', leftDatasetId: 'left', rightDatasetId: 'right', leftColumn: 'ID', rightColumn: 'ID', leftUpdatedAt: null, rightUpdatedAt: null,
      leftRevisionKey: qualityRevisionKey(left), rightRevisionKey: qualityRevisionKey(right) };
    const graph = buildEvidenceGraph([left, right], [edge]);
    const result = computeGraphMetric([left, right], graph, { sourceId: 'left', edgeIds: ['join'], metric: 'left::value', dimension: 'left::day' });
    expect(result).toMatchObject({ unit: 'USD', results: [{ group: '2026-01-02', value: '0.3' }] });
    expect(computeScopedMetric(left, { metric: 'value', dimension: 'day' }).results).toEqual([{ group: '2026-01-02', rowCount: 2, value: '0.3' }]);
    expect(computeChartSeries({ rows: left.rawRows, selectedX: 'day', metricKey: '__count__', aggregation: 'count', visibleItems: 10, columnOverrides: left.columnOverrides }).categoricalSeries).toEqual([{ name: '2026-01-02', value: 2 }]);
    const fanout = source('right', [{ ID: '1' }, { ID: '1' }]);
    const repeatedEdge = { ...edge, rightRevisionKey: qualityRevisionKey(fanout) };
    expect(() => computeGraphMetric([left, fanout], buildEvidenceGraph([left, fanout], [repeatedEdge]), { sourceId: 'left', edgeIds: ['join'], metric: 'left::value' })).toThrow('repeats');
  });
  it('sorts distinct large integer text without collapsing it to Number', () => {
    expect(sortedTablePage([{ value: '9007199254740993' }, { value: '9007199254740992' }], { page: 1, limit: 1, sort: 'value', matches: () => true }).data[0].value).toBe('9007199254740992');
  });
  it('requires an explicit precision choice for large integer text used as a measure', () => {
    const dataset = source('precision', [{ value: '9007199254740993' }]);
    expect(() => computeScopedMetric(dataset, { metric: 'value' })).toThrow('safe Number');
    const exact = { ...dataset, columnOverrides: { value: { type: 'number', role: 'measure', precision: 'exact' } } };
    expect(computeScopedMetric(exact, { metric: 'value' }).results[0].value).toBe('9007199254740993');
  });
  it('proposes an existing chart edit only after a matching calculation, without mutating the layout', async () => {
    const dataset = source('edit', [{ region: 'West', value: 1 }, { region: 'East', value: 2 }], { value: { type: 'number', role: 'measure' } });
    const layout = { id: 'layout', layout: [{ i: 'card', title: 'Old title', chartType: 'bar', x: 0, y: 0, w: 6, h: 4 }] };
    const generate = vi.fn().mockResolvedValueOnce({ type: 'tool', name: 'list_charts', args: {} })
      .mockResolvedValueOnce({ type: 'tool', name: 'calculate', args: { metric: 'value', dimension: 'region', aggregation: 'sum' } })
      .mockResolvedValueOnce({ type: 'tool', name: 'propose_chart_edit', args: { cardId: 'card', title: 'Reviewed change', chartType: 'bar', preferredX: 'region', preferredY: 'value', aggregation: 'sum' } })
      .mockResolvedValueOnce({ type: 'final', message: 'Preview the change', evidenceIds: [] });
    const result = await runLocalAgent({ query: 'Edit the existing chart', datasets: [dataset], selectedId: dataset.id, graph: { edges: [] }, layout, generate });
    expect(result.chartEditProposal).toMatchObject({ cardId: 'card', layoutId: 'layout', sourceRevision: qualityRevisionKey(dataset), card: { title: 'Reviewed change', evidenceId: 'calculation:1' } });
    expect(layout.layout[0].title).toBe('Old title'); expect(result.chartEditProposal.before).toBe(JSON.stringify(layout.layout[0]));
  });
});
