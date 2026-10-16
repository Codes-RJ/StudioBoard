import { withWorkerDatabase, readDatasetHeader, readDatasetRowPage } from '../datasetWorkerReader';
import { qualityRevisionKey, sourceRowIdentity } from '../qualityReview';
import { getDatasetColumnNames } from '../chartDataTransforms';
import { isIdentifierColumnName } from '../graphConfiguration';
import { assertReviewed, terms } from './evidence';
import { ROW_CHUNK_SIZE } from '../datasetRowStorage';
export const ENTITY_VERSION = 1;
export const entityFields = (dataset) => getDatasetColumnNames(dataset).filter((field) => {
  const role = dataset.columnOverrides?.[field]?.role || dataset.columns.find((column) => column?.name === field)?.role;
  return role === 'identifier' || (!role && isIdentifierColumnName(field));
}).slice(0, 16);
export const entityKey = (dataset) => `entities:${dataset.id}`;
export const buildEntityPage = (dataset, cursor = { row: 0, column: 0 }, { rows = dataset.rawRows, rowOffset = 0, totalRows = rows.length } = {}) => {
  assertReviewed(dataset); const fields = entityFields(dataset); const records = []; const next = { ...cursor };
  if (!Number.isInteger(next.row) || next.row < rowOffset || !Number.isInteger(next.column) || next.column < 0 || next.column >= Math.max(1, fields.length)) throw new Error('Invalid entity cursor.');
  if (!fields.length) throw new Error('Review an identifier field in Data Health before building the entity index.');
  while (next.row < Math.min(totalRows, rowOffset + rows.length) && records.length < 64) {
    const field = fields[next.column]; const rowIndex = next.row; const value = rows[rowIndex - rowOffset]?.[field];
    next.column++; if (next.column >= fields.length) { next.column = 0; next.row++; }
    if (value == null || String(value).trim() === '') continue;
    if (String(value).length > 64_000) throw new Error('An entity value exceeds 64,000 characters. Use document/text retrieval for prose fields.');
    const text = `${field}: ${String(value).slice(0, 1500)}`;
    records.push({ id: `${dataset.id}:entity:${rowIndex + 1}:${field}`, kind: 'entity', datasetId: dataset.id,
      revision: qualityRevisionKey(dataset), source: dataset.sourcePath || dataset.name, worksheet: dataset.sheetName || null,
      rowIndex, sourceRowId: sourceRowIdentity(dataset, rowIndex), fields: [field], value: String(value), text, tokens: [...new Set(terms(String(value)))] });
  }
  return { records, cursor: next, completedRows: next.row, complete: next.row >= totalRows, fields,
    coverage: 'All nonblank occurrences of the first 16 reviewed identifier fields; exact stored values; no inferred document entities.' };
};
export const readEntityPage = async (reference, cursor) => {
  if (reference.kind !== 'local-dataset-reference') return buildEntityPage(reference, cursor);
  return withWorkerDatabase(async (database) => {
    const expected = { expectedRevision: reference.revision, expectedStorageRevision: reference.storageRevision };
    const header = await readDatasetHeader(database, reference.id, expected);
    const start = cursor || { row: 0, column: 0 }; const totalRows = header.rowStorage.streams.rawRows.length;
    if (start.row >= totalRows) return { records: [], cursor: start, completedRows: totalRows, complete: true, fields: entityFields(header) };
    const pageIndex = Math.floor(start.row / ROW_CHUNK_SIZE); const page = await readDatasetRowPage(database, reference.id, pageIndex, expected);
    const result = buildEntityPage(header, start, { rows: page.rows, rowOffset: pageIndex * ROW_CHUNK_SIZE, totalRows });
    await readDatasetHeader(database, reference.id, expected); return result;
  });
};
