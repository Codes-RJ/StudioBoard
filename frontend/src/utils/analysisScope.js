import { getDatasetColumnNames, toNumber } from './chartDataTransforms';
import { isIdentifierColumnName } from './graphConfiguration';
import { addFinite, multiplyFinite, finiteResult, midpointFinite } from './finiteArithmetic';
import { getCellProvenance } from './qualityReview';
import { createExactMetric, compareExact, formatExact } from './exactDecimal';
import { dateGroupKey } from './dateSemantics';
import { assertMeasurePrecision } from './numberSemantics';

export const assertCalculationRole = (dataset, field, numeric = true) => {
  if (!field || field === '__rows__') return;
  const declared = dataset.columns?.find((column) => column?.name === field);
  const role = dataset.columnOverrides?.[field]?.role || declared?.role || (isIdentifierColumnName(field) ? 'identifier' : '');
  if (role === 'ignore' || (numeric && role === 'identifier')) throw new Error(`Field ${field} is ${role}; review its role before numerical analysis.`);
};

// One dashboard scope rule for tables, charts, exports, reports and AI tools.
// Text filters are case-insensitive substring matches, including identifiers.
export const createScopeMatcher = (filters = {}) => {
  const active = Object.entries(filters).filter(([, value]) => value != null && String(value).trim() !== '')
    .map(([column, value]) => [column, String(value).trim().toLowerCase()]);
  return (row) => active.every(([column, value]) => row?.[column] != null && String(row[column]).toLowerCase().includes(value));
};
export const matchesScope = (row, filters = {}) => createScopeMatcher(filters)(row);
export const scopeRows = (rows = [], filters = {}) => rows.filter(createScopeMatcher(filters));
export const scopeDataset = (dataset, filters = {}) => {
  const rawRows = scopeRows(dataset?.rawRows, filters);
  return { ...dataset, rawRows, rowCount: rawRows.length, analysisScope: { filters, sourceRows: dataset?.rawRows?.length || 0, eligibleRows: rawRows.length } };
};

export const MAX_MEDIAN_VALUES = 250_000;

/** Full-scope accumulator; row pages can be released after each consume call. */
export const createScopedMetricAccumulator = (dataset, { metric = '__rows__', dimension = '', aggregation = 'sum', weight = '', limit = 20, filters = {} } = {}) => {
  const columns = getDatasetColumnNames(dataset);
  for (const field of [metric === '__rows__' ? '' : metric, dimension, weight, ...Object.keys(filters)].filter(Boolean)) {
    if (!columns.includes(field)) throw new Error(`Unknown field: ${field}`);
  }
  if (!['sum', 'average', 'median', 'min', 'max', 'count', 'weighted_average'].includes(aggregation)) throw new Error('Unsupported aggregation.');
  if (aggregation === 'weighted_average' && (!weight || metric === '__rows__')) throw new Error('Weighted average needs a measure and weight field.');
  assertCalculationRole(dataset, metric, aggregation !== 'count');
  assertCalculationRole(dataset, dimension, false);
  if (aggregation === 'weighted_average') assertCalculationRole(dataset, weight);
  if (metric === '__rows__') aggregation = 'count';
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Display limit must be between 1 and 100.');
  const groups = new Map();
  const exact = metric !== '__rows__' && aggregation !== 'count' && dataset.columnOverrides?.[metric]?.precision === 'exact';
  let eligibleRows = 0;
  let contributingRows = 0;
  let missingRows = 0;
  let imputedMeasureRows = 0; let imputedWeightRows = 0;
  let retainedValues = 0;
  const matches = createScopeMatcher(filters);
  const consume = (rows, { sourceRows } = {}) => {
    const window = { ...dataset, rawRows: rows, sourceRows };
    const wasImputed = (index, field) => dataset.cleaningLog?.length && getCellProvenance(window, index, field).steps.some((step) =>
      (step.before == null || (typeof step.before === 'string' && !step.before.trim())) && step.after != null && String(step.after).trim() !== '');
    for (const [rowIndex, row] of rows.entries()) {
      if (!matches(row)) continue;
      eligibleRows += 1;
      const key = dimension ? dateGroupKey(row?.[dimension], dataset.columnOverrides?.[dimension]) : 'All rows';
      if (!groups.has(key)) {
        if (groups.size >= 10_000) throw new Error('Grouping exceeds the 10,000-group safety limit.');
        groups.set(key, { exactMetric: exact ? createExactMetric(aggregation) : null, values: aggregation === 'median' ? [] : null, count: 0, sum: 0, mean: 0, min: Infinity, max: -Infinity, rowCount: 0, numerator: 0, denominator: 0 });
      }
      const group = groups.get(key);
      group.rowCount += 1;
      const value = metric === '__rows__' ? 1 : row?.[metric];
      if (metric !== '__rows__' && aggregation !== 'count') assertMeasurePrecision(dataset, metric, value);
      if (weight) assertMeasurePrecision(dataset, weight, row?.[weight]);
      if (exact) {
        if (!group.exactMetric.consume(value, row?.[weight])) { missingRows++; continue; }
        if (aggregation === 'median' && ++retainedValues > MAX_MEDIAN_VALUES) throw new Error('Exact median exceeds 250,000 contributing values across groups.');
        contributingRows++; group.count++;
        if (wasImputed(rowIndex, metric)) imputedMeasureRows++;
        if (weight && wasImputed(rowIndex, weight)) imputedWeightRows++;
        continue;
      }
      const number = toNumber(value);
      const coefficient = weight ? toNumber(row?.[weight]) : null;
      const valid = aggregation === 'count' ? value != null && String(value).trim() !== '' : number !== null;
      if (!valid || (aggregation === 'weighted_average' && (coefficient === null || coefficient < 0))) { missingRows += 1; continue; }
      contributingRows += 1;
      if (metric !== '__rows__' && wasImputed(rowIndex, metric)) imputedMeasureRows += 1;
      if (aggregation === 'weighted_average' && wasImputed(rowIndex, weight)) imputedWeightRows += 1;
      if (aggregation === 'weighted_average') {
        group.numerator = addFinite(group.numerator, multiplyFinite(number, coefficient));
        group.denominator = addFinite(group.denominator, coefficient);
      } else {
        group.count += 1;
        if (aggregation === 'sum') group.sum = addFinite(group.sum, number);
        if (aggregation === 'average') {
          group.sum += number;
          // Preserve the ordinary sum/count result; this bounded fallback also
          // supports finite means whose intermediate sum exceeds Number range.
          group.mean = addFinite(group.mean * ((group.count - 1) / group.count), number / group.count);
        }
        if (aggregation === 'min') group.min = Math.min(group.min, number);
        if (aggregation === 'max') group.max = Math.max(group.max, number);
        if (aggregation === 'median') {
          if (retainedValues >= MAX_MEDIAN_VALUES) throw new Error(`Exact median exceeds the ${MAX_MEDIAN_VALUES.toLocaleString('en-US')}-value working-memory limit. Narrow the filters before calculating; no sampled result was returned.`);
          group.values.push(number); retainedValues += 1;
        }
      }
    }
  };
  const finish = (sourceRows = dataset.rawRows?.length ?? dataset.rowStorage?.streams?.rawRows?.length ?? dataset.rowCount ?? 0) => {
    const valueOf = (entry) => {
      if (exact) return entry.exactMetric.result();
      if (aggregation === 'weighted_average') return entry.denominator === 0 ? null : finiteResult(entry.numerator / entry.denominator, 'weighted average');
      if (aggregation === 'count') return entry.count;
      if (!entry.count) return null;
      if (aggregation === 'sum') return entry.sum;
      if (aggregation === 'average') return Number.isFinite(entry.sum) ? entry.sum / entry.count : entry.mean;
      if (aggregation === 'min') return entry.min;
      if (aggregation === 'max') return entry.max;
      entry.values.sort((a, b) => a - b);
      const middle = Math.floor(entry.count / 2);
      return entry.count % 2 ? entry.values[middle] : midpointFinite(entry.values[middle - 1], entry.values[middle]);
    };
    const results = [...groups].map(([group, entry]) => ({ group, rowCount: entry.rowCount, value: valueOf(entry) }));
    results.sort((a, b) => (a.value === null) - (b.value === null) || (a.value === null ? 0 : exact ? compareExact(b.value, a.value) : b.value - a.value));
    if (exact) results.forEach((result) => { result.value = result.value === null ? null : formatExact(result.value); });
    return { datasetId: dataset.id, metric, dimension, aggregation, weight, filters, sourceRows,
      eligibleRows, contributingRows, missingRows, imputedMeasureRows, imputedWeightRows, totalGroups: results.length, displayedGroups: Math.min(limit, results.length), results: results.slice(0, limit),
      unit: dataset.columnOverrides?.[metric]?.unit || null,
      precision: exact ? 'exact decimal/rational strings; repeating fractions are unrounded' : 'IEEE-754; presentation rounding only', scope: 'complete eligible source rows' };
  };
  return { consume, finish };
};

/** In-memory callers share exactly the same scope/aggregation implementation. */
export const computeScopedMetric = (dataset, options) => {
  if (!Array.isArray(dataset.rawRows)) throw new Error('Load working rows or use the saved-source calculation worker.');
  const accumulator = createScopedMetricAccumulator(dataset, options);
  accumulator.consume(dataset.rawRows || [], { sourceRows: dataset.sourceRows });
  return accumulator.finish();
};
