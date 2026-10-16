import { scanWorkerDatasetRows } from './datasetWorkerReader';
import { buildAdvancedPlot } from './advancedChartData';
import { createRunningMetric } from './chartDataTransforms';
import { createScopeMatcher } from './analysisScope';
import { dateGroupKey } from './dateSemantics';

export const ADVANCED_CHART_LIMITS = Object.freeze({ rows: 250_000, bytes: 32 * 1024 * 1024 });
const fullTypes = new Set(['stackedBar', 'multiSpline', 'streamgraph', 'histogram', 'box', 'violin', 'ecdf', 'density', 'sunburst']);
const stackedTypes = new Set(['stackedBar', 'multiSpline', 'streamgraph']);
export const computeAdvancedChartPayload = async (payload, { signal, onProgress, scan = scanWorkerDatasetRows, limits = ADVANCED_CHART_LIMITS } = {}) => {
  const reference = payload.rows;
  if (reference?.kind !== 'local-dataset-reference') return buildAdvancedPlot(payload);
  if (reference.field !== 'rawRows') throw new Error('A chart requires working source rows.');
  if (!Number.isSafeInteger(payload.visibleItems) || payload.visibleItems < 1 || payload.visibleItems > 100) throw new Error('Chart display limit must be 1–100.');
  const aggregation = payload.metricKey === '__count__' ? 'count' : payload.aggregation;
  const runningStacked = stackedTypes.has(payload.chartType) && ['sum', 'average', 'min', 'max', 'count'].includes(aggregation);
  const fields = [...new Set([payload.selectedX, payload.selectedY, payload.preferredZ, payload.preferredSize, payload.preferredGroup,
    payload.preferredOpen, payload.preferredHigh, payload.preferredLow, payload.metricKey,
    ...(payload.chartType === 'parallelCoordinates' ? payload.columnGroups?.numeric?.slice(0, 8) || [] : [])].filter((field) => field && field !== '__count__'))];
  const pointLimit = ['surface3d', 'mesh3d', 'contour'].includes(payload.chartType) ? 2500 : Math.max(500, payload.visibleItems * 50);
  const retainedLimit = fullTypes.has(payload.chartType) ? limits.rows : pointLimit;
  const rows = []; const categories = new Set(); const groups = new Set(); const buckets = new Map(); let bytes = 0; let sourceRowCount = 0;
  const matches = createScopeMatcher(payload.filters);
  await scan(reference.id, (page, info) => {
    for (const row of page) {
      if (!matches(row)) continue;
      sourceRowCount++;
      if (runningStacked) {
        const overrides = payload.columnOverrides || info.header?.columnOverrides;
        const category = String(dateGroupKey(row?.[payload.selectedX], overrides?.[payload.selectedX]) ?? 'Unspecified'); const group = String(dateGroupKey(row?.[payload.preferredGroup], overrides?.[payload.preferredGroup]) ?? 'Unspecified');
        if (categories.size < payload.visibleItems) categories.add(category);
        if (groups.size < 12) groups.add(group);
        if (!categories.has(category) || !groups.has(group)) continue;
        const key = JSON.stringify([group, category]);
        if (!buckets.has(key)) {
          bytes += key.length * 2;
          if (bytes > limits.bytes) throw new Error('This exact chart exceeds its text memory limit. Narrow its scope.');
          buckets.set(key, createRunningMetric(aggregation));
        }
        buckets.get(key).consume(payload.metricKey === '__count__' ? 1 : row?.[payload.metricKey]);
      } else if (fullTypes.has(payload.chartType) || rows.length < retainedLimit) {
        if (rows.length >= retainedLimit) throw new Error('This exact chart exceeds its 250,000-row memory policy. Narrow its scope; no sampling was applied.');
        const projected = Object.fromEntries(fields.map((field) => [field, row?.[field]]));
        bytes += JSON.stringify(projected).length * 2;
        if (bytes > limits.bytes) throw new Error('This chart exceeds its text memory limit. Narrow its scope.');
        rows.push(projected);
      }
    }
  }, { signal, onProgress, expectedRevision: reference.revision, expectedStorageRevision: reference.storageRevision });
  const preparedStackedSeries = runningStacked ? [...groups].map((group) => ({ group, x: [...categories],
    y: [...categories].map((category) => buckets.get(JSON.stringify([group, category]))?.finish() ?? (aggregation === 'count' ? 0 : null)) })) : undefined;
  return buildAdvancedPlot({ ...payload, rows, sourceRowCount, preparedStackedSeries });
};
