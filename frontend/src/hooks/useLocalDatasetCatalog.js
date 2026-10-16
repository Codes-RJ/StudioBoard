import { useCallback, useEffect, useRef, useState } from 'react';
import { qualityRevisionKey, newDatasetRevision } from '../utils/qualityReview';
import { datasetCatalogMetadata } from '../utils/datasetCatalogMetadata';
import { getStoredDatasetVersion } from '../utils/datasetWorkerPayload';

const WRITE_DEBOUNCE_MS = 400;
const loadDatasetStore = () => import('../utils/localDatasetStore');

export default function useLocalDatasetCatalog({
  initialDatasets,
  onRestore,
  onDiscardedLegacy,
  onPersistenceError,
  onStoragePressure,
  storeLoader = loadDatasetStore
}) {
  const [datasets, publishDatasets] = useState(initialDatasets);
  const datasetsRef = useRef(initialDatasets);
  const initialDatasetsRef = useRef(initialDatasets);
  const retainedIdRef = useRef(initialDatasets[0]?.id);
  const unsavedRef = useRef(new Map());
  const savedVersionsRef = useRef(new Map());
  const writesRef = useRef(new Map());
  const readsRef = useRef(new Map());
  const [saveConflicts, setSaveConflicts] = useState([]);
  const restoredRef = useRef(false);
  const setDatasets = useCallback((update) => {
    const next = typeof update === 'function' ? update(datasetsRef.current) : update;
    datasetsRef.current = next;
    publishDatasets(next);
  }, []);
  const evictSavedRows = useCallback(() => {
    setDatasets((current) => current.map((dataset) => dataset.rawRows
      && dataset.id !== retainedIdRef.current && !unsavedRef.current.has(dataset.id)
      && !initialDatasetsRef.current.includes(dataset) ? datasetCatalogMetadata(dataset) : dataset));
  }, [setDatasets]);
  const changedBeforeRestoreRef = useRef(false);
  const removedBeforeRestoreRef = useRef(new Set());
  const updatedBeforeRestoreRef = useRef(new Map());
  const restorePromiseRef = useRef(Promise.resolve());
  const pendingDatasetsRef = useRef(new Map());
  const timersRef = useRef(new Map());
  const storagePressureReportedRef = useRef(false);
  const persistenceRequestedRef = useRef(false);

  const checkStoragePressure = useCallback(async () => {
    if (storagePressureReportedRef.current) return;
    const { getLocalDatasetStorageStatus } = await storeLoader();
    const status = await getLocalDatasetStorageStatus();
    if (status?.nearlyFull) {
      storagePressureReportedRef.current = true;
      onStoragePressure?.(status);
    }
  }, [onStoragePressure, storeLoader]);

  const persistDataset = useCallback(async (dataset) => {
    try {
      if (!persistenceRequestedRef.current) {
        persistenceRequestedRef.current = true;
        void storeLoader()
          .then(({ requestPersistentLocalDatasetStorage }) => requestPersistentLocalDatasetStorage())
          .catch(() => false);
      }
      // Reserve the queue before yielding: approval must see a background save
      // even while catalog restore or the lazy store import is still pending.
      const write = (writesRef.current.get(dataset.id) || Promise.resolve()).catch(() => {}).then(async () => {
        await restorePromiseRef.current;
        const { saveLocalDataset } = await storeLoader();
        const version = await saveLocalDataset(dataset, { expectedStorageRevision: savedVersionsRef.current.get(dataset.id) || null });
        if (version) savedVersionsRef.current.set(dataset.id, version);
      });
      writesRef.current.set(dataset.id, write);
      await write;
      setSaveConflicts((current) => current.filter(({ id }) => id !== dataset.id));
      if (unsavedRef.current.get(dataset.id) === dataset) unsavedRef.current.delete(dataset.id);
      evictSavedRows();
    } catch (error) {
      if (error.code === 'DATASET_CONFLICT') setSaveConflicts((current) => [...current.filter(({ id }) => id !== dataset.id),
        { id: dataset.id, name: dataset.name, message: error.message }]);
      if (error.code !== 'DATASET_CONFLICT' && unsavedRef.current.get(dataset.id) === dataset && !removedBeforeRestoreRef.current.has(dataset.id)) {
        pendingDatasetsRef.current.set(dataset.id, dataset);
      }
      onPersistenceError?.(error, 'save');
      return;
    }

    try {
      await checkStoragePressure();
    } catch (error) {
      onPersistenceError?.(error, 'storage');
    }
  }, [checkStoragePressure, onPersistenceError, storeLoader, evictSavedRows]);

  const scheduleDatasetWrite = useCallback((dataset) => {
    unsavedRef.current.set(dataset.id, dataset);
    pendingDatasetsRef.current.set(dataset.id, dataset);
    const existingTimer = timersRef.current.get(dataset.id);
    if (existingTimer) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      const pending = pendingDatasetsRef.current.get(dataset.id);
      if (!pending) return;
      pendingDatasetsRef.current.delete(dataset.id);
      timersRef.current.delete(dataset.id);
      void persistDataset(pending);
    }, WRITE_DEBOUNCE_MS);
    timersRef.current.set(dataset.id, timer);
  }, [persistDataset]);

  const flushPendingWrites = useCallback(() => {
    const pending = [...pendingDatasetsRef.current.values()];
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
    pendingDatasetsRef.current.clear();
    return Promise.allSettled(pending.map((dataset) => persistDataset(dataset)));
  }, [persistDataset]);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      try {
        const { loadLocalDatasetCatalog, cleanupAbandonedLocalImports } = await storeLoader();
        await cleanupAbandonedLocalImports?.();
        const result = await loadLocalDatasetCatalog({ metadataOnly: true });
        if (cancelled) return;
        result.datasets.forEach((source) => { if (source.storageRevision) savedVersionsRef.current.set(source.id, source.storageRevision); });
        if (result.datasets.length) {
          if (changedBeforeRestoreRef.current) {
            setDatasets((current) => {
              const currentIds = new Set(current.map(({ id }) => id));
              const restored = result.datasets
                .filter(({ id }) => !removedBeforeRestoreRef.current.has(id) && !currentIds.has(id))
                .map((item) => updatedBeforeRestoreRef.current.get(item.id) || item);
              return [...current, ...restored];
            });
          } else {
            setDatasets(result.datasets);
            onRestore?.(result.datasets);
          }
        }
        if (result.discardedLegacyCount > 0) {
          onDiscardedLegacy?.(result.discardedLegacyCount);
        }
        restoredRef.current = true;
        updatedBeforeRestoreRef.current.clear();
      } catch (error) {
        onPersistenceError?.(error, 'restore');
      }
    };
    restorePromiseRef.current = restore();
    void restorePromiseRef.current;
    return () => {
      cancelled = true;
    };
  }, [onDiscardedLegacy, onPersistenceError, onRestore, storeLoader]);

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') void flushPendingWrites();
    };
    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('pagehide', flushPendingWrites);
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('pagehide', flushPendingWrites);
      void flushPendingWrites();
    };
  }, [flushPendingWrites]);

  const addDataset = useCallback((dataset) => {
    changedBeforeRestoreRef.current = true;
    removedBeforeRestoreRef.current.delete(dataset.id);
    setDatasets((current) => [dataset, ...current.filter(({ id }) => id !== dataset.id)]);
    scheduleDatasetWrite(dataset);
  }, [scheduleDatasetWrite]);

  const addDatasets = useCallback((newDatasets, { persisted = false } = {}) => {
    if (!newDatasets.length) return;
    changedBeforeRestoreRef.current = true;
    newDatasets.forEach(({ id }) => removedBeforeRestoreRef.current.delete(id));
    const newIds = new Set(newDatasets.map(({ id }) => id));
    if (persisted) newDatasets.forEach((source) => {
      const version = getStoredDatasetVersion(source); if (version) savedVersionsRef.current.set(source.id, version);
    });
    setDatasets((current) => [...newDatasets, ...current.filter(({ id }) => !newIds.has(id))]);
    if (!persisted) newDatasets.forEach(scheduleDatasetWrite);
  }, [scheduleDatasetWrite]);

  const updateDataset = useCallback((dataset) => {
    if (!dataset?.id) return;
    changedBeforeRestoreRef.current = true;
    if (!restoredRef.current) updatedBeforeRestoreRef.current.set(dataset.id, dataset);
    setDatasets((current) => current.map((item) => (item.id === dataset.id ? dataset : item)));
    scheduleDatasetWrite(dataset);
  }, [scheduleDatasetWrite]);

  const removeDataset = useCallback((datasetId) => {
    changedBeforeRestoreRef.current = true;
    removedBeforeRestoreRef.current.add(datasetId);
    updatedBeforeRestoreRef.current.delete(datasetId);
    const timer = timersRef.current.get(datasetId);
    if (timer) window.clearTimeout(timer);
    timersRef.current.delete(datasetId);
    pendingDatasetsRef.current.delete(datasetId);
    return restorePromiseRef.current
      .then(() => storeLoader())
      .then(({ deleteLocalDataset }) => deleteLocalDataset(datasetId, { expectedStorageRevision: savedVersionsRef.current.get(datasetId) || null }))
      .then(() => { unsavedRef.current.delete(datasetId); setDatasets((current) => current.filter(({ id }) => id !== datasetId)); return true; })
      .catch((error) => { removedBeforeRestoreRef.current.delete(datasetId); onPersistenceError?.(error); return false; });
  }, [onPersistenceError, storeLoader]);

  const commitDataset = useCallback(async (dataset, options) => {
    // Finish any pending source save before comparing and committing approval.
    const pending = pendingDatasetsRef.current.get(dataset.id);
    const timer = timersRef.current.get(dataset.id);
    if (timer) window.clearTimeout(timer);
    timersRef.current.delete(dataset.id);
    pendingDatasetsRef.current.delete(dataset.id);
    try {
      // A failed approval stays retryable. The next write still compares the
      // authoritative source revision/version; swallowing a prior rejection
      // here does not bypass cross-tab conflict checks.
      const write = (writesRef.current.get(dataset.id) || Promise.resolve()).catch(() => {}).then(async () => {
        await restorePromiseRef.current;
        const { saveLocalDataset } = await storeLoader();
        if (pending) {
          const version = await saveLocalDataset(pending, { expectedStorageRevision: savedVersionsRef.current.get(dataset.id) || null });
          if (version) savedVersionsRef.current.set(dataset.id, version);
        }
        const initial = initialDatasets.find((item) => item.id === dataset.id);
        const version = await saveLocalDataset(dataset, { ...options, expectedStorageRevision: savedVersionsRef.current.get(dataset.id) || null,
          ...(initial && qualityRevisionKey(initial) === options?.expectedRevision ? { allowMissing: true } : {}) });
        if (version) savedVersionsRef.current.set(dataset.id, version);
      });
      writesRef.current.set(dataset.id, write);
      await write;
    } catch (error) {
      if (pending && !pendingDatasetsRef.current.has(dataset.id)) scheduleDatasetWrite(pending);
      throw error;
    }
    changedBeforeRestoreRef.current = true;
    unsavedRef.current.delete(dataset.id);
    if (!restoredRef.current) updatedBeforeRestoreRef.current.set(dataset.id, dataset);
    setDatasets((current) => current.map((item) => item.id === dataset.id ? dataset : item));
    return dataset;
  }, [initialDatasets, scheduleDatasetWrite, storeLoader]);

  // Computation requests receive complete records without caching every table
  // in React. Unsaved edits remain authoritative and are never evicted.
  const loadDataset = useCallback(async (id, options) => {
    const current = datasetsRef.current.find((item) => item.id === id);
    if (removedBeforeRestoreRef.current.has(id)) throw new Error('This source has been removed.');
    if (current?.rawRows && (options?.workingOnly || !current.rowStreamsDeferred)) return current;
    await restorePromiseRef.current;
    const { loadLocalDataset, refreshLocalDatasetMetadata } = await storeLoader();
    const key = `${id}:${options?.workingOnly ? 'working' : 'complete'}:${qualityRevisionKey(current)}:${options?.expectedStorageRevision || ''}`;
    let reading = options?.signal ? null : readsRef.current.get(key);
    if (!reading) {
      reading = loadLocalDataset(id, options).finally(() => { if (readsRef.current.get(key) === reading) readsRef.current.delete(key); });
      if (!options?.signal) readsRef.current.set(key, reading);
    }
    const loaded = await reading;
    const latest = datasetsRef.current.find((item) => item.id === id);
    if (removedBeforeRestoreRef.current.has(id) || !latest || !loaded) throw new Error('This source is no longer available.');
    if (latest.rawRows && (options?.workingOnly || !latest.rowStreamsDeferred)) return latest;
    if (qualityRevisionKey(latest) !== qualityRevisionKey(loaded)) {
      const summary = refreshLocalDatasetMetadata ? await refreshLocalDatasetMetadata(id) : datasetCatalogMetadata(loaded);
      if (!removedBeforeRestoreRef.current.has(id)) {
        setDatasets((current) => current.map((item) => item === latest && summary ? summary : item));
      }
      throw new Error('The saved source changed in another tab. Try opening it again or reload the workspace.');
    }
    if (loaded.storageRevision) savedVersionsRef.current.set(id, loaded.storageRevision);
    return loaded;
  }, [storeLoader]);

  const retainDataset = useCallback((dataset) => {
    retainedIdRef.current = dataset?.id;
    if (dataset) setDatasets((current) => current.map((item) => item.id === dataset.id ? dataset : item));
    evictSavedRows();
  }, [evictSavedRows, setDatasets]);

  const reloadSavedDataset = useCallback(async (id) => {
    const timer = timersRef.current.get(id); if (timer) window.clearTimeout(timer);
    timersRef.current.delete(id); pendingDatasetsRef.current.delete(id);
    await writesRef.current.get(id)?.catch(() => {});
    writesRef.current.delete(id);
    const { loadLocalDataset } = await storeLoader();
    const saved = await loadLocalDataset(id);
    unsavedRef.current.delete(id);
    if (saved?.storageRevision) savedVersionsRef.current.set(id, saved.storageRevision);
    setDatasets((current) => saved ? current.map((source) => source.id === id ? saved : source) : current.filter((source) => source.id !== id));
    setSaveConflicts((current) => current.filter((source) => source.id !== id));
    return saved;
  }, [storeLoader, setDatasets]);

  const preserveDatasetCopy = useCallback(async (id) => {
    const source = unsavedRef.current.get(id) || datasetsRef.current.find((item) => item.id === id);
    if (!source?.rawRows) throw new Error('The unsaved source is no longer available.');
    const { saveLocalDataset, loadLocalDataset, loadLocalSourceFile } = await storeLoader();
    let complete = source;
    if (source.rowStreamsDeferred) {
      const prior = await loadLocalDataset(id, { expectedStorageRevision: savedVersionsRef.current.get(id) });
      if (!prior) throw new Error('Original and history streams are unavailable. Export your working rows before reloading.');
      complete = { ...source, sourceRows: prior.sourceRows, cleaningHistory: prior.cleaningHistory };
      delete complete.rowStreamsDeferred;
    }
    const copy = { ...complete, id: `local_copy_${newDatasetRevision()}`, name: `${source.name || 'Dataset'} (unsaved copy)`,
      revision: newDatasetRevision(), updatedAt: new Date().toISOString(), qualityReviewRequired: true };
    for (const field of ['qualityReview', 'folderId', 'folderName', 'collectionKind', 'relationships', 'isFolderOverview']) delete copy[field];
    if (copy.sourceFile && loadLocalSourceFile && !await loadLocalSourceFile(copy.sourceFile.id)) delete copy.sourceFile;
    const version = await saveLocalDataset(copy, { expectedStorageRevision: null });
    if (version) savedVersionsRef.current.set(copy.id, version);
    // Only discard the conflicting draft after its copy has committed.
    await reloadSavedDataset(id);
    setDatasets((current) => [copy, ...current]);
    return copy;
  }, [storeLoader, setDatasets, reloadSavedDataset]);

  return {
    localDatasets: datasets,
    loadLocalDatasetRecord: loadDataset,
    retainLocalDatasetRecord: retainDataset,
    addLocalDatasetRecord: addDataset,
    addLocalDatasetRecords: addDatasets,
    updateLocalDatasetRecord: updateDataset,
    commitLocalDatasetRecord: commitDataset,
    removeLocalDatasetRecord: removeDataset,
    flushLocalDatasetWrites: flushPendingWrites,
    localSaveConflicts: saveConflicts,
    reloadSavedLocalDataset: reloadSavedDataset,
    preserveLocalDatasetCopy: preserveDatasetCopy
  };
}
