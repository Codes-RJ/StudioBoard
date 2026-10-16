import { getDatasetColumnNames } from '../chartDataTransforms';
import { isQualityApproved, qualityRevisionKey, sourceRowIdentity, getCellProvenance } from '../qualityReview';
import { createScopeMatcher, createScopedMetricAccumulator, assertCalculationRole } from '../analysisScope';

export const EVIDENCE_VERSION = 3;
export const MAX_INDEXED_ROWS = 2_000;
export const assertReviewed = (dataset, { allowSavedMetadata = false } = {}) => {
  if (!(dataset?.rawRows?.length ?? dataset?.rowStorage?.streams?.rawRows?.length ?? (allowSavedMetadata && dataset?.metadataOnly && dataset.storageRevision ? dataset.rowCount : 0))) throw new Error('No local source rows are available.');
  if ((dataset.qualityReviewRequired || dataset.isLocal) && !isQualityApproved(dataset)
    && !(dataset.id === 'local_sample_saas' && !dataset.qualityReviewRequired)) throw new Error('Review and save this source before AI analysis.');
};
export const terms = (text) => String(text || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
const searchBoilerplate = new Set('a an the is are was were what which where how do does find search locate show list get row rows record records passage passages page document whose contain contains containing cite please tell me about of and or in to for that this with it'.split(' '));
const retrievalTerms = (text) => terms(text).filter((term) => !searchBoilerplate.has(term));
const needsRowEvidence = (query) => /\b(?:find|search|locate|which)\b[^.!?]*\b(?:rows?|records?|passages?|paragraphs?|pages?|documents?)\b/i.test(query);
export const hasExactRowClause = (query) => /\bexactly\s+(["'])(.*?)\1/iu.test(String(query));
export const exactRowCriteria = (query, columns) => {
  const clauses = [...String(query).matchAll(/\bexactly\s+(["'])(.*?)\1/giu)];
  if (!clauses.length) return [];
  const found = columns.flatMap((field) => {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [...String(query).matchAll(new RegExp(`\\b${escaped}\\s+exactly\\s+(["'])(.*?)\\1`, 'giu'))]
      .map((match) => ({ field, value: match[2] }));
  });
  return found.length === clauses.length ? found : [];
};
export const citationEvidence = ({ vector, tokens, contentTokens, ...record }) => record;
const clipped = (value) => String(value ?? '(missing)').slice(0, 300);

/** Search coverage is bounded and declared. Calculations never use indexed rows. */
export const createEvidenceIndexBuilder = (dataset, filters = {}) => {
  assertReviewed(dataset);
  const revision = qualityRevisionKey(dataset);
  const columns = getDatasetColumnNames(dataset);
  const sourceRows = dataset.rawRows?.length ?? dataset.rowStorage?.streams?.rawRows?.length;
  const matches = createScopeMatcher(filters);
  const base = { datasetId: dataset.id, revision, source: dataset.sourcePath || dataset.name || dataset.id, worksheet: dataset.sheetName || null };
  const records = [{ ...base, id: `${dataset.id}:schema`, kind: 'schema', fields: columns,
    text: `${base.source} ${base.worksheet || ''}. Fields: ${columns.join(', ')}. Source rows: ${sourceRows}.` }];
  for (const column of dataset.columns || []) {
    const name = typeof column === 'string' ? column : column.name;
    records.push({ ...base, id: `${dataset.id}:field:${name}`, kind: 'field', fields: [name],
      text: `${name}: ${typeof column === 'object' ? column.type || 'unknown' : 'unknown'}. Role: ${dataset.columnOverrides?.[name]?.role || column?.role || 'unspecified'}.` });
  }
  const numeric = (dataset.metrics?.columnGroups?.numeric || (dataset.columns || []).filter((c) => c.type === 'number').map((c) => c.name))
    .filter((field) => { try { assertCalculationRole(dataset, field); return true; } catch { return false; } });
  const summaries = numeric.slice(0, 10).map((metric) => ({ metric, accumulator: createScopedMetricAccumulator(dataset, { metric, aggregation: 'sum', filters }) }));
  const preview = []; let eligibleRows = 0; let indexedRows = 0;
  const stride = Math.max(1, Math.ceil(sourceRows / MAX_INDEXED_ROWS));
  const consume = (rows, { offset = 0, sourceRows: originals } = {}) => {
    for (const { accumulator } of summaries) accumulator.consume(rows, { sourceRows: originals });
    rows.forEach((row, localIndex) => {
      const index = offset + localIndex;
      if (!matches(row)) return;
      eligibleRows += 1;
      if (index % stride || indexedRows >= MAX_INDEXED_ROWS) return;
      indexedRows += 1;
      const fields = columns.slice(0, 30);
      preview.push({ ...base, id: `${dataset.id}:row:${index + 1}`, kind: 'row', fields,
        contentTokens: [...new Set(fields.flatMap((field) => terms(clipped(row?.[field]))))],
        rowIndex: index, sourceRowId: sourceRowIdentity(dataset, index),
        ...(dataset.document ? { documentPage: row.Page || null, documentBlock: row.Block } : {}),
        text: fields.map((field) => `${field}: ${clipped(row?.[field])}`).join('; ').slice(0, 2_000) });
    });
  };
  const finish = () => {
    const completed = [...records];
    for (const { metric, accumulator } of summaries) {
      const computation = accumulator.finish(sourceRows);
      completed.push({ ...base, id: `${dataset.id}:summary:${metric}`, kind: 'summary', fields: [metric], computation,
        text: `${metric} sum: ${computation.results[0]?.value ?? 'uncomputable'}. Eligible rows: ${computation.eligibleRows}; contributing: ${computation.contributingRows}; missing: ${computation.missingRows}.` });
    }
    completed.push(...preview);
    completed.forEach((record) => { record.tokens = [...new Set(terms(record.text))]; });
    return { version: EVIDENCE_VERSION, datasetId: dataset.id, revision, filters, records: completed,
      coverage: { sourceRows, eligibleRows, indexedRows, rowLimit: MAX_INDEXED_ROWS,
        indexedColumns: Math.min(columns.length, 30), totalColumns: columns.length,
        summaryColumns: Math.min(numeric.length, 10), totalNumericColumns: numeric.length, completeRows: indexedRows === eligibleRows,
        textClipped: true, calculations: 'complete eligible source rows' } };
  };
  return { consume, finish };
};

export const buildEvidenceIndex = (dataset, filters = {}) => {
  const builder = createEvidenceIndexBuilder(dataset, filters);
  builder.consume(dataset.rawRows, { sourceRows: dataset.sourceRows });
  return builder.finish();
};
export const assertCurrentIndex = (index, dataset, filters = {}) => {
  assertReviewed(dataset, { allowSavedMetadata: true });
  if (index?.version !== EVIDENCE_VERSION || index.revision !== qualityRevisionKey(dataset)
    || JSON.stringify(Object.entries(index.filters || {}).sort()) !== JSON.stringify(Object.entries(filters).sort())) throw new Error('Evidence index is stale. Rebuild it for this revision and scope.');
};
const cosine = (a, b) => {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
};
export const retrieveEvidence = (index, query, { limit = 6, queryVector = null } = {}) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new Error('Retrieval limit must be 1–12.');
  const queryTerms = new Set(retrievalTerms(query));
  const hits = index.records.map((record) => {
    const overlap = (record.contentTokens || record.tokens).filter((token) => queryTerms.has(token)).length;
    const lexical = overlap / Math.max(1, queryTerms.size);
    const semantic = cosine(queryVector, record.vector);
    return { ...record, score: lexical + Math.max(0, semantic) * 0.6, lexicalScore: lexical, semanticScore: semantic };
  }).filter((record) => (!needsRowEvidence(query) || record.kind === 'row') && (record.lexicalScore > 0 || record.semanticScore >= 0.35))
    .sort((a, b) => b.score - a.score).slice(0, limit);
  return { hits, coverage: index.coverage, revision: index.revision, semanticRecords: index.records.filter((r) => r.vector).length };
};

// Full source scan: retain only the best small set of rows, regardless of the
// stored preview's row/field/text limits. Imported strings are never executed.
export const createSourceEvidenceRetriever = (dataset, index, query, options = {}) => {
  assertCurrentIndex(index, dataset, index.filters);
  const limit = options.limit ?? 6; const columns = getDatasetColumnNames(dataset);
  const exact = exactRowCriteria(query, columns);
  const invalidExactCriteria = hasExactRowClause(query) && !exact.length;
  const initial = exact.length || invalidExactCriteria ? { hits: [], coverage: index.coverage, revision: index.revision, semanticRecords: 0 }
    : retrieveEvidence(index, query, { ...options, limit });
  const queryTerms = new Set(retrievalTerms(query));
  const headers = new Map(columns.map((field) => [field, terms(field).filter((term) => queryTerms.has(term))]));
  const winners = new Map(initial.hits.map((hit) => [hit.id, hit])); let eligibleRows = 0;
  const matches = createScopeMatcher(index.filters);
  const keep = (hit) => {
    if (!winners.has(hit.id) || winners.get(hit.id).score < hit.score) winners.set(hit.id, hit);
    if (winners.size > limit) winners.delete([...winners.values()].sort((a, b) => b.score - a.score).at(-1).id);
  };
  const consume = (rows, { offset = 0, sourceRows } = {}) => {
    const window = { ...dataset, rawRows: rows, sourceRows };
    for (const [localIndex, row] of rows.entries()) {
      const rowIndex = offset + localIndex;
      if (!matches(row)) continue;
      eligibleRows += 1;
      if (invalidExactCriteria) continue;
      if (exact.length) {
        if (!exact.every(({ field, value }) => String(row[field] ?? '').trim() === value.trim())) continue;
        const fields = [...new Set(exact.map(({ field }) => field))];
        keep({ id: `${dataset.id}:row:${rowIndex + 1}`, datasetId: dataset.id, kind: 'row', source: dataset.sourcePath || dataset.name,
          worksheet: dataset.sheetName || null, revision: index.revision, rowIndex, sourceRowId: sourceRowIdentity(dataset, rowIndex),
          fields, text: fields.map((field) => `${field}: ${clipped(row[field])}`).join('; '), score: 2, lexicalScore: 2, semanticScore: 0,
          ...(dataset.document ? { documentPage: row.Page || null, documentBlock: row.Block } : {}),
          transformedFields: fields.filter((field) => getCellProvenance(window, localIndex, field).steps.length) });
        continue;
      }
      const matched = new Set(); const positions = []; let contentMatches = 0;
      for (const field of columns) {
        headers.get(field).forEach((term) => matched.add(term));
        const text = String(row[field] ?? ''); const regex = /[\p{L}\p{N}_]+/gu; let token; let position = -1;
        while ((token = regex.exec(text))) {
          const overlap = terms(token[0]).filter((word) => queryTerms.has(word));
          if (overlap.length) { overlap.forEach((word) => matched.add(word)); if (position < 0) position = token.index; }
        }
        if (position >= 0) { positions.push({ field, text, position }); contentMatches += 1; }
        else if (headers.get(field).length) positions.push({ field, text, position: 0 });
      }
      if (!matched.size || !contentMatches) continue;
      const score = matched.size / Math.max(1, queryTerms.size) + (contentMatches ? 0.05 : 0);
      if (winners.size === limit && score <= Math.min(...[...winners.values()].map((hit) => hit.score))) continue;
      const snippets = positions.slice(0, 12).map(({ field, text, position }) => `${field}: ${text.slice(Math.max(0, position - 80), position + 220)}`);
      const fields = positions.slice(0, 12).map(({ field }) => field);
      keep({ id: `${dataset.id}:row:${rowIndex + 1}`, datasetId: dataset.id, kind: 'row', source: dataset.sourcePath || dataset.name, worksheet: dataset.sheetName || null,
        revision: index.revision, rowIndex, sourceRowId: sourceRowIdentity(dataset, rowIndex), fields, text: snippets.join('; ').slice(0, 2_000), score, lexicalScore: score, semanticScore: 0,
        ...(dataset.document ? { documentPage: row.Page || null, documentBlock: row.Block } : {}),
        transformedFields: fields.filter((field) => getCellProvenance(window, localIndex, field).steps.length) });
    }
  };
  const finish = () => ({ ...initial, exactMatch: exact.length > 0, invalidExactCriteria, hits: [...winners.values()].sort((a, b) => b.score - a.score),
    coverage: { ...index.coverage, storedIndexedRows: index.coverage.indexedRows, indexedRows: eligibleRows, indexedColumns: columns.length, completeRows: true,
      retrieval: 'complete eligible rows and fields scanned lexically; returned snippets are bounded', semanticCoverage: 'stored semantic records only' } });
  return { consume, finish };
};

export const retrieveSourceEvidence = (dataset, index, query, options = {}) => {
  const retriever = createSourceEvidenceRetriever(dataset, index, query, options);
  retriever.consume(dataset.rawRows, { sourceRows: dataset.sourceRows });
  return retriever.finish();
};
