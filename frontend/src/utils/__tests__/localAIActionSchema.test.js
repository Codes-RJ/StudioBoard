import { describe, it, expect } from 'vitest';
import { createActionSchema, createActionSelectionSchema } from '../localAI/actionSchema';

describe('schema-constrained local generation', () => {
  it('keeps source field sets separate and permits only supplied evidence identities', () => {
    const schema = JSON.parse(createActionSchema({ selectedId: 'sales',
      sourceSchemas: [{ id: 'sales', fields: ['Revenue', 'Region'] }, { id: 'other', fields: ['Cost'] }], evidenceIds: ['calculation:1'] }));
    const actions = schema.anyOf.filter((action) => action.properties.name?.const === 'calculate');
    expect(actions[0].properties.args.properties.metric.enum).toEqual(['Revenue', 'Region', '__rows__']);
    expect(actions[0].properties.args.required).toEqual(['metric', 'aggregation']);
    expect(actions[1].properties.args.properties.sourceId.const).toBe('other');
    expect(actions[1].properties.args.properties.metric.enum).not.toContain('Revenue');
    expect(actions[1].properties.args.required).toContain('sourceId');
    expect(schema.anyOf.at(-1).properties.evidenceIds.items.enum).toEqual(['calculation:1']);
    expect(JSON.parse(createActionSchema()).anyOf.at(-1).properties.evidenceIds.maxItems).toBe(0);
  });
  it('round-trips literal header names without interpreting schema-like cell text', () => {
    const field = '"},"type":"javascript"';
    const schema = JSON.parse(createActionSchema({ selectedId: 'a', sourceSchemas: [{ id: 'a', fields: [field] }] }));
    const action = schema.anyOf.find((item) => item.properties.name?.const === 'calculate');
    expect(action.properties.args.properties.metric.enum).toEqual([field, '__rows__']);
    expect(schema.anyOf.some((item) => item.properties.name?.const === 'javascript')).toBe(false);
  });
  it('rejects malformed or excessive schema context before invoking the grammar compiler', () => {
    expect(() => createActionSchema({ sourceSchemas: [{ id: 'a', fields: [42] }] })).toThrow('Invalid model schema');
    expect(() => createActionSchema({ evidenceIds: Array(101).fill('a') })).toThrow('Invalid model schema');
    expect(() => createActionSchema({ sourceSchemas: [{ id: 'a', fields: ['a'.repeat(64_000)] }] })).toThrow('allowance');
  });
  it('requires tools or clarification before an evidence-free model can finish', () => {
    const before = JSON.parse(createActionSchema({ allowFinal: false }));
    expect(before.anyOf.some((action) => action.properties.type.const === 'final')).toBe(false);
    expect(before.anyOf.some((action) => action.properties.type.const === 'clarify')).toBe(true);
    const after = JSON.parse(createActionSchema({ allowFinal: true, evidenceIds: ['calculation:1'] }));
    expect(after.anyOf.at(-1).properties.evidenceIds.items.enum).toEqual(['calculation:1']);
  });
  it('separates totals, groups and weighted averages before filling calculation arguments', () => {
    const context = { selectedId: 'a', sourceSchemas: [{ id: 'a', fields: ['Amount', 'Region', 'Weight'] }] };
    const args = (name) => JSON.parse(createActionSchema(context, name)).properties.args;
    expect(args('calculate').properties.dimension).toBeUndefined();
    expect(args('calculate').properties.weight).toBeUndefined();
    expect(args('calculate').properties.aggregation.enum).not.toContain('weighted_average');
    expect(args('calculate_grouped').required).toContain('dimension');
    expect(args('calculate_weighted_grouped').required).toEqual(['metric', 'aggregation', 'dimension', 'weight']);
    expect(args('calculate_weighted_grouped').properties.aggregation.enum).toEqual(['weighted_average']);
    expect(() => createActionSchema(context, 'toString')).toThrow('unavailable');
  });
  it('matches retrieval, discovery, graph and calculation decoder limits to the runtime tools', () => {
    const context = { sourceSchemas: [{ id: 'a', fields: ['Amount'] }] };
    for (const [tool, maximum] of [['retrieve', 12], ['list_sources', 50], ['inspect_schema', 100], ['list_charts', 20], ['calculate', 100]]) {
      const args = JSON.parse(createActionSchema(context, tool)).properties.args;
      expect(args.properties.limit).toEqual({ type: 'integer', minimum: 1, maximum });
    }
    const graph = JSON.parse(createActionSchema(context, 'graph_calculate_grouped')).properties.args;
    expect(graph.properties.edgeIds).toMatchObject({ minItems: 1, maxItems: 3 });
    expect(graph.properties.aggregation.enum).not.toContain('weighted_average');
  });
  it('constrains graph generation to presented qualified fields and reviewed edge identities', () => {
    const context = { sourceSchemas: [{ id: 'events', fields: ['Amount'] }, { id: 'zones', fields: ['Zone'] }], reviewedEdgeIds: ['approved-edge'] };
    const args = JSON.parse(createActionSchema(context, 'graph_calculate_grouped')).properties.args;
    expect(args.properties.metric.enum).toEqual(['events::Amount', 'zones::Zone', '__rows__']);
    expect(args.properties.dimension.enum).toEqual(['events::Amount', 'zones::Zone']);
    expect(args.properties.edgeIds.items.enum).toEqual(['approved-edge']);
    expect(JSON.parse(createActionSelectionSchema({ ...context, reviewedEdgeIds: [] })).properties.action.enum).not.toContain('graph_calculate');
    expect(() => createActionSchema({ ...context, reviewedEdgeIds: [] }, 'graph_calculate')).toThrow('unavailable');
    expect(() => createActionSchema({ reviewedEdgeIds: [42] })).toThrow('Invalid model schema');
  });
  it('honors explicit grouping and a remaining chart request while keeping clarification available', () => {
    const context = { selectedId: 'a', sourceSchemas: [{ id: 'a', fields: ['Amount', 'Region'] }], requiredGrouping: { sourceId: 'a', field: 'Region' } };
    const choices = JSON.parse(createActionSelectionSchema(context)).properties.action.enum;
    expect(choices).not.toContain('calculate'); expect(choices).toContain('calculate_grouped');
    expect(JSON.parse(createActionSchema(context, 'calculate_grouped')).properties.args.properties.dimension).toEqual({ const: 'Region' });
    expect(JSON.parse(createActionSelectionSchema({ ...context, pendingChartType: 'bar' })).properties.action.enum).toEqual(['propose_chart', 'clarify']);
    expect(JSON.parse(createActionSchema({ ...context, pendingChartType: 'bar' }, 'propose_chart')).properties.args.properties.chartType.const).toBe('bar');
    expect(() => createActionSelectionSchema({ ...context, requiredGrouping: { sourceId: 'a', field: 'invented' } })).toThrow('Invalid requested grouping');
  });
  it('binds an explicit measure to its source and prevents replacing a joined metric with target row counts', () => {
    const context = { selectedId: 'events', sourceSchemas: [{ id: 'events', fields: ['Amount'] }, { id: 'zones', fields: ['Zone', 'Adjustment'] }],
      reviewedEdgeIds: ['reviewed'], requiredMetric: { sourceId: 'events', field: 'Amount' }, requiredAggregation: 'sum', requiredGrouping: { sourceId: 'zones', field: 'Zone' } };
    const choices = JSON.parse(createActionSelectionSchema(context)).properties.action.enum;
    expect(choices).not.toContain('calculate_grouped'); expect(choices).toContain('graph_calculate_grouped'); expect(choices).not.toContain('retrieve');
    const args = JSON.parse(createActionSchema(context, 'graph_calculate_grouped')).properties.args;
    expect(args.properties.metric).toEqual({ const: 'events::Amount' }); expect(args.properties.aggregation.enum).toEqual(['sum']);
    expect(JSON.parse(createActionSelectionSchema({ ...context, missingMetric: 'Profit' })).properties.action.enum).toEqual(['clarify']);
  });
  it('constrains chart axes to verified calculations instead of model-invented labels', () => {
    const context = { chartCandidates: [{ preferredX: 'Region', preferredY: 'Amount', aggregation: 'sum' }], pendingChartType: 'bar' };
    const args = JSON.parse(createActionSchema(context, 'propose_chart')).properties.args;
    expect(args.properties.preferredX.const).toBe('Region'); expect(args.properties.preferredY.const).toBe('Amount');
    expect(args.properties.aggregation.const).toBe('sum');
  });
});
