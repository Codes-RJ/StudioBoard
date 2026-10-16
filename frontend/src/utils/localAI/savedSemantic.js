import { ROW_CHUNK_SIZE } from '../datasetRowStorage';
import { withWorkerDatabase, readDatasetHeader, readDatasetRowPage } from '../datasetWorkerReader';
import { buildSemanticPage } from './semantic';
import { assertReviewed } from './evidence';

// One immutable row page (and optional aligned source page) per indexing job.
// Revalidate storage even when a long cell requires several requests on a page.
export const createSavedSemanticPager = (reference) => {
  if (reference?.kind !== 'local-dataset-reference' || reference.field) throw new Error('Semantic indexing requires a saved dataset reference.');
  const options = { expectedRevision: reference.revision, expectedStorageRevision: reference.storageRevision, includeSourceRows: true };
  let cached;
  return {
    next: (cursor = { row: 0, column: 0, offset: 0 }, filters = {}, limit = 48) => withWorkerDatabase(async (database) => {
      if (['row', 'column', 'offset'].some((key) => !Number.isSafeInteger(cursor[key]) || cursor[key] < 0)) throw new Error('Invalid semantic cursor or page limit.');
      const header = await readDatasetHeader(database, reference.id, options);
      assertReviewed(header);
      const total = header.rowStorage.streams.rawRows.length;
      if (cursor.row > total) throw new Error('Invalid semantic cursor or page limit.');
      if (cursor.row === total) return buildSemanticPage(header, cursor, filters, limit, { rows: [], rowOffset: total, totalRows: total });
      const index = Math.floor(cursor.row / ROW_CHUNK_SIZE);
      if (cached?.offset !== index * ROW_CHUNK_SIZE) cached = undefined;
      if (!cached) cached = await readDatasetRowPage(database, reference.id, index, options);
      const result = buildSemanticPage(cached.header, cursor, filters, limit, {
        rows: cached.rows, sourceRows: cached.sourceRows, rowOffset: cached.offset, totalRows: cached.total });
      if (result.complete || result.cursor.row >= cached.offset + cached.rows.length) cached = undefined;
      return result;
    }),
  };
};
