import useChartSeries from '../../hooks/useChartSeries';
import { loadChartPanelData } from '../../utils/chartPanelData';
import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sankey,
  Scatter,
  ScatterChart,
  Treemap,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { useDashboard } from '../../context/DashboardContext';
import { FiCopy, FiMove, FiRefreshCcw, FiSettings, FiTrash2 } from 'react-icons/fi';
import {
  getGraphSelectorConfig,
  inferColumnGroups,
  getDatasetColumnGroups,
  repairGraphConfiguration,
  validateGraphConfiguration
} from '../../utils/graphConfiguration';
import {
  formatChartValue,
  normalizeChartAppearance,
  resolveChartPalette,
  SOLID_CHART_COLORS
} from '../../utils/chartAppearance';
import CorrelationHeatmap from './CorrelationHeatmap';
import {
  getDatasetColumnNames,
  resolveAggregationMode,
  toNumber
} from '../../utils/chartDataTransforms';
import { getStoredDatasetVersion } from '../../utils/datasetWorkerPayload';

const DEFAULT_PALETTE = ['#2563EB'];
const AdvancedChart = lazy(() => import('./AdvancedChart'));
const GraphConfigurationPanel = lazy(() => import('./GraphConfigurationPanel'));
const ChartDataAlternative = lazy(() => import('./ChartDataAlternative'));
const ADVANCED_CHART_TYPES = new Set([
  'stackedBar', 'waterfall', 'histogram', 'box', 'violin', 'strip', 'ecdf',
  'density', 'bubble', 'radar', 'polarScatter', 'radialBar', 'scatter3d',
  'surface3d', 'mesh3d', 'bubble4d', 'contour', 'parallelCoordinates',
  'candlestick', 'sunburst', 'multiSpline', 'streamgraph', 'rangeArea'
]);
const BLUE_SINGLE_SERIES_TYPES = new Set(['line', 'stepLine', 'spline', 'smoothArea', 'waveform', 'sineWave', 'area']);
const MULTI_COLOR_CHART_TYPES = new Set([
  'bar', 'horizontalBar', 'stackedBar', 'pie', 'donut', 'funnel', 'treemap', 'sankey',
  'box', 'violin', 'strip', 'radialBar', 'sunburst', 'multiSpline', 'streamgraph'
]);

export default memo(function ChartPanel({
  id,
  title,
  chartType,
  gridWidth,
  gridHeight,
  dataset,
  liveSnapshot,
  liveStatus = 'idle',
  preferredX = '',
  preferredY = '',
  preferredZ = '',
  preferredSize = '',
  preferredColor = '',
  preferredGroup = '',
  preferredOpen = '',
  preferredHigh = '',
  preferredLow = '',
  dataScope = 'full',
  dataLimit = 180,
  dataPage = 1,
  sortBy = '',
  sortOrder = 'asc',
  aggregation = 'auto',
  topN = 12,
  palette = DEFAULT_PALETTE,
  colorPalette = 'inherit',
  seriesColor: customSeriesColor = '',
  showLegend = true,
  showDataLabels,
  numberFormat = 'auto',
  decimalPlaces = 2,
  currency = 'USD',
  variant = 'default',
  showControls = true,
  isEditing = false,
  openConfigRequest = 0,
  onChartTypeChange,
  onConfigChange,
  onDuplicate,
  onReset,
  onKeyboardMove,
  onKeyboardResize,
  onRemove
}) {
  const { getLocalData, setGlobalFilter, globalFilters = {} } = useDashboard();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Seed declared columns synchronously. More importantly, do not repair a
  // saved mapping until row data has made column classification reliable.
  // Otherwise the first empty render can silently replace a valid metric with
  // "Count" and that wrong mapping is what the user sees and later saves.
  const [columns, setColumns] = useState(() => getDatasetColumnNames(dataset));
  const [selectedX, setSelectedX] = useState(preferredX);
  const [selectedY, setSelectedY] = useState(preferredY);
  const [titleDraft, setTitleDraft] = useState(title || 'Untitled chart');
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [tablePage, setTablePage] = useState(1);
  const [tableTotalRows, setTableTotalRows] = useState(0);
  const panelRef = useRef();
  const isEditorial = variant === 'editorial';
  const appearance = normalizeChartAppearance({
    colorPalette,
    seriesColor: customSeriesColor,
    showLegend,
    showDataLabels,
    numberFormat,
    decimalPlaces,
    currency
  }, chartType);
  const chartPalette = resolveChartPalette(appearance.colorPalette, palette, appearance.seriesColor);
  // Trend/area curves remain blue; categorical charts use the full solid
  // palette below so each section/bar/group is visually distinct.
  const seriesColor = BLUE_SINGLE_SERIES_TYPES.has(chartType)
    ? (appearance.seriesColor || '#2563EB')
    : MULTI_COLOR_CHART_TYPES.has(chartType)
      ? SOLID_CHART_COLORS[0]
      : chartPalette[0];
  const categoricalColors = MULTI_COLOR_CHART_TYPES.has(chartType)
    ? SOLID_CHART_COLORS
    : (chartPalette.length > 0 ? chartPalette : DEFAULT_PALETTE);
  const formatValue = (value) => formatChartValue(value, appearance);
  const tooltipFormatter = (value, name) => [formatValue(value), name];
  const resolvedAggregation = resolveAggregationMode(aggregation, chartType);
  const visibleItems = Math.min(50, Math.max(3, Number(topN || 12)));
  const isFullTable = chartType === 'table' && dataScope === 'full';
  const tableFetchPage = isFullTable ? tablePage : 1;
  const moveInstructionsId = `chart-move-instructions-${String(id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  const handleMoveKeyDown = (event) => {
    const deltas = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1]
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    if (event.shiftKey) onKeyboardResize?.(...delta);
    else onKeyboardMove?.(...delta);
  };

  useEffect(() => {
    if (!dataset) {
      setData([]);
      setTableTotalRows(0);
      setError('');
      setColumns([]);
      setSelectedX('');
      setSelectedY('');
      return;
    }

    setColumns(getDatasetColumnNames(dataset));
  }, [dataset]);

  useEffect(() => {
    setSelectedX(preferredX || '');
  }, [preferredX]);

  useEffect(() => {
    setSelectedY(preferredY || '');
  }, [preferredY]);

  useEffect(() => {
    setTitleDraft(title || 'Untitled chart');
  }, [title]);

  useEffect(() => {
    setTablePage(1);
  }, [dataset?.id, chartType, dataScope, dataLimit, dataPage, sortBy, sortOrder, visibleItems]);

  useEffect(() => {
    if (openConfigRequest) setIsConfigOpen(true);
  }, [openConfigRequest]);

  useEffect(() => {
    if (liveSnapshot && dataset && liveSnapshot.datasetId === dataset.id) {
      if (!dataset.isLocal && !dataset.rawRows && Array.isArray(liveSnapshot.columns?.all) && liveSnapshot.columns.all.length > 0) {
        setColumns(liveSnapshot.columns.all);
      }
      // Local datasets live in memory: their rows never change server-side,
      // so refetching on every live snapshot is pure waste.
      if (!dataset.isLocal && !dataset.rawRows) {
        fetchChartData();
      }
    }
  }, [liveSnapshot?.meta?.generatedAt, dataset?.id]);

  const activeLiveColumns = liveSnapshot && dataset && liveSnapshot.datasetId === dataset.id
    ? (liveSnapshot.columns || {})
    : {};

  // Heavy O(columns × rows) inference — must not re-run on every render.
  const columnGroups = useMemo(
    () => dataset?.isLocal ? getDatasetColumnGroups({ ...dataset, rawRows: data }) : inferColumnGroups(columns, data, activeLiveColumns),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, data, dataset, liveSnapshot?.meta?.generatedAt]
  );
  const selectorConfig = getGraphSelectorConfig(chartType, columnGroups, selectedX);
  const graphConfiguration = {
    chartType,
    w: gridWidth,
    h: gridHeight,
    preferredX: selectedX,
    preferredY: selectedY,
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
    ...appearance
  };
  const graphValidation = validateGraphConfiguration(graphConfiguration, columnGroups);

  const handleConfigurationChange = (patch) => {
    if (patch.preferredX !== undefined) setSelectedX(patch.preferredX);
    if (patch.preferredY !== undefined) setSelectedY(patch.preferredY);
    onConfigChange?.(patch);
  };

  const handleChartTypeSelection = (nextChartType) => {
    const repaired = repairGraphConfiguration({
      ...graphConfiguration,
      chartType: nextChartType
    }, columnGroups);
    setSelectedX(repaired.preferredX);
    setSelectedY(repaired.preferredY);
    if (onConfigChange) {
      onConfigChange({
        chartType: nextChartType,
        preferredX: repaired.preferredX,
        preferredY: repaired.preferredY,
        preferredZ: repaired.preferredZ,
        preferredSize: repaired.preferredSize,
        preferredColor: repaired.preferredColor,
        preferredGroup: repaired.preferredGroup,
        preferredOpen: repaired.preferredOpen,
        preferredHigh: repaired.preferredHigh,
        preferredLow: repaired.preferredLow
      });
    } else {
      onChartTypeChange?.(nextChartType);
    }
  };

  // Aggregated chart series — recomputed only when data or config actually
  // changes, not on every render (they scan the full dataset).
  const metricKey = selectedY || '__count__';
  const heatmapColumns = useMemo(() => columnGroups.numeric.slice(0, 6), [columnGroups]);
  const scanFilters = data === dataset?.rawRows && typeof Worker !== 'undefined' && getStoredDatasetVersion(dataset) ? globalFilters : undefined;
  const chartInput = useMemo(() => ({ rows: data, filters: scanFilters, columnOverrides: dataset?.columnOverrides, selectedX, metricKey, aggregation: resolvedAggregation, visibleItems, heatmapColumns, chartType }),
    [data, scanFilters, dataset?.columnOverrides, selectedX, metricKey, resolvedAggregation, visibleItems, heatmapColumns, chartType]);
  const { series, computationError } = useChartSeries(chartInput);
  const categoricalSeries = series?.categoricalSeries || [];
  const trendSeries = series?.trendSeries || [];
  const heatmapMatrix = series?.heatmapMatrix || [];

  useEffect(() => {
    // String-only server metadata and the pre-fetch local render do not know
    // which columns are dimensions/measures yet. Preserve explicit mappings
    // until classification is known instead of guessing from empty options.
    if (columnGroups.classificationKnown === false) return;

    const patch = {};
    if (selectorConfig.showX) {
      const nextX = selectorConfig.xOptions.includes(selectedX)
        ? selectedX
        : (selectorConfig.xOptions[0] || '');

      if (nextX !== selectedX) {
        setSelectedX(nextX);
        patch.preferredX = nextX;
      }
    }

    if (selectorConfig.showY) {
      const nextY = selectorConfig.yOptions.includes(selectedY)
        ? selectedY
        : (selectorConfig.yOptions[0] || '');

      if (nextY !== selectedY) {
        setSelectedY(nextY);
        patch.preferredY = nextY;
      }
    }

    // Keep the persisted layout and the rendered chart in the same state.
    if (Object.keys(patch).length > 0) onConfigChange?.(patch, { automatic: true });
  }, [
    chartType,
    columnGroups.classificationKnown,
    selectedX,
    selectedY,
    selectorConfig.showX,
    selectorConfig.showY,
    selectorConfig.xOptions.join('|'),
    selectorConfig.yOptions.join('|'),
    onConfigChange
  ]);


  const handleCrossFilter = (entry) => {
    if (!selectedX || !entry) {
      return;
    }

    const value = entry.name ?? entry.payload?.name ?? entry.payload?.x ?? entry.x;
    if (value !== undefined && value !== null && value !== '') {
      setGlobalFilter(selectedX, String(value));
    }
  };

  useEffect(() => {
    fetchChartData();
  }, [dataset?.id, dataScope, dataLimit, dataPage, sortBy, sortOrder, chartType, tableFetchPage, visibleItems, getLocalData]);

  const fetchChartData = () => loadChartPanelData({ dataset, chartType, dataScope, sortBy, sortOrder, getLocalData, isFullTable, visibleItems, dataLimit, tablePage, dataPage, columns, setLoading, setData, setTableTotalRows, setError, setTablePage, setColumns });

  const changeTablePage = (nextPage) => {
    if (isFullTable) setLoading(true);
    setTablePage(nextPage);
  };

  const renderChart = () => {
    if (loading) {
      return (
        <div role="status" aria-label="Loading chart" className="flex h-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600"></div>
        </div>
      );
    }

    if (!dataset) {
      return <div className="flex h-full items-center justify-center text-gray-500">Select a dataset to view chart</div>;
    }

    if (error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center font-bold text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => void fetchChartData()} className="border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50">
            Retry chart
          </button>
        </div>
      );
    }

    if (!data.length) {
      return <div className="flex h-full items-center justify-center text-gray-500">No data available</div>;
    }
    if (computationError) return <p role="alert" className="p-4 text-sm text-rose-700">{computationError}</p>;
    if (!series && chartType !== 'table') return <p role="status" className="p-4 text-sm text-slate-600">Calculating chart over the eligible rows…</p>;

    if (!graphValidation.valid) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-amber-300 bg-amber-50 px-5 text-center text-amber-950">
          <FiSettings className="text-2xl" aria-hidden="true" />
          <div>
            <p className="font-semibold">This graph is incompatible with the selected dataset.</p>
            <p className="mt-1 text-sm">{graphValidation.issues.join(' ')}</p>
          </div>
          {showControls && <button type="button" onClick={() => setIsConfigOpen(true)} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-100">Choose a compatible graph</button>}
        </div>
      );
    }

    if (ADVANCED_CHART_TYPES.has(chartType)) {
      return (
        <Suspense fallback={<div className="flex h-full items-center justify-center text-sm font-semibold text-slate-500">Loading interactive renderer…</div>}>
          <AdvancedChart
            filters={scanFilters}
            columnOverrides={dataset?.columnOverrides}
            chartType={chartType}
            rows={data}
            categoricalSeries={categoricalSeries}
            columnGroups={columnGroups}
            selectedX={selectedX}
            selectedY={selectedY}
            preferredZ={preferredZ}
            preferredSize={preferredSize}
            preferredGroup={preferredGroup}
            preferredOpen={preferredOpen}
            preferredHigh={preferredHigh}
            preferredLow={preferredLow}
            metricKey={metricKey}
            aggregation={resolvedAggregation}
            visibleItems={visibleItems}
            seriesColor={seriesColor}
            palette={categoricalColors}
            showLegend={appearance.showLegend}
            title={title}
          />
        </Suspense>
      );
    }

    // Leave room for formatted values such as 400,000. A zero left margin
    // lets Recharts place the first glyph outside an overflow-hidden card.
    const chartMargin = { top: 10, right: 20, left: 20, bottom: 0 };
    const trendInterval = Math.max(0, Math.min(trendSeries.length - 1, 2));

    switch (chartType) {
      case 'kpi': {
        const value = series.metricValue;
        return (
          <div className="flex h-full flex-col items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{metricKey === '__count__' ? 'Row count' : metricKey}</p>
            <p className="mt-3 text-4xl font-black tracking-tight text-slate-950" style={{ color: seriesColor }}>{formatValue(value)}</p>
            <p className="mt-2 text-xs font-semibold capitalize text-slate-500">{metricKey === '__count__' ? 'count' : resolvedAggregation}</p>
          </div>
        );
      }

      case 'table': {
        const tableRowCount = isFullTable ? tableTotalRows : data.length;
        const tablePageCount = Math.max(1, Math.ceil(tableRowCount / visibleItems));
        const activeTablePage = Math.min(tablePage, tablePageCount);
        const firstRowIndex = (activeTablePage - 1) * visibleItems;
        const visibleRows = isFullTable ? data : data.slice(firstRowIndex, firstRowIndex + visibleItems);
        const firstVisibleRow = tableRowCount > 0 ? firstRowIndex + 1 : 0;
        const lastVisibleRow = Math.min(firstRowIndex + visibleRows.length, tableRowCount);
        const paginationButtonClassName = 'rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35';
        return (
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200" role="region" aria-label={`${title} data preview`}>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span className="font-semibold" aria-live="polite">Rows {firstVisibleRow.toLocaleString()}–{lastVisibleRow.toLocaleString()} of {tableRowCount.toLocaleString()}</span>
              <div className="flex items-center gap-1.5" aria-label="Table pagination">
                <button type="button" className={paginationButtonClassName} disabled={activeTablePage <= 1} onClick={() => changeTablePage(1)} aria-label="First table page">First</button>
                <button type="button" className={paginationButtonClassName} disabled={activeTablePage <= 1} onClick={() => changeTablePage(Math.max(1, activeTablePage - 1))} aria-label="Previous table page">Prev</button>
                <span className="whitespace-nowrap px-1 font-medium">Page {activeTablePage.toLocaleString()} of {tablePageCount.toLocaleString()}</span>
                <button type="button" className={paginationButtonClassName} disabled={activeTablePage >= tablePageCount} onClick={() => changeTablePage(Math.min(tablePageCount, activeTablePage + 1))} aria-label="Next table page">Next</button>
                <button type="button" className={paginationButtonClassName} disabled={activeTablePage >= tablePageCount} onClick={() => changeTablePage(tablePageCount)} aria-label="Last table page">Last</button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto" tabIndex={0} aria-label={`${title} rows and columns`}>
              <table className="min-w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                  <tr>{columns.map((column) => <th key={column} className="whitespace-nowrap border-b border-slate-200 px-3 py-2 font-bold">{column}</th>)}</tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, rowIndex) => (
                    <tr key={`${activeTablePage}-${rowIndex}`} className="odd:bg-white even:bg-slate-50">
                      {columns.map((column) => {
                        const value = row?.[column];
                        return <td key={column} className="max-w-48 truncate border-b border-slate-100 px-3 py-2 text-slate-700" title={value === null || value === undefined ? '' : String(value)}>{typeof value === 'number' ? formatValue(value) : (value ?? '—')}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      case 'stepLine':
        return (
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <LineChart data={trendSeries} margin={chartMargin}>
              <XAxis dataKey="x" minTickGap={18} interval={trendInterval} />
              <YAxis tickFormatter={formatValue} />
              <CartesianGrid strokeDasharray="3 3" />
              <Tooltip formatter={tooltipFormatter} />
              {appearance.showLegend && <Legend />}
              <Line type="stepAfter" dataKey="y" stroke={seriesColor} strokeWidth={2} dot={false} name={metricKey === '__count__' ? 'Count' : metricKey}>
                {appearance.showDataLabels && <LabelList dataKey="y" position="top" formatter={formatValue} />}
              </Line>
            </LineChart>
          </ResponsiveContainer>
        );

      case 'spline':
        return (
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <LineChart data={trendSeries} margin={chartMargin}>
              <XAxis dataKey="x" minTickGap={18} interval={trendInterval} />
              <YAxis tickFormatter={formatValue} />
              <CartesianGrid strokeDasharray="3 3" />
              <Tooltip formatter={tooltipFormatter} />
              {appearance.showLegend && <Legend />}
              <Line type="natural" dataKey="y" stroke={seriesColor} strokeWidth={3} dot={false} name={metricKey === '__count__' ? 'Count' : metricKey}>
                {appearance.showDataLabels && <LabelList dataKey="y" position="top" formatter={formatValue} />}
              </Line>
            </LineChart>
          </ResponsiveContainer>
        );

      case 'smoothArea':
        return (
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <AreaChart data={trendSeries} margin={chartMargin}>
              <XAxis dataKey="x" minTickGap={18} interval={trendInterval} />
              <YAxis tickFormatter={formatValue} />
              <CartesianGrid strokeDasharray="3 3" />
              <Tooltip formatter={tooltipFormatter} />
              {appearance.showLegend && <Legend />}
              <Area type="natural" dataKey="y" fill={seriesColor} fillOpacity={0.35} stroke={seriesColor} strokeWidth={3} name={metricKey === '__count__' ? 'Count' : metricKey}>
                {appearance.showDataLabels && <LabelList dataKey="y" position="top" formatter={formatValue} />}
              </Area>
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'waveform':
        return (
          <ResponsiveContainer width="100%" height="100%" debounce={20}>
            <LineChart data={trendSeries} margin={chartMargin}>
              <XAxis dataKey="x" minTickGap={18} interval={trendInterval} />
              <YAxis tickFormatter={formatValue} domain={['auto', 'auto']} />
              <CartesianGrid strokeDasharray="3 3" />
              <Tooltip formatter={tooltipFormatter} />
              {appearance.showLegend && <Legend />}
              <Line type="linear" dataKey="y" stroke={seriesColor} strokeWidth={2} dot={false} isAnimationActive={false} name={metricKey === '__count__' ? 'Count' : metricKey}>
                {appearance.showDataLabels && <LabelList dataKey="y" position="top" formatter={formatValue} />}
              </Line>
            </LineChart>
          </ResponsiveContainer>
        );

      case 'sineWave': {
        const inputValues = data
          .map((row) => toNumber(row?.[selectedX]))
          .filter((value) => value !== null)
          .sort((left, right) => left - right)
          .slice(0, Math.max(24, visibleItems * 10));
        const minimum = Math.min(...inputValues);
        const maximum = Math.max(...inputValues);
        const sineSeries = inputValues.map((value, index) => ({
          x: value,
          y: Math.sin(maximum === minimum
            ? (index / Math.max(1, inputValues.length - 1)) * Math.PI * 4
            : ((value - minimum) / (maximum - minimum)) * Math.PI * 4)
        }));
        return (
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <LineChart data={sineSeries} margin={chartMargin}>
              <XAxis dataKey="x" tickFormatter={formatValue} minTickGap={18} />
              <YAxis domain={[-1, 1]} />
              <CartesianGrid strokeDasharray="3 3" />
              <Tooltip formatter={tooltipFormatter} />
              {appearance.showLegend && <Legend />}
              <Line type="natural" dataKey="y" stroke={seriesColor} strokeWidth={3} dot={false} name={`sin(${selectedX})`} />
            </LineChart>
          </ResponsiveContainer>
        );
      }

      case 'horizontalBar':
        return (
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <BarChart data={categoricalSeries} layout="vertical" margin={{ top: 8, right: 24, left: 28, bottom: 8 }}>
              <XAxis type="number" tickFormatter={formatValue} />
              <YAxis type="category" dataKey="name" width={90} />
              <CartesianGrid strokeDasharray="3 3" />
              <Tooltip formatter={tooltipFormatter} />
              {appearance.showLegend && <Legend />}
              <Bar dataKey="value" fill={seriesColor} name={metricKey === '__count__' ? 'Count' : metricKey} onClick={handleCrossFilter}>
                {categoricalSeries.map((entry, index) => (
                  <Cell key={`horizontal-bar-${entry.name}-${index}`} fill={categoricalColors[index % categoricalColors.length]} />
                ))}
                {appearance.showDataLabels && <LabelList dataKey="value" position="right" formatter={formatValue} />}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );

      case 'donut':
        return (
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <PieChart>
              <Pie data={categoricalSeries} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="36%" outerRadius="72%" fill={seriesColor} label={appearance.showDataLabels ? ({ name, value }) => `${name}: ${formatValue(value)}` : false} onClick={handleCrossFilter}>
                {categoricalSeries.map((entry, index) => (
                  <Cell key={`donut-${entry.name}-${index}`} fill={categoricalColors[index % categoricalColors.length]} />
                ))}
              </Pie>
              <Tooltip formatter={tooltipFormatter} />
              {appearance.showLegend && <Legend />}
            </PieChart>
          </ResponsiveContainer>
        );

      case 'line':
        return (
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <LineChart data={trendSeries} margin={chartMargin}>
              <XAxis dataKey="x" minTickGap={18} interval={trendInterval} />
              <YAxis tickFormatter={formatValue} />
              <CartesianGrid strokeDasharray="3 3" />
              <Tooltip formatter={tooltipFormatter} />
              {appearance.showLegend && <Legend />}
              <Line type="monotone" dataKey="y" stroke={seriesColor} strokeWidth={2} dot={{ r: 2 }} name={metricKey === '__count__' ? 'Count' : metricKey}>
                {appearance.showDataLabels && <LabelList dataKey="y" position="top" formatter={formatValue} />}
              </Line>
            </LineChart>
          </ResponsiveContainer>
        );

      case 'bar':
        return (
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <BarChart data={categoricalSeries} margin={chartMargin}>
              <XAxis dataKey="name" minTickGap={12} interval={0} />
              <YAxis tickFormatter={formatValue} />
              <CartesianGrid strokeDasharray="3 3" />
              <Tooltip formatter={tooltipFormatter} />
              {appearance.showLegend && <Legend />}
              <Bar
                dataKey="value"
                fill={seriesColor}
                name={metricKey === '__count__' ? 'Count' : metricKey}
                onClick={handleCrossFilter}
                className="cursor-pointer transition-opacity hover:opacity-80"
              >
                {categoricalSeries.map((entry, index) => (
                  <Cell key={`bar-${entry.name}-${index}`} fill={categoricalColors[index % categoricalColors.length]} />
                ))}
                {appearance.showDataLabels && <LabelList dataKey="value" position="top" formatter={formatValue} />}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );

      case 'pie':
        return (
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <PieChart>
              <Pie
                data={categoricalSeries}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius="72%"
                label={appearance.showDataLabels ? ({ name, value }) => `${name}: ${formatValue(value)}` : false}
                onClick={handleCrossFilter}
                className="cursor-pointer transition-opacity hover:opacity-80"
              >
                {categoricalSeries.map((entry, index) => (
                  <Cell key={`pie-${entry.name}-${index}`} fill={categoricalColors[index % categoricalColors.length]} />
                ))}
              </Pie>
              <Tooltip formatter={tooltipFormatter} />
              {appearance.showLegend && <Legend />}
            </PieChart>
          </ResponsiveContainer>
        );

      case 'area':
        return (
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <AreaChart data={trendSeries} margin={chartMargin}>
              <XAxis dataKey="x" minTickGap={18} interval={trendInterval} />
              <YAxis tickFormatter={formatValue} />
              <CartesianGrid strokeDasharray="3 3" />
              <Tooltip formatter={tooltipFormatter} />
              {appearance.showLegend && <Legend />}
              <Area
                type="monotone"
                dataKey="y"
                fill={seriesColor}
                stroke={seriesColor}
                strokeWidth={2}
                name={metricKey === '__count__' ? 'Count' : metricKey}
                onClick={handleCrossFilter}
                className="cursor-pointer"
              >
                {appearance.showDataLabels && <LabelList dataKey="y" position="top" formatter={formatValue} />}
              </Area>
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'scatter':
        if (!selectedX || !selectedY) {
          return <div className="flex h-full items-center justify-center text-gray-500">Select two numeric columns</div>;
        }

        return (
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <ScatterChart
              data={data
                .map((row) => ({
                  x: toNumber(row?.[selectedX]),
                  y: toNumber(row?.[selectedY])
                }))
                .filter((point) => point.x !== null && point.y !== null)
                .slice(0, visibleItems * 20)}
              margin={chartMargin}
            >
              <XAxis dataKey="x" name={selectedX} tickFormatter={formatValue} />
              <YAxis dataKey="y" name={selectedY} tickFormatter={formatValue} />
              <CartesianGrid strokeDasharray="3 3" />
              <Tooltip formatter={tooltipFormatter} />
              {appearance.showLegend && <Legend />}
              <Scatter fill={seriesColor} name={selectedY}>
                {appearance.showDataLabels && <LabelList dataKey="y" position="top" formatter={formatValue} />}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        );

      case 'heatmap': {
        if (heatmapColumns.length < 2) {
          return <div className="flex h-full items-center justify-center text-gray-500">Need at least two numeric columns for a correlation heatmap</div>;
        }

        return <CorrelationHeatmap columns={heatmapColumns} matrix={heatmapMatrix} title={title} />;
      }

      case 'gauge': {
        if (!selectedY) {
          return <div className="flex h-full items-center justify-center text-gray-500">Select a numeric metric to render a gauge</div>;
        }

        const { min, max } = series.metricRange;
        const aggregateValue = series?.metricValue;
        if (aggregateValue == null || min === null) return <p className="p-4 text-sm text-slate-600">No computable numeric values in this scope.</p>;
        const normalizedValue = max === min ? 1 : Math.min(Math.max((aggregateValue - min) / (max - min), 0), 1);
        const gaugeData = [
          { name: 'value', value: Number((normalizedValue * 100).toFixed(1)) },
          { name: 'remaining', value: Number((100 - normalizedValue * 100).toFixed(1)) }
        ];

        return (
          <div className="relative h-full">
            <ResponsiveContainer width="100%" height="100%" debounce={50}>
              <PieChart>
                <Pie data={gaugeData} dataKey="value" startAngle={180} endAngle={0} innerRadius="48%" outerRadius="72%" stroke="none">
                  <Cell fill={seriesColor} />
                  <Cell fill="#E5E7EB" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-xs font-black uppercase text-primary-black/60">{selectedY}</div>
              <div className="text-4xl font-black text-primary-black">{formatValue(aggregateValue)}</div>
              <div className="text-sm text-primary-black/70">{resolvedAggregation} of full range</div>
            </div>
          </div>
        );
      }

      case 'funnel':
        if (!selectedX) {
          return <div className="flex h-full items-center justify-center text-gray-500">Select a dimension to render a funnel</div>;
        }

        return (
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <FunnelChart>
              <Tooltip formatter={tooltipFormatter} />
              <Funnel dataKey="value" data={categoricalSeries} isAnimationActive>
                {categoricalSeries.map((entry, index) => (
                  <Cell key={`funnel-cell-${index}`} fill={categoricalColors[index % categoricalColors.length]} />
                ))}
                {appearance.showDataLabels && <LabelList dataKey="value" position="right" formatter={formatValue} />}
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        );

      case 'treemap':
        if (!selectedX) {
          return <div className="flex h-full items-center justify-center text-gray-500">Select a dimension to render a treemap</div>;
        }

        return (
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <Treemap
              data={categoricalSeries}
              dataKey="value"
              ratio={4 / 3}
              stroke="#FFFFFF"
              content={({ x, y, width, height, index, name }) => (
                <g>
                  <rect x={x} y={y} width={width} height={height} fill={categoricalColors[index % categoricalColors.length]} stroke="#FFFFFF" strokeWidth={2} />
                  {width > 54 && height > 28 && <text x={x + 7} y={y + 18} fill="#FFFFFF" fontSize={11} fontWeight={700}>{name}</text>}
                </g>
              )}
            >
              <Tooltip formatter={tooltipFormatter} />
            </Treemap>
          </ResponsiveContainer>
        );

      case 'sankey': {
        const sankeyData = series.sankeyData;

        if (!sankeyData.nodes.length || !sankeyData.links.length) {
          return <div className="flex h-full items-center justify-center text-gray-500">Select two populated dimensions to render a flow diagram</div>;
        }

        return (
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <Sankey
              data={sankeyData}
              nodePadding={24}
              nodeWidth={12}
              linkCurvature={0.5}
              margin={{ top: 10, right: 20, left: 20, bottom: 10 }}
              node={({ x, y, width, height, index, payload }) => (
                <g>
                  <rect x={x} y={y} width={width} height={height} fill={categoricalColors[index % categoricalColors.length]} />
                  <text x={x < 100 ? x + width + 6 : x - 6} y={y + height / 2} textAnchor={x < 100 ? 'start' : 'end'} dominantBaseline="middle" fill="#334155" fontSize={11} fontWeight={700}>{payload?.name}</text>
                </g>
              )}
            >
              <Tooltip formatter={tooltipFormatter} />
            </Sankey>
          </ResponsiveContainer>
        );
      }

      default:
        return <div>Select a chart type</div>;
    }
  };

  // Presentation style and editability are separate concerns. Smart-layout
  // cards use the editorial style, but still need to expose their controls
  // while the dashboard is in an editing session.
  const isCardConfigurable = showControls;
  const leadingValues = categoricalSeries.slice(0, 3)
    .map((entry) => `${entry.name} ${formatValue(entry.value)}`)
    .join(', ');
  const chartSummary = chartType === 'table'
    ? `Table showing ${tableTotalRows || data.length} rows and ${columns.length} columns.`
    : chartType === 'kpi'
      ? `${resolvedAggregation} ${metricKey === '__count__' ? 'row count' : metricKey} across ${data.length} loaded rows.`
      : `${chartType} chart showing ${metricKey === '__count__' ? 'row count' : metricKey}${selectedX ? ` by ${selectedX}` : ''}, using ${resolvedAggregation}, across ${data.length} loaded rows.${leadingValues ? ` Leading values: ${leadingValues}.` : ''}`;
  const commitTitle = () => {
    const nextTitle = titleDraft.trim() || 'Untitled chart';
    setTitleDraft(nextTitle);
    if (nextTitle !== title) {
      onConfigChange?.({ title: nextTitle });
    }
  };

  return (
    <div
      ref={panelRef}
      role="figure"
      aria-busy={loading || Boolean(dataset && data.length && chartType !== 'table' && !series && !computationError && !error)}
      aria-label={`${title || 'Untitled chart'}. ${chartSummary}`}
      className="chart-panel relative flex h-full min-w-0 flex-col overflow-hidden"
    >
      <div className="chart-panel-header">
        <div className="flex items-center justify-between gap-3">
          {isCardConfigurable ? (
            <input
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              aria-label="Chart title"
              className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-semibold tracking-tight text-slate-900 outline-hidden transition hover:border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            />
          ) : (
            <h3 className={isEditorial ? 'text-sm font-semibold text-slate-900' : 'text-lg font-semibold tracking-tight text-slate-900'}>{title}</h3>
          )}
          {isCardConfigurable && (
            <div className="flex shrink-0 items-center gap-1">
              {isEditing && (
                <button
                  type="button"
                  className="drag-handle grid h-9 w-9 cursor-grab place-items-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 active:cursor-grabbing"
                  aria-label={`Move or resize ${title || 'chart'}`}
                  aria-describedby={moveInstructionsId}
                  aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                  title="Drag or use Arrow keys to move; hold Shift to resize"
                  onKeyDown={handleMoveKeyDown}
                >
                  <FiMove />
                </button>
              )}
              {isEditing && <span id={moveInstructionsId} className="sr-only">Use Arrow keys to move this card. Hold Shift while pressing an Arrow key to resize it.</span>}
              <button
                type="button"
                onClick={() => setIsConfigOpen((open) => !open)}
                aria-expanded={isConfigOpen}
                aria-label={`Configure ${title || 'chart'}`}
                title="Configure chart"
                className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              >
                {isEditing ? <FiSettings /> : <span className="text-xl font-bold leading-none">&hellip;</span>}
              </button>
              {isEditing && onDuplicate && (
                <button type="button" onClick={onDuplicate} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" aria-label={`Duplicate ${title || 'chart'}`} title="Duplicate card"><FiCopy /></button>
              )}
              {isEditing && onReset && (
                <button type="button" onClick={onReset} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" aria-label={`Reset ${title || 'chart'}`} title="Reset card"><FiRefreshCcw /></button>
              )}
              {isEditing && onRemove && (
                <button type="button" onClick={onRemove} className="grid h-9 w-9 place-items-center rounded-lg border border-rose-200 bg-white text-rose-700 hover:bg-rose-50" aria-label={`Delete ${title || 'chart'}`} title="Delete card"><FiTrash2 /></button>
              )}
            </div>
          )}
        </div>

        {isConfigOpen && isCardConfigurable && (
          <div className="absolute inset-x-4 bottom-4 top-16 z-30 min-h-0">
            <Suspense fallback={<div className="h-full overflow-auto rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500 shadow-xl">Loading graph controls…</div>}>
              <GraphConfigurationPanel
                configuration={graphConfiguration}
                columnGroups={columnGroups}
                selectorConfig={selectorConfig}
                validation={graphValidation}
                loadedRowCount={chartType === 'table' ? tableTotalRows : data.length}
                resolvedPrimaryColor={seriesColor}
                onChartTypeChange={handleChartTypeSelection}
                onChange={handleConfigurationChange}
                onResize={onKeyboardResize}
                onRemove={onRemove}
              />
            </Suspense>
          </div>
        )}
      </div>
      <div className={`min-h-0 min-w-0 flex-1 ${chartType === 'heatmap' ? 'p-2' : 'p-5'}`} style={{ minHeight: 0 }}>
        {renderChart()}
      </div>
      {series && chartType !== 'table' && !ADVANCED_CHART_TYPES.has(chartType) && <Suspense fallback={null}><ChartDataAlternative label={title || 'Chart'} rows={categoricalSeries.length ? categoricalSeries : [{ name: metricKey, value: series.metricValue }]} /></Suspense>}
    </div>
  );
});
