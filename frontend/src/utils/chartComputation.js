import { aggregateMetricValues, buildCategoricalSeries, buildTrendSeries, buildHeatmapMatrix, buildSankeyData, toNumber } from './chartDataTransforms';
import { dateGroupKey } from './dateSemantics';
export const computeChartSeries = ({ rows, selectedX, metricKey, aggregation, visibleItems, heatmapColumns = [], chartType, columnOverrides }) => ({
  categoricalSeries: buildCategoricalSeries(rows, selectedX, metricKey, aggregation, visibleItems, (value) => dateGroupKey(value, columnOverrides?.[selectedX])),
  trendSeries: buildTrendSeries(rows, selectedX, metricKey, aggregation, visibleItems, (value) => dateGroupKey(value, columnOverrides?.[selectedX])),
  heatmapMatrix: chartType === 'heatmap' || chartType === 'correlationHeatmap' ? buildHeatmapMatrix(rows, heatmapColumns) : [],
  sankeyData: chartType === 'sankey' ? buildSankeyData(rows, selectedX, metricKey, visibleItems) : null,
  metricValue: aggregateMetricValues(rows.map((row) => metricKey === '__count__' ? 1 : row?.[metricKey]), metricKey === '__count__' ? 'count' : aggregation),
  metricRange: rows.reduce((range, row) => {
    const value = toNumber(row?.[metricKey]);
    if (value !== null) { range.min = Math.min(range.min ?? value, value); range.max = Math.max(range.max ?? value, value); }
    return range;
  }, { min: null, max: null })
});
