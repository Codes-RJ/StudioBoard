import { scanWorkerDatasetRows } from './datasetWorkerReader';
import { profileDataset } from './datasetProfiler';
import { scanIntegerPrecisionRisks } from './numberSemantics';
const missing = (value) => value == null || (typeof value === 'string' && !value.trim());
export const scanSavedQuality = async (reference, { stream = 'rawRows', sample = true, signal, onProgress, scan = scanWorkerDatasetRows } = {}) => {
  const signatures = new Set(); const sampled = []; const precisionRisks = Object.create(null); let bytes = 0; let columns; let states; let header; let total;
  const report = { totalRows: 0, missingCells: 0, missingByColumn: Object.create(null), duplicateRows: 0, emptyRows: 0, whitespaceCells: 0, mixedTypeColumns: [], constantColumns: [], emptyColumns: [] };
  const reserve = (amount) => { bytes += amount; if (bytes > 32 * 1024 * 1024) throw new Error('Exact quality review exceeds its 32 MB retained-text policy. Narrow or split the source; no sampled quality result was produced.'); };
  await scan(reference.id, (rows, info) => {
    if (!header) {
      header = info.header; total = info.total;
      columns = (stream === 'sourceRows' ? header.sourceColumns || header.columns : header.columns).map((column) => typeof column === 'string' ? column : column.name);
      states = new Map(columns.map((column) => [column, { missing: 0, populated: 0, numeric: 0, distinct: new Set() }]));
    }
    // Match profileDataset's evenly spaced 25,000-row sample exactly.
    for (const [field, counts] of Object.entries(scanIntegerPrecisionRisks(rows, columns))) {
      precisionRisks[field] ||= { 'stored-number': 0, 'integer-text': 0 };
      for (const kind of Object.keys(counts)) precisionRisks[field][kind] += counts[kind];
    }
    let target = Math.ceil(info.offset * Math.min(total, 25_000) / total);
    for (const [index, row] of rows.entries()) {
      report.totalRows++;
      const signature = JSON.stringify(columns.map((column) => row?.[column] ?? null));
      if (signatures.has(signature)) report.duplicateRows++;
      else { if (signatures.size >= 250_000) throw new Error('Exact quality review exceeds 250,000 distinct row signatures.'); reserve(signature.length * 2); signatures.add(signature); }
      let empty = true;
      for (const [column, state] of states) {
        const value = row?.[column];
        if (missing(value)) { state.missing++; report.missingCells++; continue; }
        empty = false; state.populated++;
        if (Number.isFinite(Number(value))) state.numeric++;
        if (typeof value === 'string' && value !== value.trim()) report.whitespaceCells++;
        if (state.distinct.size < 2 && !state.distinct.has(String(value))) { reserve(String(value).length * 2); state.distinct.add(String(value)); }
      }
      if (empty) report.emptyRows++;
      if (sample && info.offset + index === Math.floor(target * total / Math.min(total, 25_000))) { reserve(JSON.stringify(row).length * 2); sampled.push(row); target++; }
    }
  }, { stream, signal, onProgress, expectedRevision: reference.revision, expectedStorageRevision: reference.storageRevision });
  report.totalColumns = columns.length;
  for (const [column, state] of states) {
    report.missingByColumn[column] = state.missing;
    if (state.populated && state.numeric > 0 && state.numeric / state.populated < 0.95) report.mixedTypeColumns.push(column);
    if (state.populated > 1 && state.distinct.size <= 1) report.constantColumns.push(column);
    if (!state.populated) report.emptyColumns.push(column);
  }
  report.totalIssues = report.missingCells + report.duplicateRows + report.emptyRows + report.whitespaceCells + report.mixedTypeColumns.length + report.constantColumns.length + report.emptyColumns.length;
  report.qualityScore = Math.max(0, Math.min(100, Math.round(100 - report.totalIssues / Math.max(1, total * columns.length) * 500)));
  report.hasIssues = report.totalIssues > 0;
  return { header, quality: report, profile: sample ? { ...profileDataset({ ...header, rawRows: sampled }, report.missingByColumn, { totalRows: total }), precisionRisks } : null };
};
export const computeSavedQuality = async (reference, options) => {
  const result = await scanSavedQuality(reference, options);
  const sourceQuality = result.header.rowStorage.streams.sourceRows ? (await scanSavedQuality(reference, { ...options, stream: 'sourceRows', sample: false })).quality : result.quality;
  return { quality: result.quality, profile: result.profile, sourceQuality };
};
export const loadBoundedTransformDataset = async (id, options = {}, { rows: maxRows = 250_000, bytes: maxBytes = 32 * 1024 * 1024, reserve } = {}) => {
  const rows = []; let header; let bytes = 0;
  await scanWorkerDatasetRows(id, (page, info) => {
    header ||= info.header;
    for (const row of page) {
      reserve?.(row);
      bytes += JSON.stringify(row).length * 2;
      if (rows.length >= maxRows || bytes > maxBytes) throw new Error('This exact transformation exceeds its retained-row/text memory policy. Split the source before retrying; all saved records were retained.');
      rows.push(row);
    }
  }, options);
  return { ...header, rawRows: rows, rowStreamsDeferred: true };
};
