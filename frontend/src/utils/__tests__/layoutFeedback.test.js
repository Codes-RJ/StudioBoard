import { beforeEach, describe, expect, it } from 'vitest';
import { readDashboardFeedback, recordDashboardFeedback } from '../layoutFeedback';

describe('browser-only dashboard feedback', () => {
  beforeEach(() => localStorage.clear());

  it("keeps only capped recommendation metadata and the user's decision", () => {
    expect(recordDashboardFeedback({ goal: 'trends', score: 82, chartTypes: ['line', 'kpi'], decision: 'accepted', values: ['private'] })).toBe(true);
    expect(readDashboardFeedback()).toMatchObject([{ goal: 'trends', score: 82, chartTypes: ['line', 'kpi'], decision: 'accepted' }]);
    expect(localStorage.getItem('analytics-dashboard-layout-feedback')).not.toContain('private');
    for (let index = 0; index < 105; index += 1) recordDashboardFeedback({ goal: 'overview', score: index, chartTypes: ['bar'], decision: 'rejected' });
    expect(readDashboardFeedback()).toHaveLength(100);
  });
});
