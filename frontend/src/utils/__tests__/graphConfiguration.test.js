import { describe, expect, it } from 'vitest';
import {
  getDatasetColumnGroups,
  getGraphSelectorConfig,
  getGraphTypeCompatibility,
  repairGraphConfiguration,
  validateGraphConfiguration
} from '../graphConfiguration';

const dataset = {
  columns: [
    { name: 'month', type: 'date' },
    { name: 'segment', type: 'string' },
    { name: 'revenue', type: 'number' },
    { name: 'cost', type: 'number' }
  ]
};

describe('graph configuration', () => {
  it('normalizes dataset metadata into shared column groups', () => {
    expect(getDatasetColumnGroups(dataset)).toMatchObject({
      all: ['month', 'segment', 'revenue', 'cost'],
      numeric: ['revenue', 'cost'],
      date: ['month'],
      dimensions: ['month', 'segment'],
      measures: ['revenue', 'cost']
    });
  });

  it('rejects graph types whose column requirements cannot be met', () => {
    const groups = getDatasetColumnGroups({ columns: [{ name: 'label', type: 'string' }] });
    expect(getGraphTypeCompatibility('scatter', groups)).toEqual({
      compatible: false,
      reason: 'Needs at least two numeric columns.'
    });
    expect(validateGraphConfiguration({ chartType: 'scatter', preferredX: '', preferredY: '' }, groups).valid).toBe(false);
  });

  it('repairs axes when switching to a compatible graph type', () => {
    const groups = getDatasetColumnGroups(dataset);
    expect(repairGraphConfiguration({ chartType: 'scatter', preferredX: 'segment', preferredY: 'missing' }, groups)).toMatchObject({
      preferredX: 'revenue',
      preferredY: 'cost'
    });
  });

  it('rejects missing or stale axes once column types are known', () => {
    const groups = getDatasetColumnGroups(dataset);
    expect(validateGraphConfiguration({ chartType: 'bar', preferredX: '', preferredY: '' }, groups)).toMatchObject({
      valid: false,
      issues: ['Choose a dimension.', 'Choose a metric.']
    });
    expect(validateGraphConfiguration({ chartType: 'bar', preferredX: 'missing', preferredY: 'revenue' }, groups)).toMatchObject({
      valid: false,
      issues: ['Choose a valid dimension.']
    });
  });

  it('does not reject server columns before their types are available', () => {
    const groups = getDatasetColumnGroups({ columns: ['segment', 'revenue'] });
    expect(groups.classificationKnown).toBe(false);
    expect(getGraphTypeCompatibility('scatter', groups).compatible).toBe(true);
    expect(validateGraphConfiguration({ chartType: 'scatter', preferredX: 'segment', preferredY: 'revenue' }, groups).valid).toBe(true);
  });

  it('infers dates and numeric-looking text without treating one rogue value as numeric', () => {
    const groups = getDatasetColumnGroups({
      columns: ['date', 'amount', 'label'],
      rawRows: [
        { date: '2026-01-01', amount: '10.5', label: 'A' },
        { date: '2026-01-02', amount: '20', label: 'B' },
        { date: '2026-01-03', amount: 'bad', label: '3' },
        { date: '2026-01-04', amount: '30', label: 'D' },
        { date: '2026-01-05', amount: '40', label: 'E' }
      ]
    });
    expect(groups.date).toContain('date');
    expect(groups.numeric).toContain('amount');
    expect(groups.numeric).not.toContain('label');
    expect(groups.coercedNumeric).toContain('amount');
  });

  it('supports KPI/table templates and provides non-blocking cardinality guidance', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({ category: `Category ${index}`, amount: index }));
    const groups = getDatasetColumnGroups({ columns: ['category', 'amount'], rawRows: rows });
    expect(getGraphSelectorConfig('kpi', groups).yOptions).toContain('__count__');
    expect(getGraphSelectorConfig('table', groups).showX).toBe(false);
    expect(getGraphTypeCompatibility('table', groups).compatible).toBe(true);
    expect(validateGraphConfiguration({ chartType: 'pie', preferredX: 'category', preferredY: 'amount' }, groups)).toMatchObject({
      valid: true,
      warnings: [expect.stringContaining('20 distinct values')]
    });
  });

  it('assigns distinct dimensions for 3D, 4D, and financial charts', () => {
    const groups = getDatasetColumnGroups({
      columns: [
        { name: 'time', type: 'date' },
        { name: 'x', type: 'number' },
        { name: 'y', type: 'number' },
        { name: 'z', type: 'number' },
        { name: 'size', type: 'number' }
      ]
    });

    expect(repairGraphConfiguration({ chartType: 'bubble4d' }, groups)).toMatchObject({
      preferredX: 'x',
      preferredY: 'y',
      preferredZ: 'z',
      preferredSize: 'size'
    });
    expect(repairGraphConfiguration({ chartType: 'candlestick' }, groups)).toMatchObject({
      preferredX: 'time',
      preferredY: 'x',
      preferredOpen: 'y',
      preferredHigh: 'z',
      preferredLow: 'size'
    });
  });

  it('reports the exact numeric requirements for multidimensional plots', () => {
    const groups = getDatasetColumnGroups(dataset);
    expect(getGraphTypeCompatibility('scatter3d', groups)).toEqual({
      compatible: false,
      reason: 'Needs at least three numeric columns.'
    });
    expect(getGraphTypeCompatibility('bubble4d', groups)).toEqual({
      compatible: false,
      reason: 'Needs at least four numeric columns.'
    });
  });

  it('configures wave, grouped spline, and confidence-band charts', () => {
    const groups = getDatasetColumnGroups(dataset);
    expect(getGraphSelectorConfig('sineWave', groups)).toMatchObject({
      showX: true,
      showY: false,
      xOptions: ['revenue', 'cost']
    });
    expect(getGraphSelectorConfig('multiSpline', groups)).toMatchObject({
      showX: true,
      showY: true,
      showGroup: true,
      yOptions: ['revenue', 'cost', '__count__'],
      groupOptions: ['month', 'segment']
    });
    expect(repairGraphConfiguration({ chartType: 'rangeArea' }, groups)).toMatchObject({
      preferredX: 'month',
      preferredY: 'revenue',
      preferredZ: 'cost'
    });
  });
});
