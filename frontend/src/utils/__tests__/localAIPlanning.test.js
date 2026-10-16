import { expect, it } from 'vitest';
import { approveQualityRevision, qualityRevisionKey } from '../qualityReview';
import { buildEvidenceGraph, computeGraphMetric } from '../localAI/graph';
import { compileCalculationPlans } from '../localAI/planning';
import { questionRequirements } from '../localAI/questionRequirements';

const source = (id, rows, numeric = []) => approveQualityRevision({ id, name: `${id}.csv`, isLocal: true, revision: 'r1',
  columns: Object.keys(rows[0]).map((name) => ({ name, type: numeric.includes(name) ? 'number' : 'string' })), rawRows: rows });
const events = source('events', [{ Key: '001', Amount: 7 }, { Key: '002', Amount: 11 }], ['Amount']);
const entities = source('entities', [{ Key: '001', ZoneKey: '01' }, { Key: '002', ZoneKey: '02' }]);
const zones = source('zones', [{ ZoneKey: '01', Zone: 'North' }, { ZoneKey: '02', Zone: 'South' }]);
const edge = (id, left, right, leftColumn, rightColumn) => ({ id, status: 'approved', leftDatasetId: left.id, rightDatasetId: right.id, leftColumn, rightColumn,
  leftUpdatedAt: left.updatedAt || null, rightUpdatedAt: right.updatedAt || null,
  leftRevisionKey: qualityRevisionKey(left), rightRevisionKey: qualityRevisionKey(right) });
const datasets = [events, entities, zones];
const relationships = [edge('ee', events, entities, 'Key', 'Key'), edge('ez', entities, zones, 'ZoneKey', 'ZoneKey')];
const compile = (question, sources = datasets, edges = relationships) => compileCalculationPlans({ question,
  requirements: questionRequirements(question, sources), datasets: sources, selectedId: events.id, graph: buildEvidenceGraph(sources, edges) });

it('compiles an explicit approved two-hop plan that executes at the requested grain', () => {
  const { plans, status } = compile('Sum Amount by Zone using events.csv through entities.csv to zones.csv.');
  expect(status).toBe('ready');
  expect(plans[0].args).toMatchObject({ edgeIds: ['ee', 'ez'], metric: 'events::Amount', dimension: 'zones::Zone', aggregation: 'sum' });
  expect(computeGraphMetric(datasets, buildEvidenceGraph(datasets, relationships), plans[0].args).results).toEqual([{ group: 'South', value: 11 }, { group: 'North', value: 7 }]);
});
it('never chooses a shortest path when two approved paths have different meaning', () => {
  const direct = edge('direct', events, zones, 'Key', 'ZoneKey');
  expect(compile('Sum Amount by Zone', datasets, [...relationships, direct]).status).toBe('ambiguous');
  expect(compile('Sum Amount by Zone through entities.csv', datasets, [...relationships, direct]).plans[0].args.edgeIds).toEqual(['ee', 'ez']);
});
it('does not reuse stale approvals or disconnected sources', () => {
  expect(compile('Sum Amount by Zone', datasets, [{ ...relationships[0], status: 'rejected' }, relationships[1]]).status).toBe('unavailable');
  const changed = approveQualityRevision({ ...entities, revision: 'r2' });
  expect(compile('Sum Amount by Zone', [events, changed, zones]).status).toBe('unavailable');
});
it.each(['Sum Amount by Zone for North', 'Do not sum Amount by Zone', 'Sum Amount by Zone where Key = 001',
  'Compare sum Amount by Zone', 'Sum Amount by Zone without South', 'Sum Amount in North', 'Sum Amount since 2025',
  'Sum Amount and average Amount', 'Sum Amount by Zone and Key', 'Top 5 sum Amount by Zone'])('asks for explicit scope rather than silently dropping restrictions: %s', (query) => {
  expect(compile(query).status).toBe('unsupported');
});

it('binds an explicitly named weight without inventing a denominator', () => {
  const weighted = source('events', [{ Amount: 2, Weight: 1 }, { Amount: 8, Weight: 3 }], ['Amount', 'Weight']);
  expect(compile('Calculate the weighted average of Amount using Weight.', [weighted], []).plans[0].args)
    .toMatchObject({ metric: 'Amount', weight: 'Weight', aggregation: 'weighted_average' });
  expect(compile('Calculate the weighted average of Amount.', [weighted], []).status).toBe('unbound');
  expect(compile('Average Amount weighted by Weight.', [weighted], []).plans[0].args)
    .toMatchObject({ weight: 'Weight', aggregation: 'weighted_average' });
  expect(compile('Sum Amount multiplied by Weight.', [weighted], []).status).toBe('unsupported');
});
it('accepts a descriptive source label and prepares both sides of a plain average comparison', () => {
  const power = source('power', [{ AEP: 2, PJME: 8 }], ['AEP', 'PJME']);
  const compilePower = (question) => compileCalculationPlans({ question, requirements: questionRequirements(question, [power]),
    datasets: [power], selectedId: power.id, graph: buildEvidenceGraph([power], []) });
  expect(compilePower('For this energy source, give the sum of AEP across all imported rows.').plans[0].args)
    .toMatchObject({ metric: 'AEP', aggregation: 'sum' });
  const plans = compilePower('Which has the higher average, AEP or PJME? State both averages.');
  expect(plans.status).toBe('ready');
  expect(plans.plans.map((plan) => plan.args.metric)).toEqual(['AEP', 'PJME']);
  expect(compilePower('Which has the higher average, AEP or PJME in 2024?').status).toBe('unsupported');
});
it('never substitutes an ungrouped total when the requested grouping field is missing', () => {
  expect(compile('Sum Amount by Product.').status).toBe('unavailable');
  expect(compile('Sum Amount by ZoneCode.').status).toBe('unavailable');
});
it('keeps repeated fields ambiguous and blocks reviewed identifier measures', () => {
  const repeated = source('other', [{ Amount: 99 }], ['Amount']);
  expect(compile('Sum Amount by Zone', [...datasets, repeated]).status).toBe('ambiguous');
  const ignored = approveQualityRevision({ ...events, columnOverrides: { Amount: { role: 'identifier' } } });
  expect(compile('Sum Amount by Zone', [ignored, entities, zones]).status).toBe('unbound');
});
it('retains fan-out rejection even when a structural plan is unique', () => {
  const duplicate = approveQualityRevision({ ...entities, rawRows: [...entities.rawRows, entities.rawRows[0]] });
  const sources = [events, duplicate, zones];
  const edges = [edge('ee', events, duplicate, 'Key', 'Key'), edge('ez', duplicate, zones, 'ZoneKey', 'ZoneKey')];
  const plan = compile('Sum Amount by Zone', sources, edges).plans[0];
  expect(() => computeGraphMetric(sources, buildEvidenceGraph(sources, edges), plan.args)).toThrow('repeats measure rows');
});
it('accepts source and follow-up phrasing without interpreting it as a row restriction', () => {
  expect(compile('What is the mean of Amount for this source?').status).toBe('ready');
  expect(compile('Quick check before a follow-up: what is the total Amount across all rows?').status).toBe('ready');
  expect(compile('For each Key, show the sum of Amount.', [events], []).plans[0].args).toMatchObject({ metric: 'Amount', dimension: 'Key', aggregation: 'sum' });
});
it('binds an explicit contains filter to the calculation and keeps other restrictions unsupported', () => {
  const planned = compile('For rows where Key contains "001", add up Amount.');
  expect(planned.status).toBe('ready');
  expect(planned.plans[0].args).toMatchObject({ metric: 'Amount', aggregation: 'sum', filters: { Key: '001' } });
  expect(compile('Sum Amount where Key exactly "001"').status).toBe('unsupported');
  expect(compile('Sum Amount by Zone where Key contains "001"').status).toBe('unsupported');
});
it('plans a highest grouped total from explicit fields while rejecting ambiguous ranking', () => {
  const ranked = compile('Which Key has the highest total Amount, and what is its total?', [events], []);
  expect(ranked.status).toBe('ready');
  expect(ranked.plans[0].args).toMatchObject({ metric: 'Amount', dimension: 'Key', aggregation: 'sum', limit: 100 });
  expect(compile('Top 5 Amount by Key', [events], []).status).not.toBe('ready');
});
