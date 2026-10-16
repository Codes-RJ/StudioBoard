const MAX_SAMPLE_ROWS = 2_000;
const MAX_REVIEW_CANDIDATES = 30;
const MAX_SUGGESTIONS = 20;
const MAX_SAMPLE_CACHE_COLUMNS = 1_024;
const MAX_SAMPLE_CACHE_VALUES = 1_000_000;

const columnName = (column) => typeof column === 'string' ? column : column?.name;
const canonicalColumn = (name) => String(name || '')
  .replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]/g, '');
const baseColumn = (name) => canonicalColumn(name).replace(/(id|key)$/, '');
const normalizedValue = (value) => value === null || value === undefined || String(value).trim() === ''
  ? null : String(value).trim();
const sampleRows = (rows) => {
  if (rows.length <= MAX_SAMPLE_ROWS) return rows;
  const step = rows.length / MAX_SAMPLE_ROWS;
  return Array.from({ length: MAX_SAMPLE_ROWS }, (_, index) => rows[Math.floor(index * step)]);
};
const ratio = (numerator, denominator) => denominator ? numerator / denominator : 0;
const datasetLabel = (dataset) => `${dataset.sourcePath || dataset.name || 'Dataset'}${dataset.sheetName ? ` / ${dataset.sheetName}` : ''}`;

const matchedHeaderPairs = (left, right) => {
  const rightByName = new Map();
  for (const column of right.columns || []) {
    const name = columnName(column);
    if (!name) continue;
    for (const key of new Set([canonicalColumn(name), baseColumn(name)].filter((value) => value.length >= 3))) {
      const matches = rightByName.get(key) || [];
      matches.push(name);
      rightByName.set(key, matches);
    }
  }
  const pairs = new Map();
  for (const column of left.columns || []) {
    const leftName = columnName(column);
    if (!leftName) continue;
    const keys = new Set([canonicalColumn(leftName), baseColumn(leftName)].filter((value) => value.length >= 3));
    for (const key of keys) {
      for (const rightName of rightByName.get(key) || []) {
        const id = `${leftName}\u0000${rightName}`;
        pairs.set(id, { leftColumn: leftName, rightColumn: rightName, headerMatch: key === canonicalColumn(leftName) && key === canonicalColumn(rightName) ? 'same normalized name' : 'similar identifier name' });
      }
    }
  }
  return [...pairs.values()];
};

const countKeys = (rows, column) => {
  const counts = new Map();
  let missingRows = 0;
  for (const row of rows) {
    const values = (Array.isArray(column) ? column : [column]).map((field) => normalizedValue(row?.[field]));
    const key = values.some((value) => value === null) ? null : JSON.stringify(values);
    if (key === null) {
      missingRows += 1;
      continue;
    }
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return { counts, missingRows };
};

const sampleOverlap = (leftValues, rightValues) => {
  let matched = 0;
  for (const value of leftValues) if (rightValues.has(value)) matched += 1;
  return { matched, ratio: ratio(matched, Math.min(leftValues.size, rightValues.size)), sampledLeft: leftValues.size, sampledRight: rightValues.size };
};

const analyzeCandidate = (left, right, pair, overlap) => {
  const leftKeys = countKeys(left.rawRows || [], pair.leftColumns || pair.leftColumn);
  const rightKeys = countKeys(right.rawRows || [], pair.rightColumns || pair.rightColumn);
  let matchedDistinct = 0;
  let matchedLeftRows = 0;
  let matchedRightRows = 0;
  let innerJoinRows = 0;
  let leftUnmatchedRows = leftKeys.missingRows;
  let rightUnmatchedRows = rightKeys.missingRows;

  for (const [key, count] of leftKeys.counts) {
    const rightCount = rightKeys.counts.get(key) || 0;
    if (!rightCount) {
      leftUnmatchedRows += count;
      continue;
    }
    matchedDistinct += 1;
    matchedLeftRows += count;
    matchedRightRows += rightCount;
    innerJoinRows += count * rightCount;
  }
  for (const [key, count] of rightKeys.counts) {
    if (!leftKeys.counts.has(key)) rightUnmatchedRows += count;
  }

  const leftDistinct = leftKeys.counts.size;
  const rightDistinct = rightKeys.counts.size;
  const leftUnique = leftDistinct === (left.rawRows || []).length - leftKeys.missingRows;
  const rightUnique = rightDistinct === (right.rawRows || []).length - rightKeys.missingRows;
  const leftJoinRows = innerJoinRows + leftUnmatchedRows;
  const expansionRows = Math.max(0, leftJoinRows - (left.rawRows || []).length);
  const cardinality = leftUnique && rightUnique ? 'one-to-one'
    : rightUnique ? 'many-to-one'
      : leftUnique ? 'one-to-many' : 'many-to-many';
  const sharedRatio = ratio(matchedDistinct, Math.min(leftDistinct, rightDistinct));

  return {
    id: pair.leftColumns ? `manual:${JSON.stringify([left.id, pair.leftColumns, right.id, pair.rightColumns])}` : `${left.id}:${pair.leftColumn}->${right.id}:${pair.rightColumn}`,
    ...(pair.leftColumns ? { manual: true, leftColumns: pair.leftColumns, rightColumns: pair.rightColumns } : {}),
    leftDatasetId: left.id,
    leftLabel: datasetLabel(left),
    leftColumn: pair.leftColumn,
    rightDatasetId: right.id,
    rightLabel: datasetLabel(right),
    rightColumn: pair.rightColumn,
    headerMatch: pair.headerMatch,
    status: 'suggested',
    cardinality,
    leftUnique,
    rightUnique,
    leftRows: (left.rawRows || []).length,
    rightRows: (right.rawRows || []).length,
    leftDistinct,
    rightDistinct,
    matchedDistinct,
    sharedValueRatio: sharedRatio,
    leftUnmatchedRows,
    rightUnmatchedRows,
    matchedLeftRows,
    matchedRightRows,
    innerJoinRows,
    leftJoinRows,
    expansionRows,
    sample: { ...overlap, limit: MAX_SAMPLE_ROWS },
    leftUpdatedAt: left.updatedAt || null,
    rightUpdatedAt: right.updatedAt || null,
    evidence: [
      `Header candidate: ${pair.headerMatch}`,
      `${matchedDistinct.toLocaleString()} shared non-missing values across ${leftDistinct.toLocaleString()} and ${rightDistinct.toLocaleString()} distinct keys`,
      `Estimated left join: ${leftJoinRows.toLocaleString()} rows from ${left.rawRows.length.toLocaleString()} left rows`,
      `${leftUnmatchedRows.toLocaleString()} left rows and ${rightUnmatchedRows.toLocaleString()} right rows have no matching key`
    ]
  };
};

/** Exact, explicit key review; no header/suggestion cap applies to manual keys. */
export const reviewDatasetRelationship = ({ datasets, leftDatasetId, rightDatasetId, leftColumns, rightColumns }) => {
  const left = datasets.find((source) => source.id === leftDatasetId); const right = datasets.find((source) => source.id === rightDatasetId);
  if (!left?.rawRows || !right?.rawRows || left === right || left.isFolderOverview || right.isFolderOverview) throw new Error('Choose two source datasets.');
  if (!Array.isArray(leftColumns) || !Array.isArray(rightColumns) || !leftColumns.length || leftColumns.length > 6 || leftColumns.length !== rightColumns.length) throw new Error('Choose 1–6 matching key field pairs.');
  for (const [source, fields] of [[left, leftColumns], [right, rightColumns]]) {
    const declared = (source.columns || []).map(columnName);
    if (new Set(fields).size !== fields.length || fields.some((field) => !declared.includes(field))) throw new Error('Key fields must be distinct fields from the chosen source.');
  }
  return analyzeCandidate(left, right, { leftColumn: leftColumns.join(' + '), rightColumn: rightColumns.join(' + '), leftColumns, rightColumns,
    headerMatch: 'explicit user-selected key tuple' }, { sampledLeft: 0, sampledRight: 0, matched: 0, ratio: 0, method: 'complete key tuple counts; no sampling' });
};

/**
 * Discover local relationship candidates within one folder/workbook. Values are
 * never returned; estimates are exact over the loaded rows after a bounded
 * sample is used only to rank likely candidates.
 */
export const discoverDatasetRelationships = (datasets) => {
  const sources = (datasets || []).filter((dataset) => dataset?.id && !dataset.isFolderOverview && Array.isArray(dataset.rawRows));
  const candidates = [];
  // Reuse sampled columns across source pairs without retaining every column
  // of a wide folder. Full key counts are still checked only for the top 30.
  const sampleCache = new Map();
  let cachedValueCount = 0;
  const sampledValues = (source, column) => {
    const cacheKey = JSON.stringify([source.id, column]);
    let values = sampleCache.get(cacheKey);
    if (values) sampleCache.delete(cacheKey);
    else {
      values = new Set(sampleRows(source.rawRows).map((row) => normalizedValue(row?.[column])).filter((value) => value !== null));
      cachedValueCount += values.size;
    }
    sampleCache.set(cacheKey, values);
    while (sampleCache.size > MAX_SAMPLE_CACHE_COLUMNS || cachedValueCount > MAX_SAMPLE_CACHE_VALUES) {
      const oldestKey = sampleCache.keys().next().value;
      cachedValueCount -= sampleCache.get(oldestKey).size;
      sampleCache.delete(oldestKey);
    }
    return values;
  };
  const compareCandidates = (a, b) => b.rank - a.rank || datasetLabel(a.left).localeCompare(datasetLabel(b.left)) || a.pair.leftColumn.localeCompare(b.pair.leftColumn);
  for (let leftIndex = 0; leftIndex < sources.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sources.length; rightIndex += 1) {
      const left = sources[leftIndex];
      const right = sources[rightIndex];
      for (const pair of matchedHeaderPairs(left, right)) {
        const overlap = sampleOverlap(sampledValues(left, pair.leftColumn), sampledValues(right, pair.rightColumn));
        const candidate = { left, right, pair, overlap, rank: overlap.ratio + (pair.headerMatch === 'same normalized name' ? 1 : 0) };
        if (candidates.length === MAX_REVIEW_CANDIDATES && compareCandidates(candidate, candidates.at(-1)) >= 0) continue;
        candidates.push(candidate);
        candidates.sort(compareCandidates);
        if (candidates.length > MAX_REVIEW_CANDIDATES) candidates.pop();
      }
    }
  }
  return candidates
    .map(({ left, right, pair, overlap }) => analyzeCandidate(left, right, pair, overlap))
    .filter(({ matchedDistinct }) => matchedDistinct > 0)
    .sort((a, b) => b.sharedValueRatio - a.sharedValueRatio || a.leftLabel.localeCompare(b.leftLabel))
    .slice(0, MAX_SUGGESTIONS);
};

export const relationshipNeedsReview = (relationship, datasets) => {
  const left = datasets.find(({ id }) => id === relationship.leftDatasetId);
  const right = datasets.find(({ id }) => id === relationship.rightDatasetId);
  return Boolean(!left || !right || relationship.leftUpdatedAt !== (left.updatedAt || null)
    || relationship.rightUpdatedAt !== (right.updatedAt || null)
    || (relationship.leftRevisionKey && relationship.leftRevisionKey !== qualityRevisionKey(left))
    || (relationship.rightRevisionKey && relationship.rightRevisionKey !== qualityRevisionKey(right)));
};
import { qualityRevisionKey } from './qualityReview';
