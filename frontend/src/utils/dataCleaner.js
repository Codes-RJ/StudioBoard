/**
 * Data Cleaning & Preprocessing Engine (100% in-browser, zero dependencies)
 *
 * Two entry points:
 *  - analyzeDataQuality(dataset) -> diagnostic report of mistakes & missing parts
 *  - cleanDataset(dataset, options) -> cleaned copy of the dataset + change log
 */

import { meanFinite, midpointFinite } from './finiteArithmetic';
import { createExactMetric, formatExact, parseExactDecimal } from './exactDecimal';
const isMissing = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const isNumericLike = (v) => {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'string' || !v.trim()) return false;
  return Number.isFinite(Number(v));
};

export const columnName = (c) => (typeof c === 'string' ? c : c?.name);

/**
 * Deep quality diagnostics for a dataset.
 */
export const analyzeDataQuality = (dataset) => {
  const rows = dataset?.rawRows || [];
  const columns = (dataset?.columns || []).map(columnName).filter(Boolean);

  const report = {
    totalRows: rows.length,
    totalColumns: columns.length,
    missingCells: 0,
    missingByColumn: Object.create(null),
    duplicateRows: 0,
    emptyRows: 0,
    whitespaceCells: 0,
    mixedTypeColumns: [],
    constantColumns: [],
    emptyColumns: []
  };

  // Per-column scan
  for (const col of columns) {
    let missing = 0;
    let seenValues = new Set();
    let numericCount = 0;
    let nonEmpty = 0;

    for (const row of rows) {
      const v = row?.[col];
      if (isMissing(v)) {
        missing++;
        continue;
      }
      nonEmpty++;
      const strVal = typeof v === 'string' ? v : String(v);
      if (typeof v === 'string' && v !== v.trim()) report.whitespaceCells++;
      if (isNumericLike(v)) numericCount++;
      if (seenValues.size < 100) seenValues.add(strVal);
    }

    report.missingByColumn[col] = missing;
    report.missingCells += missing;

    if (nonEmpty > 0 && numericCount < nonEmpty && numericCount > 0 && numericCount / nonEmpty < 0.95) {
      report.mixedTypeColumns.push(col);
    }
    if (nonEmpty > 1 && seenValues.size <= 1) {
      report.constantColumns.push(col);
    }
    if (nonEmpty === 0) {
      report.emptyColumns.push(col);
    }
  }

  // Row-level scans
  const rowSignatures = new Set();
  for (const row of rows) {
    const sig = JSON.stringify(columns.map((c) => row?.[c] ?? null));
    if (rowSignatures.has(sig)) {
      report.duplicateRows++;
    } else {
      rowSignatures.add(sig);
    }
    if (columns.every((c) => isMissing(row?.[c]))) {
      report.emptyRows++;
    }
  }

  const totalIssues =
    report.missingCells +
    report.duplicateRows +
    report.emptyRows +
    report.whitespaceCells +
    report.mixedTypeColumns.length +
    report.constantColumns.length +
    report.emptyColumns.length;

  const totalCells = Math.max(1, rows.length * columns.length);
  report.qualityScore = Math.max(0, Math.min(100, Math.round(100 - (totalIssues / totalCells) * 500)));
  report.totalIssues = totalIssues;
  report.hasIssues = totalIssues > 0;

  return report;
};

/**
 * Default cleaning options.
 */
export const DEFAULT_CLEAN_OPTIONS = {
  trimWhitespace: true,
  removeDuplicates: false,
  removeEmptyRows: false,
  dropEmptyColumns: false,
  standardizeHeaders: false,
  missingNumeric: 'keep', // 'keep' | 'mean' | 'median' | 'zero' | 'dropRow'
  missingCategorical: 'keep' // 'keep' | 'unknown' | 'mode' | 'dropRow'
};


/**
 * Clean a dataset according to options.
 * Returns { rawRows, changes } — pure: does not mutate inputs.
 */
export const cleanDatasetRows = (rows, columns, options = {}) => {
  const opts = { ...DEFAULT_CLEAN_OPTIONS, ...options };
  if (opts.preserveRows && (opts.removeDuplicates || opts.removeEmptyRows || opts.dropEmptyColumns
    || opts.missingNumeric === 'dropRow' || opts.missingCategorical === 'dropRow'
    || Object.values(opts.columnPolicies || {}).some((policy) => policy.method === 'dropRow'))) {
    throw new Error('This workspace preserves every source row and column. Choose a fill policy or keep missing cells.');
  }
  const colNames = (columns || []).map(columnName).filter(Boolean);
  let columnDetails = colNames.map((name) => ({
    ...((columns || []).find((column) => columnName(column) === name && typeof column === 'object') || {}), name
  }));
  const changes = [];
  const operations = [];
  const protectedColumns = columnDetails.filter((column) => column.role === 'identifier' || column.role === 'ignore'
    || /(^|[\s_])(id|uuid|guid|sku|postal_code|zip_code)($|[\s_])/i.test(column.name)).map((column) => column.name);
  let working = rows.map((r) => ({ ...r }));

  // 1. Trim whitespace in string cells
  if (opts.trimWhitespace) {
    let trimmed = 0;
    for (const row of working) {
      for (const col of colNames) {
        if (protectedColumns.includes(col)) continue;
        const v = row[col];
        if (typeof v === 'string' && v !== v.trim()) {
          row[col] = v.trim();
          trimmed++;
        }
      }
    }
    if (trimmed) changes.push({ type: 'trim', label: `Trimmed whitespace on ${trimmed.toLocaleString()} cells` });
    if (trimmed) operations.push({ kind: 'trim', protectedColumns });
  }

  // 2. Standardize headers (snake_case)
  let finalColumns = colNames;
  if (opts.standardizeHeaders) {
    const renamed = Object.create(null);
    const usedNames = new Set();
    finalColumns = colNames.map((c) => {
      const base = c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || c;
      let std = base;
      let suffix = 2;
      while (usedNames.has(std)) {
        std = `${base}_${suffix++}`;
      }
      usedNames.add(std);
      if (std !== c) renamed[c] = std;
      return std;
    });
    working = working.map((row) => {
      return Object.fromEntries(colNames.map((oldName) => [renamed[oldName] || oldName, row[oldName]]));
    });
    columnDetails = columnDetails.map((column, index) => ({ ...column, name: finalColumns[index] }));
    if (Object.keys(renamed).length) {
      operations.push({ kind: 'headers', renamed });
      changes.push({ type: 'headers', label: `Standardized ${Object.keys(renamed).length} column names to unique snake_case names` });
    }
  }

  // 3. Drop fully-empty columns
  if (opts.dropEmptyColumns) {
    const empty = finalColumns.filter((col) => working.every((row) => isMissing(row?.[col])));
    if (empty.length) {
      finalColumns = finalColumns.filter((col) => !empty.includes(col));
      working = working.map((row) => {
        const next = { ...row };
        for (const col of empty) delete next[col];
        return next;
      });
      changes.push({ type: 'columns', label: `Removed ${empty.length} empty column${empty.length > 1 ? 's' : ''}: ${empty.join(', ')}` });
    }
  }

  // 4. Remove fully-empty rows BEFORE imputation, otherwise they would get
  //    their blanks filled and survive cleaning as fake records.
  if (opts.removeEmptyRows) {
    const before = working.length;
    working = working.filter((row) => !finalColumns.every((c) => isMissing(row?.[c])));
    const removed = before - working.length;
    if (removed) changes.push({ type: 'rows', label: `Removed ${removed} completely empty row${removed > 1 ? 's' : ''}` });
  }

  // 5. Classify columns before changing rows, then apply drop-row strategies
  // before imputation so fill statistics use only the rows that remain.
  const numericByColumn = Object.fromEntries(finalColumns.map((col) => {
    const values = working.map((row) => row?.[col]).filter((value) => !isMissing(value));
    const numericRatio = values.length ? values.filter(isNumericLike).length / values.length : 0;
    const declared = columnDetails.find((column) => column.name === col);
    return [col, declared?.type === 'number' || (!declared?.type && numericRatio >= 0.7)];
  }));
  const dropColumns = finalColumns.filter((col) => (
    numericByColumn[col] ? opts.missingNumeric === 'dropRow' : opts.missingCategorical === 'dropRow'
  ));
  if (dropColumns.length) {
    const before = working.length;
    working = working.filter((row) => dropColumns.every((col) => !isMissing(row?.[col])));
    const removed = before - working.length;
    if (removed) changes.push({
      type: 'rows',
      label: `Dropped ${removed.toLocaleString()} row${removed === 1 ? '' : 's'} with missing values in ${dropColumns.length} selected column${dropColumns.length === 1 ? '' : 's'}`
    });
  }

  // 6. Fill remaining missing values per column type
  for (const col of finalColumns) {
    // Filling keys can invent relationships; preserve them for explicit review.
    const declared = columnDetails.find((column) => column.name === col);
    if (declared?.role === 'identifier' || declared?.role === 'ignore'
      || /(^|[\s_])(id|uuid|guid|sku|postal_code|zip_code)($|[\s_])/i.test(col)) continue;
    const values = working.map((r) => r?.[col]).filter((v) => !isMissing(v));
    const isNumericCol = numericByColumn[col];

    const policy = opts.columnPolicies?.[col];
    // Dates need an explicit per-column decision, not a categorical guess.
    const method = policy?.method || (declared?.type === 'date' ? 'keep'
      : isNumericCol ? opts.missingNumeric : opts.missingCategorical);
    if (method === 'keep' || method === 'dropRow') continue;
    let fillValue;
    if (declared?.precision === 'exact' && ['value', 'zero', 'mean', 'median'].includes(method)) {
      if (method === 'value') { const replacement = parseExactDecimal(policy.value); if (!replacement) throw new Error('An exact replacement must contain a decimal value.'); fillValue = formatExact(replacement); }
      else if (method === 'zero') fillValue = '0';
      else {
        const metric = createExactMetric(method === 'mean' ? 'average' : 'median'); values.forEach((value) => metric.consume(value));
        const result = metric.result(); if (!result) continue; fillValue = formatExact(result);
        if (fillValue.includes('/')) throw new Error(`The exact ${method} for "${col}" repeats. Choose an explicit decimal replacement or preserve the missing cell.`);
      }
    } else if (method === 'value') {
      fillValue = policy.value;
      if (isNumericCol) {
        if (isMissing(fillValue) || !isNumericLike(fillValue)) throw new Error(`Enter a finite numeric replacement for "${col}".`);
        fillValue = Number(fillValue);
      } else if (isMissing(fillValue)) throw new Error(`Enter a replacement for "${col}".`);
      if (declared?.type === 'date' && !Number.isFinite(Date.parse(fillValue))) throw new Error(`Enter a valid date replacement for "${col}".`);
    } else if (method === 'zero' && isNumericCol) fillValue = 0;
    else if ((method === 'mean' || method === 'median') && isNumericCol) {
      const nums = values.filter(isNumericLike).map(Number).sort((a, b) => a - b);
      if (!nums.length) continue; // No observed statistic: leave unresolved.
      fillValue = method === 'mean' ? meanFinite(nums)
        : nums.length % 2 ? nums[(nums.length - 1) / 2] : midpointFinite(nums[nums.length / 2 - 1], nums[nums.length / 2]);
    } else if (method === 'unknown' && !isNumericCol) fillValue = 'Unknown';
    else if (method === 'mode') {
      const freq = new Map();
      let bestCount = 0;
      for (const value of values) {
        freq.set(value, (freq.get(value) || 0) + 1);
        if (freq.get(value) > bestCount) { bestCount = freq.get(value); fillValue = value; }
      }
      if (!values.length) continue;
    } else throw new Error(`Unsupported missing-value policy for "${col}".`);
    let count = 0;
    for (const row of working) {
      if (isMissing(row?.[col])) { row[col] = fillValue; count++; }
    }
    if (count) {
      operations.push({ kind: 'fill', column: col, method, value: fillValue, count });
      changes.push({ type: 'fill', label: `Filled ${count} missing value${count > 1 ? 's' : ''} in "${col}" with ${method} (${fillValue})` });
    }
  }

  // 7. Remove duplicate rows (keep first occurrence)
  if (opts.removeDuplicates) {
    const seen = new Set();
    const before = working.length;
    working = working.filter((row) => {
      const sig = JSON.stringify(finalColumns.map((c) => row?.[c] ?? null));
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
    const removed = before - working.length;
    if (removed) changes.push({ type: 'dedupe', label: `Removed ${removed.toLocaleString()} duplicate row${removed > 1 ? 's' : ''}` });
  }

  return { rawRows: working, columns: finalColumns, columnDetails: columnDetails.filter(({ name }) => finalColumns.includes(name)), changes, operations };
};

/** Rebuild a working dataset from its preserved source rows and saved recipe. */
export const replayCleaningRecipe = (rows, columns, recipe = []) => {
  let result = { rawRows: rows.map((row) => ({ ...row })), columns: (columns || []).map(columnName).filter(Boolean), changes: [] };
  const steps = [];
  const operationSteps = [];
  for (const options of recipe) {
    result = cleanDatasetRows(result.rawRows, result.columnDetails || columns, options);
    steps.push(result.changes);
    operationSteps.push(result.operations);
  }
  return { ...result, steps, operationSteps };
};

export const summarizeCleaningPreview = (beforeRows, beforeColumns, result) => ({
  rowsBefore: beforeRows.length,
  rowsAfter: result.rawRows.length,
  rowsRemoved: Math.max(0, beforeRows.length - result.rawRows.length),
  columnsBefore: (beforeColumns || []).length,
  columnsAfter: result.columns.length,
  columnsRemoved: Math.max(0, (beforeColumns || []).length - result.columns.length),
  changes: result.changes || []
});

/**
 * Per-column descriptive statistics (used by reports and the chat).
 */
export const computeNumericColumnStats = (nums, missing) => {
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = sum / nums.length;
  const std = Math.sqrt(nums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / nums.length);
  // Callers own this array. Sort after the original-order arithmetic so exact
  // median needs no additional full numeric copy or change in summation order.
  nums.sort((a, b) => a - b);
  const median = nums.length % 2 ? nums[(nums.length - 1) / 2]
    : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2;
  return { type: 'number', count: nums.length, missing, mean, median, min: nums[0], max: nums[nums.length - 1], std, sum };
};

export const computeColumnStats = (rows, columnNames, overrides = {}) => {
  const stats = Object.create(null);
  for (const col of columnNames) {
    if (overrides[col]?.precision === 'exact') {
      const metrics = Object.fromEntries(['sum', 'average', 'median', 'min', 'max'].map((kind) => [kind, createExactMetric(kind)])); let count = 0;
      for (const row of rows) if (!isMissing(row?.[col])) { count++; Object.values(metrics).forEach((metric) => metric.consume(row[col])); }
      stats[col] = { type: 'exact', count, missing: rows.length - count, ...Object.fromEntries(Object.entries(metrics).map(([kind, metric]) => [kind === 'average' ? 'mean' : kind, metric.result() ? formatExact(metric.result()) : null])) };
      continue;
    }
    const values = rows.map((r) => r?.[col]).filter((v) => !isMissing(v));
    const nums = values.map(Number).filter(Number.isFinite);
    if (!values.length) {
      stats[col] = { type: 'empty', missing: rows.length, unique: 0 };
      continue;
    }
    if (nums.length / values.length >= 0.7) {
      stats[col] = computeNumericColumnStats(nums, rows.length - nums.length);
    } else {
      const freq = new Map();
      for (const v of values) {
        const key = String(v);
        freq.set(key, (freq.get(key) || 0) + 1);
      }
      const top = [...freq.entries()].sort((a, b) => b[1] - a[1]);
      stats[col] = {
        type: 'category',
        count: values.length,
        missing: rows.length - values.length,
        unique: top.length,
        top: top.slice(0, 3).map(([value, count]) => ({ value, count }))
      };
    }
  }
  return stats;
};
