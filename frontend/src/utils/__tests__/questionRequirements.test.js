import { expect, it } from 'vitest';
import { questionRequirements } from '../localAI/questionRequirements';
const sources = [{ id: 'sales', columns: ['Amount (USD)', 'Region'] }, { id: 'zones', columns: ['Zone'] }];
it('binds an explicit literal grouping and chart request without inventing a calculation', () => {
  expect(questionRequirements('Sum Amount (USD) grouped by Region, then propose a bar chart.', sources))
    .toEqual({ grouping: { sourceId: 'sales', field: 'Region' }, ambiguousGrouping: false, chartType: 'bar', metric: { sourceId: 'sales', field: 'Amount (USD)' }, aggregation: 'sum', missingMetric: null });
  expect(questionRequirements('Sum Amount (USD) by Zone', sources).grouping).toEqual({ sourceId: 'zones', field: 'Zone' });
});
it('leaves repeated field names ambiguous, escapes headers and respects a simple negative chart request', () => {
  expect(questionRequirements('Group by Region', [...sources, { id: 'other', columns: ['Region'] }]).ambiguousGrouping).toBe(true);
  expect(questionRequirements('Group by RegionCode', sources).grouping).toBeNull();
  expect(questionRequirements('Do not propose a bar chart', sources).chartType).toBeNull();
  expect(questionRequirements('Sum all rows', sources)).toEqual({ grouping: null, ambiguousGrouping: false, chartType: null, metric: null, aggregation: null, missingMetric: null });
});
it('does not substitute row counts for an explicit absent field or replace a named measure', () => {
  expect(questionRequirements('Calculate Profit. Ask which available measure I mean.', sources).missingMetric).toBe('Profit');
  expect(questionRequirements('Now calculate the average of that same measure.', sources).missingMetric).toBe('the previous measure');
  expect(questionRequirements('Calculate the sum of Amount (USD) grouped by Zone.', sources)).toMatchObject({ metric: { sourceId: 'sales', field: 'Amount (USD)' }, aggregation: 'sum' });
  expect(questionRequirements('Calculate the sum of Profit across all rows.', sources).missingMetric).toBe('Profit');
});
it('carries only a present prior field identity into an explicit follow-up, never its old value', () => {
  expect(questionRequirements('Now calculate the average of that same measure.', sources, { sourceId: 'sales', metric: 'Amount (USD)', value: 999 }))
    .toMatchObject({ metric: { sourceId: 'sales', field: 'Amount (USD)' }, aggregation: 'average', missingMetric: null });
  expect(questionRequirements('Average of that same measure.', sources, { sourceId: 'other', metric: 'Amount (USD)' }).missingMetric).toBe('the previous measure');
});
it('binds ordinary paraphrases and per-group questions to the named fields', () => {
  expect(questionRequirements('What is the smallest recorded Amount (USD)?', sources)).toMatchObject({ metric: { sourceId: 'sales', field: 'Amount (USD)' }, aggregation: 'min' });
  expect(questionRequirements('What is the largest recorded Amount (USD)?', sources)).toMatchObject({ metric: { sourceId: 'sales', field: 'Amount (USD)' }, aggregation: 'max' });
  expect(questionRequirements('Across imported rows, add up Amount (USD).', sources)).toMatchObject({ metric: { sourceId: 'sales', field: 'Amount (USD)' }, aggregation: 'sum' });
  expect(questionRequirements('For each Region, show the mean of Amount (USD).', sources)).toMatchObject({ grouping: { sourceId: 'sales', field: 'Region' }, metric: { sourceId: 'sales', field: 'Amount (USD)' }, aggregation: 'average' });
});
it('binds a numeric validity count and a two-measure average comparison', () => {
  const table = [{ id: 'power', columns: ['AEP', 'PJME', 'Datetime'] }];
  expect(questionRequirements('How many imported rows have a missing or nonnumeric AEP value? State the scope.', table))
    .toMatchObject({ qualityField: { sourceId: 'power', field: 'AEP' }, metric: { sourceId: 'power', field: 'AEP' }, aggregation: 'average' });
  expect(questionRequirements('Which has the higher average, AEP or PJME? State both averages.', table).comparison)
    .toEqual([{ sourceId: 'power', field: 'AEP' }, { sourceId: 'power', field: 'PJME' }]);
});
