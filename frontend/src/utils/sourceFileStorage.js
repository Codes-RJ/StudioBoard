// Blob persistence fails in some WebKit environments. Store exact binary chunks
// instead; reconstruct the public Blob only when an original is requested.
const CHUNK_BYTES = 1024 * 1024;
export const FILE_CHUNK_STORE = 'sourceFileChunks';
const cancelled = (signal) => { if (signal?.aborted) throw new DOMException('Preserving the original was cancelled.', 'AbortError'); };
export const readBlobBytes = async (blob) => {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read original bytes.'));
    reader.readAsArrayBuffer(blob);
  });
};
export const archiveByteLength = (record) => {
  if (record?.blob) return record.blob.size; // Previously stored originals remain compatible.
  if (record?.byteFormat === 2 && Number.isSafeInteger(record.storedBytes) && record.storedBytes >= 0
    && Number.isSafeInteger(record.byteChunkCount) && record.byteChunkCount > 0 && record.byteChunkCount <= 3200
    && typeof record.chunkGeneration === 'string') return record.storedBytes;
  if (record?.byteFormat !== 1 || !Array.isArray(record.byteChunks)) throw new Error('The original-file byte archive is invalid.');
  let length = 0;
  for (const chunk of record.byteChunks) {
    if (Object.prototype.toString.call(chunk) !== '[object ArrayBuffer]' || chunk.byteLength > CHUNK_BYTES) throw new Error('An original-file byte chunk is invalid.');
    length += chunk.byteLength;
  }
  return length;
};
export const encodeArchivedFile = async (record, { signal } = {}) => {
  cancelled(signal);
  if (!record.blob) { if (archiveByteLength(record) !== record.size) throw new Error('Original-file bytes do not match their size.'); return record; }
  if (record.size !== undefined && record.size !== record.blob.size) throw new Error('Original-file bytes do not match their size.');
  const byteChunks = [];
  for (let offset = 0; offset < record.blob.size; offset += CHUNK_BYTES) {
    cancelled(signal); byteChunks.push(await readBlobBytes(record.blob.slice(offset, offset + CHUNK_BYTES)));
  }
  cancelled(signal);
  const { blob, ...metadata } = record;
  return { ...metadata, size: blob.size, byteFormat: 1, byteChunks };
};
export const encodeArchivedFiles = async (records, options) => {
  const result = []; for (const record of records) result.push(await encodeArchivedFile(record, options)); return result;
};
export const decodeArchivedFile = (record) => {
  if (!record || record.blob) return record;
  if (archiveByteLength(record) !== record.size) throw new Error('The saved original is incomplete.');
  const { byteChunks, byteFormat, ...metadata } = record;
  return { ...metadata, blob: new Blob(byteChunks, { type: record.type || 'application/octet-stream' }) };
};
export const deleteSourceFileChunks = (transaction, fileId) => {
  const request = transaction.objectStore(FILE_CHUNK_STORE).index('fileId').openCursor(fileId);
  request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
};
export const readArchivedFile = (transaction, record, complete, fail) => {
  if (record?.byteFormat !== 2) { complete(decodeArchivedFile(record)); return; }
  if (archiveByteLength(record) !== record.size) throw new Error('The saved original is incomplete.');
  const parts = new Array(record.byteChunkCount); let next = 0; let active = 0; let received = 0; let size = 0; let stopped = false;
  const pump = () => {
    while (!stopped && active < 4 && next < parts.length) {
      const index = next++; active++;
      const request = transaction.objectStore(FILE_CHUNK_STORE).get([record.id, record.chunkGeneration, index]);
      request.onsuccess = () => {
        const bytes = request.result?.bytes;
        if (Object.prototype.toString.call(bytes) !== '[object ArrayBuffer]' || bytes.byteLength > CHUNK_BYTES) { stopped = true; fail(new Error('A saved original-file chunk is missing or invalid.')); return; }
        parts[index] = bytes; size += bytes.byteLength; active--; received++;
        if (size > record.size) { stopped = true; fail(new Error('Saved original bytes exceed their declared size.')); return; }
        if (received === parts.length) {
          if (size !== record.size) { fail(new Error('The saved original is incomplete.')); return; }
          const { byteFormat, byteChunkCount, chunkGeneration, storedBytes, ...metadata } = record;
          complete({ ...metadata, blob: new Blob(parts, { type: record.type || 'application/octet-stream' }) });
        } else pump();
      };
      request.onerror = () => { stopped = true; fail(request.error || new Error('Unable to read original bytes.')); };
    }
  };
  pump();
};
