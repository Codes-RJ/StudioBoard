import { describe, expect, it } from 'vitest';
import {
  aggregateMetricValues,
  buildCategoricalSeries,
  buildHeatmapMatrix,
  calculateCorrelation,
  buildSankeyData,
  buildTrendSeries
} from '../chartDataTransforms';

describe('chart data transforms', () => {
  it.each([
    [[], 0],
    [[{ a: 1, b: 2 }, { a: null, b: 3 }], 1],
    [[{ a: 1, b: 2 }, { a: 1, b: 3 }], 2],
    [[{ a: Infinity, b: 2 }, { a: 'invalid', b: 3 }, { a: '', b: 4 }], 0],
  ])('keeps unavailable correlation distinct from zero (%j)', (data, pairCount) => {
    expect(calculateCorrelation(data, 'a', 'b')).toBeNull();
    expect(buildHeatmapMatrix(data, ['a', 'b'])[0].values[1]).toEqual({ key: 'b', value: null, pairCount });
  });

  it.each([
    [[1, 2, 3], [2, 4, 6], 1],
    [[1, 2, 3], [6, 4, 2], -1],
    [[-1, 0, 1], [1, -2, 1], 0],
    [[1e308, 0, -1e308], [1e308, 0, -1e308], 1],
  ])('preserves measured correlation including zero and large finite values', (a, b, expected) => {
    const data = a.map((value, index) => ({ a: value, b: b[index] }));
    data.push({ a: 10, b: null }, { a: NaN, b: 7 });
    expect(calculateCorrelation(data, 'a', 'b')).toBeCloseTo(expected, 12);
    expect(buildHeatmapMatrix(data, ['a', 'b'])[0].values[1]).toEqual({ key: 'b', value: expected, pairCount: 3 });
  });

  it('preserves missing groups as null and very small metrics as numbers', () => {
    const data = [{ group: 'missing', value: null }, { group: 'zero', value: 0 }, { group: 'small', value: 0.0001 }];
    expect(buildCategoricalSeries(data, 'group', 'value', 'sum', 10)).toEqual([
      { name: 'small', value: 0.0001 }, { name: 'zero', value: 0 }, { name: 'missing', value: null }
    ]);
    expect(buildTrendSeries(data, 'group', 'value', 'average', 10)[0].y).toBeNull();
  });
  const rows = [
    { team: 'A', month: 'Jan', revenue: 10, cost: 5 },
    { team: 'A', month: 'Feb', revenue: 20, cost: 10 },
    { team: 'B', month: 'Jan', revenue: 5, cost: 2.5 }
  ];

  it('aggregates metrics without chart rendering concerns', () => {
    expect(aggregateMetricValues([10, 20, 5], 'sum')).toBe(35);
    expect(aggregateMetricValues([10, 20, 5], 'median')).toBe(10);
    expect(buildCategoricalSeries(rows, 'team', 'revenue', 'sum', 10)).toEqual([
      { name: 'A', value: 30 },
      { name: 'B', value: 5 }
    ]);
  });

  it('builds trend, heatmap, and sankey structures', () => {
    expect(buildTrendSeries(rows, 'month', 'revenue', 'sum', 10)).toEqual([
      { x: 'Jan', y: 15 },
      { x: 'Feb', y: 20 }
    ]);
    expect(buildHeatmapMatrix(rows, ['revenue', 'cost'])[0].values[0].value).toBe(1);
    expect(buildSankeyData(rows, 'team', 'month').links).toHaveLength(3);
  });

  it('limits displayed trend groups after aggregating all source rows', () => {
    expect(buildTrendSeries(rows, 'month', 'revenue', 'sum', 1)).toEqual([{ x: 'Jan', y: 15 }]);
    expect(buildTrendSeries(rows, 'month', '__count__', 'count', 1)).toEqual([{ x: 'Jan', y: 2 }]);
  });

  it('orders ISO date trends chronologically regardless of input row order', () => {
    const datedRows = [
      { date: '2026-03-01', revenue: 30 },
      { date: '2026-01-01', revenue: 10 },
      { date: '2026-02-01', revenue: 20 },
      { date: '2026-01-01', revenue: 5 },
    ];
    expect(buildTrendSeries(datedRows, 'date', 'revenue', 'sum', 2)).toEqual([
      { x: '2026-01-01', y: 15 }, { x: '2026-02-01', y: 20 },
    ]);
  });

  it('counts populated measure cells and returns zero when all cells are missing', () => {
    expect(aggregateMetricValues([null, undefined, '', ' '], 'count')).toBe(0);
    expect(aggregateMetricValues([0, 'label', null, ' '], 'count')).toBe(2);
  });

  it('computes extrema for large datasets without spreading rows into function arguments', () => {
    const values = Array.from({ length: 250_000 }, (_, index) => index - 10);
    expect(aggregateMetricValues(values, 'min')).toBe(-10);
    expect(aggregateMetricValues(values, 'max')).toBe(249_989);
  });
});
