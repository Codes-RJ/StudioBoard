import { describe, expect, it } from 'vitest';
import { analyzeQueryWithData, buildDatasetProfile } from '../aiQueryEngine';
import { profileDataset } from '../datasetProfiler';
import { computeDatasetMetrics } from '../localDataEngine';

const source = (values) => ({ id: 'finite', columns: [{ name: 'Amount', type: 'number' }, { name: 'Region', type: 'string' }],
  rawRows: values.map((Amount) => ({ Amount, Region: 'West' })) });

describe('finite numeric results across review and assistant calculations', () => {
  it('preserves a representable average when an intermediate sum overflows', () => {
    const dataset = source([1e308, 1e308]);
    expect(computeDatasetMetrics(dataset.rawRows, ['Amount', 'Region']).primaryMean).toBe(1e308);
    expect(buildDatasetProfile(dataset).columns[0].mean).toBe(1e308);
    expect(profileDataset(dataset).columns[0].mean).toBe(1e308);
    for (const query of ['Average Amount', 'Average Amount by Region', 'Median Amount']) {
      const result = analyzeQueryWithData(query, dataset);
      expect(result.directAnswer).not.toMatch(/uncomputable|Infinity|NaN/);
      expect(result.directAnswer).toContain((1e308).toLocaleString(undefined, { maximumSignificantDigits: 12 }));
    }
  });

  it('keeps a zero median between opposite finite extremes', () => {
    const dataset = source([-1e308, 1e308]);
    expect(profileDataset(dataset).columns[0].median).toBe(0);
    const answer = analyzeQueryWithData('Describe Amount', dataset);
    expect(answer.directAnswer).toContain('mean of 0');
    expect(answer.keyInsights.join(' ')).toContain((1e308).toLocaleString(undefined, { maximumSignificantDigits: 12 }));
  });

  it('rejects unrepresentable sums instead of presenting an unavailable or missing group as a measured result', () => {
    for (const query of ['Total Amount', 'Total Amount by Region']) {
      expect(() => analyzeQueryWithData(query, source([1e308, 1e308]))).toThrow(/range exceeded/i);
    }
  });
});
