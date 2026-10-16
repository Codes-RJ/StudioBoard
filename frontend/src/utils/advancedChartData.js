import { SOLID_CHART_COLORS } from './chartAppearance';
import { dateGroupKey } from './dateSemantics';

import { toNumber, aggregateMetricValues as aggregateValues } from './chartDataTransforms';

const GL3D_CHART_TYPES = new Set(['scatter3d', 'surface3d', 'mesh3d', 'bubble4d']);
const FINANCE_CHART_TYPES = new Set(['waterfall', 'candlestick']);
const CARTESIAN_CHART_TYPES = new Set([
  'multiSpline', 'streamgraph', 'rangeArea', 'stackedBar', 'histogram', 'box', 'violin',
  'strip', 'ecdf', 'density', 'bubble', 'contour'
]);

const rendererForChartType = (chartType) => {
  if (GL3D_CHART_TYPES.has(chartType)) return 'gl3d';
  if (FINANCE_CHART_TYPES.has(chartType)) return 'finance';
  if (CARTESIAN_CHART_TYPES.has(chartType)) return 'cartesian';
  return 'full';
};

const numericSeries = (rows, key) => rows.map((row) => toNumber(row?.[key]));

const scaleMarkerSizes = (values, minimum = 6, maximum = 34) => {
  const numericValues = values.map(toNumber);
  const valid = numericValues.filter((value) => value !== null);
  if (!valid.length) return numericValues.map(() => minimum);
  const low = valid.reduce((min, value) => Math.min(min, value), Infinity);
  const high = valid.reduce((max, value) => Math.max(max, value), -Infinity);
  return numericValues.map((value) => {
    if (value === null) return minimum;
    if (high === low) return (minimum + maximum) / 2;
    return minimum + ((value - low) / (high - low)) * (maximum - minimum);
  });
};

const buildSurfaceGrid = (rows, xKey, yKey, zKey, limit = 2500) => {
  const points = rows
    .slice(0, limit)
    .map((row) => ({ x: toNumber(row?.[xKey]), y: toNumber(row?.[yKey]), z: toNumber(row?.[zKey]) }))
    .filter((point) => point.x !== null && point.y !== null && point.z !== null);
  const x = [...new Set(points.map((point) => point.x))].sort((left, right) => left - right).slice(0, 60);
  const y = [...new Set(points.map((point) => point.y))].sort((left, right) => left - right).slice(0, 60);
  const lookup = new Map(points.map((point) => [`${point.x}\u0000${point.y}`, point.z]));
  return {
    x,
    y,
    z: y.map((yValue) => x.map((xValue) => lookup.get(`${xValue}\u0000${yValue}`) ?? null)),
    points
  };
};

const buildStackedSeries = (rows, categoryKey, groupKey, metricKey, aggregation, limit = 12, overrides) => {
  const categories = [...new Set(rows.map((row) => String(dateGroupKey(row?.[categoryKey], overrides?.[categoryKey]) ?? 'Unspecified')))].slice(0, limit);
  const groups = [...new Set(rows.map((row) => String(dateGroupKey(row?.[groupKey], overrides?.[groupKey]) ?? 'Unspecified')))].slice(0, 12);
  const categorySet = new Set(categories); const groupSet = new Set(groups);
  // Single-pass grouping: O(N) instead of O(N × G × C) nested filtering.
  const buckets = new Map();
  for (const row of rows) {
    const category = String(dateGroupKey(row?.[categoryKey], overrides?.[categoryKey]) ?? 'Unspecified');
    const group = String(dateGroupKey(row?.[groupKey], overrides?.[groupKey]) ?? 'Unspecified');
    if (!categorySet.has(category) || !groupSet.has(group)) continue;
    const key = JSON.stringify([group, category]);
    const bucket = buckets.get(key) || [];
    bucket.push(metricKey === '__count__' ? 1 : row?.[metricKey]);
    buckets.set(key, bucket);
  }
  return groups.map((group) => ({
    group,
    x: categories,
    y: categories.map((category) => {
      const values = buckets.get(JSON.stringify([group, category])) || [];
      return aggregateValues(values, metricKey === '__count__' ? 'count' : aggregation);
    })
  }));
};

const resolveSeriesColors = (primaryColor, count, palette = []) => {
  const colors = [...new Set([primaryColor, ...palette, ...SOLID_CHART_COLORS]
    .filter(Boolean)
    .map((color) => color.toUpperCase()))];
  return Array.from({ length: count }, (_, index) => colors[index % colors.length]);
};

const withAlpha = (hexColor, alpha) => {
  const normalized = String(hexColor).replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return hexColor;
  const channels = normalized.match(/.{2}/g).map((channel) => parseInt(channel, 16));
  return `rgba(${channels.join(', ')}, ${alpha})`;
};

export function buildAdvancedPlot({
  chartType,
  rows,
  categoricalSeries,
  columnGroups,
  selectedX,
  selectedY,
  preferredZ,
  preferredSize,
  preferredGroup,
  preferredOpen,
  preferredHigh,
  preferredLow,
  metricKey,
  aggregation,
  visibleItems,
  seriesColor,
  palette,
  showLegend,
  title,
  sourceRowCount = rows.length,
  preparedStackedSeries,
  columnOverrides
}) {
  const fullStatistics = ['stackedBar', 'multiSpline', 'streamgraph', 'histogram', 'box', 'violin', 'ecdf', 'density', 'sunburst'].includes(chartType);
  const pointLimit = ['surface3d', 'mesh3d', 'contour'].includes(chartType) ? 2500 : Math.max(500, visibleItems * 50);
  const plotRows = fullStatistics ? rows : rows.slice(0, pointLimit);
  const baseLayout = {
    showlegend: showLegend,
    xaxis: { title: { text: selectedX || undefined }, gridcolor: '#E2E8F0', zerolinecolor: '#CBD5E1' },
    yaxis: { title: { text: selectedY || undefined }, gridcolor: '#E2E8F0', zerolinecolor: '#CBD5E1' }
  };
  const renderPlot = (traces, layout = {}) => ({ traces, layout: { ...baseLayout, ...layout },
    renderer: rendererForChartType(chartType),
    coverage: { sourceRows: sourceRowCount, plottedRows: fullStatistics ? sourceRowCount : plotRows.length, fullStatistics } });

  switch (chartType) {
    case 'multiSpline': {
      const series = preparedStackedSeries || buildStackedSeries(plotRows, selectedX, preferredGroup, metricKey, aggregation, visibleItems, columnOverrides);
      const colors = resolveSeriesColors(seriesColor, series.length, palette);
      return renderPlot(series.map((entry, index) => ({
        type: 'scatter', mode: 'lines', name: entry.group, x: entry.x, y: entry.y,
        line: { color: colors[index], width: 3, shape: 'spline', smoothing: 1.15 },
        hovertemplate: `${selectedX}: %{x}<br>${entry.group}: %{y}<extra></extra>`
      })));
    }
    case 'streamgraph': {
      const series = preparedStackedSeries || buildStackedSeries(plotRows, selectedX, preferredGroup, metricKey, aggregation, visibleItems, columnOverrides);
      const colors = resolveSeriesColors(seriesColor, series.length, palette);
      const totals = series[0]?.x.map((_, pointIndex) => (
        series.reduce((sum, entry) => sum + Math.max(0, entry.y[pointIndex] || 0), 0)
      )) || [];
      let boundary = totals.map((total) => -total / 2);
      const traces = [{
        type: 'scatter', mode: 'lines', x: series[0]?.x || [], y: boundary,
        line: { width: 0 }, hoverinfo: 'skip', showlegend: false
      }];
      series.forEach((entry, index) => {
        boundary = boundary.map((value, pointIndex) => value + Math.max(0, entry.y[pointIndex] || 0));
        traces.push({
          type: 'scatter', mode: 'lines', name: entry.group, x: entry.x, y: [...boundary],
          customdata: entry.y, fill: 'tonexty', fillcolor: withAlpha(colors[index], 0.82),
          line: { color: colors[index], width: 1, shape: 'spline', smoothing: 1 },
          hovertemplate: `${selectedX}: %{x}<br>${entry.group}: %{customdata}<extra></extra>`
        });
      });
      return renderPlot(traces, { yaxis: { title: { text: metricKey === '__count__' ? 'Count' : metricKey }, showticklabels: false, zeroline: false, gridcolor: '#E2E8F0' } });
    }
    case 'rangeArea': {
      const points = plotRows.map((row, index) => {
        const first = toNumber(row?.[selectedY]);
        const second = toNumber(row?.[preferredZ]);
        if (first === null || second === null) return null;
        return {
          x: row?.[selectedX] ?? index + 1,
          lower: Math.min(first, second),
          upper: Math.max(first, second)
        };
      }).filter(Boolean);
      return renderPlot([
        {
          type: 'scatter', mode: 'lines', name: selectedY, x: points.map(({ x }) => x), y: points.map(({ lower }) => lower),
          line: { color: seriesColor, width: 1 }, hovertemplate: `${selectedY}: %{y}<extra></extra>`
        },
        {
          type: 'scatter', mode: 'lines', name: preferredZ, x: points.map(({ x }) => x), y: points.map(({ upper }) => upper),
          fill: 'tonexty', fillcolor: withAlpha(seriesColor, 0.25), line: { color: seriesColor, width: 2, shape: 'spline' },
          hovertemplate: `${preferredZ}: %{y}<extra></extra>`
        }
      ], { yaxis: { title: { text: `${selectedY} – ${preferredZ}` }, gridcolor: '#E2E8F0', zerolinecolor: '#CBD5E1' } });
    }
    case 'stackedBar': {
      const series = preparedStackedSeries || buildStackedSeries(plotRows, selectedX, preferredGroup, metricKey, aggregation, visibleItems, columnOverrides);
      const colors = resolveSeriesColors(seriesColor, series.length, palette);
      return renderPlot(series.map((entry, index) => ({
        type: 'bar', name: entry.group, x: entry.x, y: entry.y,
        marker: { color: colors[index], line: { color: '#FFFFFF', width: 1 } }
      })), { barmode: 'stack' });
    }
    case 'waterfall':
      return renderPlot([{
        type: 'waterfall', x: categoricalSeries.map(({ name }) => name), y: categoricalSeries.map(({ value }) => value),
        measure: categoricalSeries.map(() => 'relative'), connector: { line: { color: '#94A3B8' } },
        increasing: { marker: { color: seriesColor } }, decreasing: { marker: { color: seriesColor } }, totals: { marker: { color: seriesColor } }
      }]);
    case 'histogram':
      return renderPlot([{
        type: 'histogram', x: numericSeries(plotRows, selectedX).filter((value) => value !== null),
        marker: { color: seriesColor, line: { color: '#FFFFFF', width: 1 } }, name: selectedX
      }], { bargap: 0.04, yaxis: { title: { text: 'Count' }, gridcolor: '#E2E8F0' } });
    case 'box':
    case 'violin': {
      const buckets = new Map();
      for (const row of plotRows) {
        const group = selectedX ? String(dateGroupKey(row?.[selectedX], columnOverrides?.[selectedX]) ?? 'Unspecified') : 'All';
        const values = buckets.get(group) || [];
        values.push(toNumber(row?.[selectedY])); buckets.set(group, values);
      }
      const groups = [...buckets.keys()].slice(0, visibleItems);
      const colors = resolveSeriesColors(seriesColor, groups.length, palette);
      return renderPlot(groups.map((group, index) => {
        return {
          type: chartType, y: buckets.get(group), name: group,
          marker: { color: colors[index] }, line: { color: colors[index] },
          boxpoints: chartType === 'box' ? 'outliers' : undefined,
          points: chartType === 'violin' ? 'outliers' : undefined,
          box: chartType === 'violin' ? { visible: true } : undefined,
          meanline: chartType === 'violin' ? { visible: true } : undefined
        };
      }));
    }
    case 'strip': {
      const category = (row) => String(dateGroupKey(row?.[selectedX], columnOverrides?.[selectedX]) ?? 'All');
      const categories = [...new Set(plotRows.map(category))];
      const indexes = new Map(categories.map((category, index) => [category, index]));
      const colors = resolveSeriesColors(seriesColor, categories.length, palette);
      return renderPlot([{
        type: 'scatter', mode: 'markers',
        x: plotRows.map((row, index) => (indexes.get(category(row)) || 0) + (((index * 37) % 17) - 8) / 40),
        y: numericSeries(plotRows, selectedY), text: plotRows.map(category),
        marker: { color: plotRows.map((row) => colors[indexes.get(category(row)) || 0]), size: 7, opacity: 0.78 }, hovertemplate: '%{text}<br>%{y}<extra></extra>'
      }], { xaxis: { tickmode: 'array', tickvals: categories.map((_, index) => index), ticktext: categories, title: { text: selectedX || 'Group' } } });
    }
    case 'ecdf': {
      const sorted = numericSeries(plotRows, selectedX).filter((value) => value !== null).sort((left, right) => left - right);
      return renderPlot([{
        type: 'scatter', mode: 'lines', line: { color: seriesColor, width: 3, shape: 'hv' },
        x: sorted, y: sorted.map((_, index) => (index + 1) / sorted.length), name: selectedX
      }], { yaxis: { title: { text: 'Cumulative probability' }, tickformat: '.0%', range: [0, 1], gridcolor: '#E2E8F0' } });
    }
    case 'density':
      return renderPlot([{
        type: 'histogram2dcontour', x: numericSeries(plotRows, selectedX), y: numericSeries(plotRows, selectedY),
        colorscale: [[0, '#F8FAFC'], [1, seriesColor]], contours: { coloring: 'heatmap', showlabels: true },
        line: { color: seriesColor }, showscale: false
      }]);
    case 'bubble':
      return renderPlot([{
        type: 'scatter', mode: 'markers', x: numericSeries(plotRows, selectedX), y: numericSeries(plotRows, selectedY),
        marker: { color: seriesColor, size: scaleMarkerSizes(numericSeries(plotRows, preferredSize)), opacity: 0.7, line: { color: '#FFFFFF', width: 1 } },
        text: plotRows.map((row) => `${preferredSize}: ${row?.[preferredSize] ?? '—'}`),
        hovertemplate: `${selectedX}: %{x}<br>${selectedY}: %{y}<br>%{text}<extra></extra>`
      }]);
    case 'radar':
      return renderPlot([{
        type: 'scatterpolar', mode: 'lines+markers', fill: 'toself', theta: categoricalSeries.map(({ name }) => name),
        r: categoricalSeries.map(({ value }) => value), line: { color: seriesColor, width: 2 }, marker: { color: seriesColor },
        fillcolor: `${seriesColor}33`, name: metricKey === '__count__' ? 'Count' : metricKey
      }], { polar: { radialaxis: { visible: true, gridcolor: '#E2E8F0' } } });
    case 'polarScatter':
      return renderPlot([{
        type: 'scatterpolar', mode: 'markers', theta: plotRows.map((row) => row?.[selectedX]), r: numericSeries(plotRows, selectedY),
        marker: { color: resolveSeriesColors(seriesColor, plotRows.length, palette), size: 9, opacity: 0.8 }, name: selectedY
      }], { polar: { radialaxis: { visible: true, gridcolor: '#E2E8F0' } } });
    case 'radialBar':
      return renderPlot([{
        type: 'barpolar', theta: categoricalSeries.map(({ name }) => name), r: categoricalSeries.map(({ value }) => value),
        marker: { color: resolveSeriesColors(seriesColor, categoricalSeries.length, palette), line: { color: '#FFFFFF', width: 1 } }, opacity: 0.9,
        name: metricKey === '__count__' ? 'Count' : metricKey
      }], { polar: { radialaxis: { visible: true, gridcolor: '#E2E8F0' } } });
    case 'scatter3d':
      return renderPlot([{
        type: 'scatter3d', mode: 'markers', x: numericSeries(plotRows, selectedX), y: numericSeries(plotRows, selectedY),
        z: numericSeries(plotRows, preferredZ), marker: { color: seriesColor, size: 5, opacity: 0.78, line: { color: '#FFFFFF', width: 0.5 } },
        hovertemplate: `${selectedX}: %{x}<br>${selectedY}: %{y}<br>${preferredZ}: %{z}<extra></extra>`
      }], { scene: { xaxis: { title: selectedX }, yaxis: { title: selectedY }, zaxis: { title: preferredZ }, bgcolor: 'rgba(248,250,252,0.65)', aspectmode: 'cube', camera: { eye: { x: 1.45, y: 1.45, z: 1.2 } } } });
    case 'surface3d': {
      const grid = buildSurfaceGrid(plotRows, selectedX, selectedY, preferredZ);
      return renderPlot([{
        type: 'surface', x: grid.x, y: grid.y, z: grid.z, colorscale: [[0, '#F8FAFC'], [1, seriesColor]], showscale: false,
        contours: { z: { show: true, usecolormap: false, color: seriesColor, project: { z: true } } }
      }], { scene: { xaxis: { title: selectedX }, yaxis: { title: selectedY }, zaxis: { title: preferredZ }, aspectmode: 'cube', camera: { eye: { x: 1.45, y: 1.45, z: 1.2 } } } });
    }
    case 'mesh3d': {
      const points = buildSurfaceGrid(plotRows, selectedX, selectedY, preferredZ).points;
      return renderPlot([{
        type: 'mesh3d', x: points.map(({ x }) => x), y: points.map(({ y }) => y), z: points.map(({ z }) => z),
        color: seriesColor, opacity: 0.72, alphahull: 0
      }], { scene: { xaxis: { title: selectedX }, yaxis: { title: selectedY }, zaxis: { title: preferredZ }, aspectmode: 'cube', camera: { eye: { x: 1.45, y: 1.45, z: 1.2 } } } });
    }
    case 'bubble4d':
      return renderPlot([{
        type: 'scatter3d', mode: 'markers', x: numericSeries(plotRows, selectedX), y: numericSeries(plotRows, selectedY),
        z: numericSeries(plotRows, preferredZ),
        marker: { color: seriesColor, size: scaleMarkerSizes(numericSeries(plotRows, preferredSize), 3, 18), opacity: 0.7, line: { color: '#FFFFFF', width: 0.5 } },
        text: plotRows.map((row) => `${preferredSize}: ${row?.[preferredSize] ?? '—'}`),
        hovertemplate: `${selectedX}: %{x}<br>${selectedY}: %{y}<br>${preferredZ}: %{z}<br>%{text}<extra></extra>`
      }], { scene: { xaxis: { title: selectedX }, yaxis: { title: selectedY }, zaxis: { title: preferredZ }, aspectmode: 'cube', camera: { eye: { x: 1.45, y: 1.45, z: 1.2 } } } });
    case 'contour': {
      const grid = buildSurfaceGrid(plotRows, selectedX, selectedY, preferredZ);
      return renderPlot([{
        type: 'contour', x: grid.x, y: grid.y, z: grid.z, colorscale: [[0, '#F8FAFC'], [1, seriesColor]], showscale: true,
        contours: { coloring: 'heatmap', showlabels: true }, line: { color: seriesColor }
      }]);
    }
    case 'parallelCoordinates':
      return renderPlot([{
        type: 'parcoords', line: { color: seriesColor },
        dimensions: columnGroups.numeric.slice(0, 8).map((column) => ({ label: column, values: numericSeries(plotRows, column) }))
      }], { margin: { l: 64, r: 64, t: 28, b: 28 } });
    case 'candlestick':
      return renderPlot([{
        type: 'candlestick', x: plotRows.map((row, index) => row?.[selectedX] ?? index + 1),
        open: numericSeries(plotRows, preferredOpen), high: numericSeries(plotRows, preferredHigh),
        low: numericSeries(plotRows, preferredLow), close: numericSeries(plotRows, selectedY),
        increasing: { line: { color: seriesColor }, fillcolor: seriesColor },
        decreasing: { line: { color: seriesColor }, fillcolor: seriesColor }, name: 'OHLC'
      }], { xaxis: { title: { text: selectedX }, rangeslider: { visible: false }, gridcolor: '#E2E8F0' } });
    case 'sunburst': {
      const values = plotRows.map((row) => metricKey === '__count__' ? 1 : toNumber(row?.[metricKey]));
      const parentValues = new Map();
      plotRows.forEach((row, index) => {
        const parent = String(dateGroupKey(row?.[selectedX], columnOverrides?.[selectedX]) ?? 'Unspecified');
        if (!parentValues.has(parent)) parentValues.set(parent, null);
        if (values[index] !== null) parentValues.set(parent, (parentValues.get(parent) ?? 0) + values[index]);
      });
      const parentLabels = [...parentValues.keys()];
      const childLabels = plotRows.map((row) => String(dateGroupKey(row?.[preferredGroup], columnOverrides?.[preferredGroup]) ?? 'Unspecified'));
      const colors = resolveSeriesColors(seriesColor, parentLabels.length + childLabels.length, palette);
      return renderPlot([{
        type: 'sunburst',
        ids: [...parentLabels.map((parent) => `parent:${parent}`), ...plotRows.map((row, index) => `child:${String(dateGroupKey(row?.[selectedX], columnOverrides?.[selectedX]) ?? 'Unspecified')}:${childLabels[index]}:${index}`)],
        labels: [...parentLabels, ...childLabels],
        parents: [...parentLabels.map(() => ''), ...plotRows.map((row) => `parent:${String(dateGroupKey(row?.[selectedX], columnOverrides?.[selectedX]) ?? 'Unspecified')}`)],
        values: [...parentLabels.map((parent) => parentValues.get(parent)), ...values], branchvalues: 'total',
        marker: { colors }, insidetextorientation: 'radial'
      }], { margin: { l: 8, r: 8, t: 8, b: 8 } });
    }
    default:
      return null;
  }
}
