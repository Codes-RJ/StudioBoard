import { FiAlertTriangle, FiCheckCircle } from 'react-icons/fi';
import { CHART_TYPE_OPTIONS } from '../../utils/chartCatalog';
import { getGraphTypeCompatibility } from '../../utils/graphConfiguration';
import { getChartSizeConstraints } from '../../utils/layoutModel';
import {
  CHART_PALETTES,
  CURRENCY_OPTIONS,
  getPalettePrimaryColor,
  normalizeChartAppearance,
  NUMBER_FORMAT_OPTIONS
} from '../../utils/chartAppearance';

const LEGEND_CHART_TYPES = new Set([
  'line', 'stepLine', 'spline', 'smoothArea', 'multiSpline', 'streamgraph', 'rangeArea',
  'waveform', 'sineWave', 'bar', 'horizontalBar', 'stackedBar', 'pie', 'donut', 'area',
  'scatter', 'bubble', 'box', 'violin', 'strip', 'radar', 'polarScatter',
  'scatter3d', 'surface3d', 'mesh3d', 'bubble4d', 'candlestick'
]);
const DATA_LABEL_CHART_TYPES = new Set(['line', 'stepLine', 'spline', 'smoothArea', 'waveform', 'bar', 'horizontalBar', 'pie', 'donut', 'area', 'scatter', 'funnel']);

export default function GraphConfigurationPanel({
  configuration,
  columnGroups,
  selectorConfig,
  validation,
  loadedRowCount = 0,
  resolvedPrimaryColor = '',
  onChartTypeChange,
  onChange,
  onResize,
  onRemove
}) {
  const {
    chartType,
    preferredX,
    preferredY,
    preferredZ,
    preferredSize,
    preferredColor,
    preferredGroup,
    preferredOpen,
    preferredHigh,
    preferredLow,
    dataScope,
    dataLimit,
    dataPage,
    sortBy,
    sortOrder,
    aggregation,
    topN,
    w,
    h
  } = configuration;
  const {
    colorPalette,
    seriesColor,
    showLegend,
    showDataLabels,
    numberFormat,
    decimalPlaces,
    currency
  } = normalizeChartAppearance(configuration, chartType);
  const legendSupported = LEGEND_CHART_TYPES.has(chartType);
  const dataLabelsSupported = DATA_LABEL_CHART_TYPES.has(chartType);
  const colorInputValue = seriesColor || resolvedPrimaryColor || getPalettePrimaryColor(colorPalette);
  const sizeConstraints = getChartSizeConstraints(chartType);
  const warnings = validation.warnings || [];
  const hasGuidance = validation.valid && warnings.length > 0;
  const additionalSelectors = [
    { show: selectorConfig.showZ, field: 'preferredZ', value: preferredZ, label: selectorConfig.zLabel, options: selectorConfig.zOptions },
    { show: selectorConfig.showSize, field: 'preferredSize', value: preferredSize, label: selectorConfig.sizeLabel, options: selectorConfig.sizeOptions },
    { show: selectorConfig.showColor, field: 'preferredColor', value: preferredColor, label: selectorConfig.colorLabel, options: selectorConfig.colorOptions },
    { show: selectorConfig.showGroup, field: 'preferredGroup', value: preferredGroup, label: selectorConfig.groupLabel, options: selectorConfig.groupOptions },
    { show: selectorConfig.showOpen, field: 'preferredOpen', value: preferredOpen, label: selectorConfig.openLabel, options: selectorConfig.openOptions },
    { show: selectorConfig.showHigh, field: 'preferredHigh', value: preferredHigh, label: selectorConfig.highLabel, options: selectorConfig.highOptions },
    { show: selectorConfig.showLow, field: 'preferredLow', value: preferredLow, label: selectorConfig.lowLabel, options: selectorConfig.lowOptions }
  ].filter(({ show }) => show);

  return (
    <div className="h-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
      <div className={`mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs font-medium ${hasGuidance ? 'bg-indigo-50 text-indigo-900' : validation.valid ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`} role="status">
        {validation.valid && !hasGuidance ? <FiCheckCircle className="mt-0.5 shrink-0" /> : <FiAlertTriangle className="mt-0.5 shrink-0" />}
        <div>
          <p className="font-semibold">{hasGuidance ? 'Graph configuration is valid with guidance' : validation.valid ? 'Graph configuration is valid' : 'This graph needs attention'}</p>
          {!validation.valid && (
            <>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {validation.issues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span>Compatible alternatives:</span>
                {validation.compatibleTypes.slice(0, 5).map((type) => (
                  <button key={type} type="button" onClick={() => onChartTypeChange(type)} className="rounded-md border border-amber-300 bg-white px-2 py-1 font-semibold capitalize hover:bg-amber-100">
                    {type}
                  </button>
                ))}
              </div>
            </>
          )}
          {warnings.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {onResize && (
          <fieldset className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:col-span-2 xl:col-span-4">
            <legend className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Card size</legend>
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-xs font-semibold text-slate-700">{w || 1} columns × {h || 1} rows</span>
              <button type="button" disabled={w <= sizeConstraints.minW} onClick={() => onResize(-1, 0)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Decrease graph width">Narrower</button>
              <button type="button" disabled={w >= sizeConstraints.maxW} onClick={() => onResize(1, 0)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Increase graph width">Wider</button>
              <button type="button" disabled={h <= sizeConstraints.minH} onClick={() => onResize(0, -1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Decrease graph height">Shorter</button>
              <button type="button" disabled={h >= sizeConstraints.maxH} onClick={() => onResize(0, 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Increase graph height">Taller</button>
            </div>
          </fieldset>
        )}
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Chart type
          <select value={chartType} onChange={(event) => onChartTypeChange(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700">
            {CHART_TYPE_OPTIONS.map((option) => {
              const compatibility = getGraphTypeCompatibility(option.value, columnGroups);
              return <option key={option.value} value={option.value}>{option.label}{compatibility.compatible ? '' : ' — incompatible'}</option>;
            })}
          </select>
        </label>
        {selectorConfig.showX && (
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            {selectorConfig.xLabel}
            <select value={preferredX} onChange={(event) => onChange({ preferredX: event.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700">
              <option value="" disabled>Select a column</option>
              {selectorConfig.xOptions.map((column) => <option key={column} value={column}>{column}</option>)}
            </select>
          </label>
        )}
        {selectorConfig.showY && (
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            {selectorConfig.yLabel}
            <select value={preferredY} onChange={(event) => onChange({ preferredY: event.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700">
              <option value="" disabled>Select a column</option>
              {selectorConfig.yOptions.map((column) => <option key={column} value={column}>{column === '__count__' ? 'Count' : column}</option>)}
            </select>
          </label>
        )}
        {additionalSelectors.map(({ field, value, label, options }) => (
          <label key={field} className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            {label}
            <select value={value} onChange={(event) => onChange({ [field]: event.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700">
              <option value="" disabled>Select a column</option>
              {options.map((column) => <option key={column} value={column}>{column}</option>)}
            </select>
          </label>
        ))}
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Dataset length
          <select value={dataScope} onChange={(event) => onChange({ dataScope: event.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700">
            <option value="full">Full dataset</option>
            <option value="sample">Custom slice</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Rows {dataScope === 'full' ? '(full dataset)' : ''}
          <input type="number" min="1" max="500" disabled={dataScope === 'full'} value={dataLimit} onChange={(event) => onChange({ dataLimit: Number(event.target.value || 180) })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 disabled:bg-slate-100" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Page
          <input type="number" min="1" disabled={dataScope === 'full'} value={dataPage} onChange={(event) => onChange({ dataPage: Number(event.target.value || 1) })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 disabled:bg-slate-100" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Sort by
          <select value={sortBy} onChange={(event) => onChange({ sortBy: event.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700">
            <option value="">No sorting</option>
            {columnGroups.all.map((column) => <option key={column} value={column}>{column}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Sort order
          <select value={sortOrder} onChange={(event) => onChange({ sortOrder: event.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700">
            <option value="asc">Ascending</option><option value="desc">Descending</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Aggregation
          <select value={aggregation} onChange={(event) => onChange({ aggregation: event.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700">
            <option value="auto">Auto</option><option value="count">Count</option><option value="sum">Sum</option><option value="average">Average</option><option value="median">Median</option><option value="min">Min</option><option value="max">Max</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          {chartType === 'table' ? 'Rows per table page' : 'Visible items'}
          <input type="number" min="3" max="50" value={topN} onChange={(event) => onChange({ topN: Number(event.target.value || 12) })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700" />
        </label>
        <fieldset className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:col-span-2 xl:col-span-4">
          <legend className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Appearance</legend>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Graph color
            <select value={colorPalette} onChange={(event) => onChange({ colorPalette: event.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700">
              <option value="inherit">Dashboard default</option>
              {CHART_PALETTES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Primary color
            <span className="flex flex-wrap items-center gap-2">
              <input type="color" aria-label="Primary color" value={colorInputValue} onChange={(event) => onChange({ seriesColor: event.target.value })} className="h-9 w-12 cursor-pointer rounded-lg border border-slate-300 bg-white p-1" />
              <button type="button" disabled={!seriesColor} onClick={() => onChange({ seriesColor: '' })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">Use selected color</button>
            </span>
          </label>
          <label className={`flex items-center gap-2 self-end rounded-lg border px-3 py-2 text-xs font-semibold ${legendSupported ? 'border-slate-300 bg-white text-slate-700' : 'border-slate-200 bg-slate-100 text-slate-400'}`}>
            <input type="checkbox" className="h-4 w-4 shrink-0" checked={legendSupported && showLegend} disabled={!legendSupported} onChange={(event) => onChange({ showLegend: event.target.checked })} />
            Show legend
          </label>
          <label className={`flex items-center gap-2 self-end rounded-lg border px-3 py-2 text-xs font-semibold ${dataLabelsSupported ? 'border-slate-300 bg-white text-slate-700' : 'border-slate-200 bg-slate-100 text-slate-400'}`}>
            <input type="checkbox" className="h-4 w-4 shrink-0" checked={dataLabelsSupported && showDataLabels} disabled={!dataLabelsSupported} onChange={(event) => onChange({ showDataLabels: event.target.checked })} />
            Show data labels
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Number format
            <select value={numberFormat} onChange={(event) => onChange({ numberFormat: event.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700">
              {NUMBER_FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Decimal places
            <input type="number" min="0" max="4" value={decimalPlaces} onChange={(event) => onChange({ decimalPlaces: Number(event.target.value || 0) })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700" />
          </label>
          {numberFormat === 'currency' && (
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
              Currency
              <select value={currency} onChange={(event) => onChange({ currency: event.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-700">
                {CURRENCY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          )}
          </div>
        </fieldset>
        <div className="flex items-end justify-between gap-2 sm:col-span-2 xl:col-span-4">
          <span className="text-xs font-medium text-slate-500">Showing {loadedRowCount.toLocaleString()} loaded rows.</span>
          {onRemove && <button type="button" onClick={onRemove} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">Remove card</button>}
        </div>
      </div>
    </div>
  );
}
