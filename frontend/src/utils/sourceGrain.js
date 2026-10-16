import { getDatasetColumnNames } from './chartDataTransforms';
export const reviewSourceGrain = (dataset, { fields = [], description = '' } = {}) => {
  if (!Array.isArray(fields) || fields.length > 6 || new Set(fields).size !== fields.length || fields.some((field) => !getDatasetColumnNames(dataset).includes(field))) throw new Error('Choose up to six actual fields for the source grain.');
  if (typeof description !== 'string' || !description.trim() || description.length > 300) throw new Error('Describe what one source row represents in 1–300 characters.');
  const keys = new Set(); let missingKeyRows = 0; let repeatedKeyRows = 0; let bytes = 0;
  for (const row of dataset.rawRows) {
    if (!fields.length) continue;
    if (fields.some((field) => row[field] == null || String(row[field]).trim() === '')) { missingKeyRows++; continue; }
    // Preserve identifier bytes: whitespace/leading zeros are not repaired.
    const key = JSON.stringify(fields.map((field) => String(row[field])));
    if (keys.has(key)) repeatedKeyRows++;
    else { bytes += key.length * 2; if (keys.size >= 250_000 || bytes > 32 * 1024 * 1024) throw new Error('Exact grain review exceeds its retained-key policy. Narrow the source.'); keys.add(key); }
  }
  return { description: description.trim(), fields, rows: dataset.rawRows.length, missingKeyRows, repeatedKeyRows,
    unique: fields.length > 0 && missingKeyRows === 0 && repeatedKeyRows === 0, reviewedAt: new Date().toISOString() };
};
