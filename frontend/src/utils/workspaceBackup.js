import { MAX_LOCAL_DATASET_ROWS } from './localDataEngine';
import { MAX_WORKSPACE_BACKUP_BYTES, restoreDataset, restoreLayout, restoreFilters, restorePalette } from './workspaceBackupValidation';
export { MAX_WORKSPACE_BACKUP_BYTES, restoreDataset, restoreLayout, restoreFilters, restorePalette } from './workspaceBackupValidation';
const BACKUP_KIND = 'analytics-dashboard-local-workspace';
const BACKUP_VERSION = 1;
const COLLECTION_BACKUP_VERSION = 2;
const MAX_COLLECTION_DATASETS = 201;
const MAX_COLLECTION_LAYOUTS = 1000;


const newLocalId = (prefix) => `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);

const serializeBackup = (backup) => {
  const content = JSON.stringify(backup);
  if (new TextEncoder().encode(content).byteLength > MAX_WORKSPACE_BACKUP_BYTES) {
    throw new Error('The workspace backup exceeds the 200 MB browser limit.');
  }
  return content;
};

export const serializeWorkspaceBackup = ({ dataset, layout, datasets = [], layouts = [], filters = {}, palette = 'blue' }) => {
  if (!dataset?.isLocal || !Array.isArray(dataset.rawRows) || !dataset.rawRows.length) {
    throw new Error('Select a local dataset to back up.');
  }
  if (!Array.isArray(layout?.layout)) {
    throw new Error('The current layout is unavailable.');
  }
  if (dataset.folderId) {
    const collection = datasets.filter((item) => item.folderId === dataset.folderId);
    if (collection.length < 2 || collection.length > MAX_COLLECTION_DATASETS
      || !collection.some((item) => item.id === dataset.id)
      || collection.filter((item) => item.isFolderOverview).length !== 1) {
      throw new Error('The complete folder or workbook is unavailable for backup.');
    }
    const ids = new Set(collection.map((item) => item.id));
    const collectionLayouts = [
      ...layouts.filter((item) => ids.has(item.sourceDatasetId)),
      { ...layout, sourceDatasetId: dataset.id },
    ];
    const uniqueLayouts = [...new Map(collectionLayouts.map((item) => [item.id, item])).values()];
    if (uniqueLayouts.length > MAX_COLLECTION_LAYOUTS) {
      throw new Error(`A folder backup can contain at most ${MAX_COLLECTION_LAYOUTS} layouts.`);
    }
    return serializeBackup({
      kind: BACKUP_KIND,
      version: COLLECTION_BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      datasets: collection,
      layouts: uniqueLayouts,
      selectedDatasetId: dataset.id,
      selectedLayoutId: layout.id,
      filters,
      palette,
    });
  }
  return serializeBackup({
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    dataset,
    layout,
    filters,
    palette
  });
};

const blobBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(reader.error || new Error('Could not read an archived source file.'));
  reader.readAsDataURL(blob);
});

const sha256 = async (text) => {
  if (!globalThis.crypto?.subtle) throw new Error('Backup integrity verification requires a secure browser context.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
const integrityBackup = async (backup) => serializeBackup({ ...backup, version: 5,
  integrity: { algorithm: 'SHA-256', payloadVersion: backup.version, digest: await sha256(serializeBackup(backup)) } });

export const parseVerifiedWorkspaceBackup = async (text) => {
  let backup; try { backup = JSON.parse(text); } catch { throw new Error('This is not a valid workspace backup file.'); }
  if (backup?.version !== 5) return parseWorkspaceBackup(text);
  const { integrity, ...payload } = backup;
  if (integrity?.algorithm !== 'SHA-256' || ![1, 2, 3, 4].includes(integrity.payloadVersion) || !/^[a-f0-9]{64}$/.test(integrity.digest || '')) throw new Error('The backup has an invalid integrity manifest.');
  payload.version = integrity.payloadVersion;
  const serialized = serializeBackup(payload);
  if (await sha256(serialized) !== integrity.digest) throw new Error('Backup integrity check failed. The file changed or is damaged; nothing was restored.');
  return parseWorkspaceBackup(serialized);
};

/** Portable backups include one original file per archive, even for many sheets. */
export const serializeWorkspaceBackupWithSources = async (workspace, { loadSource } = {}) => {
  const backup = JSON.parse(serializeWorkspaceBackup(workspace));
  const sources = backup.datasets || [backup.dataset];
  const files = [...new Map(sources.filter((source) => source.sourceFile?.id).map((source) => [source.sourceFile.id, source.sourceFile])).values()];
  if (!files.length) return integrityBackup(backup);
  const loader = loadSource || (await import('./localDatasetStore')).loadLocalSourceFile;
  backup.originalFiles = [];
  let estimatedBytes = new TextEncoder().encode(JSON.stringify(backup)).byteLength;
  for (const metadata of files) {
    const archived = await loader(metadata.id);
    if (!archived?.blob || archived.blob.size !== metadata.size) throw new Error(`Original file "${metadata.name}" is unavailable. Import it again before creating a complete backup.`);
    estimatedBytes += Math.ceil(archived.blob.size / 3) * 4 + 2048;
    if (estimatedBytes > MAX_WORKSPACE_BACKUP_BYTES) throw new Error('The complete backup, including original files, exceeds the 200 MB browser limit.');
    backup.originalFiles.push({ ...metadata, base64: await blobBase64(archived.blob) });
  }
  backup.version = backup.datasets ? 4 : 3;
  return integrityBackup(backup);
};

const parseCollectionBackup = (backup) => {
  const sources = backup.datasets;
  if (!Array.isArray(sources) || sources.length < 2 || sources.length > MAX_COLLECTION_DATASETS
    || !sources.every((source) => isRecord(source) && source.isLocal && source.id && source.folderId)
    || new Set(sources.map(({ id }) => id)).size !== sources.length
    || new Set(sources.map(({ folderId }) => folderId)).size !== 1
    || sources.filter(({ isFolderOverview }) => isFolderOverview).length !== 1) {
    throw new Error('The backup does not contain a complete folder or workbook.');
  }
  const totalRows = sources.reduce((sum, source) => sum + (Array.isArray(source.rawRows) ? source.rawRows.length : 0), 0);
  if (totalRows > MAX_LOCAL_DATASET_ROWS + MAX_COLLECTION_DATASETS) {
    throw new Error('The backup contains too many folder rows.');
  }
  const folderId = newLocalId('folder');
  const datasets = sources.map((source) => restoreDataset(source, { folderId }));
  const datasetIds = new Map(sources.map((source, index) => [source.id, datasets[index].id]));
  const sourceOverview = sources.find(({ isFolderOverview }) => isFolderOverview);
  const restoredOverview = datasets.find(({ isFolderOverview }) => isFolderOverview);
  if (Array.isArray(sourceOverview.relationships) && restoredOverview) {
    restoredOverview.relationships = sourceOverview.relationships.filter(isRecord).slice(0, 500).flatMap((item) => {
      const leftDatasetId = datasetIds.get(item.leftDatasetId);
      const rightDatasetId = datasetIds.get(item.rightDatasetId);
      const leftSource = sources.find(({ id }) => id === item.leftDatasetId);
      const rightSource = sources.find(({ id }) => id === item.rightDatasetId);
      const leftColumn = String(item.leftColumn || '');
      const rightColumn = String(item.rightColumn || '');
      if (!leftDatasetId || !rightDatasetId || !leftSource?.columns?.some((column) => (typeof column === 'string' ? column : column?.name) === leftColumn)
        || !rightSource?.columns?.some((column) => (typeof column === 'string' ? column : column?.name) === rightColumn)) return [];
      return [{
        ...item,
        id: `${leftDatasetId}:${leftColumn}->${rightDatasetId}:${rightColumn}`,
        leftDatasetId,
        rightDatasetId,
        status: 'needs_review',
        leftUpdatedAt: null,
        rightUpdatedAt: null,
      }];
    });
  }
  const selectedId = datasetIds.get(backup.selectedDatasetId);
  if (!selectedId) throw new Error('The selected dataset is missing from this backup.');
  const dataset = datasets.find(({ id }) => id === selectedId);
  if (!Array.isArray(backup.layouts) || !backup.layouts.length || backup.layouts.length > MAX_COLLECTION_LAYOUTS) {
    throw new Error('The backup contains invalid folder layouts.');
  }
  const layouts = backup.layouts.map((source) => {
    const sourceDatasetId = datasetIds.get(source?.sourceDatasetId);
    if (!sourceDatasetId) throw new Error('A folder layout references a missing dataset.');
    return restoreLayout(source, sourceDatasetId);
  });
  const selectedLayoutIndex = backup.layouts.findIndex(({ id }) => id === backup.selectedLayoutId);
  if (selectedLayoutIndex < 0 || layouts[selectedLayoutIndex].sourceDatasetId !== selectedId) {
    throw new Error('The selected layout is missing from this backup.');
  }
  const layout = layouts[selectedLayoutIndex];
  return { dataset, datasets, layout, layouts, filters: restoreFilters(backup.filters, dataset.columns), palette: restorePalette(backup.palette) };
};

export const parseWorkspaceBackup = (text) => {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error('This is not a valid workspace backup file.');
  }
  if (backup?.kind !== BACKUP_KIND || ![BACKUP_VERSION, COLLECTION_BACKUP_VERSION, 3, 4].includes(backup.version)) {
    throw new Error('This file is not a supported Analytics Dashboard workspace backup.');
  }
  if (backup.version === 3 || backup.version === 4) {
    if (!Array.isArray(backup.originalFiles) || !backup.originalFiles.length || backup.originalFiles.length > 100
      || new Set(backup.originalFiles.map((file) => file?.id)).size !== backup.originalFiles.length) throw new Error('The backup contains invalid original files.');
    let totalBytes = 0;
    const sourceFiles = backup.originalFiles.map((file) => {
      if (!isRecord(file) || typeof file.id !== 'string' || typeof file.base64 !== 'string'
        || !Number.isInteger(file.size) || file.size < 0 || file.size > 100 * 1024 * 1024
        || file.base64.length !== Math.ceil(file.size / 3) * 4
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) throw new Error('The backup contains invalid original file bytes.');
      totalBytes += file.size;
      if (totalBytes > MAX_WORKSPACE_BACKUP_BYTES) throw new Error('The original files exceed the browser backup limit.');
      const bytes = Uint8Array.from(atob(file.base64), (value) => value.charCodeAt(0));
      if (bytes.byteLength !== file.size) throw new Error('The backup contains truncated original files.');
      return { id: newLocalId('source'), previousId: file.id, name: String(file.name || 'source').slice(0, 255),
        type: String(file.type || 'application/octet-stream').slice(0, 191), size: bytes.byteLength,
        path: String(file.path || file.name || '').slice(0, 500), lastModified: Number(file.lastModified) || 0,
        blob: new Blob([bytes], { type: String(file.type || 'application/octet-stream') }) };
    });
    const legacy = { ...backup, version: backup.version === 4 ? 2 : 1 };
    const restored = parseWorkspaceBackup(JSON.stringify(legacy));
    const originalDatasets = backup.datasets || [backup.dataset];
    const restoredDatasets = restored.datasets || [restored.dataset];
    originalDatasets.forEach((source, index) => {
      if (!source.sourceFile) return;
      const archived = sourceFiles.find((file) => file.previousId === source.sourceFile.id);
      if (!archived || archived.size !== source.sourceFile.size) throw new Error('An original file referenced by a source is missing.');
      const { blob, previousId, ...metadata } = archived;
      restoredDatasets[index].sourceFile = metadata;
    });
    return { ...restored, sourceFiles: sourceFiles.map(({ previousId, ...file }) => file) };
  }
  if (backup.version === COLLECTION_BACKUP_VERSION) return parseCollectionBackup(backup);
  const dataset = restoreDataset(backup.dataset);
  const layout = restoreLayout(backup.layout, dataset.id);
  return { dataset, layout, filters: restoreFilters(backup.filters, dataset.columns), palette: restorePalette(backup.palette) };
};

export const readWorkspaceBackup = async (file, options = {}) => {
  if (options.signal?.aborted) throw new DOMException('Workspace restore cancelled.', 'AbortError');
  if (!file || file.size > MAX_WORKSPACE_BACKUP_BYTES) {
    throw new Error('The workspace backup exceeds the 200 MB browser limit.');
  }
  if (typeof file.stream === 'function') {
    const prefix = await file.slice(0, 256).text();
    if (prefix.includes('analytics-dashboard-record-stream')) return (await import('./workspaceBackupStream')).restoreWorkspaceStream(file, options);
  }
  const workspace = await parseVerifiedWorkspaceBackup(await file.text());
  const { saveRestoredWorkspace } = await import('./localDatasetStore');
  await saveRestoredWorkspace(workspace, { signal: options.signal });
  delete workspace.sourceFiles;
  return { ...workspace, persisted: true };
};
