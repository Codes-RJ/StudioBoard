import { describe, expect, it } from 'vitest';
import { profileDashboardPlanning } from '../dashboardPlanningProfile';
import { generateDashboardCandidates } from '../dashboardCandidatePlanner';

const groups = { all: ['Sparse', 'Revenue', 'Customer', 'Region'], numeric: ['Sparse', 'Revenue'], measures: ['Sparse', 'Revenue'],
  dimensions: ['Customer', 'Region'], date: [], identifiers: [], ignored: [], cardinality: {} };

describe('data-aware dashboard planning', () => {
  it('prefers populated variable measures and useful category groups', () => {
    const rawRows = Array.from({ length: 100 }, (_, index) => ({ Sparse: index ? null : 10, Revenue: index + 1, Customer: `customer-${index}`, Region: index % 2 ? 'West' : 'East' }));
    const profiled = profileDashboardPlanning({ rawRows }, groups);
    const [candidate] = generateDashboardCandidates('sales', profiled, { goal: 'comparisons', limit: 1 });
    expect(candidate.layout[0]).toMatchObject({ chartType: 'bar', preferredX: 'Region', preferredY: 'Revenue', aggregation: 'sum' });
    expect(candidate.profile).toEqual({ sampledRows: 100, totalRows: 100, complete: true });
  });

  it('bounds sample size and exposes partial coverage without copying row data into the plan', () => {
    const rawRows = Array.from({ length: 10_000 }, (_, index) => ({ Revenue: index, Customer: 'x'.repeat(200), Region: index % 2 ? 'West' : 'East' }));
    const profile = profileDashboardPlanning({ rawRows }, groups).planningProfile;
    expect(profile).toMatchObject({ sampledRows: 2_000, totalRows: 10_000, complete: false });
    expect(profile.fields.Customer.distinct).toBe(65);
    expect(JSON.stringify(profile)).not.toContain('x'.repeat(200));
  });

  it('keeps metadata-only operation available and excludes reviewed identifiers', () => {
    expect(profileDashboardPlanning({}, groups)).toBe(groups);
    const [candidate] = generateDashboardCandidates('ids', { ...groups, identifiers: ['Revenue'], measures: ['Revenue'] }, { limit: 1 });
    expect(candidate.coverage).not.toContain('Revenue');
  });
});
