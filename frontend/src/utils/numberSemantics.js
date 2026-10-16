export const integerPrecisionRisk = (value) => {
  if (typeof value === 'number') return Number.isInteger(value) && !Number.isSafeInteger(value) ? 'stored-number' : null;
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim()) && !Number.isSafeInteger(Number(value))) return 'integer-text';
  return null;
};
export const scanIntegerPrecisionRisks = (rows, fields) => {
  const risks = Object.create(null);
  for (const row of rows) for (const field of fields) {
    const kind = integerPrecisionRisk(row?.[field]);
    if (kind) { risks[field] ||= { 'stored-number': 0, 'integer-text': 0 }; risks[field][kind]++; }
  }
  return risks;
};
export const assertMeasurePrecision = (dataset, field, value) => {
  if (integerPrecisionRisk(value) === 'integer-text' && !['exact', 'native'].includes(dataset.columnOverrides?.[field]?.precision)) throw new Error(`Field ${field} contains integers outside the safe Number range. Review exact decimal precision, explicitly accept native approximation, or mark it as an identifier in Data Health.`);
};
