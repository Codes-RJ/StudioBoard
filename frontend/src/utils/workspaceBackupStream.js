import { MAX_WORKSPACE_BACKUP_BYTES, restoreDataset, restoreLayout, restoreFilters, restorePalette } from './workspaceBackupValidation';
import { loadLocalDatasetHeader, scanLocalDatasetRows, loadLocalSourceFile, beginLocalImport, stageLocalImportHeader,
  stageLocalImportRowPage, stageLocalImportFileChunk, updateStagedLocalImportMetrics, publishLocalImport, discardLocalImport } from './localDatasetStore';
import { createScopedDatasetMetricsAccumulator } from './localDataEngine';
import { encodeDatasetPayload } from './datasetWorkerPayload';
import { newDatasetRevision } from './qualityReview';

const KIND = 'analytics-dashboard-record-stream';
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const uid = (kind) => `${kind}_${newDatasetRevision()}`;
const cancelled = (signal) => { if (signal?.aborted) throw new DOMException('Workspace backup cancelled.', 'AbortError'); };
const sha256 = async (text) => {
  if (!globalThis.crypto?.subtle) throw new Error('Backup verification requires a secure browser context.');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const blobBase64 = async (blob) => {
  if (typeof blob.arrayBuffer === 'function') {
    let binary = ''; for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  return new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
  });
};
const portableSource = (source) => {
  const header = { ...source }; const streams = {};
  for (const field of ['rawRows', 'sourceRows']) if (Array.isArray(source[field])) { streams[field] = source[field]; delete header[field]; }
  header.cleaningHistory = source.cleaningHistory?.map((entry, index) => {
    const copy = { ...entry };
    for (const field of ['rows', 'rawRows', 'sourceRows']) if (Array.isArray(entry[field])) { streams[`history:${index}:${field}`] = entry[field]; delete copy[field]; }
    return copy;
  });
  header.rowStorage = { version: 1, generation: 'portable', firstRowFields: Object.keys(source.rawRows[0] || {}),
    streams: Object.fromEntries(Object.entries(streams).map(([stream, rows]) => [stream, { length: rows.length, chunks: Math.ceil(rows.length / 512) }])) };
  return { header, streams };
};

// A Blob is built from individually converted records. No full collection row
// arrays, full original-file base64 strings or monolithic JSON string is built.
export const createWorkspaceStream = async (workspace, { signal, onProgress } = {}) => {
  const selected = workspace.dataset;
  if (!selected?.isLocal || !workspace.layout?.layout?.length) throw new Error('Select a local workspace before backing up.');
  const sources = selected.folderId ? workspace.datasets.filter((source) => source.folderId === selected.folderId) : [selected];
  if (!sources.length || sources.length > 201 || (selected.folderId && (sources.filter((source) => source.isFolderOverview).length !== 1 || !sources.some((source) => source.id === selected.id)))) throw new Error('The complete collection is unavailable for backup.');
  const prepared = [];
  for (const source of sources) {
    cancelled(signal);
    const reference = encodeDatasetPayload({ dataset: source }).dataset;
    if (reference?.kind === 'local-dataset-reference' || source.metadataOnly) {
      const expected = reference.kind === 'local-dataset-reference' ? { expectedRevision: reference.revision, expectedStorageRevision: reference.storageRevision }
        : { expectedRevision: source.revisionKey, expectedStorageRevision: source.storageRevision };
      prepared.push({ header: await loadLocalDatasetHeader(source.id, expected), expected });
    } else {
      if (source.rowStreamsDeferred) throw new Error('Save the pending source changes before backing up; original and history streams are still deferred.');
      prepared.push(portableSource(source));
    }
  }
  const ids = new Set(sources.map((source) => source.id));
  const layouts = [...new Map([...(workspace.layouts || []).filter((layout) => ids.has(layout.sourceDatasetId)), { ...workspace.layout, sourceDatasetId: selected.id }].map((layout) => [layout.id, layout])).values()];
  const files = [...new Map(prepared.flatMap(({ header }) => header.sourceFile?.id ? [[header.sourceFile.id, header.sourceFile]] : [])).values()];
  const parts = []; let digest = ''; let size = 0; let records = 0;
  const append = async (payload) => {
    cancelled(signal);
    const serialized = JSON.stringify(payload); digest = await sha256(`${digest}\n${serialized}`);
    const part = new Blob([JSON.stringify({ payload, digest }) + '\n'], { type: 'application/x-ndjson' });
    size += part.size;
    if (part.size > MAX_RECORD_BYTES || size > MAX_WORKSPACE_BACKUP_BYTES) throw new Error('The backup exceeds its 4 MB record or 200 MB workspace limit.');
    parts.push(part); records += 1; onProgress?.({ records, bytes: size });
  };
  await append({ type: 'manifest', kind: KIND, version: 6, exportedAt: new Date().toISOString(),
    datasets: prepared.map(({ header }) => header), originalFiles: files, layouts, selectedDatasetId: selected.id, selectedLayoutId: workspace.layout.id,
    filters: workspace.filters || {}, palette: workspace.palette || 'blue' });
  for (const source of prepared) for (const stream of Object.keys(source.header.rowStorage.streams)) {
    if (source.streams) {
      const rows = source.streams[stream];
      for (let index = 0; index < Math.ceil(rows.length / 512); index++) await append({ type: 'rows', datasetId: source.header.id, stream, index, rows: rows.slice(index * 512, (index + 1) * 512) });
    } else await scanLocalDatasetRows(source.header.id, async (rows, { offset }) => append({ type: 'rows', datasetId: source.header.id, stream, index: offset / 512, rows }), { ...source.expected, stream, signal });
  }
  for (const metadata of files) {
    const archived = await loadLocalSourceFile(metadata.id);
    if (!archived?.blob || archived.blob.size !== metadata.size) throw new Error(`Original file ${metadata.name} is unavailable; no complete backup was produced.`);
    for (let offset = 0, index = 0; offset < Math.max(1, archived.blob.size); offset += 65536, index++) {
      await append({ type: 'file', fileId: metadata.id, index, base64: await blobBase64(archived.blob.slice(offset, offset + 65536)) });
    }
  }
  for (const source of prepared.filter((source) => source.expected)) await loadLocalDatasetHeader(source.header.id, source.expected);
  await append({ type: 'end', records });
  return new Blob(parts, { type: 'application/x-ndjson' });
};

async function* recordsFrom(file, signal) {
  const decoder = new TextDecoder('utf-8', { fatal: true }); let buffer = '';
  const reader = file.stream().getReader();
  try {
    while (true) {
      cancelled(signal); const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let position;
      while ((position = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, position); buffer = buffer.slice(position + 1);
        if (!line || new TextEncoder().encode(line).length > MAX_RECORD_BYTES) throw new Error('Invalid or oversized backup record.');
        yield JSON.parse(line);
      }
      if (buffer.length > MAX_RECORD_BYTES) throw new Error('Oversized backup record.');
      if (done) { if (buffer.length) throw new Error('The backup is truncated.'); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

const validateManifest = (manifest) => {
  if (manifest.kind !== KIND || manifest.version !== 6 || !Array.isArray(manifest.datasets) || !manifest.datasets.length || manifest.datasets.length > 201
    || !Array.isArray(manifest.layouts) || !manifest.layouts.length || manifest.layouts.length > 1000 || !Array.isArray(manifest.originalFiles) || manifest.originalFiles.length > 100
    || new Set(manifest.datasets.map((source) => source.id)).size !== manifest.datasets.length || new Set(manifest.originalFiles.map((file) => file.id)).size !== manifest.originalFiles.length) throw new Error('Invalid backup manifest.');
  let totalRows = 0;
  if (manifest.datasets.length > 1 && (manifest.datasets.filter((source) => source.isFolderOverview).length !== 1
    || !manifest.datasets.every((source) => source.folderId) || new Set(manifest.datasets.map((source) => source.folderId)).size !== 1)) throw new Error('The backup collection is incomplete.');
  for (const header of manifest.datasets) {
    const streams = header.rowStorage?.streams;
    if (header.rowStorage?.version !== 1 || !streams?.rawRows || header.rawRows || header.sourceRows) throw new Error('Invalid source row manifest.');
    for (const [stream, spec] of Object.entries(streams)) {
      if (!['rawRows', 'sourceRows'].includes(stream) && !/^history:\d+:(rows|rawRows|sourceRows)$/.test(stream)) throw new Error('Unsupported backup row stream.');
      if (!Number.isSafeInteger(spec.length) || spec.length < 0 || spec.length > 1_000_000 || spec.chunks !== Math.ceil(spec.length / 512)) throw new Error('Invalid backup row counts.');
      if (stream.startsWith('history:') && !header.cleaningHistory?.[Number(stream.split(':')[1])]) throw new Error('Missing backup history metadata.');
    }
    if (!streams.rawRows.length || (streams.sourceRows && streams.sourceRows.length !== streams.rawRows.length)) throw new Error('Invalid working/original alignment.');
    totalRows += streams.rawRows.length;
  }
  if (totalRows > 1_000_201) throw new Error('The collection contains too many rows.');
  for (const file of manifest.originalFiles) if (typeof file.id !== 'string' || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 100 * 1024 * 1024) throw new Error('Invalid original-file metadata.');
};

export const restoreWorkspaceStream = async (file, { signal, onProgress } = {}) => {
  const accumulators = new Map(); let retainedSampleBytes = 0;
  if (file.size > MAX_WORKSPACE_BACKUP_BYTES) throw new Error('The backup exceeds the 200 MB workspace limit.');
  let sessionId; let digest = ''; let records = 0; let ended = false; let manifest; let workspace;
  const sourceIds = new Map(); const sourceHeaders = new Map(); const fileIds = new Map(); const fileMetadata = new Map(); const fileChunks = new Map();
  try {
    for await (const record of recordsFrom(file, signal)) {
      if (ended || !record?.payload || typeof record.digest !== 'string') throw new Error('Invalid or trailing backup records.');
      const serialized = JSON.stringify(record.payload); const expected = await sha256(`${digest}\n${serialized}`);
      if (expected !== record.digest) throw new Error('Backup integrity check failed; nothing was restored.');
      digest = expected; const payload = record.payload;
      if (!manifest) {
        if (payload.type !== 'manifest') throw new Error('The backup manifest must come first.');
        manifest = payload; validateManifest(manifest); sessionId = await beginLocalImport();
        const folderId = manifest.datasets.length > 1 ? uid('folder') : undefined;
        manifest.originalFiles.forEach((metadata) => { const id = uid('source'); fileIds.set(metadata.id, id); fileMetadata.set(metadata.id, { ...metadata, id }); });
        for (const source of manifest.datasets) {
          const blank = Object.fromEntries((source.columns || []).map((column) => [typeof column === 'string' ? column : column.name, null]));
          const validated = restoreDataset({ ...source, rawRows: [blank], ...(source.rowStorage.streams.sourceRows ? { sourceRows: [blank] } : {}) }, { folderId });
          delete validated.rawRows; delete validated.sourceRows;
          const generation = uid('rows'); const header = { ...validated, rowCount: source.rowStorage.streams.rawRows.length,
            rowStorage: { ...source.rowStorage, generation }, storageRevision: generation, cleaningHistory: source.cleaningHistory || [] };
          if (source.sourceFile) {
            const metadata = fileMetadata.get(source.sourceFile.id);
            if (!metadata || metadata.size !== source.sourceFile.size) throw new Error('An original file referenced by a source is missing.');
            header.sourceFile = metadata;
          }
          sourceIds.set(source.id, header.id); sourceHeaders.set(source.id, header);
        }
        for (const source of manifest.datasets) {
          const header = sourceHeaders.get(source.id);
          if (source.relationships) header.relationships = source.relationships.map((edge) => ({ ...edge,
            id: uid('relationship'), leftDatasetId: sourceIds.get(edge.leftDatasetId), rightDatasetId: sourceIds.get(edge.rightDatasetId),
            status: 'needs_review', leftUpdatedAt: null, rightUpdatedAt: null, leftRevisionKey: null, rightRevisionKey: null }));
          await stageLocalImportHeader(sessionId, header);
        }
        const datasets = [...sourceHeaders.values()]; const selected = sourceHeaders.get(manifest.selectedDatasetId);
        if (!selected) throw new Error('The selected source is missing.');
        const layouts = manifest.layouts.map((layout) => {
          const id = sourceIds.get(layout.sourceDatasetId); if (!id) throw new Error('A layout references a missing source.'); return restoreLayout(layout, id);
        });
        const layoutIndex = manifest.layouts.findIndex((layout) => layout.id === manifest.selectedLayoutId);
        if (layoutIndex < 0 || layouts[layoutIndex].sourceDatasetId !== selected.id) throw new Error('The selected layout is missing.');
        workspace = { dataset: selected, datasets, layouts, layout: layouts[layoutIndex], filters: restoreFilters(manifest.filters, selected.columns), palette: restorePalette(manifest.palette) };
      } else if (payload.type === 'rows') {
        const id = sourceIds.get(payload.datasetId); if (!id) throw new Error('Unknown backup source.');
        await stageLocalImportRowPage(sessionId, id, payload.stream, payload.index, payload.rows);
        if (payload.stream === 'rawRows') {
          const header = sourceHeaders.get(payload.datasetId);
          if (!accumulators.has(id)) accumulators.set(id, { accumulator: createScopedDatasetMetricsAccumulator(header), bytes: 0 });
          const state = accumulators.get(id);
          for (const row of payload.rows.slice(0, Math.max(0, 500 - payload.index * 512))) {
            const bytes = JSON.stringify(row).length * 2; state.bytes += bytes; retainedSampleBytes += bytes;
          }
          if (retainedSampleBytes > 32 * 1024 * 1024) throw new Error('Backup metric classification exceeds its 32 MB retained-sample policy. Restore a smaller workspace.');
          state.accumulator.consume(payload.rows);
          if (payload.index + 1 === header.rowStorage.streams.rawRows.chunks) {
            await updateStagedLocalImportMetrics(sessionId, id, state.accumulator.finish());
            retainedSampleBytes -= state.bytes; accumulators.delete(id);
          }
        }
      } else if (payload.type === 'file') {
        const metadata = fileMetadata.get(payload.fileId);
        if (!metadata || payload.index !== (fileChunks.get(payload.fileId) || 0) || typeof payload.base64 !== 'string'
          || payload.base64.length > 87384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.base64)) throw new Error('Invalid original-file chunk.');
        const bytes = Uint8Array.from(atob(payload.base64), (value) => value.charCodeAt(0));
        await stageLocalImportFileChunk(sessionId, metadata, payload.index, new Blob([bytes], { type: metadata.type }));
        fileChunks.set(payload.fileId, payload.index + 1);
      } else if (payload.type === 'end') {
        if (payload.records !== records || manifest.originalFiles.some((metadata) => (fileChunks.get(metadata.id) || 0) !== Math.max(1, Math.ceil(metadata.size / 65536)))) throw new Error('The backup is incomplete.');
        ended = true;
      } else throw new Error('Unknown backup record.');
      records += 1; onProgress?.({ records, bytes: file.size });
    }
    if (!ended) throw new Error('The backup is truncated; nothing was restored.');
    cancelled(signal); const summaries = await publishLocalImport(sessionId, { workspace, signal });
    const dataset = summaries.find((source) => source.id === workspace.dataset.id);
    return { ...workspace, dataset, datasets: summaries, persisted: true };
  } catch (error) { if (sessionId) await discardLocalImport(sessionId); throw error; }
};
