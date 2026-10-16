import { STORE_NAME, SOURCE_STORE_NAME, METADATA_STORE_NAME, RESTORE_STORE_NAME, IMPORT_STORE_NAME, STAGED_DATASET_STORE, STAGED_FILE_STORE, isValidDataset, readAll, enqueueWrite, withDatabase } from './localDatasetDatabase';
import { ROW_STORE_NAME, writeStoredDataset, storedDatasetIsValid, deleteDatasetRows } from './datasetRowStorage';
import { FILE_CHUNK_STORE, encodeArchivedFiles, archiveByteLength, readBlobBytes } from './sourceFileStorage';
import { datasetCatalogMetadata as datasetMetadata } from './datasetCatalogMetadata';

const importStores = [IMPORT_STORE_NAME, STAGED_DATASET_STORE, STAGED_FILE_STORE, FILE_CHUNK_STORE, ROW_STORE_NAME, STORE_NAME, METADATA_STORE_NAME, SOURCE_STORE_NAME, RESTORE_STORE_NAME];
const importTransaction = (operation, { signal } = {}) => enqueueWrite(() => withDatabase((database) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Import cancelled.', 'AbortError')); return; }
  const transaction = database.transaction(importStores, 'readwrite');
  let failure; let result;
  let settled = false;
  const settle = (error) => {
    if (settled) return;
    settled = true; cleanup();
    if (error) reject(error); else resolve(result);
  };
  const fail = (error) => {
    if (!failure) failure = error;
    try { transaction.abort(); } catch { /* Already inactive/aborted. */ }
    settle(failure);
  };
  const done = (value) => { result = value; };
  const abort = () => fail(new DOMException('Import cancelled.', 'AbortError'));
  const timer = setTimeout(() => fail(new Error('Local storage stopped responding. Import was aborted; the saved workspace was retained. Close other workspace tabs and try again.')), 30_000);
  signal?.addEventListener('abort', abort, { once: true });
  const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
  transaction.oncomplete = () => settle(failure);
  transaction.onerror = (event) => fail(failure || event.target?.error || transaction.error || new Error('Local storage could not preserve this import. The saved workspace was retained.'));
  transaction.onabort = () => settle(failure || transaction.error || new Error('Import failed; the saved workspace was retained.'));
  try { operation(transaction, done, fail); } catch (error) { fail(error); }
})));

export const beginLocalImport = () => importTransaction((transaction, done) => {
  const id = `import_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`}`;
  transaction.objectStore(IMPORT_STORE_NAME).add({ id, sourceIds: [], fileIds: [], updatedAt: Date.now() });
  done(id);
});

export const stageLocalImport = async (sessionId, datasets, files = []) => persistLocalImport(sessionId, datasets, await encodeArchivedFiles(files));
const persistLocalImport = (sessionId, datasets, files) => importTransaction((transaction, done, fail) => {
  if (!datasets.length || datasets.some((source) => !isValidDataset(source)) || new Set(datasets.map((source) => source.id)).size !== datasets.length) {
    fail(new Error('The import contains invalid or duplicate sources.')); return;
  }
  const request = transaction.objectStore(IMPORT_STORE_NAME).get(sessionId);
  request.onsuccess = () => {
    const session = request.result;
    if (!session) { fail(new Error('This import was cancelled or expired. Start it again.')); return; }
    let remaining = datasets.length * 2;
    const write = () => {
      if (--remaining) return;
      try {
        for (const source of datasets) {
          const header = writeStoredDataset(transaction, source, { replace: false, headerStore: STAGED_DATASET_STORE });
          transaction.objectStore(STAGED_DATASET_STORE).put({ ...header, sessionId });
        }
        files.forEach((file) => transaction.objectStore(STAGED_FILE_STORE).put({ ...file, sessionId }));
        transaction.objectStore(IMPORT_STORE_NAME).put({ ...session, sourceIds: [...session.sourceIds, ...datasets.map((source) => source.id)],
          fileIds: [...new Set([...session.fileIds, ...files.map((file) => file.id)])], updatedAt: Date.now() });
        done(datasets.map(datasetMetadata));
      } catch (error) { fail(error); }
    };
    for (const source of datasets) for (const name of [STORE_NAME, STAGED_DATASET_STORE]) {
      const check = transaction.objectStore(name).get(source.id);
      check.onsuccess = () => {
        if (check.result) fail(new Error('An imported source ID already exists. Start this import again.')); else write();
      };
    }
  };
});

export const publishLocalImport = (sessionId, { workspace, signal } = {}) => importTransaction((transaction, done, fail) => {
  const request = transaction.objectStore(IMPORT_STORE_NAME).get(sessionId);
  request.onsuccess = () => {
    const session = request.result;
    if (!session?.sourceIds.length) { fail(new Error('This import has no staged sources.')); return; }
    const summaries = new Array(session.sourceIds.length);
    for (const [index, id] of session.sourceIds.entries()) {
      const read = transaction.objectStore(STAGED_DATASET_STORE).get(id);
      read.onsuccess = () => {
        const source = read.result;
        if (!source || source.sessionId !== sessionId) { fail(new Error('A staged source is missing. Nothing was imported.')); return; }
        if (source.streamedImport && Object.entries(source.rowStorage.streams).some(([stream, spec]) => source.receivedPages?.[stream] !== spec.chunks)) {
          fail(new Error('A staged row stream is incomplete. Nothing was restored.')); return;
        }
        const check = transaction.objectStore(STORE_NAME).get(id);
        check.onsuccess = () => {
          if (check.result) { fail(new Error('An imported source ID already exists. Nothing was imported.')); return; }
          const { sessionId: discardedSession, receivedPages, streamedImport, ...header } = source;
          transaction.objectStore(STORE_NAME).add(header);
          const summary = datasetMetadata(header); summaries[index] = summary;
          transaction.objectStore(METADATA_STORE_NAME).add(summary);
          transaction.objectStore(STAGED_DATASET_STORE).delete(id);
        };
      };
    }
    for (const id of session.fileIds) {
      const read = transaction.objectStore(STAGED_FILE_STORE).get(id);
      read.onsuccess = () => {
        try {
          if (!read.result || read.result.sessionId !== sessionId || (read.result.expectedSize !== undefined && archiveByteLength(read.result) !== read.result.expectedSize)) throw new Error('A staged original is missing or incomplete. Nothing was imported.');
        } catch (error) { fail(error); return; }
        const { sessionId: discardedSession, expectedSize, receivedChunks, ...file } = read.result;
        transaction.objectStore(SOURCE_STORE_NAME).add(file);
        transaction.objectStore(STAGED_FILE_STORE).delete(id);
      };
    }
    transaction.objectStore(IMPORT_STORE_NAME).delete(sessionId);
    if (workspace) transaction.objectStore(RESTORE_STORE_NAME).put({ id: workspace.dataset.id,
      datasetIds: workspace.datasets.map((source) => source.id), selectedDatasetId: workspace.dataset.id,
      layout: workspace.layout, layouts: workspace.layouts, filters: workspace.filters, palette: workspace.palette, savedAt: new Date().toISOString() });
    done(summaries);
  };
}, { signal });

export const stageLocalImportHeader = (sessionId, source) => importTransaction((transaction, done, fail) => {
  if (!storedDatasetIsValid(source) || !source.rowStorage || source.rawRows || source.sourceRows) { fail(new Error('Invalid staged source header.')); return; }
  const request = transaction.objectStore(IMPORT_STORE_NAME).get(sessionId);
  request.onsuccess = () => {
    const session = request.result;
    if (!session || session.sourceIds.includes(source.id)) { fail(new Error('Duplicate or expired restore source.')); return; }
    transaction.objectStore(STAGED_DATASET_STORE).add({ ...source, sessionId, streamedImport: true,
      receivedPages: Object.fromEntries(Object.keys(source.rowStorage.streams).map((stream) => [stream, 0])) });
    transaction.objectStore(IMPORT_STORE_NAME).put({ ...session, sourceIds: [...session.sourceIds, source.id], updatedAt: Date.now() }); done();
  };
});

export const stageLocalImportRowPage = (sessionId, id, stream, index, rows) => importTransaction((transaction, done, fail) => {
  const request = transaction.objectStore(STAGED_DATASET_STORE).get(id);
  request.onsuccess = () => {
    const source = request.result; const spec = source?.rowStorage?.streams?.[stream];
    if (!source || source.sessionId !== sessionId || !spec || source.receivedPages[stream] !== index || index >= spec.chunks
      || !Array.isArray(rows) || rows.length !== Math.min(512, spec.length - index * 512) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
      fail(new Error('The backup row page is invalid, duplicated or out of order.')); return;
    }
    transaction.objectStore(ROW_STORE_NAME).add({ datasetId: id, generation: source.rowStorage.generation, stream, index, rows });
    transaction.objectStore(STAGED_DATASET_STORE).put({ ...source, receivedPages: { ...source.receivedPages, [stream]: index + 1 } }); done();
    const sessionRequest = transaction.objectStore(IMPORT_STORE_NAME).get(sessionId);
    sessionRequest.onsuccess = () => {
      if (!sessionRequest.result) { fail(new Error('This restore was cancelled.')); return; }
      transaction.objectStore(IMPORT_STORE_NAME).put({ ...sessionRequest.result, updatedAt: Date.now() });
    };
  };
});

export const updateStagedLocalImportMetrics = (sessionId, id, metrics) => importTransaction((transaction, done, fail) => {
  const read = transaction.objectStore(STAGED_DATASET_STORE).get(id);
  read.onsuccess = () => {
    const source = read.result;
    if (!source || source.sessionId !== sessionId || source.receivedPages.rawRows !== source.rowStorage.streams.rawRows.chunks) { fail(new Error('Working rows must be complete before restoring their metrics.')); return; }
    transaction.objectStore(STAGED_DATASET_STORE).put({ ...source, metrics,
      ...(source.document ? { document: { ...source.document, blocks: metrics.rows } } : {}),
      ...(source.rowGrain ? { rowGrain: { ...source.rowGrain, rows: metrics.rows } } : {}) }); done();
  };
});

export const stageLocalImportFileChunk = async (sessionId, metadata, index, blob) => {
  if (blob.size > 1024 * 1024) throw new Error('An original-file restore chunk is too large.');
  const bytes = await readBlobBytes(blob);
  return importTransaction((transaction, done, fail) => {
  const request = transaction.objectStore(IMPORT_STORE_NAME).get(sessionId);
  request.onsuccess = () => {
    const session = request.result;
    if (!session) { fail(new Error('This restore was cancelled.')); return; }
    const read = transaction.objectStore(STAGED_FILE_STORE).get(metadata.id);
    read.onsuccess = () => {
      const previous = read.result;
      if ((previous?.receivedChunks || 0) !== index || (previous && previous.sessionId !== sessionId)) { fail(new Error('Invalid original-file chunk order.')); return; }
      if (previous && previous.byteFormat !== 2) { fail(new Error('Restart this older incomplete original-file restore.')); return; }
      const total = (previous?.storedBytes || 0) + bytes.byteLength;
      if (total > metadata.size) { fail(new Error('Original-file bytes exceed their manifest size.')); return; }
      transaction.objectStore(FILE_CHUNK_STORE).add({ fileId: metadata.id, generation: sessionId, index, sessionId, bytes });
      transaction.objectStore(STAGED_FILE_STORE).put({ ...metadata, sessionId, expectedSize: metadata.size, receivedChunks: index + 1,
        byteFormat: 2, chunkGeneration: sessionId, byteChunkCount: index + 1, storedBytes: total });
      transaction.objectStore(IMPORT_STORE_NAME).put({ ...session, fileIds: [...new Set([...session.fileIds, metadata.id])], updatedAt: Date.now() }); done();
    };
  };
  });
};

export const discardLocalImport = (sessionId, { olderThan } = {}) => importTransaction((transaction) => {
  const discard = () => {
    const chunks = transaction.objectStore(FILE_CHUNK_STORE).index('sessionId').openCursor(sessionId);
    chunks.onsuccess = () => { const cursor = chunks.result; if (cursor) { cursor.delete(); cursor.continue(); } };
    for (const name of [STAGED_DATASET_STORE, STAGED_FILE_STORE]) {
      const scan = transaction.objectStore(name).index('sessionId').openCursor(sessionId);
      scan.onsuccess = () => {
        const cursor = scan.result; if (!cursor) return;
        if (name === STAGED_DATASET_STORE) deleteDatasetRows(transaction, cursor.value.id);
        cursor.delete(); cursor.continue();
      };
    }
    transaction.objectStore(IMPORT_STORE_NAME).delete(sessionId);
  };
  if (olderThan === undefined) discard();
  else {
    const request = transaction.objectStore(IMPORT_STORE_NAME).get(sessionId);
    request.onsuccess = () => { if (request.result?.updatedAt < olderThan) discard(); };
  }
});

export const cleanupAbandonedLocalImports = async ({ olderThan = Date.now() - 48 * 60 * 60 * 1000 } = {}) => {
  const sessions = await withDatabase((database) => readAll(database, IMPORT_STORE_NAME));
  for (const session of sessions) if (session.updatedAt < olderThan) await discardLocalImport(session.id, { olderThan });
};

