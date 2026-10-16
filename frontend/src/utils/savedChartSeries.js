import { scanWorkerDatasetRows } from './datasetWorkerReader';
import { createRunningMetric, toNumber } from './chartDataTransforms';
import { CHART_TYPE_VALUES } from './chartTypes';
import { computeChartSeries } from './chartComputation';
import { createScopeMatcher } from './analysisScope';
import { dateGroupKey } from './dateSemantics';

const chartTypes = new Set(CHART_TYPE_VALUES.filter((type) => !['heatmap', 'correlationHeatmap', 'sankey'].includes(type)));
export const canScanChartSeries = (payload) => payload?.rows?.kind === 'local-dataset-reference' && payload.rows.field === 'rawRows'
  && chartTypes.has(payload.chartType) && ['sum', 'average', 'min', 'max', 'count'].includes(payload.aggregation)
  && Number.isSafeInteger(payload.visibleItems) && payload.visibleItems > 0 && payload.visibleItems <= 100;

export const computeSavedChartSeries = async (payload, { signal, onProgress, scan = scanWorkerDatasetRows } = {}) => {
  if (!canScanChartSeries(payload)) throw new Error('This chart scope requires the existing calculation path.');
  const { rows: reference, selectedX, metricKey, visibleItems } = payload;
  const aggregation = metricKey === '__count__' ? 'count' : payload.aggregation;
  const groups = new Map(); const metric = createRunningMetric(aggregation); const preview = [];
  const metricRange = { min: null, max: null };
  const matches = createScopeMatcher(payload.filters); let eligiblePosition = 0;
  await scan(reference.id, (rows, { header }) => {
    for (const row of rows) {
      if (!matches(row)) continue;
      const position = eligiblePosition++;
      const value = metricKey === '__count__' ? 1 : row?.[metricKey]; metric.consume(value);
      const number = toNumber(row?.[metricKey]);
      if (number !== null) { metricRange.min = Math.min(metricRange.min ?? number, number); metricRange.max = Math.max(metricRange.max ?? number, number); }
      if (selectedX) {
        const raw = dateGroupKey(row?.[selectedX], payload.columnOverrides?.[selectedX] || header?.columnOverrides?.[selectedX]); const key = raw == null || raw === '' ? 'Unspecified' : String(raw);
        if (!groups.has(key)) {
          if (groups.size >= 10_000) throw new Error('Chart grouping exceeds the 10,000-group working-memory limit. Narrow the chart scope before calculating.');
          groups.set(key, createRunningMetric(aggregation));
        }
        groups.get(key).consume(value);
      } else if (position < visibleItems) {
        const y = metricKey === '__count__' ? position + 1 : number;
        if (y !== null) preview.push({ x: `Row ${position + 1}`, y });
      }
    }
  }, { signal, onProgress, expectedRevision: reference.revision, expectedStorageRevision: reference.storageRevision });
  const entries = [...groups].map(([name, group]) => ({ name, value: group.finish() }));
  const categoricalSeries = [...entries].sort((left, right) => (left.value === null) - (right.value === null) || right.value - left.value).slice(0, visibleItems);
  if (entries.every(({ name }) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(name) && Number.isFinite(Date.parse(name)))) entries.sort((left, right) => Date.parse(left.name) - Date.parse(right.name));
  return { categoricalSeries, trendSeries: selectedX ? entries.slice(0, visibleItems).map(({ name, value }) => ({ x: name, y: value })) : preview,
    heatmapMatrix: [], sankeyData: null, metricValue: metric.finish(), metricRange };
};

export const computeChartSeriesPayload = async (payload, options = {}) => {
  if (canScanChartSeries(payload)) return computeSavedChartSeries(payload, options);
  const reference = payload.rows;
  if (reference?.kind !== 'local-dataset-reference') return computeChartSeries(payload);
  if (reference.field !== 'rawRows') throw new Error('Charts require working source rows.');
  const rows = []; let bytes = 0;
  const matches = createScopeMatcher(payload.filters);
  const fields = [...new Set([payload.selectedX, payload.metricKey, ...(payload.heatmapColumns || [])].filter((field) => field && field !== '__count__'))];
  await (options.scan || scanWorkerDatasetRows)(reference.id, (page) => {
    for (const row of page) {
      if (!matches(row)) continue;
      if (rows.length >= 250_000) throw new Error('This exact chart exceeds its 250,000-row memory policy. Narrow its scope; no sampling was applied.');
      const projected = Object.fromEntries(fields.map((field) => [field, row?.[field]])); bytes += JSON.stringify(projected).length * 2;
      if (bytes > 32 * 1024 * 1024) throw new Error('This exact chart exceeds its text memory limit. Narrow its scope.');
      rows.push(projected);
    }
  }, { signal: options.signal, onProgress: options.onProgress, expectedRevision: reference.revision, expectedStorageRevision: reference.storageRevision });
  return computeChartSeries({ ...payload, rows });
};
