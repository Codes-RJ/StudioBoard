import { describe, expect, it } from 'vitest';
import { buildAIDashboardProfile, validateAIDashboardProposal } from '../aiLayoutProposal';

const dataset = {
  id: 'local-1', rowCount: 3,
  columns: [{ name: 'Region', type: 'string' }, { name: 'Revenue', type: 'number' }, { name: 'Customer ID', type: 'string' }],
  rawRows: [{ Region: 'private-value', Revenue: 12, 'Customer ID': 'secret-id' }],
  columnOverrides: { 'Customer ID': { type: 'string', role: 'ignore' } },
  metrics: { columnGroups: { all: ['Region', 'Revenue', 'Customer ID'], numeric: ['Revenue'], measures: ['Revenue'], categorical: ['Region', 'Customer ID'], dimensions: ['Region', 'Customer ID'], date: [], cardinality: {} } },
};

describe('opt-in AI dashboard proposals', () => {
  it('builds a schema-only payload and excludes ignored fields and row values', () => {
    const profile = buildAIDashboardProfile(dataset, 'comparisons', 'Compare regions');
    expect(profile).toMatchObject({ goal: 'comparisons', purpose: 'Compare regions', rowCount: 3 });
    expect(profile.columns.map(({ name }) => name)).toEqual(['Region', 'Revenue']);
    expect(JSON.stringify(profile)).not.toContain('private-value');
    expect(JSON.stringify(profile)).not.toContain('secret-id');
  });

  it('accepts only existing fields and locally valid chart proposals', () => {
    const proposal = validateAIDashboardProposal({
      title: 'Regional sales', summary: 'Group sales by region.',
      cards: [
        { title: 'Sales by region', chartType: 'bar', xField: 'Region', yField: 'Revenue', aggregation: 'sum' },
        { title: 'Fabricated chart', chartType: 'bar', xField: 'Made up', yField: 'Revenue', aggregation: 'sum' },
      ],
    }, dataset);
    expect(proposal.aiGenerated).toBe(true);
    expect(proposal.layout).toHaveLength(1);
    expect(proposal.layout[0]).toMatchObject({ preferredX: 'Region', preferredY: 'Revenue' });
    expect(() => validateAIDashboardProposal({ title: 'Invalid', cards: [{ chartType: 'scatter', xField: 'Region', yField: 'Revenue' }] }, dataset)).toThrow(/valid chart/);
  });

  it('respects corrected types and numeric dimension roles in the shared profile', () => {
    const corrected = { ...dataset, columnOverrides: { ...dataset.columnOverrides, Revenue: { type: 'string', role: 'dimension' } } };
    expect(buildAIDashboardProfile(corrected, 'overview').columns.find(({ name }) => name === 'Revenue')).toEqual({ name: 'Revenue', type: 'string', role: 'dimension' });
  });

  it('supports row-count charts and rejects hidden fabricated or ignored fields', () => {
    const proposal = validateAIDashboardProposal({ title: 'Counts', cards: [
      { chartType: 'kpi', xField: '', yField: '__count__', aggregation: 'count' },
      { chartType: 'table', xField: 'Invented', yField: '', aggregation: 'auto' },
      { chartType: 'table', xField: '', yField: 'Customer ID', aggregation: 'auto' },
      { chartType: 'bar', xField: 'Region', yField: '__count__', aggregation: 'average' },
    ] }, dataset);
    expect(proposal.layout).toHaveLength(1);
    expect(proposal.layout[0]).toMatchObject({ chartType: 'kpi', preferredY: '__count__', aggregation: 'count' });
  });
});
