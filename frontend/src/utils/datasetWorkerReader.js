import { hydrateStoredDataset, ROW_STORE_NAME, ROW_CHUNK_SIZE, storedDatasetIsValid } from './datasetRowStorage';
import { qualityRevisionKey } from './qualityReview';
import { MAX_SELECTED_SOURCE_ROWS, MAX_SELECTED_SOURCE_TEXT_BYTES } from './browserCapacityPolicy';

export const readDatasetFromDatabase = (database, id, { signal, expectedRevision, expectedStorageRevision, workingOnly = false,
  retainedPolicy = workingOnly ? { rows: MAX_SELECTED_SOURCE_ROWS, bytes: MAX_SELECTED_SOURCE_TEXT_BYTES } : undefined } = {}) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Opening this source was cancelled.', 'AbortError')); return; }
  const transaction = database.transaction(['datasets', ROW_STORE_NAME], 'readonly');
  let result = null; let failure;
  const fail = (error) => { if (failure) return; failure = error; transaction.abort(); };
  const abort = () => fail(new DOMException('Opening this source was cancelled.', 'AbortError'));
  signal?.addEventListener('abort', abort, { once: true });
  const request = transaction.objectStore('datasets').get(id);
  request.onsuccess = () => {
    if (!storedDatasetIsValid(request.result)) return;
    if ((expectedRevision !== undefined && qualityRevisionKey(request.result) !== expectedRevision)
      || (expectedStorageRevision !== undefined && request.result.storageRevision !== expectedStorageRevision)) {
      fail(new Error('The saved source changed. Reload it before continuing.')); return;
    }
    hydrateStoredDataset(transaction, request.result, (record) => { result = record; }, fail, { workingOnly, retainedPolicy });
  };
  const cleanup = () => signal?.removeEventListener('abort', abort);
  transaction.oncomplete = () => { cleanup(); resolve(result); };
  transaction.onerror = () => { cleanup(); reject(failure || transaction.error); };
  transaction.onabort = () => { cleanup(); reject(failure || transaction.error || new Error('Opening this source failed.')); };
});

// Workers never upgrade or mutate the database. A reference is issued only
// after the application has successfully opened/migrated and saved the source.
export const withWorkerDatabase = async (operation) => {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('analytics-dashboard-local-data');
    request.onupgradeneeded = () => request.transaction.abort();
    request.onblocked = () => reject(new Error('Local storage is being upgraded. Close other tabs and reopen the workspace.'));
    request.onerror = () => reject(request.error || new Error('Saved source storage is unavailable.'));
    request.onsuccess = () => {
      if (!request.result.objectStoreNames.contains(ROW_STORE_NAME)) {
        request.result.close(); reject(new Error('Reopen the workspace to upgrade saved source storage.')); return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
  try { return await operation(database); }
  finally { database.close(); }
};

export const loadWorkerDataset = (id, options) => withWorkerDatabase((database) => readDatasetFromDatabase(database, id, options));

const checkHeader = (header, { expectedRevision, expectedStorageRevision } = {}) => {
  if (!storedDatasetIsValid(header)) throw new Error('The source was deleted during this scan.');
  if ((expectedRevision !== undefined && qualityRevisionKey(header) !== expectedRevision)
    || (expectedStorageRevision !== undefined && header.storageRevision !== expectedStorageRevision)) throw new Error('The saved source changed during this scan.');
  if (header.rowStorage?.version !== 1 || !header.rowStorage.generation) throw new Error('This source needs to be saved in the current row format before scanning.');
};

const streamSpec = (header, stream) => {
  const spec = header.rowStorage.streams?.[stream];
  if (!spec || !Number.isSafeInteger(spec.length) || spec.length < 0 || spec.length > 1_000_000
    || spec.chunks !== Math.ceil(spec.length / ROW_CHUNK_SIZE)) throw new Error('The saved row stream is inconsistent.');
  return spec;
};

export const readDatasetHeader = (database, id, options = {}) => new Promise((resolve, reject) => {
  const transaction = database.transaction('datasets', 'readonly');
  let header; let failure;
  const request = transaction.objectStore('datasets').get(id);
  request.onsuccess = () => {
    try { header = request.result; checkHeader(header, options); }
    catch (error) { failure = error; transaction.abort(); }
  };
  transaction.oncomplete = () => resolve(header);
  transaction.onerror = () => reject(failure || transaction.error);
  transaction.onabort = () => reject(failure || transaction.error);
});

// Each page and its optional aligned provenance page share one read snapshot.
// No original/history stream is hydrated merely to calculate a working measure.
export const readDatasetRowPage = (database, id, index, options = {}) => new Promise((resolve, reject) => {
  const { signal, stream = 'rawRows', includeSourceRows = false } = options;
  if (signal?.aborted) { reject(new DOMException('The row scan was cancelled.', 'AbortError')); return; }
  const transaction = database.transaction(['datasets', ROW_STORE_NAME], 'readonly');
  let result; let failure;
  const fail = (error) => { if (failure) return; failure = error; transaction.abort(); };
  const abort = () => fail(new DOMException('The row scan was cancelled.', 'AbortError'));
  signal?.addEventListener('abort', abort, { once: true });
  const request = transaction.objectStore('datasets').get(id);
  request.onsuccess = () => {
    try {
      const header = request.result; checkHeader(header, options);
      const spec = streamSpec(header, stream);
      if (!Number.isSafeInteger(index) || index < 0 || (spec.chunks && index >= spec.chunks)) throw new Error('The row page is outside the saved stream.');
      result = { header, rows: [], offset: index * ROW_CHUNK_SIZE, total: spec.length, chunks: spec.chunks };
      const read = (name, destination, description) => {
        const expected = Math.min(ROW_CHUNK_SIZE, description.length - result.offset);
        if (expected <= 0) { result[destination] = []; return; }
        const page = transaction.objectStore(ROW_STORE_NAME).get([id, header.rowStorage.generation, name, index]);
        page.onsuccess = () => {
          if (!Array.isArray(page.result?.rows) || page.result.rows.length !== expected) { fail(new Error('A saved row chunk is missing or incomplete.')); return; }
          result[destination] = page.result.rows;
        };
      };
      read(stream, 'rows', spec);
      if (includeSourceRows && header.cleaningLog?.length && header.rowStorage.streams?.sourceRows) read('sourceRows', 'sourceRows', streamSpec(header, 'sourceRows'));
    } catch (error) { fail(error); }
  };
  const cleanup = () => signal?.removeEventListener('abort', abort);
  transaction.oncomplete = () => { cleanup(); resolve(result); };
  transaction.onerror = () => { cleanup(); reject(failure || transaction.error); };
  transaction.onabort = () => { cleanup(); reject(failure || transaction.error || new Error('The row scan stopped.')); };
});

export const scanDatasetRowsFromDatabase = async (database, id, visit, options = {}) => {
  let expectedStorageRevision = options.expectedStorageRevision; let chunks; let scanned = 0; let total;
  for (let index = 0; chunks === undefined || index < chunks; index++) {
    const page = await readDatasetRowPage(database, id, index, { ...options, expectedStorageRevision });
    expectedStorageRevision = page.header.storageRevision;
    chunks = page.chunks; total = page.total;
    if (options.signal?.aborted) throw new DOMException('The row scan was cancelled.', 'AbortError');
    await visit(page.rows, { offset: page.offset, total, stream: options.stream || 'rawRows', header: page.header, sourceRows: page.sourceRows });
    scanned += page.rows.length;
    options.onProgress?.({ scanned, total });
  }
  // Also reject cancellation or an edit made by the final asynchronous visitor.
  if (options.signal?.aborted) throw new DOMException('The row scan was cancelled.', 'AbortError');
  await readDatasetHeader(database, id, { ...options, expectedStorageRevision });
  if (options.signal?.aborted) throw new DOMException('The row scan was cancelled.', 'AbortError');
  return { scanned, total };
};

export const scanWorkerDatasetRows = (id, visit, options) => withWorkerDatabase((database) => scanDatasetRowsFromDatabase(database, id, visit, options));
