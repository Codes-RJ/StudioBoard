import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { encodeArchivedFile, decodeArchivedFile, readBlobBytes } from '../sourceFileStorage';
import { archiveLocalSourceFile, loadLocalSourceFile, beginLocalImport, stageLocalImportFileChunk, discardLocalImport,
  stageLocalImport, publishLocalImport, deleteLocalDataset } from '../localDatasetStore';
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); localStorage.clear(); });
describe('original-file binary storage', () => {
  it('preserves arbitrary bytes and MIME without storing a Blob', async () => {
    const bytes = new Uint8Array([0, 255, 13, 10, 42, 128]);
    const encoded = await encodeArchivedFile({ id: 'binary', size: bytes.length, type: 'application/octet-stream', blob: new Blob([bytes]) });
    expect(encoded.blob).toBeUndefined();
    expect(new Uint8Array(await readBlobBytes(decodeArchivedFile(encoded).blob))).toEqual(bytes);
    const metadata = await archiveLocalSourceFile(new File([bytes], 'exact.bin'));
    expect(new Uint8Array(await readBlobBytes((await loadLocalSourceFile(metadata.id)).blob))).toEqual(bytes);
  });
  it('retains old Blob records and rejects incomplete binary archives', () => {
    const legacy = { id: 'old', blob: new Blob(['old']) }; expect(decodeArchivedFile(legacy)).toBe(legacy);
    expect(() => decodeArchivedFile({ byteFormat: 1, size: 9, byteChunks: [new ArrayBuffer(2)] })).toThrow('incomplete');
  });
  it('discards staged original chunks on cancellation', async () => {
    const session = await beginLocalImport();
    await stageLocalImportFileChunk(session, { id: 'chunked', name: 'fixture.bin', size: 4 }, 0, new Blob([new Uint8Array([0, 255])]));
    await stageLocalImportFileChunk(session, { id: 'chunked', name: 'fixture.bin', size: 4 }, 1, new Blob([new Uint8Array([1, 128])]));
    await discardLocalImport(session);
    const remaining = await new Promise((resolve) => {
      const open = indexedDB.open('analytics-dashboard-local-data'); open.onsuccess = () => {
        const db = open.result; const read = db.transaction('sourceFileChunks').objectStore('sourceFileChunks').count();
        read.onsuccess = () => { db.close(); resolve(read.result); };
      };
    });
    expect(remaining).toBe(0); expect(await loadLocalSourceFile('chunked')).toBeNull();
  });
  it('publishes ordered streamed original bytes and removes their chunks when the last source is deleted', async () => {
    const session = await beginLocalImport();
    const metadata = { id: 'published-file', name: 'exact.bin', size: 4 };
    await stageLocalImport(session, [{ id: 'published-source', name: 'Source', isLocal: true,
      columns: ['value'], rawRows: [{ value: 1 }], sourceFile: metadata }]);
    await expect(stageLocalImportFileChunk(session, metadata, 1, new Blob(['xx']))).rejects.toThrow('order');
    await stageLocalImportFileChunk(session, metadata, 0, new Blob([new Uint8Array([0, 255])]));
    await expect(publishLocalImport(session)).rejects.toThrow('incomplete');
    expect(await loadLocalSourceFile(metadata.id)).toBeNull();
    await stageLocalImportFileChunk(session, metadata, 1, new Blob([new Uint8Array([1, 128])]));
    await publishLocalImport(session);
    expect(new Uint8Array(await readBlobBytes((await loadLocalSourceFile(metadata.id)).blob))).toEqual(new Uint8Array([0, 255, 1, 128]));
    await deleteLocalDataset('published-source');
    expect(await loadLocalSourceFile(metadata.id)).toBeNull();
    const count = await new Promise((resolve, reject) => {
      const open = indexedDB.open('analytics-dashboard-local-data'); open.onerror = () => reject(open.error);
      open.onsuccess = () => { const db = open.result; const read = db.transaction('sourceFileChunks').objectStore('sourceFileChunks').count();
        read.onsuccess = () => { db.close(); resolve(read.result); }; };
    });
    expect(count).toBe(0);
  });
  it('upgrades a version-six database while preserving its original Blob bytes', async () => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('analytics-dashboard-local-data', 6);
      open.onupgradeneeded = () => { open.result.createObjectStore('datasets', { keyPath: 'id' });
        // fake-indexeddb uses Node structuredClone, which supports native Blob;
        // jsdom Blob loses its internal slots when this legacy record is cloned.
        open.result.createObjectStore('sourceFiles', { keyPath: 'id' }).put({ id: 'legacy-six', size: 3, blob: new NodeBlob([new Uint8Array([0, 255, 128])]) }); };
      open.onsuccess = () => { open.result.close(); resolve(); }; open.onerror = () => reject(open.error);
    });
    const original = await loadLocalSourceFile('legacy-six');
    expect(new Uint8Array(await readBlobBytes(original.blob))).toEqual(new Uint8Array([0, 255, 128]));
  });
});
