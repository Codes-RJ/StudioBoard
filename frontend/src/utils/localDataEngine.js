import Papa from 'papaparse';
import { safeSpreadsheetMatrix } from './safeSpreadsheetExport';
import { validateWorkbookArchive } from './workbookArchivePolicy';
import { sortedTablePage } from './boundedTablePage';
import { meanFinite } from './finiteArithmetic';
import { toNumber, aggregateMetricValues, createRunningMetric } from './chartDataTransforms';
import { scopeRows, createScopeMatcher } from './analysisScope';
import { buildGoalCards, normalizePlanningGroups } from './dashboardLayoutPlan';
import { parseDelimitedText, readSpreadsheetSheets } from './tabularImport';
import { getDatasetColumnGroups, createColumnCardinalityCollector } from './graphConfiguration';

// xlsx (~440 KB min) is loaded on demand — only when an Excel file is actually
// parsed or exported. CSV/TSV users never pay for it.
const loadXlsx = () => import('xlsx');

const parseSpreadsheetInWorker = (file, { signal } = {}) => new Promise((resolve, reject) => {
  if (typeof Worker === 'undefined') {
    resolve(null);
    return;
  }
  const worker = new Worker(new URL('./spreadsheetParser.worker.js', import.meta.url), { type: 'module' });
  const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const dispose = () => { worker.terminate(); signal?.removeEventListener('abort', abort); };
  const abort = () => { dispose(); reject(new DOMException('Import cancelled.', 'AbortError')); };
  if (signal?.aborted) { abort(); return; }
  signal?.addEventListener('abort', abort, { once: true });
  worker.onmessage = ({ data }) => {
    if (data.id !== requestId) return;
    dispose();
    if (data.error) reject(new Error(data.error));
    else resolve(data.sheets);
  };
  worker.onerror = () => {
    dispose();
    reject(new Error('The spreadsheet worker could not start.'));
  };
  worker.postMessage({ id: requestId, file });
});

import { MAX_LOCAL_DATASET_BYTES, MAX_LOCAL_DATASET_ROWS, MAX_LOCAL_DATASET_COLUMNS, MAX_LOCAL_WORKBOOK_SHEETS } from './browserCapacityPolicy';
export { MAX_LOCAL_DATASET_BYTES, MAX_LOCAL_DATASET_ROWS, MAX_LOCAL_DATASET_COLUMNS, MAX_LOCAL_WORKBOOK_SHEETS };
export const LOCAL_FILE_ACCEPT = '.csv,.tsv,.txt,.xlsx,.xls';

/**
 * Clean & normalize column names to string
 */
export const sanitizeColumnName = (name) => {
  if (name === null || name === undefined) return 'Column';
  return String(name).trim() || 'Column';
};

const uniqueColumnNames = (names = []) => {
  const seen = new Set();
  return names.map((rawName, index) => {
    const baseName = sanitizeColumnName(rawName) || `Column ${index + 1}`;
    let name = baseName;
    let suffix = 2;
    while (seen.has(name)) name = `${baseName} (${suffix++})`;
    seen.add(name);
    return name;
  });
};

const normalizeRows = (rawRows, rawColumnNames, normalizedColumnNames) => {
  if (rawColumnNames.every((name, index) => name === normalizedColumnNames[index])
    && rawRows.every((row) => Object.keys(row).length === rawColumnNames.length && rawColumnNames.every((name) => Object.hasOwn(row, name) && row[name] !== undefined))) return rawRows;
  return rawRows.map((row) => Object.fromEntries(rawColumnNames.map((rawName, index) => [normalizedColumnNames[index], Object.hasOwn(row, rawName) ? row[rawName] ?? null : null])));
};

/**
 * Infer data type of a column from sample values
 */
const TYPE_SAMPLE_SIZE = 100;
const isMissing = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

export const inferColumnType = (values) => {
  const nonNulls = values.filter((value) => !isMissing(value));
  if (!nonNulls.length) return 'string';

  // Threshold is computed over the same sample we inspect, otherwise large
  // columns (>100 rows) would systematically under-count and fall to 'string'.
  const sample = nonNulls.slice(0, TYPE_SAMPLE_SIZE);
  let numCount = 0;
  let dateCount = 0;

  for (const v of sample) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      numCount++;
    } else if (typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '') {
      numCount++;
    } else if (typeof v === 'string' && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v) && !isNaN(Date.parse(v))) {
      dateCount++;
    }
  }

  if (numCount >= sample.length * 0.7) return 'number';
  if (dateCount >= sample.length * 0.7) return 'date';
  return 'string';
};

/**
 * Calculate KPI summary and column groupings from in-memory tabular data
 */
export const computeDatasetMetrics = (rows, columnNames) => {
  if (!rows || !rows.length || !columnNames || !columnNames.length) {
    return {
      rows: 0,
      columns: columnNames ? columnNames.length : 0,
      numericColumns: 0,
      categoricalColumns: 0,
      missingValues: 0,
      completeness: 100,
      primaryMetricColumn: null,
      primaryMean: null,
      columnGroups: {
        all: columnNames || [],
        numeric: [],
        categorical: [],
        date: [],
        dimensions: [],
        measures: []
      }
    };
  }

  const columnTypes = Object.create(null);
  let totalMissing = 0;

  for (const col of columnNames) {
    const sample = [];
    for (const row of rows) {
      const value = row?.[col];
      if (isMissing(value)) totalMissing++;
      else if (sample.length < TYPE_SAMPLE_SIZE) sample.push(value);
    }
    columnTypes[col] = inferColumnType(sample);
  }

  const numericCols = columnNames.filter((col) => columnTypes[col] === 'number');
  const dateCols = columnNames.filter((col) => columnTypes[col] === 'date');
  const categoricalCols = columnNames.filter((col) => columnTypes[col] === 'string');

  const totalCells = rows.length * columnNames.length;
  const completeness = totalCells > 0 ? Math.round(((totalCells - totalMissing) / totalCells) * 1000) / 10 : 100;

  let primaryMean = null;
  const primaryMetric = numericCols[0] || null;
  if (primaryMetric) {
    const average = createRunningMetric('average');
    for (const row of rows) {
      const value = toNumber(row?.[primaryMetric]);
      if (value !== null) average.consume(value);
    }
    primaryMean = average.finish();
  }

  return {
    rows: rows.length,
    columns: columnNames.length,
    numericColumns: numericCols.length,
    categoricalColumns: categoricalCols.length,
    missingValues: totalMissing,
    completeness,
    primaryMetricColumn: primaryMetric,
    primaryMean,
    columnGroups: {
      all: columnNames,
      numeric: numericCols,
      categorical: categoricalCols,
      date: dateCols,
      dimensions: [...dateCols, ...categoricalCols],
      measures: numericCols
    }
  };
};

/** Use the same validated overview planner for imports, cleaning and review. */
export const computeScopedDatasetMetrics = (dataset, filters = {}) => {
  const rows = scopeRows(dataset.rawRows, filters);
  const columns = (dataset.columns || []).map((column) => typeof column === 'string' ? column : column.name);
  const metrics = computeDatasetMetrics(rows, columns);
  const groups = getDatasetColumnGroups(dataset);
  const primary = groups.numeric[0] || null;
  return { ...metrics, numericColumns: groups.numeric.length, categoricalColumns: groups.categorical.length,
    primaryMetricColumn: primary, primaryMean: primary ? aggregateMetricValues(rows.map((row) => row?.[primary]), 'average') : null,
    columnGroups: groups, sourceRows: dataset.rawRows.length };
};

// Preserve full-source role/type classification while counting the filtered
// scope. Samples are limited to the existing 500-row classification contract.
export const createScopedDatasetMetricsAccumulator = (dataset, filters = {}) => {
  const columns = (dataset.columns || []).map((column) => typeof column === 'string' ? column : column.name);
  const classified = [...new Set([...columns, ...(dataset.metrics?.columnGroups?.all || [])])];
  const cardinality = createColumnCardinalityCollector(classified);
  const averages = new Map(classified.map((column) => [column, createRunningMetric('average')]));
  const matches = createScopeMatcher(filters); const sample = [];
  let sourceRows = 0; let eligibleRows = 0; let missingValues = 0;
  return {
    consume: (rows) => {
      cardinality.consume(rows); sourceRows += rows.length;
      for (const row of rows) {
        if (sample.length < 500) sample.push(row);
        if (!matches(row)) continue;
        eligibleRows += 1;
        for (const column of columns) if (isMissing(row?.[column])) missingValues += 1;
        for (const [column, average] of averages) average.consume(row?.[column]);
      }
    },
    finish: () => {
      const groups = getDatasetColumnGroups({ ...dataset, rawRows: sample }, { fullCardinality: cardinality.finish() });
      const primary = groups.numeric[0] || null;
      const totalCells = eligibleRows * columns.length;
      return { rows: columns.length ? eligibleRows : 0, columns: columns.length,
        numericColumns: groups.numeric.length, categoricalColumns: groups.categorical.length, missingValues,
        completeness: totalCells ? Math.round(((totalCells - missingValues) / totalCells) * 1000) / 10 : 100,
        primaryMetricColumn: primary, primaryMean: primary ? averages.get(primary)?.finish() ?? null : null,
        columnGroups: groups, sourceRows };
    },
  };
};

/** Use the same validated overview planner for imports, cleaning and review. */
export const planLocalSmartLayout = (datasetId, columnGroups = {}) => {
  const groups = {
    numeric: [], dimensions: [], date: [], cardinality: {},
    ...columnGroups,
    all: columnGroups.all || [...new Set([...(columnGroups.numeric || []), ...(columnGroups.dimensions || []), ...(columnGroups.date || [])])],
  };
  return groups.all.length ? buildGoalCards('overview', normalizePlanningGroups(groups)) : [{
    i: 'candidate_1', title: 'Source rows', chartType: 'table', preferredX: '', preferredY: '',
    aggregation: 'auto', topN: 12, x: 0, y: 0, w: 12, h: 4,
  }];
};

/**
 * Build a normalized local dataset object from parsed raw rows.
 * Shared by both the delimited-text and Excel parsing branches.
 */
export const createLocalDatasetFromRows = (file, rawRows, fieldNames) => {
  const rawColumns = fieldNames || Object.keys(rawRows[0] || {});
  if (!rawColumns.length || rawColumns.length > MAX_LOCAL_DATASET_COLUMNS) {
    throw new Error(`Datasets must contain between 1 and ${MAX_LOCAL_DATASET_COLUMNS} columns.`);
  }
  if (!rawRows.length || rawRows.length > MAX_LOCAL_DATASET_ROWS) {
    throw new Error(`Datasets must contain between 1 and ${MAX_LOCAL_DATASET_ROWS.toLocaleString()} rows.`);
  }

  const normalizedNames = uniqueColumnNames(rawColumns);
  const normalizedRows = normalizeRows(rawRows, rawColumns, normalizedNames);
  const columns = normalizedNames.map((name) => ({
    name,
    type: 'string'
  }));

  const cleanColumns = columns.map((c) => c.name);
  const metrics = computeDatasetMetrics(normalizedRows, cleanColumns);

  // Update column types in schema from inferred groups
  for (const col of columns) {
    if (metrics.columnGroups.numeric.includes(col.name)) {
      col.type = 'number';
    } else if (metrics.columnGroups.date.includes(col.name)) {
      col.type = 'date';
    }
  }

  const datasetId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  metrics.columnGroups = getDatasetColumnGroups({ columns, rawRows: normalizedRows, metrics });
  metrics.numericColumns = metrics.columnGroups.numeric.length;
  metrics.primaryMetricColumn = metrics.columnGroups.measures[0] || null;
  const primaryValues = metrics.primaryMetricColumn
    ? normalizedRows.map((row) => toNumber(row[metrics.primaryMetricColumn])).filter((value) => value !== null) : [];
  metrics.primaryMean = primaryValues.length
    ? meanFinite(primaryValues) : null;

  return {
    id: datasetId,
    revision: globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    sourceId: datasetId,
    qualityReviewRequired: true,
    name: file.name.replace(/\.[^/.]+$/, ''),
    fileName: file.name,
    rowCount: normalizedRows.length,
    columns,
    isLocal: true,
    rawRows: normalizedRows,
    metrics,
    smartLayout: planLocalSmartLayout(datasetId, metrics.columnGroups),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
};

const parseDelimitedInWorker = (file, { signal, onProgress } = {}) => new Promise((resolve, reject) => {
  if (typeof Worker === 'undefined') {
    resolve(null);
    return;
  }
  const worker = new Worker(new URL('./delimitedParser.worker.js', import.meta.url), { type: 'module' });
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const dispose = () => { worker.terminate(); signal?.removeEventListener('abort', abort); };
  const abort = () => { dispose(); reject(new DOMException('Import cancelled.', 'AbortError')); };
  if (signal?.aborted) { abort(); return; }
  signal?.addEventListener('abort', abort, { once: true });
  worker.onmessage = ({ data }) => {
    if (data.id !== id) return;
    if (data.progress) { onProgress?.(data.progress); return; }
    dispose();
    if (data.error) reject(new Error(data.error));
    else resolve({ rawRows: data.rawRows, fieldNames: data.fieldNames });
  };
  worker.onerror = () => {
    dispose();
    reject(new Error('The CSV parsing worker could not start.'));
  };
  worker.postMessage({ id, file });
});

const parseDelimitedFile = async (file, options) => {
  const workerResult = await parseDelimitedInWorker(file, options);
  const result = workerResult || parseDelimitedText(await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Unable to read this file.'));
    reader.readAsText(file);
  }));
  if (!result.rawRows?.length) throw new Error('The uploaded CSV file contains no data rows.');
  return [createLocalDatasetFromRows(file, result.rawRows, result.fieldNames)];
};

const readWorkbookInMainThread = async (file) => {
  let XLSX;
  try {
    XLSX = await loadXlsx();
  } catch {
    throw new Error('Could not load the Excel engine. Check your connection and try again.');
  }
  const buffer = typeof file.arrayBuffer === 'function'
    ? await file.arrayBuffer()
    : await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Unable to read the workbook.'));
      reader.readAsArrayBuffer(file);
    });
  validateWorkbookArchive(buffer, { requireZip: /\.xlsx$/i.test(file.name) });
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
  if (!workbook.SheetNames.length) throw new Error('The workbook contains no worksheets.');
  if (workbook.SheetNames.length > MAX_LOCAL_WORKBOOK_SHEETS) {
    throw new Error(`A workbook can contain at most ${MAX_LOCAL_WORKBOOK_SHEETS} worksheets for browser import.`);
  }
  return readSpreadsheetSheets(XLSX.utils.sheet_to_json, workbook);
};

/** Parse every nonempty worksheet, or one delimited file, in browser memory. */
export const parseLocalFileDatasets = async (file, { signal, onProgress, archive = true, onSource, documentMode = false } = {}) => {
  const assertActive = () => { if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError'); };
  assertActive();
  if (!file?.name) {
    throw new Error('Choose a CSV, TSV, TXT, XLSX, or XLS file first.');
  }
  if (Number(file.size || 0) > MAX_LOCAL_DATASET_BYTES) {
    throw new Error('The selected file exceeds the 100 MB browser limit.');
  }
  const extension = file.name.split('.').pop().toLowerCase();
  const preserveSource = async () => {
    assertActive();
    const store = await import('./localDatasetStore');
    if (archive) return store.archiveLocalSourceFile(file);
    const prepared = store.prepareLocalSourceFile(file);
    onSource?.(prepared.archive); return prepared.metadata;
  };

  if (documentMode) {
    const { parseLocalDocument } = await import('./documentImport');
    const parsed = await parseLocalDocument(file, { signal, onProgress });
    const dataset = createLocalDatasetFromRows(file, parsed.rawRows, parsed.fieldNames);
    dataset.document = parsed.document;
    dataset.columnOverrides = { Document: { type: 'string', role: 'dimension' }, Page: { type: 'string', role: 'dimension' }, Block: { type: 'string', role: 'identifier' }, Text: { type: 'string', role: 'dimension' } };
    dataset.metrics.columnGroups = getDatasetColumnGroups(dataset);
    dataset.sourceFile = await preserveSource();
    return [dataset];
  }

  if (['csv', 'tsv', 'txt'].includes(extension)) {
    const datasets = await parseDelimitedFile(file, { signal, onProgress });
    const sourceFile = await preserveSource();
    return datasets.map((dataset) => ({ ...dataset, sourceFile }));
  }
  if (!['xlsx', 'xls'].includes(extension)) {
    throw new Error(`Unsupported file format .${extension}. Please use CSV or Excel (.xlsx, .xls).`);
  }

  // Excel decoding is CPU-heavy. The worker handles it when available.
  const sheets = (await parseSpreadsheetInWorker(file, { signal })) || (await readWorkbookInMainThread(file));
  assertActive();
  const nonempty = sheets.filter(({ rawRows }) => rawRows?.length);
  if (!nonempty.length) throw new Error('The uploaded Excel workbook contains no data rows.');
  const baseName = file.name.replace(/\.[^/.]+$/, '');
  const datasets = nonempty.map(({ name, rawRows, fieldNames }) => ({
    ...createLocalDatasetFromRows(file, rawRows, fieldNames),
    name: nonempty.length > 1 ? `${baseName} · ${name}` : baseName,
    sheetName: name,
  }));
  // Validate/normalize every sheet before archiving any original bytes.
  const sourceFile = await preserveSource();
  return datasets.map((dataset) => ({ ...dataset, sourceFile }));
};

/** Retained for CSV URL import and callers that need only the first dataset. */
export const parseLocalFile = async (file) => (await parseLocalFileDatasets(file))[0];

/**
 * Filter, sort, and paginate in-memory local data
 */
export const filterAndPaginateLocalData = (rows = [], { page = 1, limit = 50, sort = null, order = 'asc', filters = {} } = {}) => {
  const numLimit = Number(limit);
  const numPage = Number(page) || 1;
  if (sort && Number.isSafeInteger(numLimit) && numLimit > 0 && Number.isSafeInteger(numPage) && numPage > 0) {
    return sortedTablePage(rows, { page: numPage, limit: numLimit, sort, order, matches: createScopeMatcher(filters) });
  }
  // Preserve registered immutable rows for the full, unfiltered chart scope.
  // Filtered, sorted and paginated views keep their explicit row arrays.
  if (!sort && !(numLimit > 0) && !Object.values(filters).some((value) => value != null && String(value).trim() !== '')) {
    return { data: rows, total: rows.length, page: numPage, limit: rows.length };
  }
  // The usual table view retains only the requested page. Counting matches
  // still visits the complete scope; no full filtered array is assembled.
  if (!sort && Number.isSafeInteger(numLimit) && numLimit > 0 && Number.isSafeInteger(numPage) && numPage > 0) {
    const start = (numPage - 1) * numLimit;
    const end = start + numLimit;
    if (!Object.values(filters).some((value) => value != null && String(value).trim() !== '')) {
      return { data: rows.slice(start, end), total: rows.length, page: numPage, limit: numLimit };
    }
    const matches = createScopeMatcher(filters); const data = []; let total = 0;
    for (const row of rows) {
      if (!matches(row)) continue;
      if (total >= start && total < end) data.push(row);
      total += 1;
    }
    return { data, total, page: numPage, limit: numLimit };
  }
  let filtered = scopeRows(rows, filters);

  // Apply sorting
  if (sort) {
    const isAsc = order !== 'desc';
    filtered.sort((a, b) => {
      const valA = a?.[sort];
      const valB = b?.[sort];

      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      const numA = Number(valA);
      const numB = Number(valB);

      if (Number.isFinite(numA) && Number.isFinite(numB)) {
        return isAsc ? numA - numB : numB - numA;
      }

      return isAsc
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });
  }

  const total = filtered.length;

  let pageData = filtered;
  if (numLimit > 0) {
    const start = (numPage - 1) * numLimit;
    const end = start + numLimit;
    pageData = filtered.slice(start, end);
  }

  return {
    data: pageData,
    total,
    page: numPage,
    limit: numLimit > 0 ? numLimit : total
  };
};

/**
 * Client-side file exporter.
 * Returns true when a download was produced; throws for unsupported formats
 * so callers can surface a real error instead of a silent no-op.
 */
export const exportLocalDataset = async (dataset, format = 'csv') => {
  if (!dataset || !dataset.rawRows || !dataset.rawRows.length) return false;

  const filename = `${dataset.name || 'dataset'}_export`;

  if (format === 'csv') {
    const csvString = Papa.unparse(safeSpreadsheetMatrix(dataset.rawRows));
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `${filename}.csv`);
  } else if (format === 'json') {
    const jsonString = JSON.stringify(dataset.rawRows, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    downloadBlob(blob, `${filename}.json`);
  } else if (format === 'xlsx') {
    const XLSX = await loadXlsx();
    const worksheet = XLSX.utils.aoa_to_sheet(safeSpreadsheetMatrix(dataset.rawRows));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
    XLSX.writeFile(workbook, `${filename}.xlsx`);
  } else {
    throw new Error(`"${format}" export requires server mode. Local exports support CSV, Excel, and JSON.`);
  }

  return true;
};

const downloadBlob = (blob, filename) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

const SAMPLE_ROWS = [
  { Month: '2025-01-01', Plan: 'Enterprise', MRR: 45000, NewCustomers: 12, ChurnRate: 1.2, CAC: 1200 },
  { Month: '2025-02-01', Plan: 'Pro', MRR: 52000, NewCustomers: 28, ChurnRate: 1.5, CAC: 850 },
  { Month: '2025-03-01', Plan: 'Starter', MRR: 61000, NewCustomers: 54, ChurnRate: 2.1, CAC: 420 },
  { Month: '2025-04-01', Plan: 'Enterprise', MRR: 68000, NewCustomers: 18, ChurnRate: 0.9, CAC: 1100 },
  { Month: '2025-05-01', Plan: 'Pro', MRR: 74000, NewCustomers: 35, ChurnRate: 1.4, CAC: 790 },
  { Month: '2025-06-01', Plan: 'Starter', MRR: 83000, NewCustomers: 65, ChurnRate: 1.8, CAC: 390 },
  { Month: '2025-07-01', Plan: 'Enterprise', MRR: 91000, NewCustomers: 22, ChurnRate: 0.8, CAC: 1050 },
  { Month: '2025-08-01', Plan: 'Pro', MRR: 98000, NewCustomers: 42, ChurnRate: 1.1, CAC: 740 },
  { Month: '2025-09-01', Plan: 'Starter', MRR: 106000, NewCustomers: 78, ChurnRate: 1.6, CAC: 360 },
  { Month: '2025-10-01', Plan: 'Enterprise', MRR: 115000, NewCustomers: 26, ChurnRate: 0.7, CAC: 980 },
  { Month: '2025-11-01', Plan: 'Pro', MRR: 124000, NewCustomers: 49, ChurnRate: 1.0, CAC: 710 },
  { Month: '2025-12-01', Plan: 'Starter', MRR: 135000, NewCustomers: 92, ChurnRate: 1.3, CAC: 340 }
];

const SAMPLE_COLUMNS = ['Month', 'Plan', 'MRR', 'NewCustomers', 'ChurnRate', 'CAC'];
const SAMPLE_METRICS = computeDatasetMetrics(SAMPLE_ROWS, SAMPLE_COLUMNS);
const SAMPLE_SMART_LAYOUT = planLocalSmartLayout('local_sample_saas', SAMPLE_METRICS.columnGroups);

/**
 * Pre-packaged instant sample datasets
 */
export const SAMPLE_DATASETS = [
  {
    id: 'local_sample_saas',
    name: 'SaaS Growth & Performance (Sample)',
    fileName: 'saas_growth_sample.csv',
    rowCount: SAMPLE_ROWS.length,
    isLocal: true,
    columns: [
      { name: 'Month', type: 'date' },
      { name: 'Plan', type: 'string' },
      { name: 'MRR', type: 'number' },
      { name: 'NewCustomers', type: 'number' },
      { name: 'ChurnRate', type: 'number' },
      { name: 'CAC', type: 'number' }
    ],
    rawRows: SAMPLE_ROWS,
    metrics: SAMPLE_METRICS,
    smartLayout: SAMPLE_SMART_LAYOUT,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];
