import { describe, expect, it } from 'vitest';
import { profileDataset } from '../datasetProfiler';
import { getDatasetColumnGroups, getGraphSelectorConfig } from '../graphConfiguration';

describe('local dataset profiling', () => {
  it('keeps hyphenated customer identifiers out of date inference across profiling, graph selection and chat', async () => {
    const source = { columns: ['Customer', 'Region', 'Amount'], rawRows: Array.from({ length: 100 }, (_, index) => ({ Customer: `customer-${index}`, Region: 'West', Amount: index })) };
    expect(profileDataset(source).columns[0]).toMatchObject({ inferredType: 'string', inferredRole: 'identifier' });
    expect(getDatasetColumnGroups(source).date).not.toContain('Customer');
    const { buildDatasetProfile } = await import('../aiQueryEngine');
    expect(buildDatasetProfile(source).date).not.toContain('Customer');
  });
  it('profiles types, missing values, numeric outliers, currencies, units, and likely identifiers with evidence', () => {
    const report = profileDataset({
      columns: ['customer_id', 'Revenue USD', 'Order Date', 'Conversion rate'],
      rawRows: [
        { customer_id: 'c1', 'Revenue USD': '$10', 'Order Date': '2025-01-01', 'Conversion rate': 0.1 },
        { customer_id: 'c2', 'Revenue USD': '$12', 'Order Date': '2025-02-01', 'Conversion rate': 0.2 },
        { customer_id: 'c3', 'Revenue USD': '$11', 'Order Date': '2025-03-01', 'Conversion rate': 0.15 },
        { customer_id: 'c4', 'Revenue USD': '$13', 'Order Date': '2025-04-01', 'Conversion rate': null },
        { customer_id: 'c5', 'Revenue USD': '$1000', 'Order Date': '2025-05-01', 'Conversion rate': 0.12 }
      ]
    });

    expect(report.rowCount).toBe(5);
    expect(report.columns.find(({ name }) => name === 'customer_id')).toMatchObject({ inferredRole: 'identifier', inferredType: 'string' });
    expect(report.columns.find(({ name }) => name === 'Revenue USD')).toMatchObject({ inferredRole: 'dimension', inferredType: 'string', currencyHint: 'USD (currency code detected)', formattedNumericCount: 5, outlierCount: 1 });
    expect(report.columns.find(({ name }) => name === 'Order Date')).toMatchObject({ inferredType: 'date', inferredRole: 'dimension' });
    expect(report.columns.find(({ name }) => name === 'Conversion rate')).toMatchObject({ missingCount: 1, unitHint: 'rate (scale unknown)' });
    expect(report.rowGrain.description).toContain('customer_id');
    expect(report.columns[0].evidence.length).toBeGreaterThan(0);
  });

  it('uses a bounded evenly spaced sample and reports its size', () => {
    const rows = Array.from({ length: 30_000 }, (_, index) => ({ value: index }));
    const report = profileDataset({ columns: ['value'], rawRows: rows });
    expect(report.sampledRows).toBe(25_000);
    expect(report.columns[0].sampledRows).toBe(25_000);
    expect(report.columns[0].missingCount).toBe(0);
    expect(report.columns[0].inferredRole).toBe('measure');
  });

  it('keeps unique dates as dimensions and unique amounts as measures', () => {
    const rawRows = Array.from({ length: 30 }, (_, index) => ({ Date: `2026-01-${String(index + 1).padStart(2, '0')}`, Revenue: index * 123.45, customer_id: `c${index}` }));
    const profile = profileDataset({ columns: ['Date', 'Revenue', 'customer_id'], rawRows });
    expect(profile.columns.map(({ inferredRole }) => inferredRole)).toEqual(['dimension', 'measure', 'identifier']);
  });
});

describe('column profile overrides', () => {
  const dataset = {
    columns: [{ name: 'Account Number', type: 'number' }, { name: 'Revenue', type: 'number' }, { name: 'Region', type: 'string' }],
    rawRows: [{ 'Account Number': 101, Revenue: 20, Region: 'West' }],
    metrics: { columnGroups: { all: ['Account Number', 'Revenue', 'Region'], numeric: ['Account Number', 'Revenue'], categorical: ['Region'], date: [], dimensions: ['Region'], measures: ['Account Number', 'Revenue'] } },
    columnOverrides: { 'Account Number': { type: 'number', role: 'identifier' }, Region: { type: 'string', role: 'ignore' } }
  };

  it('removes identifiers and ignored fields from chart roles without removing them from the table schema', () => {
    const groups = getDatasetColumnGroups(dataset);
    expect(groups.all).toContain('Account Number');
    expect(groups.all).toContain('Region');
    expect(groups.numeric).toEqual(['Revenue']);
    expect(groups.measures).toEqual(['Revenue']);
    expect(groups.dimensions).not.toContain('Region');
    expect(groups.identifiers).toEqual(['Account Number']);
    const selectors = getGraphSelectorConfig('bar', groups);
    expect(selectors.xOptions).not.toContain('Account Number');
    expect(selectors.xOptions).not.toContain('Region');
  });
});
