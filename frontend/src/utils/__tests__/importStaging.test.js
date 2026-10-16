import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { Blob } from 'node:buffer';
import { beginLocalImport, stageLocalImport, publishLocalImport, discardLocalImport, cleanupAbandonedLocalImports,
  loadLocalDatasetCatalog, loadLocalSourceFile, loadLocalDataset, saveLocalDataset, clearLocalDatasetCatalog } from '../localDatasetStore';
import { importLocalFolder } from '../folderImport';
import { createLocalDatasetFromRows } from '../localDataEngine';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); localStorage.clear(); });
const source = (id) => ({ ...createLocalDatasetFromRows({ name: `${id}.csv` }, [{ ID: '0001', Amount: '12' }], ['ID', 'Amount']), id });
const counts = () => new Promise((resolve) => {
  const request = indexedDB.open('analytics-dashboard-local-data');
  request.onsuccess = () => {
    const database = request.result; const names = ['workspaceImports', 'stagedDatasets', 'stagedFiles', 'datasetRows'];
    const transaction = database.transaction(names, 'readonly'); const values = {};
    for (const name of names) { const read = transaction.objectStore(name).count(); read.onsuccess = () => { values[name] = read.result; }; }
    transaction.oncomplete = () => { database.close(); resolve(values); };
  };
});

describe('recoverable import staging', () => {
  it('keeps sources and originals hidden until the entire collection publishes', async () => {
    const session = await beginLocalImport();
    const archive = { id: 'workbook', blob: new Blob(['original bytes']) };
    await stageLocalImport(session, [{ ...source('sheet-a'), sourceFile: { id: archive.id } }], [archive]);
    await stageLocalImport(session, [{ ...source('sheet-b'), sourceFile: { id: archive.id } }]);
    expect((await loadLocalDatasetCatalog({ metadataOnly: true })).datasets).toEqual([]);
    expect(await loadLocalSourceFile(archive.id)).toBeNull(); expect(await loadLocalDataset('sheet-a')).toBeNull();
    const published = await publishLocalImport(session);
    expect(published.map(({ id }) => id).sort()).toEqual(['sheet-a', 'sheet-b']);
    expect(published.every((item) => item.metadataOnly)).toBe(true);
    expect((await loadLocalDataset('sheet-a')).rawRows[0].ID).toBe('0001');
    expect((await loadLocalSourceFile(archive.id)).blob.size).toBe(14);
    expect(await counts()).toEqual({ workspaceImports: 0, stagedDatasets: 0, stagedFiles: 0, datasetRows: 2 });
  });
  it('discards all staged pages and blobs while preserving the saved workspace', async () => {
    await saveLocalDataset(source('previous'));
    const session = await beginLocalImport();
    await stageLocalImport(session, [source('candidate')], [{ id: 'candidate-file', blob: new Blob(['private']) }]);
    await discardLocalImport(session);
    expect(await counts()).toEqual({ workspaceImports: 0, stagedDatasets: 0, stagedFiles: 0, datasetRows: 1 });
    expect((await loadLocalDatasetCatalog()).datasets.map(({ id }) => id)).toEqual(['previous']);
    await expect(publishLocalImport(session)).rejects.toThrow('no staged sources');
  });
  it('rolls back a failed file stage and cannot overwrite an existing source', async () => {
    await saveLocalDataset(source('existing')); const session = await beginLocalImport();
    await expect(stageLocalImport(session, [source('existing')])).rejects.toThrow('already exists');
    await expect(stageLocalImport(session, [source('bad')], [{ id: 'uncloneable', value: () => {} }])).rejects.toBeDefined();
    expect(await counts()).toEqual({ workspaceImports: 1, stagedDatasets: 0, stagedFiles: 0, datasetRows: 1 });
    await discardLocalImport(session);
  });
  it('cancels an import between files with no partially visible collection or orphan originals', async () => {
    const controller = new AbortController(); let parsed = 0;
    await expect(importLocalFolder([new File(['data'], 'a.csv'), new File(['data'], 'b.csv')], {
      signal: controller.signal,
      parseFileDatasets: async (file) => { parsed++; return [source(file.name)]; },
      onProgress: ({ completed }) => { if (completed === 1) controller.abort(); }
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(parsed).toBe(1); expect((await loadLocalDatasetCatalog()).datasets).toEqual([]);
    expect(await counts()).toEqual({ workspaceImports: 0, stagedDatasets: 0, stagedFiles: 0, datasetRows: 0 });
  });
  it('cleans expired sessions, preserves fresh sessions and cancels staging on a catalog reset', async () => {
    const old = await beginLocalImport(); await stageLocalImport(old, [source('old')]);
    await cleanupAbandonedLocalImports({ olderThan: Date.now() + 1 });
    expect((await counts()).datasetRows).toBe(0);
    const fresh = await beginLocalImport(); await stageLocalImport(fresh, [source('fresh')]);
    await cleanupAbandonedLocalImports(); expect((await counts()).stagedDatasets).toBe(1);
    await clearLocalDatasetCatalog(); expect((await counts()).stagedDatasets).toBe(0);
    await expect(publishLocalImport(fresh)).rejects.toThrow('no staged sources');
  });
});
