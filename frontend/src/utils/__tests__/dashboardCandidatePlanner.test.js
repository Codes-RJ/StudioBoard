import { describe, expect, it } from 'vitest';
import { generateDashboardCandidates } from '../dashboardCandidatePlanner';
import { validateGraphConfiguration } from '../graphConfiguration';

const groups = {
  all: ['Order Date', 'Region', 'Revenue', 'Cost'],
  numeric: ['Revenue', 'Cost'], measures: ['Revenue', 'Cost'],
  categorical: ['Region'], date: ['Order Date'], dimensions: ['Order Date', 'Region'],
  cardinality: { 'Order Date': 24, Region: 5 }, classificationKnown: true,
  identifiers: [], ignored: []
};

describe('goal-based dashboard candidates', () => {
  it('does not sum rates or invent a positive part-to-whole chart', () => {
    const rates = { ...groups, all: ['Region', 'ChurnRate'], numeric: ['ChurnRate'], measures: ['ChurnRate'], date: [], dimensions: ['Region'] };
    for (const candidate of generateDashboardCandidates('rates', rates, { goal: 'auto', limit: 4 })) {
      expect(candidate.layout.filter((card) => card.preferredY === 'ChurnRate').every((card) => card.aggregation !== 'sum')).toBe(true);
      expect(candidate.layout.some((card) => card.chartType === 'pie')).toBe(false);
    }
  });

  it('chooses a useful low-cardinality grouping instead of the first nearly unique text field', () => {
    const fields = { ...groups, all: ['Customer', ...groups.all], dimensions: ['Customer', 'Order Date', 'Region'], cardinality: { Customer: 500, Region: 5, 'Order Date': 24 } };
    const [candidate] = generateDashboardCandidates('sales', fields, { goal: 'comparisons', limit: 1 });
    expect(candidate.layout.some((card) => card.preferredX === 'Region' && card.chartType === 'bar')).toBe(true);
    expect(candidate.layout.some((card) => card.preferredX === 'Customer')).toBe(false);
  });

  it('discloses an unavailable trend goal when no time field exists', () => {
    const [candidate] = generateDashboardCandidates('no-time', { ...groups, date: [], dimensions: ['Region'] }, { goal: 'trends', limit: 1 });
    expect(candidate.description).toMatch(/no .*date|no .*time/i);
    expect(candidate.layout.some((card) => ['line', 'area'].includes(card.chartType))).toBe(false);
  });

  it('returns distinct scored goal options with valid chart and field combinations', () => {
    const candidates = generateDashboardCandidates('sales', groups, { goal: 'auto' });
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    expect(candidates).toEqual([...candidates].sort((a, b) => b.score - a.score));
    expect(new Set(candidates.map(({ goal }) => goal)).size).toBe(candidates.length);
    for (const candidate of candidates) {
      expect(candidate.score).toBeGreaterThan(0);
      expect(candidate.coverage).toContain('Revenue');
      expect(candidate.layout.every((card) => validateGraphConfiguration(card, groups).valid)).toBe(true);
    }
  });

  it('omits unusable chart suggestions when no fields are profiled', () => {
    expect(generateDashboardCandidates('empty', { all: [], numeric: [], measures: [], dimensions: [], date: [], cardinality: {} }, { goal: 'auto' })).toEqual([]);
  });

  it('keeps an explicitly requested goal first even when another template scores higher', () => {
    const result = generateDashboardCandidates('sales', groups, { goal: 'trends', limit: 1 });
    expect(result[0].goal).toBe('trends');
  });

  it('respects numeric dimension roles and uses row counts for a trend without measures', () => {
    const dimensionsOnly = { ...groups, all: ['Order Date', 'Quarter'], numeric: ['Quarter'], measures: [], dimensions: ['Order Date', 'Quarter'], categorical: [], cardinality: { Quarter: 4 } };
    const [candidate] = generateDashboardCandidates('quarters', dimensionsOnly, { goal: 'trends', limit: 1 });
    expect(candidate.layout).toContainEqual(expect.objectContaining({ chartType: 'line', preferredX: 'Order Date', preferredY: '__count__', aggregation: 'count' }));
    expect(candidate.layout.some(({ preferredY }) => preferredY === 'Quarter')).toBe(false);
  });
});
