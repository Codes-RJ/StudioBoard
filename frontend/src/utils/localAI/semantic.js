import { getDatasetColumnNames } from '../chartDataTransforms';
import { qualityRevisionKey, sourceRowIdentity, getCellProvenance } from '../qualityReview';
import { createScopeMatcher } from '../analysisScope';
import { assertReviewed, terms, retrieveEvidence } from './evidence';
export const SEMANTIC_VERSION = 2;
export const semanticKey = (dataset, filters = {}) => `semantic:${dataset.id}:${JSON.stringify(Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)))}`;

// Cursor-based packing covers complete cell text in bounded row/field chunks.
// The caller persists pages, and can resume without rebuilding completed pages.
export const buildSemanticPage = (dataset, cursor = { row: 0, column: 0, offset: 0 }, filters = {}, limit = 48,
  { rows = dataset.rawRows, sourceRows = dataset.sourceRows, rowOffset = 0, totalRows = dataset.rawRows?.length } = {}) => {
  assertReviewed(dataset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 64 || ['row', 'column', 'offset'].some((field) => !Number.isInteger(cursor[field]) || cursor[field] < 0)) throw new Error('Invalid semantic cursor or page limit.');
  const columns = getDatasetColumnNames(dataset); const next = { ...cursor }; const records = [];
  const matches = createScopeMatcher(filters);
  const window = { ...dataset, rawRows: rows, sourceRows };
  while (next.row < Math.min(totalRows, rowOffset + rows.length) && records.length < limit) {
    if (!matches(rows[next.row - rowOffset])) { next.row += 1; next.column = 0; next.offset = 0; continue; }
    const rowIndex = next.row; const start = { ...next }; const fields = []; const pieces = []; const spans = []; let size = 0;
    while (next.column < columns.length && size < 1_500) {
      const field = columns[next.column]; const value = rows[next.row - rowOffset]?.[field];
      const text = value == null ? '(missing)' : String(value); const prefix = `${field.slice(0, 120)}: `;
      const capacity = 1_600 - size - prefix.length - 2;
      if (capacity < 64 && pieces.length) break;
      const piece = text.slice(next.offset, next.offset + Math.max(64, capacity));
      spans.push({ field, start: next.offset, end: next.offset + piece.length, textStart: size + prefix.length, textEnd: size + prefix.length + piece.length });
      pieces.push(`${prefix}${piece}`); fields.push(field); size += prefix.length + piece.length + 2;
      next.offset += piece.length;
      if (next.offset >= text.length) { next.column += 1; next.offset = 0; }
      else break;
    }
    if (next.column >= columns.length) { next.row += 1; next.column = 0; next.offset = 0; }
    const text = pieces.join('; ');
      records.push({ id: `${dataset.id}:row:${rowIndex + 1}:chunk:${start.column}:${start.offset}`, kind: 'row', datasetId: dataset.id,
      source: dataset.sourcePath || dataset.name, worksheet: dataset.sheetName || null, revision: qualityRevisionKey(dataset), rowIndex,
      sourceRowId: sourceRowIdentity(dataset, rowIndex), fields, spans, text, tokens: [...new Set(terms(text))],
      ...(dataset.document ? { documentPage: rows[rowIndex - rowOffset].Page || null, documentBlock: rows[rowIndex - rowOffset].Block } : {}),
      contentTokens: [...new Set(spans.flatMap((span) => terms(text.slice(span.textStart, span.textEnd))))],
      transformedFields: fields.filter((field) => getCellProvenance(window, rowIndex - rowOffset, field).steps.length) });
  }
  return { records, cursor: next, completedRows: next.row, complete: next.row >= totalRows };
};
export const mergeSemanticHits = (left, right, limit = 6) => {
  const unique = new Map();
  for (const hit of [...left, ...right].sort((a, b) => b.score - a.score)) if (!unique.has(hit.id)) unique.set(hit.id, hit);
  return [...unique.values()].slice(0, limit);
};
export const rankSemanticArtifact = (artifact, query, options) => retrieveEvidence({ records: artifact.records, coverage: {}, revision: artifact.revision }, query, options).hits;
