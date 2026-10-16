import { describe, expect, it } from 'vitest';
import {
  formatChartValue,
  normalizeChartAppearance,
  resolveChartPalette
} from '../chartAppearance';

describe('chart appearance', () => {
  it('normalizes persisted appearance settings and chart defaults', () => {
    expect(normalizeChartAppearance({
      colorPalette: 'unknown',
      seriesColor: 'red',
      showLegend: false,
      numberFormat: 'unknown',
      decimalPlaces: 99,
      currency: 'CAD'
    }, 'pie')).toEqual({
      colorPalette: 'inherit',
      seriesColor: '',
      showLegend: false,
      showDataLabels: true,
      numberFormat: 'auto',
      decimalPlaces: 4,
      currency: 'USD'
    });
  });

  it('applies a custom primary while preserving distinct solid category colors', () => {
    expect(resolveChartPalette('red').slice(0, 4)).toEqual(['#DC2626', '#2563EB', '#16A34A', '#EAB308']);
    expect(resolveChartPalette('orange', [], '#123456').slice(0, 3)).toEqual(['#123456', '#EA580C', '#DC2626']);
    expect(resolveChartPalette('inherit', ['#ABCDEF']).slice(0, 3)).toEqual(['#ABCDEF', '#DC2626', '#2563EB']);
  });

  it('formats compact, currency, percent, and missing values', () => {
    expect(formatChartValue(1250, { numberFormat: 'compact', decimalPlaces: 1 })).toMatch(/1[.,]3K/i);
    expect(formatChartValue(12.5, { numberFormat: 'currency', currency: 'USD', decimalPlaces: 2 })).toMatch(/12[.,]50/);
    expect(formatChartValue(0.25, { numberFormat: 'percent', decimalPlaces: 1 })).toContain('25');
    expect(formatChartValue(null)).toBe('—');
  });
});
