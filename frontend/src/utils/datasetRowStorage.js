// Every manifest and its immutable pages are published in the same transaction.
// A bounded page limits individual IndexedDB clones; it is not a sampling limit.
export const ROW_STORE_NAME = 'datasetRows';
export const ROW_CHUNK_SIZE = 512;

const generationId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`;

export const storedDatasetIsValid = (source) => Boolean(source?.id && Array.isArray(source.columns)
  && (source.rawRows?.length > 0 || source.rowStorage?.streams?.rawRows?.length > 0));

export const deleteDatasetRows = (transaction, id, keepGeneration) => {
  const request = transaction.objectStore(ROW_STORE_NAME).index('datasetId').openCursor(id);
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    if (cursor.value.generation !== keepGeneration) cursor.delete();
    cursor.continue();
  };
};

export const writeStoredDataset = (transaction, source, { replace = true, headerStore = 'datasets', prior } = {}) => {
  const generation = generationId();
  const preserve = source.rowStreamsDeferred && prior?.rowStorage;
  if (source.rowStreamsDeferred && !preserve) throw new Error('Original and history streams are unavailable for this partial save.');
  if (replace && !preserve) deleteDatasetRows(transaction, source.id, generation);
  const streams = {};
  const header = { ...source };
  delete header.rowStorage;
  delete header.rowStreamsDeferred;
  const pages = transaction.objectStore(ROW_STORE_NAME);
  const writeStream = (name, rows) => {
    streams[name] = { length: rows.length, chunks: Math.ceil(rows.length / ROW_CHUNK_SIZE) };
    for (let index = 0; index < streams[name].chunks; index++) {
      pages.put({ datasetId: source.id, generation, stream: name, index,
        rows: rows.slice(index * ROW_CHUNK_SIZE, (index + 1) * ROW_CHUNK_SIZE) });
    }
  };
  for (const name of ['rawRows', 'sourceRows']) {
    if (Array.isArray(source[name])) { writeStream(name, source[name]); delete header[name]; }
  }
  // Older integrations stored complete snapshots. Keep them recoverable without
  // embedding their rows in the header; current cleaning uses compact recipes.
  if (Array.isArray(source.cleaningHistory)) header.cleaningHistory = source.cleaningHistory.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const snapshot = { ...entry };
    for (const name of ['rows', 'rawRows', 'sourceRows']) if (Array.isArray(entry[name])) {
      writeStream(`history:${index}:${name}`, entry[name]); delete snapshot[name];
    }
    return snapshot;
  });
  if (preserve) {
    header.cleaningHistory = prior.cleaningHistory;
    let pendingCopies = 0;
    for (const [stream, spec] of Object.entries(prior.rowStorage.streams)) {
      if (stream === 'rawRows') continue;
      streams[stream] = { ...spec };
      for (let index = 0; index < spec.chunks; index++) {
        pendingCopies++;
        const read = pages.get([source.id, prior.rowStorage.generation, stream, index]);
        read.onsuccess = () => {
          if (!Array.isArray(read.result?.rows) || read.result.rows.length !== Math.min(ROW_CHUNK_SIZE, spec.length - index * ROW_CHUNK_SIZE)) { transaction.abort(); return; }
          pages.put({ ...read.result, generation });
          if (--pendingCopies === 0 && replace) deleteDatasetRows(transaction, source.id, generation);
        };
      }
    }
    if (!pendingCopies && replace) deleteDatasetRows(transaction, source.id, generation);
  }
  header.rowStorage = { version: 1, generation, streams, firstRowFields: Object.keys(source.rawRows[0] || {}) };
  header.storageRevision = generation;
  transaction.objectStore(headerStore).put(header);
  return header;
};

// Issue all reads while the caller's snapshot transaction is active. Completion
// is reported only when every expected page exists with its declared row count.
export const hydrateStoredDataset = (transaction, header, complete, fail, { workingOnly = false, retainedPolicy } = {}) => {
  if (!header?.rowStorage) { complete(header); return; }
  const manifest = header.rowStorage;
  if (manifest.version !== 1 || !manifest.generation || !manifest.streams?.rawRows) {
    fail(new Error('The saved row manifest is invalid. Restore a backup or re-import this source.')); return;
  }
  const result = { ...header }; delete result.rowStorage; delete result.storageRevision;
  let retainedRows = 0; let retainedBytes = 0;
  if (workingOnly) { result.rowStreamsDeferred = true; result.rowStorage = manifest; }
  Object.defineProperty(result, 'storageRevision', { value: header.storageRevision, configurable: true });
  if (Array.isArray(result.cleaningHistory)) result.cleaningHistory = result.cleaningHistory.map((entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry) ? { ...entry } : entry);
  let pending = 1; let active = 0; let next = 0; let stopped = false;
  const reads = [];
  const reject = (error) => { if (!stopped) { stopped = true; fail(error); } };
  const pump = () => {
    // Limit simultaneous structured-clone work, especially for wide pages.
    // Schedule the next request inside the success callback to keep the
    // caller's single snapshot transaction active and preserve row ordering.
    while (!stopped && active < 4 && next < reads.length) { active++; reads[next++](); }
  };
  const done = () => { active--; if (--pending === 0) complete(result); else pump(); };
  for (const [stream, spec] of Object.entries(manifest.streams)) {
    if (workingOnly && stream !== 'rawRows') continue;
    retainedRows += spec.length;
    if (retainedPolicy && retainedRows > retainedPolicy.rows) { reject(new Error('Opening this source exceeds its retained-row policy. Split the original by date, sheet or category and re-import; saved rows were retained.')); return; }
    if (!Number.isSafeInteger(spec.length) || spec.length < 0 || spec.length > 1_000_000 || spec.chunks !== Math.ceil(spec.length / ROW_CHUNK_SIZE)) {
      reject(new Error('The saved row manifest is inconsistent.')); return;
    }
    const rows = new Array(spec.length);
    if (stream.startsWith('history:')) {
      const [, index, field] = stream.split(':');
      if (!result.cleaningHistory?.[index] || !['rows', 'rawRows', 'sourceRows'].includes(field)) {
        reject(new Error('The saved history manifest is inconsistent.')); return;
      }
      result.cleaningHistory[index][field] = rows;
    } else if (['rawRows', 'sourceRows'].includes(stream)) result[stream] = rows;
    else { reject(new Error('The saved row stream is unsupported.')); return; }
    for (let index = 0; index < spec.chunks; index++) {
      pending++;
      reads.push(() => {
      const request = transaction.objectStore(ROW_STORE_NAME).get([header.id, manifest.generation, stream, index]);
      request.onsuccess = () => {
        const page = request.result;
        const expected = Math.min(ROW_CHUNK_SIZE, spec.length - index * ROW_CHUNK_SIZE);
        if (!Array.isArray(page?.rows) || page.rows.length !== expected) {
          reject(new Error('A saved row chunk is missing or incomplete. Restore a backup or re-import this source.')); return;
        }
        if (retainedPolicy) {
          for (const row of page.rows) retainedBytes += JSON.stringify(row).length * 2;
          if (retainedBytes > retainedPolicy.bytes) { reject(new Error('Opening this source exceeds its retained-text memory policy. Split wide or long text into smaller files and re-import; saved rows were retained.')); return; }
        }
        for (let offset = 0; offset < expected; offset++) rows[index * ROW_CHUNK_SIZE + offset] = page.rows[offset];
        done();
      };
      });
    }
  }
  if (--pending === 0) complete(result); else pump();
};
