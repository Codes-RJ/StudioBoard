import { describe, expect, it } from 'vitest';
import { analyzeApprovedRelationship } from '../crossDatasetAnalysis';
import { approveQualityRevision, qualityRevisionKey } from '../qualityReview';

const customers = { id: 'customers', sourcePath: 'customers.csv', updatedAt: 'r1', columns: [{ name: 'Customer ID', type: 'string' }, { name: 'Region', type: 'string' }], rawRows: [{ 'Customer ID': 'a', Region: 'West' }, { 'Customer ID': 'b', Region: 'East' }, { 'Customer ID': 'c', Region: 'West' }] };
const orders = { id: 'orders', sourcePath: 'orders.csv', updatedAt: 'r2', columns: [{ name: 'Customer ID', type: 'string' }, { name: 'Amount', type: 'number' }], rawRows: [{ 'Customer ID': 'a', Amount: 10 }, { 'Customer ID': 'a', Amount: 15 }, { 'Customer ID': 'b', Amount: 5 }, { 'Customer ID': 'missing', Amount: 30 }] };
const relationship = { id: 'r', status: 'approved', leftDatasetId: customers.id, rightDatasetId: orders.id, leftColumn: 'Customer ID', rightColumn: 'Customer ID', leftUpdatedAt: customers.updatedAt, rightUpdatedAt: orders.updatedAt, leftUnmatchedRows: 1, rightUnmatchedRows: 1, cardinality: 'one-to-many' };

const reviewedExactInputs = (rows, source = orders, field = 'Amount') => {
  const exactSource = { ...source, rawRows: rows, columnOverrides: { [field]: { role: 'measure', precision: 'exact' } } };
  const datasets = [customers, orders].map((dataset) => approveQualityRevision({ ...(dataset.id === source.id ? exactSource : dataset), isLocal: true }));
  return { datasets, relationship: { ...relationship, leftRevisionKey: qualityRevisionKey(datasets[0]), rightRevisionKey: qualityRevisionKey(datasets[1]) }, metric: `${source.id}::${field}` };
};

describe('approved local cross-file analysis', () => {
  it.each([
    ['sum', ['9007199254740993', '1'], '9007199254740994'],
    ['sum', ['0.1', '0.2'], '0.3'],
    ['average', ['0.1', '0.2'], '0.15'],
    ['average', ['1', '0', '0'], '1/3'],
  ])('preserves reviewed exact %s for %j', (aggregation, values, expected) => {
    const inputs = reviewedExactInputs(values.map((Amount) => ({ 'Customer ID': 'a', Amount })));
    const result = analyzeApprovedRelationship({ ...inputs, aggregation });
    expect(result.results).toEqual([{ group: 'All matching rows', rowCount: values.length, metricCount: values.length, value: expected }]);
  });

  it('sorts exact groups without collapsing adjacent unsafe integers and keeps missing values separate from zero', () => {
    const inputs = reviewedExactInputs([
      { 'Customer ID': 'a', Amount: '9007199254740992' },
      { 'Customer ID': 'b', Amount: '9007199254740993' },
    ]);
    expect(analyzeApprovedRelationship({ ...inputs, aggregation: 'sum', dimension: 'customers::Region' }).results.map(({ group, value }) => [group, value]))
      .toEqual([['East', '9007199254740993'], ['West', '9007199254740992']]);
    const missingInputs = reviewedExactInputs([{ 'Customer ID': 'a', Amount: null }, { 'Customer ID': 'b', Amount: '0' }]);
    expect(analyzeApprovedRelationship({ ...missingInputs, aggregation: 'average', dimension: 'customers::Region' }).results)
      .toEqual([{ group: 'East', rowCount: 1, metricCount: 1, value: '0' }, { group: 'West', rowCount: 1, metricCount: 0, value: null }]);
  });

  it('retains measure-grain protection when using exact arithmetic', () => {
    const source = { ...customers, columns: [...customers.columns, { name: 'Budget', type: 'number' }] };
    const inputs = reviewedExactInputs(customers.rawRows.map((row) => ({ ...row, Budget: '9007199254740993' })), source, 'Budget');
    expect(() => analyzeApprovedRelationship({ ...inputs, aggregation: 'sum' })).toThrow('repeats measure rows');
    expect(analyzeApprovedRelationship({ ...inputs, aggregation: 'sum', measureGrain: 'joined' }).results[0].value).toBe('27021597764222979');
    expect(() => analyzeApprovedRelationship({ ...inputs, datasets: inputs.datasets.map((dataset) => ({ ...dataset, updatedAt: 'changed' })), aggregation: 'sum' })).toThrow(/source changed/);
  });

  it('rejects already-rounded and malformed exact inputs and requires a precision choice for unsafe integers', () => {
    for (const Amount of [9007199254740992, '$12']) {
      const inputs = reviewedExactInputs([{ 'Customer ID': 'a', Amount }]);
      expect(() => analyzeApprovedRelationship({ ...inputs, aggregation: 'sum' })).toThrow(/already lost integer precision|plain decimal text/);
    }
    const unreviewedPrecision = { ...orders, rawRows: [{ 'Customer ID': 'a', Amount: '9007199254740993' }] };
    expect(() => analyzeApprovedRelationship({ datasets: [customers, unreviewedPrecision], relationship, metric: 'orders::Amount', aggregation: 'sum' })).toThrow(/Review exact decimal precision/);
  });

  it('requires quality review of both imported sources, including older local records', () => {
    expect(() => analyzeApprovedRelationship({ datasets: [{ ...customers, isLocal: true }, orders], relationship }))
      .toThrow('Review and save both source datasets');
  });
  it('joins only matching keys and returns grouped deterministic calculations with provenance', () => {
    const result = analyzeApprovedRelationship({ datasets: [customers, orders], relationship, metric: 'orders::Amount', aggregation: 'sum', dimension: 'customers::Region' });
    expect(result).toMatchObject({ sources: ['customers.csv', 'orders.csv'], relationship: 'Customer ID ↔ Customer ID', matchedRows: 3, metric: 'orders.csv · Amount', dimension: 'customers.csv · Region' });
    expect(result.results).toEqual([{ group: 'West', rowCount: 2, value: 25, metricCount: 2 }, { group: 'East', rowCount: 1, value: 5, metricCount: 1 }]);
    expect(result.filters).toEqual([]);
    expect(result.warnings[0]).toMatch(/excluded by this inner join/);
  });

  it('requires approval and a current reviewed revision, and bounds join expansion', () => {
    expect(() => analyzeApprovedRelationship({ datasets: [customers, orders], relationship: { ...relationship, status: 'suggested' } })).toThrow(/Approve this relationship/);
    expect(() => analyzeApprovedRelationship({ datasets: [customers, { ...orders, updatedAt: 'r3' }], relationship })).toThrow(/source changed/);
    const duplicatedOrders = { ...orders, rawRows: Array.from({ length: 251_000 }, () => ({ 'Customer ID': 'a', Amount: 1 })) };
    expect(() => analyzeApprovedRelationship({ datasets: [customers, duplicatedOrders], relationship: { ...relationship, rightUpdatedAt: duplicatedOrders.updatedAt } })).toThrow(/safety limit/);
  });

  it('reports filter scope separately from total key matches', () => {
    const result = analyzeApprovedRelationship({ datasets: [customers, orders], relationship, filters: [{ sourceDatasetId: customers.id, column: 'Region', value: 'West' }] });
    expect(result.matchedRows).toBe(3);
    expect(result.filteredRows).toBe(2);
    expect(result.filters).toEqual([{ source: 'customers.csv', column: 'Region', value: 'West' }]);
    expect(() => analyzeApprovedRelationship({ datasets: [customers, orders], relationship, filters: [{ sourceDatasetId: 'elsewhere', column: 'Region', value: 'West' }] })).toThrow(/outside the approved relationship/);
  });

  it('bounds high-cardinality grouped output', () => {
    const manyGroups = {
      ...orders,
      columns: [...orders.columns, { name: 'Group', type: 'string' }],
      rawRows: Array.from({ length: 10_001 }, (_, index) => ({ 'Customer ID': 'a', Amount: 1, Group: `g${index}` })),
    };
    const resultRelationship = { ...relationship, rightUpdatedAt: manyGroups.updatedAt };
    expect(() => analyzeApprovedRelationship({
      datasets: [customers, manyGroups],
      relationship: resultRelationship,
      dimension: 'orders::Group',
    })).toThrow(/group safety limit/);
  });

  it('distinguishes a missing measure from a real zero and warns about repeated source measures', () => {
    const missingOrders = { ...orders, rawRows: [{ 'Customer ID': 'a', Amount: null }] };
    const missing = analyzeApprovedRelationship({ datasets: [customers, missingOrders], relationship, metric: 'orders::Amount', aggregation: 'sum' });
    expect(missing.results[0]).toMatchObject({ value: null, metricCount: 0 });
    const zeroOrders = { ...missingOrders, rawRows: [{ 'Customer ID': 'a', Amount: 0 }] };
    expect(analyzeApprovedRelationship({ datasets: [customers, zeroOrders], relationship, metric: 'orders::Amount', aggregation: 'sum' }).results[0].value).toBe(0);

    const measuredCustomers = { ...customers, columns: [...customers.columns, { name: 'Budget', type: 'number' }], rawRows: customers.rawRows.map((row) => ({ ...row, Budget: 100 })) };
    expect(() => analyzeApprovedRelationship({ datasets: [measuredCustomers, orders], relationship, metric: 'customers::Budget', aggregation: 'sum' })).toThrow('repeats measure rows');
    const repeated = analyzeApprovedRelationship({ datasets: [measuredCustomers, orders], relationship, metric: 'customers::Budget', aggregation: 'sum', measureGrain: 'joined' });
    expect(repeated.results[0].value).toBe(300);
    expect(repeated.warnings).toContainEqual(expect.stringMatching(/repeat a measure from customers.csv/));
    expect(() => analyzeApprovedRelationship({ datasets: [customers, orders], relationship, aggregation: 'average' })).toThrow(/numeric measure/);
  });

  it('executes approved composite tuples and counts only nonmissing measure values', () => {
    const left = { id: 'left', columns: ['key', 'part'], rawRows: [{ key: '001', part: 'A' }, { key: '001', part: 'B' }] };
    const right = { id: 'right', columns: ['key', 'part', 'amount'], rawRows: [{ key: '001', part: 'A', amount: 7 }, { key: '001', part: 'B', amount: null }, { key: '1', part: 'A', amount: 99 }] };
    const composite = { status: 'approved', leftDatasetId: 'left', rightDatasetId: 'right', leftColumns: ['key', 'part'], rightColumns: ['key', 'part'], leftUpdatedAt: null, rightUpdatedAt: null };
    expect(analyzeApprovedRelationship({ datasets: [left, right], relationship: composite, metric: 'right::amount', aggregation: 'sum' })).toMatchObject({ matchedRows: 2, results: [{ value: 7 }] });
    expect(analyzeApprovedRelationship({ datasets: [left, right], relationship: composite, metric: 'right::amount', aggregation: 'count' }).results[0].value).toBe(1);
  });

  it('supports column names containing the field separator', () => {
    const customOrders = { ...orders, columns: [{ name: 'Customer ID' }, { name: 'Net::Amount', type: 'number' }], rawRows: [{ 'Customer ID': 'a', 'Net::Amount': 7 }] };
    const result = analyzeApprovedRelationship({ datasets: [customers, customOrders], relationship, metric: 'orders::Net::Amount', aggregation: 'sum' });
    expect(result.results[0].value).toBe(7);
  });

  it('keeps real missing-label text separate from missing grouping values', () => {
    const labeledCustomers = { ...customers, rawRows: [{ 'Customer ID': 'a', Region: null }, { 'Customer ID': 'b', Region: '(Missing)' }] };
    const result = analyzeApprovedRelationship({ datasets: [labeledCustomers, orders], relationship, dimension: 'customers::Region' });
    expect(result.results).toHaveLength(2);
    expect(result.results.find(({ missingGroup }) => missingGroup)).toMatchObject({ rowCount: 2, value: 2 });
    expect(result.results.find(({ missingGroup }) => !missingGroup)).toMatchObject({ group: '(Missing)', rowCount: 1 });
  });
});
