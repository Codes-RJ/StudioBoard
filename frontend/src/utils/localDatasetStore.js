import { STORE_NAME, SOURCE_STORE_NAME, ARTIFACT_STORE_NAME, METADATA_STORE_NAME, RESTORE_STORE_NAME, IMPORT_STORE_NAME, STAGED_DATASET_STORE, STAGED_FILE_STORE, isValidDataset, openDatabase, readAll, enqueueWrite, withDatabase } from './localDatasetDatabase';
export { beginLocalImport, stageLocalImport, publishLocalImport, stageLocalImportHeader, stageLocalImportRowPage, updateStagedLocalImportMetrics, stageLocalImportFileChunk, discardLocalImport, cleanupAbandonedLocalImports } from './localImportStorage';
import { qualityRevisionKey } from './qualityReview';
import { datasetCatalogMetadata } from './datasetCatalogMetadata';
import { ROW_STORE_NAME, writeStoredDataset, hydrateStoredDataset, deleteDatasetRows, storedDatasetIsValid } from './datasetRowStorage';
import { rememberStoredDataset, getStoredDatasetVersion } from './datasetWorkerPayload';
import { readDatasetFromDatabase, scanDatasetRowsFromDatabase, readDatasetHeader } from './datasetWorkerReader';
import { encodeArchivedFiles, readArchivedFile, deleteSourceFileChunks, FILE_CHUNK_STORE } from './sourceFileStorage';

const LEGACY_CATALOG_KEY = 'local_datasets_catalog';
const datasetMetadata = datasetCatalogMetadata;

/**
 * A legacy localStorage catalogue was capped at 500 rows. Only records whose
 * retained rows equal the declared row count can be migrated without changing
 * analytical meaning. Partial catalogues must be re-imported instead.
 */
export const resolveLegacyDatasetCatalog = (serializedCatalog) => {
  try {
    const catalog = JSON.parse(serializedCatalog || '[]');
    if (!Array.isArray(catalog)) return { datasets: [], discardedCount: 0 };

    const valid = catalog.filter(isValidDataset);
    const datasets = valid.filter((dataset) => Number(dataset.rowCount) === dataset.rawRows.length);
    return {
      datasets,
      discardedCount: valid.length - datasets.length
    };
  } catch {
    return { datasets: [], discardedCount: 0 };
  }
};

const replaceAll = async (database, datasets) => new Promise((resolve, reject) => {
  const transaction = database.transaction([STORE_NAME, SOURCE_STORE_NAME, ARTIFACT_STORE_NAME, METADATA_STORE_NAME, RESTORE_STORE_NAME, ROW_STORE_NAME,
    IMPORT_STORE_NAME, STAGED_DATASET_STORE, STAGED_FILE_STORE, FILE_CHUNK_STORE], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const metadata = transaction.objectStore(METADATA_STORE_NAME);
  let writeError;
  const versions = new Map();
  try { store.clear(); metadata.clear(); transaction.objectStore(ROW_STORE_NAME).clear(); datasets.forEach((dataset) => {
    const header = writeStoredDataset(transaction, dataset, { replace: false }); versions.set(dataset.id, header.storageRevision); metadata.put(datasetMetadata(header));
  }); }
  catch (error) { writeError = error; transaction.abort(); }
  if (writeError) { transaction.onabort = () => reject(writeError); return; }
  transaction.objectStore(ARTIFACT_STORE_NAME).clear();
  transaction.objectStore(RESTORE_STORE_NAME).clear();
  for (const name of [IMPORT_STORE_NAME, STAGED_DATASET_STORE, STAGED_FILE_STORE]) transaction.objectStore(name).clear();
  const retainedSources = new Set(datasets.map((dataset) => dataset.sourceFile?.id).filter(Boolean));
  const chunks = transaction.objectStore(FILE_CHUNK_STORE).index('fileId').openKeyCursor();
  chunks.onsuccess = () => { const cursor = chunks.result; if (cursor) { if (!retainedSources.has(cursor.key)) cursor.delete(); cursor.continue(); } };
  const cursorRequest = transaction.objectStore(SOURCE_STORE_NAME).openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    if (!retainedSources.has(cursor.key)) { deleteSourceFileChunks(transaction, cursor.key); cursor.delete(); }
    cursor.continue();
  };
  transaction.oncomplete = () => { datasets.forEach((source) => rememberStoredDataset(source, versions.get(source.id))); resolve(); };
  transaction.onerror = () => reject(transaction.error || new Error('Unable to save local datasets.'));
  transaction.onabort = () => reject(transaction.error || new Error('Saving local datasets was aborted.'));
});

const putOne = async (database, dataset, { expectedRevision, expectedStorageRevision, allowMissing = false } = {}) => new Promise((resolve, reject) => {
  const transaction = database.transaction([STORE_NAME, ARTIFACT_STORE_NAME, METADATA_STORE_NAME, ROW_STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const metadata = transaction.objectStore(METADATA_STORE_NAME);
  let conflict;
  let storageRevision;
  const writeDataset = (prior) => {
    try {
      const header = writeStoredDataset(transaction, dataset, { prior }); storageRevision = header.storageRevision;
      metadata.put(datasetMetadata(header));
      const cursorRequest = transaction.objectStore(ARTIFACT_STORE_NAME).openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result; if (!cursor) return;
        if (cursor.value.datasetIds?.includes(dataset.id)) cursor.delete();
        cursor.continue();
      };
    }
    catch (error) { conflict = error; transaction.abort(); }
  };
  if (expectedRevision !== undefined || expectedStorageRevision !== undefined) {
    // Approval compares the authoritative source too, even if a diagnostic
    // or older integration bypassed the revision metadata store.
    const request = store.get(dataset.id);
    request.onsuccess = () => {
      const current = request.result;
      const revisionConflict = expectedRevision !== undefined && ((!current && !allowMissing) || (current && qualityRevisionKey(current) !== expectedRevision));
      const storageConflict = expectedStorageRevision !== undefined && (current?.storageRevision || null) !== expectedStorageRevision;
      if (revisionConflict || storageConflict) {
        conflict = Object.assign(new Error('The saved source changed. Your unsaved work is retained; reload the saved source or preserve a copy before applying.'), { code: 'DATASET_CONFLICT' });
        transaction.abort();
      } else writeDataset(current);
    };
  } else writeDataset();
  transaction.oncomplete = () => { rememberStoredDataset(dataset, storageRevision); resolve(storageRevision); };
  transaction.onerror = () => reject(conflict || transaction.error || new Error('Unable to save the local dataset.'));
  transaction.onabort = () => reject(conflict || transaction.error || new Error('Saving the local dataset was aborted.'));
});

const deleteOne = async (database, datasetId, { expectedStorageRevision } = {}) => new Promise((resolve, reject) => {
  // Read the dataset first to find its sourceFile reference, then delete
  // both the dataset and any orphaned original-file blob in one transaction.
  const storeNames = [STORE_NAME, SOURCE_STORE_NAME, FILE_CHUNK_STORE, ARTIFACT_STORE_NAME, METADATA_STORE_NAME, RESTORE_STORE_NAME, ROW_STORE_NAME];
  const transaction = database.transaction(storeNames, 'readwrite');
  const datasetStore = transaction.objectStore(STORE_NAME);
  const sourceStore = transaction.objectStore(SOURCE_STORE_NAME);
  const metadata = transaction.objectStore(METADATA_STORE_NAME);
  const restores = transaction.objectStore(RESTORE_STORE_NAME).openCursor();
  restores.onsuccess = () => {
    const cursor = restores.result; if (!cursor) return;
    if (cursor.value.datasetIds.includes(datasetId)) cursor.delete();
    cursor.continue();
  };
  const artifacts = transaction.objectStore(ARTIFACT_STORE_NAME).openCursor();
  artifacts.onsuccess = () => {
    const cursor = artifacts.result;
    if (!cursor) return;
    if (cursor.value.datasetIds?.includes(datasetId)) cursor.delete();
    cursor.continue();
  };
  let failure;
  const readRequest = datasetStore.get(datasetId);
  readRequest.onsuccess = () => {
    const dataset = readRequest.result;
    if (expectedStorageRevision !== undefined && dataset && (dataset.storageRevision || null) !== expectedStorageRevision) {
      failure = Object.assign(new Error('The saved source changed. Reload it before deleting.'), { code: 'DATASET_CONFLICT' });
      transaction.abort(); return;
    }
    datasetStore.delete(datasetId);
    metadata.delete(datasetId);
    deleteDatasetRows(transaction, datasetId);
    if (dataset?.sourceFile?.id) {
      // Workbook sheets share one archive. Check surviving references inside
      // this transaction so another tab cannot interleave a write.
      let referenced = false;
      const cursorRequest = metadata.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          if (!referenced) { sourceStore.delete(dataset.sourceFile.id); deleteSourceFileChunks(transaction, dataset.sourceFile.id); }
          return;
        }
        if (cursor.value.sourceFile?.id === dataset.sourceFile.id) referenced = true;
        cursor.continue();
      };
    }
  };
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error('Unable to delete the local dataset.'));
  transaction.onabort = () => reject(failure || transaction.error || new Error('Deleting the local dataset was aborted.'));
});

export const saveLocalSourceFiles = async (sources) => persistSourceFiles(await encodeArchivedFiles(sources));
const persistSourceFiles = (sources) => enqueueWrite(() => withDatabase((database) => new Promise((resolve, reject) => {
  const transaction = database.transaction([SOURCE_STORE_NAME, FILE_CHUNK_STORE], 'readwrite');
  const store = transaction.objectStore(SOURCE_STORE_NAME);
  let writeError;
  try { sources.forEach((source) => { if (source.byteFormat !== 2) deleteSourceFileChunks(transaction, source.id); store.put(source); }); }
  catch (error) { writeError = error; transaction.abort(); }
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error('Unable to preserve original files locally.'));
  transaction.onabort = () => reject(writeError || transaction.error || new Error('Preserving original files was aborted.'));
})));

export const prepareLocalSourceFile = (file) => {
  const metadata = { id: `source_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`,
    name: file.name, type: file.type || 'application/octet-stream', size: file.size,
    lastModified: file.lastModified || 0, path: file.webkitRelativePath || file.name };
  return { metadata, archive: { ...metadata, blob: file.slice(0, file.size, metadata.type) } };
};
export const archiveLocalSourceFile = async (file) => {
  const { metadata, archive } = prepareLocalSourceFile(file);
  await saveLocalSourceFiles([archive]); return metadata;
};

export const loadLocalSourceFile = (id) => withDatabase((database) => new Promise((resolve, reject) => {
  const transaction = database.transaction([SOURCE_STORE_NAME, FILE_CHUNK_STORE], 'readonly');
  const request = transaction.objectStore(SOURCE_STORE_NAME).get(id);
  request.onsuccess = () => { try { readArchivedFile(transaction, request.result || null, resolve, reject); } catch (error) { reject(error); } };
  request.onerror = () => reject(request.error || new Error('Unable to read the original source file.'));
}));

// Restore sources, approved-data candidates and the recoverable layout snapshot
// together. The existing workspace is untouched if any write fails.
export const saveRestoredWorkspace = async (workspace, options = {}) => persistRestoredWorkspace({ ...workspace,
  sourceFiles: await encodeArchivedFiles(workspace.sourceFiles || [], options) }, options);
const persistRestoredWorkspace = (workspace, { signal } = {}) => enqueueWrite(() => withDatabase((database) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Workspace restore cancelled.', 'AbortError')); return; }
  const datasets = workspace.datasets || [workspace.dataset]; const files = workspace.sourceFiles || [];
  if (!datasets.length || datasets.some((dataset) => !isValidDataset(dataset)) || new Set(datasets.map((dataset) => dataset.id)).size !== datasets.length) {
    reject(new Error('The restored workspace contains invalid sources.')); return;
  }
  const transaction = database.transaction([STORE_NAME, METADATA_STORE_NAME, SOURCE_STORE_NAME, RESTORE_STORE_NAME, ROW_STORE_NAME], 'readwrite');
  let failure; let remaining = datasets.length;
  const versions = new Map();
  const fail = (error) => { failure = error; transaction.abort(); };
  const abort = () => fail(new DOMException('Workspace restore cancelled.', 'AbortError'));
  signal?.addEventListener('abort', abort, { once: true });
  const cleanup = () => signal?.removeEventListener('abort', abort);
  for (const dataset of datasets) {
    const request = transaction.objectStore(METADATA_STORE_NAME).get(dataset.id);
    request.onsuccess = () => {
      if (request.result) { fail(new Error('Restored source IDs already exist. Read the backup again before restoring.')); return; }
      if (--remaining) return;
      try {
        datasets.forEach((source) => {
          const header = writeStoredDataset(transaction, source, { replace: false });
          versions.set(source.id, header.storageRevision);
          transaction.objectStore(METADATA_STORE_NAME).put(datasetMetadata(header));
        });
        files.forEach((file) => transaction.objectStore(SOURCE_STORE_NAME).put(file));
        transaction.objectStore(RESTORE_STORE_NAME).put({ id: workspace.dataset.id,
          datasetIds: datasets.map((source) => source.id), selectedDatasetId: workspace.dataset.id,
          layout: workspace.layout, layouts: workspace.layouts || [workspace.layout], filters: workspace.filters, palette: workspace.palette,
          savedAt: new Date().toISOString() });
      } catch (error) { fail(error); }
    };
  }
  transaction.oncomplete = () => {
    cleanup();
    datasets.forEach((source) => {
      rememberStoredDataset(source, versions.get(source.id));
    }); resolve();
  }; transaction.onerror = () => { cleanup(); reject(failure || transaction.error); };
  transaction.onabort = () => { cleanup(); reject(failure || transaction.error || new Error('Restore failed; the previous workspace was retained.')); };
})));

export const loadRestoredWorkspace = (datasetId, { metadataOnly = false } = {}) => withDatabase((database) => new Promise((resolve, reject) => {
  const sourceStore = metadataOnly ? METADATA_STORE_NAME : STORE_NAME;
  const transaction = database.transaction([...new Set([RESTORE_STORE_NAME, sourceStore, ROW_STORE_NAME])], 'readonly');
  let workspace = null;
  let failure;
  const fail = (error) => { failure = error; transaction.abort(); };
  const request = transaction.objectStore(RESTORE_STORE_NAME).get(datasetId);
  request.onsuccess = () => {
    if (!request.result) return;
    const snapshot = request.result; const datasets = []; let remaining = snapshot.datasetIds.length;
    for (const id of snapshot.datasetIds) {
      const source = transaction.objectStore(sourceStore).get(id);
      source.onsuccess = () => {
        const complete = (record) => {
          if (record) datasets.push(metadataOnly ? record : rememberStoredDataset(record));
          if (--remaining === 0 && datasets.length === snapshot.datasetIds.length) workspace = { ...snapshot, datasets,
            dataset: datasets.find((item) => item.id === snapshot.selectedDatasetId), persisted: true };
        };
        if (metadataOnly) complete(source.result); else hydrateStoredDataset(transaction, source.result, complete, fail);
      };
    }
  };
  transaction.oncomplete = () => resolve(workspace); transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(failure || transaction.error);
}));

// Evidence and conversations share the dataset database, so dataset deletion
// removes dependent content atomically. Model weights use separate runtime caches.
export const loadAssistantArtifact = (id) => withDatabase((database) => new Promise((resolve, reject) => {
  const request = database.transaction(ARTIFACT_STORE_NAME, 'readonly').objectStore(ARTIFACT_STORE_NAME).get(id);
  request.onsuccess = () => resolve(request.result || null);
  request.onerror = () => reject(request.error);
}));
export const saveAssistantArtifacts = (artifacts, { expectedArtifact } = {}) => enqueueWrite(() => withDatabase((database) => new Promise((resolve, reject) => {
  const transaction = database.transaction([ARTIFACT_STORE_NAME, METADATA_STORE_NAME], 'readwrite');
  // A late worker/save cannot recreate private content after source deletion.
  const sourceIds = [...new Set(artifacts.flatMap((artifact) => artifact.datasetIds || []))];
  let remaining = sourceIds.length + (expectedArtifact ? 1 : 0);
  let missing = false;
  if (!sourceIds.length || artifacts.some((artifact) => !artifact.datasetIds?.length)) { reject(new Error('Assistant content needs a source dataset.')); transaction.abort(); return; }
  const finishRead = () => {
    if (--remaining === 0 && !missing) {
      try { artifacts.forEach((artifact) => transaction.objectStore(ARTIFACT_STORE_NAME).put(artifact)); }
      catch (error) { reject(error); transaction.abort(); }
    }
  };
  if (expectedArtifact) {
    const request = transaction.objectStore(ARTIFACT_STORE_NAME).get(expectedArtifact.id);
    request.onsuccess = () => { if (JSON.stringify(request.result || null) !== JSON.stringify(expectedArtifact.value)) missing = true; finishRead(); };
  }
  for (const id of sourceIds) {
    const request = transaction.objectStore(METADATA_STORE_NAME).get(id);
    request.onsuccess = () => {
      if (!request.result) missing = true;
      if (request.result && artifacts.some((artifact) => artifact.datasetIds.includes(id) && artifact.revision && request.result.revisionKey !== artifact.revision)) missing = true;
      finishRead();
    };
  }
  transaction.oncomplete = () => resolve(!missing);
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error || new Error('Assistant content could not be saved.'));
})));
export const saveAssistantArtifact = (artifact) => saveAssistantArtifacts([artifact]);
export const deleteAssistantArtifact = (id) => enqueueWrite(() => withDatabase((database) => new Promise((resolve, reject) => {
  const transaction = database.transaction(ARTIFACT_STORE_NAME, 'readwrite');
  transaction.objectStore(ARTIFACT_STORE_NAME).delete(id);
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error);
})));

// Cursor iteration keeps persisted evidence pages out of the UI's heap.
export const scanAssistantArtifacts = (prefix, visit) => withDatabase((database) => new Promise((resolve, reject) => {
  const transaction = database.transaction(ARTIFACT_STORE_NAME, 'readonly');
  const request = transaction.objectStore(ARTIFACT_STORE_NAME).openCursor(globalThis.IDBKeyRange?.bound(prefix, `${prefix}\uffff`));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    try { if (String(cursor.key).startsWith(prefix)) visit(cursor.value); cursor.continue(); }
    catch (error) { reject(error); transaction.abort(); }
  };
  transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || new Error('Evidence scan stopped.'));
}));

export const loadLocalDataset = (id, options) => withDatabase((database) => readDataset(database, id, options));
export const loadLocalDatasetHeader = (id, options) => withDatabase((database) => readDatasetHeader(database, id, options));

const readDataset = (database, id, options) => readDatasetFromDatabase(database, id, options).then(rememberStoredDataset);

// Bounded, ordered scans for exporters/indexers. Each page reads the current
// manifest in the same transaction, so a concurrent edit rejects the scan
// instead of mixing generations. Async visitors may write elsewhere safely.
export const scanLocalDatasetRows = (id, visit, options) => withDatabase((database) => scanDatasetRowsFromDatabase(database, id, visit, options));

// Older integrations can update the authoritative row store directly. Repair
// its summary on conflict, without writing rows or accepting a stale review.
export const refreshLocalDatasetMetadata = (id) => enqueueWrite(() => withDatabase((database) => new Promise((resolve, reject) => {
  const transaction = database.transaction([STORE_NAME, METADATA_STORE_NAME, ARTIFACT_STORE_NAME], 'readwrite');
  let source; let previous; let summary = null; let remaining = 2;
  const finish = () => {
    if (--remaining) return;
    summary = storedDatasetIsValid(source) ? datasetMetadata(source) : null;
    const metadata = transaction.objectStore(METADATA_STORE_NAME);
    if (summary) metadata.put(summary); else metadata.delete(id);
    if (!summary || previous?.revisionKey !== summary.revisionKey) {
      const scan = transaction.objectStore(ARTIFACT_STORE_NAME).openCursor();
      scan.onsuccess = () => {
        const cursor = scan.result; if (!cursor) return;
        if (cursor.value.datasetIds?.includes(id)) cursor.delete();
        cursor.continue();
      };
    }
  };
  const rows = transaction.objectStore(STORE_NAME).get(id);
  rows.onsuccess = () => { source = rows.result; finish(); };
  const catalog = transaction.objectStore(METADATA_STORE_NAME).get(id);
  catalog.onsuccess = () => { previous = catalog.result; finish(); };
  transaction.oncomplete = () => resolve(summary);
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error || new Error('Catalog refresh was aborted.'));
})));

export const loadLocalDatasetCatalog = async ({ metadataOnly = false } = {}) => {
  const database = await openDatabase();
  try {
    const savedDatasets = (await readAll(database, metadataOnly ? METADATA_STORE_NAME : STORE_NAME))
      .filter((dataset) => metadataOnly ? dataset.metadataOnly && dataset.rowCount > 0 : storedDatasetIsValid(dataset))
      .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0));
    if (savedDatasets.length) {
      return { datasets: metadataOnly ? savedDatasets : await Promise.all(savedDatasets.map((source) => readDataset(database, source.id))), discardedLegacyCount: 0 };
    }

    const legacyCatalog = typeof localStorage === 'undefined'
      ? null
      : localStorage.getItem(LEGACY_CATALOG_KEY);
    const migration = resolveLegacyDatasetCatalog(legacyCatalog);
    if (migration.datasets.length) {
      await replaceAll(database, migration.datasets);
    }
    if (legacyCatalog !== null) {
      localStorage.removeItem(LEGACY_CATALOG_KEY);
    }

    return {
      datasets: metadataOnly ? migration.datasets.map(datasetMetadata) : migration.datasets,
      discardedLegacyCount: migration.discardedCount
    };
  } finally {
    database.close();
  }
};

export const saveLocalDatasetCatalog = async (datasets) => {
  if (datasets.some((source) => source.rowStreamsDeferred || source.metadataOnly)) throw new Error('A catalog replacement needs complete source and history streams. Export a streamed backup or explicitly load complete records first.');
  return enqueueWrite(() => withDatabase((database) => replaceAll(database, datasets.filter(isValidDataset))));
};

export const saveLocalDataset = async (dataset, options) => {
  if (!isValidDataset(dataset)) {
    throw new Error('The local dataset is incomplete and cannot be saved.');
  }
  try {
    return await enqueueWrite(() => withDatabase(async (database) => {
      const guards = dataset.rowStreamsDeferred ? { ...options, expectedStorageRevision: options?.expectedStorageRevision ?? getStoredDatasetVersion(dataset) ?? dataset.rowStorage?.generation } : options;
      const version = await putOne(database, dataset, guards);
      rememberStoredDataset(dataset, version); return version;
    }));
  } catch (error) {
    if (error.message.startsWith('The saved source changed.')) {
      await refreshLocalDatasetMetadata(dataset.id).catch(() => null);
    }
    throw error;
  }
};

export const deleteLocalDataset = async (datasetId, options) => {
  if (!datasetId) return;
  return enqueueWrite(() => withDatabase((database) => deleteOne(database, datasetId, options)));
};

export const getLocalDatasetStorageStatus = async () => {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return {
    usage,
    quota,
    ratio: quota > 0 ? usage / quota : 0,
    nearlyFull: quota > 0 && usage / quota >= 0.9
  };
};

export const requestPersistentLocalDatasetStorage = async () => {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  return navigator.storage.persist();
};

export const clearLocalDatasetCatalog = async () => {
  return enqueueWrite(() => withDatabase((database) => replaceAll(database, [])));
};
