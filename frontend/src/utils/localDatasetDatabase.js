import { datasetCatalogMetadata as datasetMetadata } from './datasetCatalogMetadata';
import { ROW_STORE_NAME, writeStoredDataset, storedDatasetIsValid } from './datasetRowStorage';
import { FILE_CHUNK_STORE } from './sourceFileStorage';

export const DATABASE_NAME = 'analytics-dashboard-local-data';
export const DATABASE_VERSION = 7;
export const STORE_NAME = 'datasets';
export const SOURCE_STORE_NAME = 'sourceFiles';
export const ARTIFACT_STORE_NAME = 'assistantArtifacts';
export const METADATA_STORE_NAME = 'datasetMetadata';
export const RESTORE_STORE_NAME = 'workspaceRestores';
export const IMPORT_STORE_NAME = 'workspaceImports';
export const STAGED_DATASET_STORE = 'stagedDatasets';
export const STAGED_FILE_STORE = 'stagedFiles';

export const isValidDataset = (dataset) => Boolean(
  dataset
  && dataset.id
  && Array.isArray(dataset.columns)
  && Array.isArray(dataset.rawRows)
  && dataset.rawRows.length > 0
);

export const openDatabase = () => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('IndexedDB is unavailable in this browser.'));
    return;
  }

  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  let blocked = false;
  let migrationError;
  request.onblocked = () => { blocked = true; reject(new Error('Close other dashboard tabs and try again to upgrade local storage.')); };
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: 'id' });
    }
    if (!database.objectStoreNames.contains(SOURCE_STORE_NAME)) database.createObjectStore(SOURCE_STORE_NAME, { keyPath: 'id' });
    if (!database.objectStoreNames.contains(FILE_CHUNK_STORE)) {
      const chunks = database.createObjectStore(FILE_CHUNK_STORE, { keyPath: ['fileId', 'generation', 'index'] });
      chunks.createIndex('fileId', 'fileId'); chunks.createIndex('sessionId', 'sessionId');
    }
    if (!database.objectStoreNames.contains(ARTIFACT_STORE_NAME)) database.createObjectStore(ARTIFACT_STORE_NAME, { keyPath: 'id' });
    if (!database.objectStoreNames.contains(RESTORE_STORE_NAME)) database.createObjectStore(RESTORE_STORE_NAME, { keyPath: 'id' });
    if (!database.objectStoreNames.contains(METADATA_STORE_NAME)) {
      database.createObjectStore(METADATA_STORE_NAME, { keyPath: 'id' });
    }
    if (!database.objectStoreNames.contains(ROW_STORE_NAME)) {
      const rows = database.createObjectStore(ROW_STORE_NAME, { keyPath: ['datasetId', 'generation', 'stream', 'index'] });
      rows.createIndex('datasetId', 'datasetId');
    }
    if (!database.objectStoreNames.contains(IMPORT_STORE_NAME)) database.createObjectStore(IMPORT_STORE_NAME, { keyPath: 'id' });
    for (const name of [STAGED_DATASET_STORE, STAGED_FILE_STORE]) if (!database.objectStoreNames.contains(name)) {
      database.createObjectStore(name, { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
    }
    // Version 4 summaries lacked names, collection and review information.
    // Rebuild once in the upgrade transaction; retain all authoritative rows.
    {
      const metadata = request.transaction.objectStore(METADATA_STORE_NAME);
      metadata.clear();
      const cursorRequest = request.transaction.objectStore(STORE_NAME).openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result; if (!cursor) return;
        try {
          if (isValidDataset(cursor.value)) {
            const header = writeStoredDataset(request.transaction, cursor.value, { replace: false });
            metadata.put(datasetMetadata(header));
          } else if (storedDatasetIsValid(cursor.value)) metadata.put(datasetMetadata(cursor.value));
          cursor.continue();
        } catch (error) { migrationError = error; request.transaction.abort(); }
      };
    }
  };
  request.onsuccess = () => {
    if (blocked) { request.result.close(); return; }
    request.result.onversionchange = () => request.result.close();
    resolve(request.result);
  };
  request.onerror = () => reject(migrationError || request.error || new Error('Unable to open local dataset storage.'));
});

export const readAll = async (database, storeName = STORE_NAME) => new Promise((resolve, reject) => {
  const transaction = database.transaction(storeName, 'readonly');
  const request = transaction.objectStore(storeName).getAll();
  request.onsuccess = () => resolve(request.result || []);
  request.onerror = () => reject(request.error || new Error('Unable to read local datasets.'));
});

let writeQueue = Promise.resolve();

export const enqueueWrite = (operation) => {
  const queued = writeQueue.then(operation, operation);
  writeQueue = queued.catch(() => undefined);
  return queued;
};

export const withDatabase = async (operation) => {
  const database = await openDatabase();
  try {
    return await operation(database);
  } finally {
    database.close();
  }
};

