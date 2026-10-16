import { describe, expect, it } from 'vitest';

import { analyzeReportDataset } from '../reportAnalysis';

describe('analyzeReportDataset', () => {
  it('groups by the category instead of the date and handles special category names', () => {
    const result = analyzeReportDataset({
      columns: ['Date', 'Region', 'Revenue'],
      rawRows: [{ Date: '2026-01-01', Region: '__proto__', Revenue: 10 }, { Date: '2026-01-02', Region: '__proto__', Revenue: 20 }],
      metrics: { columnGroups: { date: ['Date'], dimensions: ['Date', 'Region'], numeric: ['Revenue'] } }
    });
    expect(result.insights.find(({ kind }) => kind === 'category')).toMatchObject({ dimension: 'Region', category: '__proto__', value: 30, total: 30 });
  });
  it('computes report statistics and insights without DOM access', () => {
    const result = analyzeReportDataset({
      name: 'Revenue',
      columns: [{ name: 'month' }, { name: 'segment' }, { name: 'revenue' }],
      rawRows: [
        { month: '2026-01-01', segment: 'A', revenue: 10 },
        { month: '2026-02-01', segment: 'B', revenue: 20 },
        { month: '2026-03-01', segment: 'A', revenue: 30 },
        { month: '2026-04-01', segment: 'A', revenue: 40 },
      ],
      metrics: {
        columnGroups: {
          date: ['month'],
          dimensions: ['segment'],
          numeric: ['revenue'],
        },
      },
    });

    expect(result.columns).toEqual(['month', 'segment', 'revenue']);
    expect(result.stats.revenue).toMatchObject({ type: 'number', sum: 100, missing: 0 });
    expect(result.quality).toHaveProperty('qualityScore');
    expect(result.insights).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'category', category: 'A', value: 80 }),
      expect.objectContaining({ kind: 'trend', primaryMetric: 'revenue' }),
    ]));
  });
});
