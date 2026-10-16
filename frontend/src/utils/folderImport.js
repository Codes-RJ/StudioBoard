import {
  MAX_LOCAL_DATASET_BYTES,
  MAX_LOCAL_DATASET_ROWS,
  createLocalDatasetFromRows,
  parseLocalFileDatasets,
} from './localDataEngine';
import { rememberStoredDataset } from './datasetWorkerPayload';

export const MAX_FOLDER_FILES = 100;
export const MAX_FOLDER_BYTES = 200 * 1024 * 1024;
export const MAX_FOLDER_DATASETS = 200;
const SUPPORTED_EXTENSIONS = /\.(csv|tsv|txt|xlsx|xls)$/i;
const folderLimitError = (message) => Object.assign(new Error(message), { code: 'FOLDER_LIMIT' });

const getRelativePath = (file) => String(file.webkitRelativePath || file.name)
  .replaceAll('\\', '/')
  .split('/')
  .filter((segment) => segment && segment !== '.' && segment !== '..')
  .join('/');

const newCollectionId = () => `folder_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

const createCollectionOverview = ({ datasets, name, folderId, sourceFileCount, kind = 'folder', failures = [], ignoredCount = 0 }) => {
  const overviewRows = datasets.map((dataset) => ({
    Source: dataset.sourcePath,
    Worksheet: dataset.sheetName || '',
    Rows: dataset.rowCount,
    Columns: dataset.columns.length,
    'Missing cells': dataset.metrics.missingValues,
    'Completeness %': dataset.metrics.completeness,
  }));
  return {
    ...createLocalDatasetFromRows(
      { name: `${name}-overview.csv` },
      overviewRows,
      ['Source', 'Worksheet', 'Rows', 'Columns', 'Missing cells', 'Completeness %'],
    ),
    name: `${name} · ${kind === 'workbook' ? 'Workbook' : 'Folder'} overview`,
    folderId,
    folderName: name,
    collectionKind: kind,
    isFolderOverview: true,
    sourceFileCount,
    sourceDatasetCount: datasets.length,
    totalSourceRows: datasets.reduce((sum, dataset) => sum + dataset.rowCount, 0),
    ignoredFileCount: ignoredCount,
    importFailures: failures,
  };
};

export const parseLocalFileWorkspace = async (file, { parseFileDatasets = parseLocalFileDatasets, ...options } = {}) => {
  const datasets = await parseFileDatasets(file, options);
  if (datasets.reduce((sum, dataset) => sum + dataset.rowCount, 0) > MAX_LOCAL_DATASET_ROWS) {
    throw folderLimitError(`A workbook can contain at most ${MAX_LOCAL_DATASET_ROWS.toLocaleString()} data rows in total.`);
  }
  if (datasets.length === 1) return { datasets, selected: datasets[0] };
  const folderId = newCollectionId();
  const name = file.name.replace(/\.[^/.]+$/, '');
  const sources = datasets.map((dataset) => ({
    ...dataset, folderId, folderName: name, collectionKind: 'workbook', sourcePath: file.name,
  }));
  const overview = createCollectionOverview({ datasets: sources, name, folderId, sourceFileCount: 1, kind: 'workbook' });
  return { datasets: [overview, ...sources], selected: overview };
};

export const inspectFolderFiles = (fileList) => {
  const files = Array.from(fileList || []);
  const supported = files.filter((file) => SUPPORTED_EXTENSIONS.test(file.name) && !file.name.startsWith('~$'));
  const totalBytes = supported.reduce((sum, file) => sum + Number(file.size || 0), 0);
  const firstPath = getRelativePath(files[0] || { name: 'Folder' });
  const folderName = firstPath.includes('/') ? firstPath.split('/')[0] : 'Selected files';
  return { files: supported, folderName, ignoredCount: files.length - supported.length, totalBytes };
};

export const parseLocalFolder = async (fileList, { onProgress, parseFileDatasets = parseLocalFileDatasets, signal, stageSources, archive = true } = {}) => {
  const selection = inspectFolderFiles(fileList);
  if (!selection.files.length) throw new Error('This folder contains no supported CSV or Excel files.');
  if (selection.files.length > MAX_FOLDER_FILES) {
    throw new Error(`Choose a folder with at most ${MAX_FOLDER_FILES} CSV or Excel files.`);
  }
  if (selection.totalBytes > MAX_FOLDER_BYTES) {
    throw new Error('The selected folder exceeds the 200 MB browser limit.');
  }
  if (selection.files.some((file) => file.size > MAX_LOCAL_DATASET_BYTES)) {
    throw new Error('A file in this folder exceeds the 100 MB per-file browser limit.');
  }

  const folderId = newCollectionId();
  const datasets = [];
  const failures = [];
  let rowCount = 0;
  const orderedFiles = [...selection.files].sort((left, right) => getRelativePath(left).localeCompare(getRelativePath(right)));

  for (const [index, file] of orderedFiles.entries()) {
    if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
    const sourcePath = getRelativePath(file);
    onProgress?.({ completed: index, total: orderedFiles.length, path: sourcePath });
    try {
      const originals = [];
      const parsed = await parseFileDatasets(file, { signal, archive, onSource: (source) => originals.push(source) });
      if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
      if (datasets.length + parsed.length > MAX_FOLDER_DATASETS) {
        throw folderLimitError(`A folder can contain at most ${MAX_FOLDER_DATASETS} nonempty datasets.`);
      }
      const nextRows = parsed.reduce((sum, dataset) => sum + dataset.rowCount, 0);
      if (rowCount + nextRows > MAX_LOCAL_DATASET_ROWS) {
        throw folderLimitError(`A folder can contain at most ${MAX_LOCAL_DATASET_ROWS.toLocaleString()} data rows in total.`);
      }
      rowCount += nextRows;
      const sources = parsed.map((dataset) => {
        const relativeName = sourcePath.split('/').slice(1).join('/') || file.name;
        return {
          ...dataset,
          name: `${relativeName.replace(/\.[^/.]+$/, '')}${dataset.sheetName ? ` · ${dataset.sheetName}` : ''}`,
          folderId,
          folderName: selection.folderName,
          collectionKind: 'folder',
          sourcePath,
        };
      });
      if (stageSources) {
        try { datasets.push(...await stageSources(sources, originals)); }
        catch (error) { throw Object.assign(new Error(error.message, { cause: error }), { code: 'IMPORT_STORAGE', name: error.name }); }
      } else datasets.push(...sources);
    } catch (error) {
      if (error.code === 'FOLDER_LIMIT' || error.code === 'IMPORT_STORAGE' || error.name === 'AbortError') throw error;
      failures.push({ path: sourcePath, message: error.message || 'Unable to parse this file.' });
    }
    onProgress?.({ completed: index + 1, total: orderedFiles.length, path: sourcePath });
  }

  if (!datasets.length) {
    throw new Error(`No usable datasets were found. ${failures[0]?.path || 'The folder'}: ${failures[0]?.message || 'All files were empty.'}`);
  }

  const overview = createCollectionOverview({
    datasets, name: selection.folderName, folderId, sourceFileCount: selection.files.length,
    failures, ignoredCount: selection.ignoredCount,
  });

  return { overview, datasets, failures, ignoredCount: selection.ignoredCount };
};

const stagedImport = async (work, { signal, storage } = {}) => {
  const store = storage || await import('./localDatasetStore');
  await store.cleanupAbandonedLocalImports();
  if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
  const sessionId = await store.beginLocalImport();
  try {
    const result = await work(store, sessionId);
    if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
    const published = await store.publishLocalImport(sessionId);
    const byId = new Map(published.map((source) => [source.id, source]));
    const ordered = result.overview ? [result.overview, ...result.datasets] : result.datasets;
    const datasets = ordered.map((source) => byId.get(source.id));
    rememberStoredDataset(result.selected, datasets.find(({ id }) => id === result.selected.id)?.storageRevision);
    return { ...result, datasets, persisted: true };
  } catch (error) {
    try { await store.discardLocalImport(sessionId); }
    catch { error.message += ' Staged data could not be removed; it remains hidden and is eligible for cleanup after 48 hours.'; }
    throw error;
  }
};

/** At most one input file's rows are retained while a folder is staged. */
export const importLocalFolder = (files, options = {}) => stagedImport(async (store, sessionId) => {
  const result = await parseLocalFolder(files, { ...options, archive: false,
    stageSources: (sources, originals) => store.stageLocalImport(sessionId, sources, originals) });
  await store.stageLocalImport(sessionId, [result.overview]);
  return { ...result, selected: result.overview };
}, options);

export const importLocalFileWorkspace = (file, { name, ...options } = {}) => stagedImport(async (store, sessionId) => {
  const originals = [];
  const result = await parseLocalFileWorkspace(file, { ...options, archive: false, onSource: (source) => originals.push(source) });
  if (name?.trim()) for (const source of result.datasets) {
    source.name = source.isFolderOverview ? `${name.trim()} · Workbook overview`
      : source.sheetName && result.datasets.length > 1 ? `${name.trim()} · ${source.sheetName}` : name.trim();
    if (source.folderId) source.folderName = name.trim();
  }
  await store.stageLocalImport(sessionId, result.datasets, originals);
  return result;
}, options);
