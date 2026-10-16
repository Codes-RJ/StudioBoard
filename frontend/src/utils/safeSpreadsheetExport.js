// Escape only the downloadable spreadsheet copy. Originals/JSON retain values.
export const FORMULA_PREFIX = /^(?:[\s\u0000-\u001f])*[=+\-@]|^[\t\r\n]/;
export const safeSpreadsheetValue = (value) => {
  const scalar = value && typeof value === 'object' ? JSON.stringify(value) : value;
  return typeof scalar === 'string' && FORMULA_PREFIX.test(scalar) ? `'${scalar}` : scalar;
};
export const safeSpreadsheetMatrix = (rows) => {
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [fields.map(safeSpreadsheetValue), ...rows.map((row) => fields.map((field) => safeSpreadsheetValue(row[field])))];
};
