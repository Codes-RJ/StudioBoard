export const SOLID_CHART_COLORS = [
  '#DC2626', '#2563EB', '#16A34A', '#EAB308', '#DB2777',
  '#7C3AED', '#EA580C', '#0891B2', '#111827'
];

const COLOR_OPTIONS = [
  ['blue', 'Blue', '#2563EB'],
  ['red', 'Red', '#DC2626'],
  ['green', 'Green', '#16A34A'],
  ['yellow', 'Yellow', '#EAB308'],
  ['magenta', 'Magenta', '#DB2777'],
  ['purple', 'Purple', '#7C3AED'],
  ['orange', 'Orange', '#EA580C'],
  ['cyan', 'Cyan', '#0891B2'],
  ['black', 'Black', '#111827']
];

// A color choice sets the first series/category; the remaining categories
// rotate through the same solid color set instead of collapsing to one hue.
export const CHART_PALETTES = COLOR_OPTIONS.map(([value, label, primary]) => ({
  value,
  label,
  colors: [primary, ...SOLID_CHART_COLORS.filter((color) => color !== primary)]
}));

export const NUMBER_FORMAT_OPTIONS = [
  { value: 'auto', label: 'Automatic' },
  { value: 'number', label: 'Number' },
  { value: 'compact', label: 'Compact (1.2K)' },
  { value: 'currency', label: 'Currency' },
  { value: 'percent', label: 'Percent (0.25 → 25%)' }
];

export const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'INR', 'JPY'];

const PALETTE_NAMES = new Set(CHART_PALETTES.map(({ value }) => value));
const NUMBER_FORMATS = new Set(NUMBER_FORMAT_OPTIONS.map(({ value }) => value));
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const clampInteger = (value, minimum, maximum, fallback) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(numericValue)));
};

export const normalizeChartAppearance = (configuration = {}, chartType = configuration.chartType) => ({
  colorPalette: configuration.colorPalette === 'inherit' || PALETTE_NAMES.has(configuration.colorPalette)
    ? configuration.colorPalette
    : 'inherit',
  seriesColor: HEX_COLOR.test(configuration.seriesColor || '') ? configuration.seriesColor.toUpperCase() : '',
  showLegend: typeof configuration.showLegend === 'boolean' ? configuration.showLegend : true,
  showDataLabels: typeof configuration.showDataLabels === 'boolean'
    ? configuration.showDataLabels
    : chartType === 'pie',
  numberFormat: NUMBER_FORMATS.has(configuration.numberFormat) ? configuration.numberFormat : 'auto',
  decimalPlaces: clampInteger(configuration.decimalPlaces, 0, 4, 2),
  currency: CURRENCY_OPTIONS.includes(configuration.currency) ? configuration.currency : 'USD'
});

export const resolveChartPalette = (colorPalette, fallbackColors = [], seriesColor = '') => {
  const selected = CHART_PALETTES.find(({ value }) => value === colorPalette);
  const baseColors = selected?.colors?.length
    ? selected.colors
    : (Array.isArray(fallbackColors) && fallbackColors.length ? fallbackColors : CHART_PALETTES[0].colors);
  const completePalette = [...new Set([...baseColors, ...SOLID_CHART_COLORS].map((color) => color.toUpperCase()))];
  if (!HEX_COLOR.test(seriesColor)) return completePalette;
  return [seriesColor.toUpperCase(), ...completePalette.filter((color) => color !== seriesColor.toUpperCase())];
};

export const getPalettePrimaryColor = (colorPalette) => (
  CHART_PALETTES.find(({ value }) => value === colorPalette)?.colors?.[0] || CHART_PALETTES[0].colors[0]
);

export const normalizeDashboardColor = (value) => (
  PALETTE_NAMES.has(value) ? value : 'blue'
);

export const formatChartValue = (value, configuration = {}) => {
  if (value === null || value === undefined || value === '') return '—';
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return String(value);

  const { numberFormat, decimalPlaces, currency } = normalizeChartAppearance(configuration);
  if (numberFormat === 'auto' && numericValue !== 0 && Math.abs(numericValue) < 10 ** -decimalPlaces) {
    return numericValue.toLocaleString(undefined, { maximumSignificantDigits: 8 });
  }
  const fractionDigits = numberFormat === 'auto'
    ? { maximumFractionDigits: decimalPlaces }
    : { minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces };
  const options = numberFormat === 'compact'
    ? { notation: 'compact', maximumFractionDigits: decimalPlaces }
    : numberFormat === 'currency'
      ? { style: 'currency', currency, ...fractionDigits }
      : numberFormat === 'percent'
        ? { style: 'percent', ...fractionDigits }
        : fractionDigits;

  return new Intl.NumberFormat(undefined, options).format(numericValue);
};
