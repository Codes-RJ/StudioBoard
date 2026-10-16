import { describe, it, expect } from 'vitest';
import { computeScopedMetric } from '../analysisScope';
import { aggregateMetricValues } from '../chartDataTransforms';
import { cleanDatasetRows } from '../dataCleaner';

describe('finite analytical results and fills', () => {
  it('rejects overflowing sums and weighted products instead of storing Infinity', () => {
    expect(() => aggregateMetricValues([1e308, 1e308], 'sum')).toThrow('Number range exceeded');
    expect(() => computeScopedMetric({ id: 'range', columns: ['value', 'weight'], rawRows: [{ value: 1e308, weight: 2 }] }, { metric: 'value', weight: 'weight', aggregation: 'weighted_average' })).toThrow('weighted multiplication');
  });
  it('computes large finite averages and medians without overflowing intermediate sums', () => {
    expect(aggregateMetricValues([1e308, 1e308], 'average')).toBe(1e308);
    expect(aggregateMetricValues([1e308, 1e308], 'median')).toBe(1e308);
    for (const method of ['mean', 'median']) {
      const cleaned = cleanDatasetRows([{ value: 1e308 }, { value: 1e308 }, { value: null }], [{ name: 'value', type: 'number' }], { preserveRows: true, columnPolicies: { value: { method } } });
      expect(cleaned.rawRows[2].value).toBe(1e308);
    }
  });
});
