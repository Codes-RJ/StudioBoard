import { relationshipNeedsReview } from './datasetRelationships';
import { isQualityApproved } from './qualityReview';
import { addFinite } from './finiteArithmetic';
import { assertCalculationRole } from './analysisScope';
import { createExactMetric, compareExact, formatExact } from './exactDecimal';
import { assertMeasurePrecision } from './numberSemantics';

export const MAX_CROSS_DATASET_MATCHES = 250_000;
export const MAX_CROSS_DATASET_GROUPS = 10_000;
const keyValue = (value) => value === null || value === undefined || String(value).trim() === '' ? null : String(value).trim();
const tupleKey = (row, fields) => {
  const values = fields.map((field) => keyValue(row?.[field]));
  return values.some((value) => value === null) ? null : JSON.stringify(values);
};
const numericValue = (value) => value === null || value === undefined || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const parseField = (reference) => {
  const value = String(reference);
  const separator = value.indexOf('::');
  return separator < 0 ? [null, null] : [value.slice(0, separator), value.slice(separator + 2)];
};

/** Execute a bounded, deterministic inner join on one explicitly approved edge. */
export const analyzeApprovedRelationship = ({ datasets, relationship, metric = '__rows__', aggregation = 'count', dimension = '', filters = [], measureGrain = 'source' }) => {
  if (!relationship || relationship.status !== 'approved') throw new Error('Approve this relationship before using it.');
  if (relationshipNeedsReview(relationship, datasets)) throw new Error('A source changed. Review this relationship again before using it.');
  if (!['sum', 'average', 'count'].includes(aggregation)) throw new Error('Choose a supported aggregation.');
  if (metric === '__rows__' && aggregation !== 'count') throw new Error('Choose a numeric measure for sum or average.');
  if (!['source', 'joined'].includes(measureGrain)) throw new Error('Choose source rows or joined rows as the measure grain.');
  const left = datasets.find(({ id }) => id === relationship.leftDatasetId);
  const right = datasets.find(({ id }) => id === relationship.rightDatasetId);
  const hasColumn = (dataset, name) => (dataset?.columns || []).some((column) => (typeof column === 'string' ? column : column?.name) === name);
  const leftKeys = relationship.leftColumns || [relationship.leftColumn]; const rightKeys = relationship.rightColumns || [relationship.rightColumn];
  if (!left || !right || !leftKeys.length || leftKeys.length !== rightKeys.length || !leftKeys.every((field) => hasColumn(left, field)) || !rightKeys.every((field) => hasColumn(right, field))) throw new Error('A relationship source or key column is unavailable.');
  if ([left, right].some((source) => (source.isLocal || source.qualityReviewRequired) && !isQualityApproved(source))) {
    throw new Error('Review and save both source datasets before cross-source analysis.');
  }
  const fieldSource = (sourceId) => datasets.find(({ id }) => id === sourceId);
  const [metricSourceId, metricColumn] = metric === '__rows__' ? [null, null] : parseField(metric);
  const sourceMetricDataset = metricSourceId ? fieldSource(metricSourceId) : null;
  if (metric !== '__rows__' && (!sourceMetricDataset || ![left.id, right.id].includes(sourceMetricDataset.id) || !hasColumn(sourceMetricDataset, metricColumn))) throw new Error('Choose a measure from one of the related sources.');
  if (sourceMetricDataset) assertCalculationRole(sourceMetricDataset, metricColumn, aggregation !== 'count');
  const exact = sourceMetricDataset?.columnOverrides?.[metricColumn]?.precision === 'exact' && aggregation !== 'count';
  const [dimensionSourceId, dimensionColumn] = dimension ? parseField(dimension) : [null, null];
  const sourceDimensionDataset = dimensionSourceId ? fieldSource(dimensionSourceId) : null;
  if (dimension && (!sourceDimensionDataset || ![left.id, right.id].includes(sourceDimensionDataset.id) || !hasColumn(sourceDimensionDataset, dimensionColumn))) throw new Error('Choose a grouping field from one of the related sources.');
  for (const filter of filters) {
    const source = fieldSource(filter?.sourceDatasetId);
    if (![left.id, right.id].includes(source?.id) || !hasColumn(source, filter?.column)) throw new Error('A filter references a field outside the approved relationship.');
  }

  const rightByKey = new Map();
  for (const row of right.rawRows || []) {
    const key = tupleKey(row, rightKeys);
    if (key === null) continue;
    const bucket = rightByKey.get(key) || [];
    bucket.push(row);
    rightByKey.set(key, bucket);
  }
  const groups = new Map();
  let matchedRows = 0;
  let filteredRows = 0;
  let missingMeasureRows = 0;
  let missingDimensionRows = 0;
  let repeatedMeasureRows = 0;
  const seenMeasureRows = new Set();
  let estimate = 0;
  for (const row of left.rawRows || []) {
    const key = tupleKey(row, leftKeys);
    if (key === null) continue;
    estimate += rightByKey.get(key)?.length || 0;
    if (estimate > MAX_CROSS_DATASET_MATCHES) throw new Error(`This join would exceed the ${MAX_CROSS_DATASET_MATCHES.toLocaleString()} matched-row safety limit.`);
  }
  for (const leftRow of left.rawRows || []) {
    const key = tupleKey(leftRow, leftKeys);
    if (key === null) continue;
    for (const rightRow of rightByKey.get(key) || []) {
      const pair = { [left.id]: leftRow, [right.id]: rightRow };
      matchedRows += 1;
      if (filters.some(({ sourceDatasetId, column, value }) => keyValue(pair[sourceDatasetId]?.[column]) !== keyValue(value))) continue;
      filteredRows += 1;
      const groupValue = dimension ? keyValue(pair[dimensionSourceId]?.[dimensionColumn]) : 'All matching rows';
      if (dimension && groupValue === null) missingDimensionRows += 1;
      const group = groupValue;
      if (!groups.has(group) && groups.size >= MAX_CROSS_DATASET_GROUPS) {
        throw new Error(`This grouping would exceed the ${MAX_CROSS_DATASET_GROUPS.toLocaleString()} group safety limit. Choose a lower-cardinality field.`);
      }
      const entry = groups.get(group) || { group, rowCount: 0, metricCount: 0, sum: 0, exactMetric: exact ? createExactMetric(aggregation) : null };
      entry.rowCount += 1;
      if (metric !== '__rows__') {
        const rawValue = pair[metricSourceId]?.[metricColumn];
        if (aggregation !== 'count') assertMeasurePrecision(sourceMetricDataset, metricColumn, rawValue);
        const value = exact ? rawValue : aggregation === 'count' ? keyValue(rawValue) === null ? null : 1 : numericValue(rawValue);
        const valid = exact ? entry.exactMetric.consume(value) : value !== null;
        if (!valid) missingMeasureRows += 1;
        else {
          if (!exact) entry.sum = addFinite(entry.sum, value);
          entry.metricCount += 1;
          const measureRow = pair[metricSourceId];
          if (seenMeasureRows.has(measureRow)) {
            repeatedMeasureRows += 1;
            if (measureGrain === 'source') throw new Error('This join repeats measure rows. Choose a different key or explicitly select joined-row weighting to avoid silently double counting.');
          }
          else seenMeasureRows.add(measureRow);
        }
      }
      groups.set(group, entry);
    }
  }
  const results = [...groups.values()].map(({ group, rowCount, metricCount, sum, exactMetric }) => ({
    group: group ?? '(Missing)',
    ...(group === null ? { missingGroup: true } : {}),
    rowCount,
    value: metric === '__rows__' ? rowCount : aggregation === 'count' ? metricCount : exact ? exactMetric.result() : !metricCount ? null : aggregation === 'average' ? sum / metricCount : sum,
    metricCount,
  })).sort((a, b) => (a.value === null) - (b.value === null)
    || (a.value === null ? 0 : exact ? compareExact(b.value, a.value) : b.value - a.value) || a.group.localeCompare(b.group));
  if (exact) results.forEach((result) => { if (result.value !== null) result.value = formatExact(result.value); });
  const path = (dataset) => dataset.sourcePath || dataset.name;
  const warnings = [];
  if (relationship.leftUnmatchedRows || relationship.rightUnmatchedRows) warnings.push(`${relationship.leftUnmatchedRows.toLocaleString()} left and ${relationship.rightUnmatchedRows.toLocaleString()} right rows did not match and are excluded by this inner join.`);
  if (missingMeasureRows) warnings.push(`${missingMeasureRows.toLocaleString()} joined rows had a missing or nonnumeric measure and were excluded from the measure calculation.`);
  if (missingDimensionRows) warnings.push(`${missingDimensionRows.toLocaleString()} joined rows had a missing grouping value.`);
  if (repeatedMeasureRows) warnings.push(`${repeatedMeasureRows.toLocaleString()} joined rows repeat a measure from ${path(sourceMetricDataset)} because multiple records match its key. Sums and averages use joined-row weighting; these are not unique-source totals.`);
  if (relationship.cardinality === 'many-to-many') warnings.push('This approved relationship is many-to-many; repeated keys can multiply records.');
  return {
    aggregation,
    metric: metric === '__rows__' ? 'joined rows' : `${path(sourceMetricDataset)} · ${metricColumn}`,
    dimension: dimension ? `${path(sourceDimensionDataset)} · ${dimensionColumn}` : null,
    sources: [path(left), path(right)],
    relationship: `${relationship.leftColumn} ↔ ${relationship.rightColumn}`,
    matchedRows,
    filteredRows,
    measureGrain,
    results,
    filters: filters.map(({ sourceDatasetId, column, value }) => ({ source: path(fieldSource(sourceDatasetId)), column, value })),
    warnings,
  };
};
