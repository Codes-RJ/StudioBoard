import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { saveLocalDataset, loadLocalDatasetCatalog, deleteLocalDataset, saveLocalSourceFiles, loadLocalSourceFile,
  clearLocalDatasetCatalog, saveLocalDatasetCatalog, loadAssistantArtifact, saveAssistantArtifact, saveAssistantArtifacts, scanAssistantArtifacts,
  saveRestoredWorkspace, loadRestoredWorkspace, loadLocalDataset, refreshLocalDatasetMetadata } from '../localDatasetStore';
import { qualityRevisionKey } from '../qualityReview';
const dataset = (id, sourceId = 'shared') => ({ id, revision: 'r1', rawRows: [{ value: 1 }], columns: [{ name: 'value' }], rowCount: 1, sourceFile: { id: sourceId } });
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); localStorage.clear(); });
describe('transactional source and assistant lifecycle', () => {
  it('compares ordinary mutation revisions, including relationship-only edits and delete-versus-save races', async () => {
    const source = dataset('two-tabs');
    const initialVersion = await saveLocalDataset(source, { expectedStorageRevision: null });
    const firstTab = await loadLocalDataset(source.id); const secondTab = await loadLocalDataset(source.id);
    expect(firstTab.storageRevision).toBe(initialVersion);
    const nextVersion = await saveLocalDataset({ ...firstTab, relationships: [{ id: 'reviewed-edge', status: 'approved' }] }, { expectedStorageRevision: firstTab.storageRevision });
    expect(nextVersion).not.toBe(initialVersion);
    await expect(saveLocalDataset({ ...secondTab, name: 'stale rename' }, { expectedStorageRevision: secondTab.storageRevision })).rejects.toMatchObject({ code: 'DATASET_CONFLICT' });
    await expect(deleteLocalDataset(source.id, { expectedStorageRevision: secondTab.storageRevision })).rejects.toThrow('before deleting');
    await deleteLocalDataset(source.id, { expectedStorageRevision: nextVersion });
    await expect(saveLocalDataset(firstTab, { expectedStorageRevision: nextVersion })).rejects.toMatchObject({ code: 'DATASET_CONFLICT' });
    expect(await loadLocalDataset(source.id)).toBeNull();
  });
  it('repairs summaries after an authoritative-store conflict without accepting the old approval', async () => {
    const source = dataset('conflict'); await saveLocalDataset(source);
    await saveAssistantArtifact({ id: 'old-index', datasetIds: [source.id], revision: qualityRevisionKey(source) });
    await new Promise((resolve) => {
      const request = indexedDB.open('analytics-dashboard-local-data');
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('datasets', 'readwrite');
        transaction.objectStore('datasets').put({ ...source, revision: 'r2', rawRows: [{ value: 9 }] });
        transaction.oncomplete = () => { database.close(); resolve(); };
      };
    });
    await expect(saveLocalDataset(source, { expectedRevision: qualityRevisionKey(source) })).rejects.toThrow('saved source changed');
    const catalog = await loadLocalDatasetCatalog({ metadataOnly: true });
    expect(catalog.datasets[0].revision).toBe('r2');
    expect((await loadLocalDataset(source.id)).rawRows).toEqual([{ value: 9 }]);
    expect(await loadAssistantArtifact('old-index')).toBeNull();
    await deleteLocalDataset(source.id);
    expect(await refreshLocalDatasetMetadata(source.id)).toBeNull();
    expect((await loadLocalDatasetCatalog({ metadataOnly: true })).datasets).toEqual([]);
  });
  it('lists metadata without reading row records and hydrates only the requested source', async () => {
    const original = { ...dataset('one'), name: 'First', sourceRows: [{ value: '001' }],
      cleaningHistory: [{ rows: [{ value: '001' }] }], metrics: { columnGroups: { numeric: ['value'] }, numericStats: { private: [1] } } };
    await saveLocalDataset(original); await saveLocalDataset(dataset('two'));
    const calls = [];
    const originalGetAll = IDBObjectStore.prototype.getAll;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (...args) {
      calls.push(this.name); return originalGetAll.apply(this, args);
    });
    try {
      const catalog = await loadLocalDatasetCatalog({ metadataOnly: true });
      expect(calls).toEqual(['datasetMetadata']);
      expect(catalog.datasets).toHaveLength(2);
      const metadata = catalog.datasets.find(({ id }) => id === 'one');
      expect(metadata).toMatchObject({ name: 'First', metadataOnly: true, rowCount: 1, revisionKey: qualityRevisionKey(original) });
      for (const field of ['rawRows', 'sourceRows', 'cleaningHistory']) expect(metadata).not.toHaveProperty(field);
      expect(metadata.metrics).not.toHaveProperty('numericStats');
      expect(await loadLocalDataset('one')).toEqual(original);
      expect(await loadLocalDataset('missing')).toBeNull();
    } finally { spy.mockRestore(); }
  });
  it('upgrades existing v4 summaries while preserving histories and recovery snapshots', async () => {
    const original = { ...dataset('legacy-v4'), name: 'Preserved', folderId: 'folder', sourceRows: [{ value: '001' }] };
    const snapshot = { id: original.id, selectedDatasetId: original.id, datasetIds: [original.id], layout: { id: 'old-layout' } };
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('analytics-dashboard-local-data', 4);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('datasets', { keyPath: 'id' }).put(original);
        request.result.createObjectStore('datasetMetadata', { keyPath: 'id' }).put({ id: original.id, rowCount: 1 });
        request.result.createObjectStore('workspaceRestores', { keyPath: 'id' }).put(snapshot);
      };
      request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
    });
    expect((await loadLocalDatasetCatalog({ metadataOnly: true })).datasets[0]).toMatchObject({ name: 'Preserved', folderId: 'folder', metadataOnly: true });
    expect(await loadLocalDataset(original.id)).toEqual(original);
    const summary = await loadRestoredWorkspace(original.id, { metadataOnly: true });
    expect(summary.dataset).not.toHaveProperty('rawRows');
    expect(summary.layout.id).toBe('old-layout');
    expect((await loadRestoredWorkspace(original.id)).dataset).toEqual(original);
  });
  it('rolls back the complete restore, including originals and layout, when a write fails', async () => {
    await saveLocalDataset(dataset('previous'));
    const restored = { dataset: dataset('restored', 'new-source'), sourceFiles: [{ id: 'new-source', blob: new Blob(['exact original']) }],
      layout: { id: 'layout-restored', layout: [] }, filters: {}, palette: 'blue' };
    await expect(saveRestoredWorkspace({ ...restored, layout: { bad: () => {} } })).rejects.toBeDefined();
    expect((await loadLocalDatasetCatalog()).datasets.map((item) => item.id)).toEqual(['previous']);
    expect(await loadLocalSourceFile('new-source')).toBeNull(); expect(await loadRestoredWorkspace('restored')).toBeNull();
    await saveRestoredWorkspace(restored);
    expect(await loadRestoredWorkspace('restored')).toMatchObject({ dataset: { id: 'restored' }, layout: { id: 'layout-restored' }, persisted: true });
    await expect(saveRestoredWorkspace(restored)).rejects.toThrow('already exist');
    await deleteLocalDataset('restored'); expect(await loadRestoredWorkspace('restored')).toBeNull();
  });
  it('migrates revision metadata from the previous IndexedDB version without losing rows', async () => {
    const original = dataset('legacy-v3');
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('analytics-dashboard-local-data', 3);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('datasets', { keyPath: 'id' }).put(original);
        request.result.createObjectStore('sourceFiles', { keyPath: 'id' });
        request.result.createObjectStore('assistantArtifacts', { keyPath: 'id' });
      };
      request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
    });
    expect(await saveAssistantArtifact({ id: 'migrated-evidence', datasetIds: [original.id], revision: qualityRevisionKey(original) })).toBe(true);
    await saveLocalDataset({ ...original, revision: 'r2' }, { expectedRevision: qualityRevisionKey(original) });
    expect((await loadLocalDatasetCatalog()).datasets[0].rawRows).toEqual(original.rawRows);
  });
  it('commits semantic pages and their resume cursor together and rolls back uncloneable pages', async () => {
    const source = dataset('semantic'); await saveLocalDataset(source);
    const base = { datasetIds: [source.id], revision: qualityRevisionKey(source) };
    await saveAssistantArtifacts([{ ...base, id: 'semantic:chunk:0', records: [{ text: 'private' }] }, { ...base, id: 'semantic:manifest', pages: 1 }]);
    await expect(saveAssistantArtifacts([{ ...base, id: 'semantic:chunk:1', bad: () => {} }, { ...base, id: 'semantic:manifest', pages: 2 }])).rejects.toBeDefined();
    expect((await loadAssistantArtifact('semantic:manifest')).pages).toBe(1);
    expect(await saveAssistantArtifacts([{ ...base, id: 'semantic:manifest', pages: 0 }], { expectedArtifact: { id: 'semantic:manifest', value: { ...base, id: 'semantic:manifest', pages: 0 } } })).toBe(false);
    expect((await loadAssistantArtifact('semantic:manifest')).pages).toBe(1);
    expect(await loadAssistantArtifact('semantic:chunk:1')).toBeNull();
    const pages = []; await scanAssistantArtifacts('semantic:chunk:', (record) => pages.push(record)); expect(pages).toHaveLength(1);
    await deleteLocalDataset(source.id); const deleted = []; await scanAssistantArtifacts('semantic:', (record) => deleted.push(record)); expect(deleted).toEqual([]);
  });
  it('retains a shared workbook until the final referencing sheet is removed', async () => {
    await saveLocalSourceFiles([{ id: 'shared', blob: new Blob(['original workbook']) }]);
    await saveLocalDataset(dataset('sheet1')); await saveLocalDataset(dataset('sheet2'));
    await deleteLocalDataset('sheet1');
    expect(await loadLocalSourceFile('shared')).not.toBeNull();
    expect((await loadLocalDatasetCatalog()).datasets.map((d) => d.id)).toEqual(['sheet2']);
    await deleteLocalDataset('sheet2'); expect(await loadLocalSourceFile('shared')).toBeNull();
  });
  it('clears originals and assistant content along with the catalog', async () => {
    await saveLocalSourceFiles([{ id: 'shared', blob: new Blob(['original']) }]);
    await saveLocalDataset(dataset('sheet1'));
    await saveAssistantArtifact({ id: 'conversation', datasetIds: ['sheet1'], messages: [{ text: 'private prompt' }] });
    await clearLocalDatasetCatalog();
    expect(await loadAssistantArtifact('conversation')).toBeNull(); expect(await loadLocalSourceFile('shared')).toBeNull();
  });
  it('deletes source-dependent conversations/indexes and refuses late worker saves', async () => {
    const original = dataset('sheet1'); await saveLocalDataset(original);
    await saveAssistantArtifact({ id: 'evidence', datasetIds: ['sheet1'], revision: qualityRevisionKey(original), index: { private: true } });
    await saveLocalDataset({ ...original, revision: 'r2' }); expect(await loadAssistantArtifact('evidence')).toBeNull();
    expect(await saveAssistantArtifact({ id: 'evidence', datasetIds: ['sheet1'], revision: qualityRevisionKey(original) })).toBe(false);
    await saveAssistantArtifact({ id: 'conversation', datasetIds: ['sheet1'], messages: [] });
    await deleteLocalDataset('sheet1'); expect(await loadAssistantArtifact('conversation')).toBeNull();
    expect(await saveAssistantArtifact({ id: 'late', datasetIds: ['sheet1'], messages: [] })).toBe(false);
  });
  it('preserves the last valid catalog when replacement cannot be cloned', async () => {
    await saveLocalDataset(dataset('valid'));
    await expect(saveLocalDatasetCatalog([{ ...dataset('bad'), cannotClone: () => {} }])).rejects.toBeDefined();
    expect((await loadLocalDatasetCatalog()).datasets[0].id).toBe('valid');
  });
  it('rejects stale approval commits without replacing saved rows', async () => {
    const original = dataset('valid'); await saveLocalDataset(original);
    await saveLocalDataset({ ...original, revision: 'r2', rawRows: [{ value: 9 }] });
    await expect(saveLocalDataset(original, { expectedRevision: qualityRevisionKey(original) })).rejects.toThrow('saved source changed');
    expect((await loadLocalDatasetCatalog()).datasets[0].rawRows[0].value).toBe(9);
  });
});
