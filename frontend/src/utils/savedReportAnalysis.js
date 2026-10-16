import { scanWorkerDatasetRows } from './datasetWorkerReader';
import { createScopeMatcher, scopeDataset } from './analysisScope';
import { analyzeReportDataset, createReportInsightsAccumulator } from './reportAnalysis';
import { computeNumericColumnStats } from './dataCleaner';
import { createExactMetric, formatExact } from './exactDecimal';

// Exact report operations retain some state. These are working-memory policies,
// not supported-device limits or measurements of actual JavaScript heap bytes.
export const REPORT_MEMORY_LIMITS = Object.freeze({ signatures: 250_000, trend: 250_000, numbers: 250_000, groups: 100_000, bytes: 32 * 1024 * 1024 });
const missing = (value) => value == null || (typeof value === 'string' && !value.trim());
const numericLike = (value) => typeof value === 'number' ? Number.isFinite(value)
  : typeof value === 'string' && Boolean(value.trim()) && Number.isFinite(Number(value));
const createBudget = (limits) => {
  const usage = { signatures: 0, trend: 0, numbers: 0, groups: 0, bytes: 0 };
  return (kind, count, bytes = 0) => {
    usage[kind] += count; usage.bytes += bytes;
    if (usage[kind] > limits[kind] || usage.bytes > limits.bytes) throw new Error(`Exact report ${kind} exceeds its working-memory limit. Narrow the report filters before retrying; no sampled result was produced.`);
  };
};

export const computeReportAnalysisPayload = async ({ dataset, filters = {} }, { signal, onProgress, scan = scanWorkerDatasetRows, limits = REPORT_MEMORY_LIMITS } = {}) => {
  if (dataset?.kind !== 'local-dataset-reference') {
    const scoped = scopeDataset(dataset, filters);
    return { ...analyzeReportDataset(scoped), analysisScope: scoped.analysisScope };
  }
  if (dataset.field) throw new Error('Report analysis requires a dataset reference.');
  const matches = createScopeMatcher(filters);
  const reserve = createBudget(limits);
  let header; let columns; let states; let insights; let quality; let sourceRows;
  const signatures = new Set();
  const scanOptions = (phase) => ({ signal, expectedRevision: dataset.revision, expectedStorageRevision: dataset.storageRevision,
    onProgress: (progress) => onProgress?.({ ...progress, phase }) });
  await scan(dataset.id, (rows, info) => {
    if (!header) {
      header = info.header; sourceRows = info.total;
      columns = (header.columns || []).map((column) => typeof column === 'string' ? column : column?.name).filter(Boolean);
      states = new Map(columns.map((column) => [column, { populated: 0, numeric: 0, numericLike: 0, distinct: new Set(), missing: 0 }]));
      insights = createReportInsightsAccumulator(header, reserve);
      quality = { totalRows: 0, totalColumns: columns.length, missingCells: 0, missingByColumn: {}, duplicateRows: 0, emptyRows: 0,
        whitespaceCells: 0, mixedTypeColumns: [], constantColumns: [], emptyColumns: [] };
    }
    for (const row of rows) {
      if (!matches(row)) continue;
      quality.totalRows += 1;
      const signature = JSON.stringify(columns.map((column) => row?.[column] ?? null));
      if (signatures.has(signature)) quality.duplicateRows += 1;
      else { reserve('signatures', 1, signature.length * 2); signatures.add(signature); }
      let empty = true;
      for (const [column, state] of states) {
        const value = row?.[column];
        if (missing(value)) { state.missing += 1; quality.missingCells += 1; continue; }
        empty = false; state.populated += 1;
        if (Number.isFinite(Number(value))) state.numeric += 1;
        if (numericLike(value)) state.numericLike += 1;
        if (typeof value === 'string' && value !== value.trim()) quality.whitespaceCells += 1;
        if (state.distinct.size < 2) {
          const text = String(value);
          if (!state.distinct.has(text)) { reserve('groups', 1, text.length * 2); state.distinct.add(text); }
        }
      }
      if (empty) quality.emptyRows += 1;
      insights.consume([row]);
    }
  }, scanOptions('quality'));
  signatures.clear();
  quality.missingByColumn = Object.fromEntries([...states].map(([column, state]) => [column, state.missing]));
  const stats = Object.create(null);
  for (const [column, state] of states) {
    if (state.populated && state.numericLike > 0 && state.numericLike / state.populated < 0.95) quality.mixedTypeColumns.push(column);
    if (state.populated > 1 && state.distinct.size <= 1) quality.constantColumns.push(column);
    if (!state.populated) quality.emptyColumns.push(column);
    state.distinct.clear();
    state.kind = header.columnOverrides?.[column]?.precision === 'exact' ? 'exact' : !state.populated ? 'empty' : state.numeric / state.populated >= 0.7 ? 'number' : 'category';
    if (state.kind === 'exact') state.exact = Object.fromEntries(['sum', 'average', 'median', 'min', 'max'].map((kind) => [kind, createExactMetric(kind)]));
    if (state.kind === 'number') state.values = [];
    if (state.kind === 'category') state.frequencies = new Map();
  }
  quality.totalIssues = quality.missingCells + quality.duplicateRows + quality.emptyRows + quality.whitespaceCells
    + quality.mixedTypeColumns.length + quality.constantColumns.length + quality.emptyColumns.length;
  quality.qualityScore = Math.max(0, Math.min(100, Math.round(100 - quality.totalIssues / Math.max(1, quality.totalRows * columns.length) * 500)));
  quality.hasIssues = quality.totalIssues > 0;
  // Release signatures and trend projections before collecting exact statistics.
  const completedInsights = insights.finish(); insights = null;
  const reserveStats = createBudget(limits);
  await scan(dataset.id, (rows) => {
    for (const row of rows) {
      if (!matches(row)) continue;
      for (const [column, state] of states) {
        const value = row?.[column];
        if (missing(value)) continue;
        if (state.kind === 'exact') {
          reserveStats('numbers', 1, String(value).length * 2 + 32);
          Object.values(state.exact).forEach((metric) => metric.consume(value));
        } else if (state.kind === 'number') {
          const number = Number(value);
          if (Number.isFinite(number)) { reserveStats('numbers', 1, 8); state.values.push(number); }
        } else if (state.kind === 'category') {
          const text = String(value);
          if (!state.frequencies.has(text)) reserveStats('groups', 1, text.length * 2);
          state.frequencies.set(text, (state.frequencies.get(text) || 0) + 1);
        }
      }
    }
  }, scanOptions('statistics'));
  for (const [column, state] of states) {
    if (state.kind === 'exact') stats[column] = { type: 'exact', count: state.populated, missing: state.missing,
      ...Object.fromEntries(Object.entries(state.exact).map(([kind, metric]) => { const value = metric.result(); return [kind === 'average' ? 'mean' : kind, value ? formatExact(value) : null]; })) };
    else if (state.kind === 'empty') stats[column] = { type: 'empty', missing: quality.totalRows, unique: 0 };
    else if (state.kind === 'number') stats[column] = computeNumericColumnStats(state.values, quality.totalRows - state.numeric);
    else stats[column] = { type: 'category', count: state.populated, missing: state.missing, unique: state.frequencies.size,
      top: [...state.frequencies].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([value, count]) => ({ value, count })) };
  }
  return { columns, quality, stats, insights: completedInsights, analysisScope: { filters, sourceRows, eligibleRows: quality.totalRows } };
};
