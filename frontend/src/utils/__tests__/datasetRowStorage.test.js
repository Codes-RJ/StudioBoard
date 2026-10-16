import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { saveLocalDataset, loadLocalDataset, deleteLocalDataset, scanLocalDatasetRows, loadLocalDatasetCatalog } from '../localDatasetStore';
import { ROW_CHUNK_SIZE } from '../datasetRowStorage';
import { qualityRevisionKey } from '../qualityReview';
import { encodeDatasetPayload, decodeDatasetPayload } from '../datasetWorkerPayload';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); localStorage.clear(); });
const fixture = (id = 'paged') => ({ id, revision: 'r1', columns: [{ name: 'ID', type: 'string' }, { name: 'value', type: 'number' }],
  rawRows: Array.from({ length: ROW_CHUNK_SIZE * 2 + 3 }, (_, i) => ({ ID: String(i).padStart(5, '0'), value: i === 17 ? '' : i })),
  sourceRows: [{ ID: '00017', value: ' ' }], cleaningHistory: [{ rows: [{ ID: '00017', value: 'original' }], label: 'exact snapshot' }] });
const inspect = (operation) => new Promise((resolve, reject) => {
  const request = indexedDB.open('analytics-dashboard-local-data');
  request.onsuccess = () => {
    const database = request.result;
    const transaction = database.transaction(['datasets', 'datasetRows'], 'readwrite');
    let result;
    operation(transaction, (value) => { result = value; });
    transaction.oncomplete = () => { database.close(); resolve(result); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  };
});

describe('immutable row pages and worker ownership', () => {
  it('bounds concurrent clones while reconstructing every page in order', async () => {
    const source = fixture(); source.rawRows = Array.from({ length: 512 * 12 + 7 }, (_, value) => ({ ID: String(value), value }));
    await saveLocalDataset(source);
    const original = IDBObjectStore.prototype.get; let active = 0; let maximum = 0;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (...args) {
      const request = original.apply(this, args);
      if (this.name === 'datasetRows') { active++; maximum = Math.max(maximum, active); request.addEventListener('success', () => { active--; }); }
      return request;
    });
    try {
      const loaded = await loadLocalDataset(source.id, { workingOnly: true });
      expect(loaded.rawRows).toEqual(source.rawRows); expect(maximum).toBeGreaterThan(1); expect(maximum).toBeLessThanOrEqual(4);
    } finally { spy.mockRestore(); }
  });
  it('aborts a partial save if an original page is missing, preserving the accepted working generation', async () => {
    const source = fixture(); await saveLocalDataset(source); const view = await loadLocalDataset(source.id, { workingOnly: true });
    await inspect((transaction) => { const store = transaction.objectStore('datasetRows'); store.delete([source.id, view.storageRevision, 'sourceRows', 0]); });
    await expect(saveLocalDataset({ ...view, name: 'Must not publish' }, { expectedStorageRevision: view.storageRevision })).rejects.toBeDefined();
    const accepted = await loadLocalDataset(source.id, { workingOnly: true });
    expect(accepted.rawRows).toEqual(source.rawRows); expect(accepted.name).not.toBe('Must not publish'); expect(accepted.storageRevision).toBe(view.storageRevision);
  });
  it('opens working rows alone and retains originals/history through a metadata edit', async () => {
    const source = fixture(); await saveLocalDataset(source);
    const view = await loadLocalDataset(source.id, { workingOnly: true });
    expect(view.rawRows).toEqual(source.rawRows); expect(view.sourceRows).toBeUndefined(); expect(view.cleaningHistory[0].rows).toBeUndefined();
    await saveLocalDataset({ ...view, name: 'Renamed' }, { expectedStorageRevision: view.storageRevision });
    const complete = await loadLocalDataset(source.id);
    expect(complete.sourceRows).toEqual(source.sourceRows); expect(complete.cleaningHistory).toEqual(source.cleaningHistory); expect(complete.name).toBe('Renamed');
    expect(complete.rowStreamsDeferred).toBeUndefined();
  });
  it('stores bounded pages and reconstructs every original row and legacy snapshot in order', async () => {
    const source = fixture(); await saveLocalDataset(source);
    const stored = await inspect((transaction, done) => {
      const request = transaction.objectStore('datasets').get(source.id); request.onsuccess = () => done(request.result);
    });
    expect(stored).not.toHaveProperty('rawRows'); expect(stored).not.toHaveProperty('sourceRows');
    expect(stored.cleaningHistory[0]).not.toHaveProperty('rows');
    expect(stored.rowStorage.streams.rawRows).toEqual({ length: 1027, chunks: 3 });
    const sizes = await inspect((transaction, done) => {
      const request = transaction.objectStore('datasetRows').getAll(); request.onsuccess = () => done(request.result.map((page) => page.rows.length));
    });
    expect(Math.max(...sizes)).toBe(ROW_CHUNK_SIZE);
    expect(await loadLocalDataset(source.id)).toEqual(source);
    const seen = []; const offsets = [];
    expect(await scanLocalDatasetRows(source.id, (rows, info) => { seen.push(...rows); offsets.push(info.offset); })).toEqual({ scanned: 1027, total: 1027 });
    expect(offsets).toEqual([0, 512, 1024]); expect(seen).toEqual(source.rawRows);
  });
  it('rolls back chunk publication on cloning failure and removes obsolete generations and all pages on deletion', async () => {
    const source = fixture(); await saveLocalDataset(source);
    const changed = { ...source, revision: 'r2', rawRows: [{ ID: 'new', value: () => {} }] };
    await expect(saveLocalDataset(changed)).rejects.toBeDefined();
    expect(await loadLocalDataset(source.id)).toEqual(source);
    await saveLocalDataset({ ...source, revision: 'r2', rawRows: [{ ID: 'new', value: 10 }], sourceRows: [] });
    const pages = await inspect((transaction, done) => {
      const request = transaction.objectStore('datasetRows').getAll(); request.onsuccess = () => done(request.result);
    });
    expect(new Set(pages.map((page) => page.generation)).size).toBe(1);
    expect(pages).toHaveLength(2); // one working page and one preserved history page
    await deleteLocalDataset(source.id);
    expect(await inspect((transaction, done) => {
      const request = transaction.objectStore('datasetRows').count(); request.onsuccess = () => done(request.result);
    })).toBe(0);
  });
  it('fails closed for missing pages without making the catalog disappear', async () => {
    const source = fixture(); await saveLocalDataset(source);
    await inspect((transaction) => {
      const request = transaction.objectStore('datasetRows').openCursor();
      request.onsuccess = () => {
        const cursor = request.result; if (!cursor) return;
        if (cursor.value.stream === 'rawRows') cursor.delete(); else cursor.continue();
      };
    });
    await expect(loadLocalDataset(source.id)).rejects.toThrow('missing or incomplete');
    expect((await loadLocalDatasetCatalog({ metadataOnly: true })).datasets).toHaveLength(1);
    await expect(scanLocalDatasetRows(source.id, () => {})).rejects.toThrow('missing or incomplete');
  });
  it('cancels between pages and rejects concurrent revisions rather than mixing rows', async () => {
    const source = fixture(); await saveLocalDataset(source);
    const controller = new AbortController(); const visit = vi.fn(() => controller.abort());
    await expect(scanLocalDatasetRows(source.id, visit, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(visit).toHaveBeenCalledTimes(1);
    await expect(scanLocalDatasetRows(source.id, async (_, { offset }) => {
      if (offset === 0) await saveLocalDataset({ ...source, revision: 'r2' });
    })).rejects.toThrow('changed during this scan');
    await expect(loadLocalDataset(source.id, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(loadLocalDataset(source.id, { expectedRevision: qualityRevisionKey(source) })).rejects.toThrow('saved source changed');
  });
  it('sends saved source handles, resolves each source once and keeps unsaved/filtered rows explicit', async () => {
    const source = fixture(); await saveLocalDataset(source);
    const encoded = encodeDatasetPayload({ dataset: source, datasets: [source], rows: source.sourceRows });
    expect(JSON.stringify(encoded).length).toBeLessThan(650);
    expect(encoded.dataset.kind).toBe('local-dataset-reference');
    const read = vi.fn(loadLocalDataset);
    const decoded = await decodeDatasetPayload(encoded, read);
    expect(read).toHaveBeenCalledTimes(1); expect(decoded.dataset).toEqual(source); expect(decoded.rows).toEqual(source.sourceRows);
    const unsaved = { ...source, revision: 'not-saved', rawRows: source.rawRows.slice(0, 2) };
    expect(encodeDatasetPayload({ dataset: unsaved }).dataset).toBe(unsaved);
    expect(encodeDatasetPayload({ rows: source.rawRows.slice(0, 2) }).rows).toHaveLength(2);
    await deleteLocalDataset(source.id);
    await expect(decodeDatasetPayload(encoded, loadLocalDataset)).rejects.toThrow('deleted');
  });
  it('preserves the previous database when migration cannot write row pages', async () => {
    const source = fixture('v5');
    await new Promise((resolve) => {
      const request = indexedDB.open('analytics-dashboard-local-data', 5);
      request.onupgradeneeded = () => request.result.createObjectStore('datasets', { keyPath: 'id' }).put(source);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) {
      if (this.name === 'datasetRows') throw new DOMException('Simulated storage pressure', 'QuotaExceededError');
      return original.apply(this, args);
    });
    try { await expect(loadLocalDataset(source.id)).rejects.toBeDefined(); } finally { spy.mockRestore(); }
    expect(await loadLocalDataset(source.id)).toEqual(source);
  });
});
