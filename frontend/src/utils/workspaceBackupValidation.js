import { CHART_PALETTES } from './chartAppearance';
import { MAX_LOCAL_DATASET_COLUMNS, MAX_LOCAL_DATASET_ROWS, computeDatasetMetrics } from './localDataEngine';
import { normalizeLayoutItems } from './layoutModel';
import { isValidColumnOverride } from './datasetProfiler';
import { newDatasetRevision } from './qualityReview';

export const MAX_WORKSPACE_BACKUP_BYTES = 200 * 1024 * 1024;
const newLocalId = (prefix) => `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);

export const restoreDataset = (source, { folderId } = {}) => {
  if (!isRecord(source) || !Array.isArray(source.rawRows) || !source.rawRows.length
    || source.rawRows.length > MAX_LOCAL_DATASET_ROWS || !source.rawRows.every(isRecord)) {
    throw new Error('The backup contains invalid or too many dataset rows.');
  }
  if (!Array.isArray(source.columns) || !source.columns.length || source.columns.length > MAX_LOCAL_DATASET_COLUMNS) {
    throw new Error('The backup contains invalid or too many columns.');
  }
  const columns = source.columns.map((column) => ({
    name: String(typeof column === 'string' ? column : column?.name || '').trim(),
    type: ['number', 'date', 'string'].includes(column?.type) ? column.type : 'string'
  }));
  const columnNames = columns.map(({ name }) => name);
  if (columnNames.some((name) => !name || name.length > 191) || new Set(columnNames).size !== columnNames.length) {
    throw new Error('The backup contains invalid or duplicate column names.');
  }

  const hasSourceRows = Array.isArray(source.sourceRows);
  const hasSourceColumns = Array.isArray(source.sourceColumns);
  if (hasSourceRows !== hasSourceColumns) throw new Error('The backup contains incomplete cleaning history.');
  if (hasSourceRows && (!source.sourceRows.length || source.sourceRows.length > MAX_LOCAL_DATASET_ROWS
    || !source.sourceRows.every(isRecord) || !source.sourceColumns.length
    || source.sourceColumns.length > MAX_LOCAL_DATASET_COLUMNS)) {
    throw new Error('The backup contains invalid original dataset rows or columns.');
  }
  const sourceColumns = hasSourceColumns
    ? source.sourceColumns.map((column) => typeof column === 'string' ? column.trim() : {
      name: String(column?.name || '').trim(),
      type: ['number', 'date', 'string'].includes(column?.type) ? column.type : 'string',
      ...(['measure', 'dimension', 'identifier', 'ignore'].includes(column?.role) ? { role: column.role } : {}),
    })
    : null;
  const sourceColumnNames = sourceColumns?.map((column) => typeof column === 'string' ? column : column.name);
  if (sourceColumnNames && (sourceColumnNames.some((name) => !name || name.length > 191) || new Set(sourceColumnNames).size !== sourceColumnNames.length)) {
    throw new Error('The backup contains invalid original column names.');
  }
  const columnOverrides = isRecord(source.columnOverrides)
    ? Object.fromEntries(Object.entries(source.columnOverrides)
      .filter(([column, override]) => columnNames.includes(column) && isValidColumnOverride(override))
      .slice(0, MAX_LOCAL_DATASET_COLUMNS)
      .map(([column, override]) => [column, { type: override.type, role: override.role,
        ...(['native', 'exact'].includes(override.precision) ? { precision: override.precision } : {}),
        ...(typeof override.unit === 'string' ? { unit: override.unit.slice(0, 40) } : {}),
        ...(['verbatim', 'date-only', 'instant-day'].includes(override.dateKind) ? { dateKind: override.dateKind } : {}),
        ...(typeof override.timeZone === 'string' ? { timeZone: override.timeZone.slice(0, 80) } : {}) }]))
    : {};
  const validOptions = (options) => {
    if (!isRecord(options)) return null;
    const numeric = ['keep', 'mean', 'median', 'zero', 'dropRow'].includes(options.missingNumeric) ? options.missingNumeric : 'keep';
    const categorical = ['keep', 'unknown', 'mode', 'dropRow'].includes(options.missingCategorical) ? options.missingCategorical : 'keep';
    return {
      trimWhitespace: Boolean(options.trimWhitespace),
      removeDuplicates: Boolean(options.removeDuplicates),
      removeEmptyRows: Boolean(options.removeEmptyRows),
      dropEmptyColumns: Boolean(options.dropEmptyColumns),
      standardizeHeaders: Boolean(options.standardizeHeaders),
      missingNumeric: numeric,
      missingCategorical: categorical,
      ...(options.preserveRows !== undefined ? { preserveRows: Boolean(options.preserveRows) } : {}),
      ...(isRecord(options.columnPolicies) ? { columnPolicies: Object.fromEntries(Object.entries(options.columnPolicies)
        .filter(([name, policy]) => (sourceColumnNames || columnNames).includes(name) && isRecord(policy)
          && ['keep', 'mean', 'median', 'mode', 'zero', 'unknown', 'value'].includes(policy.method))
        .map(([name, policy]) => [name, { method: policy.method, value: policy.value }])) } : {})
    };
  };
  if (Array.isArray(source.cleaningRecipe) && source.cleaningRecipe.length > 50) {
    throw new Error('The backup contains too many cleaning steps.');
  }
  const cleaningRecipe = Array.isArray(source.cleaningRecipe)
    ? source.cleaningRecipe.slice(0, 50).map(validOptions).filter(Boolean)
    : [];
  const now = new Date().toISOString();
  const cleaningLog = Array.isArray(source.cleaningLog)
    ? source.cleaningLog.filter(isRecord).slice(-50).map((entry) => ({
      at: String(entry.at || now),
      ...(validOptions(entry.options) ? { options: validOptions(entry.options) } : {}),
      ...(Number.isFinite(Number(entry.beforeRows)) ? { beforeRows: Number(entry.beforeRows) } : {}),
      ...(Number.isFinite(Number(entry.afterRows)) ? { afterRows: Number(entry.afterRows) } : {}),
      changes: Array.isArray(entry.changes)
        ? entry.changes.filter(isRecord).slice(0, 100).map((change) => ({ label: String(change.label || '') }))
        : [],
      operations: Array.isArray(entry.operations) ? entry.operations.filter((operation) => isRecord(operation)
        && ((operation.kind === 'trim' && Array.isArray(operation.protectedColumns))
          || (operation.kind === 'headers' && isRecord(operation.renamed))
          || (operation.kind === 'fill' && typeof operation.column === 'string'
            && ['string', 'number', 'boolean'].includes(typeof operation.value))))
        .slice(0, MAX_LOCAL_DATASET_COLUMNS + 2) : []
    }))
    : [];
  if (hasSourceRows && cleaningRecipe.length !== cleaningLog.length) {
    throw new Error('The backup contains incomplete cleaning history.');
  }

  const name = String(source.name || 'Restored dataset').trim().slice(0, 191) || 'Restored dataset';
  const dataset = {
    id: newLocalId('local_backup'),
    name,
    fileName: String(source.fileName || `${name}.csv`).slice(0, 255),
    isLocal: true,
    revision: newDatasetRevision(),
    sourceId: String(source.sourceId || source.id || newLocalId('source')).slice(0, 191),
    qualityReviewRequired: true,
    ...(isRecord(source.document) ? { document: { format: String(source.document.format || '').slice(0, 10), blocks: source.rawRows.length,
      extraction: String(source.document.extraction || '').slice(0, 500), textCharacters: Number(source.document.textCharacters) || 0 } } : {}),
    rowCount: source.rawRows.length,
    columns,
    rawRows: source.rawRows,
    ...(isRecord(source.rowGrain) && typeof source.rowGrain.description === 'string' && Array.isArray(source.rowGrain.fields)
      && source.rowGrain.fields.length <= 6 && source.rowGrain.fields.every((field) => columnNames.includes(field)) ? { rowGrain: {
        description: source.rowGrain.description.slice(0, 300), fields: [...new Set(source.rowGrain.fields)], rows: source.rawRows.length,
        reviewedAt: null, unique: false, missingKeyRows: null, repeatedKeyRows: null, requiresReview: true } } : {}),
    ...(Object.keys(columnOverrides).length ? { columnOverrides } : {}),
    ...(hasSourceRows ? { sourceRows: source.sourceRows, sourceColumns } : {}),
    ...(cleaningRecipe.length ? { cleaningRecipe } : {}),
    cleaningLog,
    metrics: source.metrics,
    createdAt: now,
    updatedAt: now
  };
  const groups = dataset.metrics?.columnGroups;
  if (!isRecord(groups) || !['all', 'numeric', 'date', 'dimensions', 'categorical', 'measures'].every((key) => (
    Array.isArray(groups[key]) && groups[key].every((column) => columnNames.includes(column))
  ))) {
    dataset.metrics = computeDatasetMetrics(dataset.rawRows, columnNames);
  }
  if (folderId) {
    dataset.folderId = folderId;
    dataset.folderName = String(source.folderName || 'Restored folder').slice(0, 191);
    dataset.collectionKind = source.collectionKind === 'workbook' ? 'workbook' : 'folder';
    dataset.sourcePath = String(source.sourcePath || '').slice(0, 500);
    dataset.sheetName = String(source.sheetName || '').slice(0, 191);
    dataset.isFolderOverview = Boolean(source.isFolderOverview);
    if (dataset.isFolderOverview) {
      dataset.sourceFileCount = Number(source.sourceFileCount) || 0;
      dataset.sourceDatasetCount = Number(source.sourceDatasetCount) || 0;
      dataset.totalSourceRows = Number(source.totalSourceRows) || 0;
      dataset.ignoredFileCount = Number(source.ignoredFileCount) || 0;
      dataset.importFailures = Array.isArray(source.importFailures)
        ? source.importFailures.filter(isRecord).slice(0, 100).map(({ path, message }) => ({
          path: String(path || '').slice(0, 500), message: String(message || '').slice(0, 500),
        }))
        : [];
    }
  }
  return dataset;
};

export const restoreLayout = (source, datasetId) => {
  if (!isRecord(source) || !Array.isArray(source.layout) || !source.layout.length
    || source.layout.length > 50 || !source.layout.every(isRecord)) {
    throw new Error('The backup contains an invalid dashboard layout.');
  }
  const name = String(source.name || 'Restored layout').trim().slice(0, 191) || 'Restored layout';
  return {
    id: newLocalId('local_layout'),
    name,
    source: source.source === 'planner' ? 'planner' : 'custom',
    sourceDatasetId: datasetId,
    localOnly: true,
    layout: normalizeLayoutItems(source.layout),
  };
};

export const restoreFilters = (source, columns) => {
  const allowedColumns = new Set(columns.map(({ name }) => name));
  return isRecord(source)
    ? Object.fromEntries(Object.entries(source)
      .filter(([column, value]) => allowedColumns.has(column) && ['string', 'number', 'boolean'].includes(typeof value))
      .slice(0, 20)
      .map(([column, value]) => [column, String(value).slice(0, 200)]))
    : {};
};

export const restorePalette = (palette) => CHART_PALETTES.some(({ value }) => value === palette) ? palette : 'blue';

