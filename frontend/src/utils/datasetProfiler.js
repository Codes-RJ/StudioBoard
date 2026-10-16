import { scanIntegerPrecisionRisks } from './numberSemantics';
import { meanFinite } from './finiteArithmetic';
import { isDateLikeValue } from './dateSemantics';
const PROFILE_SAMPLE_LIMIT = 25_000;
const MISSING = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
const TYPE_OPTIONS = ['number', 'date', 'string'];
const ROLE_OPTIONS = ['measure', 'dimension', 'identifier', 'ignore'];

const isDateLike = isDateLikeValue;
const nativeNumericValue = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const numericValue = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim()
    .replace(/[,$₹€£¥%]/g, '')
    .replace(/\b(?:USD|INR|EUR|GBP|JPY|CNY)\b/gi, '')
    .trim();
  const isParentheticalNegative = /^\(.*\)$/.test(normalized);
  const parsed = Number(normalized.replace(/^\(|\)$/g, ''));
  return Number.isFinite(parsed) ? (isParentheticalNegative ? -parsed : parsed) : null;
};
const quantile = (values, probability) => {
  if (!values.length) return null;
  const position = (values.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return values[lower] * (1 - fraction) + values[upper] * fraction;
};

const detectCurrency = (name, values) => {
  const text = `${name} ${values.slice(0, 100).filter((value) => typeof value === 'string').join(' ')}`;
  const codes = [
    [/\bINR\b/i, 'INR'], [/\bEUR\b/i, 'EUR'], [/\bGBP\b/i, 'GBP'],
    [/\bUSD\b/i, 'USD'], [/\bCAD\b/i, 'CAD'], [/\bAUD\b/i, 'AUD'],
    [/\bNZD\b/i, 'NZD'], [/\bJPY\b/i, 'JPY'], [/\bCNY\b/i, 'CNY']
  ];
  const code = codes.find(([pattern]) => pattern.test(text))?.[1];
  if (code) return `${code} (currency code detected)`;
  if (/₹/.test(text)) return 'INR (₹ symbol detected)';
  if (/€/.test(text)) return 'EUR (€ symbol detected)';
  if (/£/.test(text)) return 'GBP (£ symbol detected)';
  if (/\$/.test(text)) return '$ symbol (USD/CAD/AUD/NZD ambiguous)';
  if (/¥/.test(text)) return '¥ symbol (JPY/CNY ambiguous)';
  return null;
};

const detectUnit = (name) => {
  const normalized = name.toLowerCase();
  if (/%|percent|percentage/.test(normalized)) return '% (suggested by column name)';
  if (/\brate\b/.test(normalized)) return 'rate (scale unknown)';
  if (/\b(age|years?)\b/.test(normalized)) return 'years (suggested by column name)';
  if (/\b(kg|kilograms?)\b/.test(normalized)) return 'kg (suggested by column name)';
  if (/\b(hours?|hrs?)\b/.test(normalized)) return 'hours (suggested by column name)';
  if (/\b(minutes?|mins?)\b/.test(normalized)) return 'minutes (suggested by column name)';
  if (/\b(seconds?|secs?)\b/.test(normalized)) return 'seconds (suggested by column name)';
  return null;
};

const suggestsIdentifier = (name) => /(^|[ _-])(id|key|uuid|code|zip|postal|phone|email|account number|customer number)([ _-]|$)/i.test(name);

const sampledRows = (rows) => {
  if (rows.length <= PROFILE_SAMPLE_LIMIT) return rows;
  const step = rows.length / PROFILE_SAMPLE_LIMIT;
  return Array.from({ length: PROFILE_SAMPLE_LIMIT }, (_, index) => rows[Math.floor(index * step)]);
};

export const profileDataset = (dataset, knownMissingByColumn = null, { totalRows = dataset?.rawRows?.length || 0 } = {}) => {
  const rows = Array.isArray(dataset?.rawRows) ? dataset.rawRows : [];
  const columns = (dataset?.columns || []).map((column) => typeof column === 'string' ? column : column?.name).filter(Boolean);
  const sample = sampledRows(rows);
  const profiles = columns.map((name) => {
    let missingCount = Number.isFinite(knownMissingByColumn?.[name]) ? knownMissingByColumn[name] : 0;
    let numericCount = 0;
    let plainNumericCount = 0;
    let formattedNumericCount = 0;
    let dateCount = 0;
    const numericValues = [];
    const dateValues = [];
    const distinct = new Set();
    const sampledValues = [];

    if (!knownMissingByColumn) {
      for (let index = 0; index < rows.length; index += 1) {
        if (MISSING(rows[index]?.[name])) missingCount += 1;
      }
    }
    for (const row of sample) {
      const value = row?.[name];
      if (MISSING(value)) continue;
      sampledValues.push(value);
      distinct.add(String(value));
      const number = numericValue(value);
      if (number !== null) {
        numericCount += 1;
        if (nativeNumericValue(value) === null) formattedNumericCount += 1;
        else plainNumericCount += 1;
        numericValues.push(number);
      } else if (isDateLike(value)) {
        dateCount += 1;
        dateValues.push(new Date(value).getTime());
      }
    }

    const validSample = sampledValues.length;
    const numericRatio = validSample ? plainNumericCount / validSample : 0;
    const dateRatio = validSample ? dateCount / validSample : 0;
    const type = validSample && dateRatio >= 0.8 ? 'date'
      : validSample && numericRatio >= 0.8 ? 'number'
        : 'string';
    const uniqueness = validSample ? distinct.size / validSample : 0;
    const idName = suggestsIdentifier(name);
    const identifier = idName || (type === 'string' && validSample >= 20 && uniqueness >= 0.98);
    const role = !validSample ? 'ignore' : identifier ? 'identifier' : type === 'number' ? 'measure' : 'dimension';
    const evidence = [`${plainNumericCount.toLocaleString()} of ${validSample.toLocaleString()} sampled non-missing values are plain numbers`,
      `${dateCount.toLocaleString()} of ${validSample.toLocaleString()} sampled values parse as dates`,
      `${distinct.size.toLocaleString()} distinct sampled values`];
    if (formattedNumericCount) evidence.push(`${formattedNumericCount.toLocaleString()} values look numeric only after removing currency/unit formatting`);
    if (idName) evidence.push('Column name resembles an identifier');
    else if (identifier) evidence.push('At least 98% of sampled values are distinct');

    const sorted = numericValues.sort((left, right) => left - right);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q1 === null || q3 === null ? 0 : q3 - q1;
    const lower = q1 === null ? -Infinity : q1 - 1.5 * iqr;
    const upper = q3 === null ? Infinity : q3 + 1.5 * iqr;
    const outlierCount = sorted.filter((value) => value < lower || value > upper).length;

    return {
      name,
      inferredType: type,
      inferredRole: role,
      sampledRows: sample.length,
      nonMissingRows: totalRows - missingCount,
      missingCount,
      missingRatio: totalRows ? missingCount / totalRows : 0,
      distinctSampleCount: distinct.size,
      sampledCardinality: validSample ? distinct.size / validSample : 0,
      outlierCount,
      numericSampleCount: numericCount,
      formattedNumericCount,
      ...(numericCount ? {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: meanFinite(numericValues),
        median: quantile(sorted, 0.5),
        outlierMethod: '1.5 × IQR on sampled numeric values'
      } : {}),
      ...(dateValues.length ? {
        minDate: new Date(Math.min(...dateValues)).toISOString(),
        maxDate: new Date(Math.max(...dateValues)).toISOString()
      } : {}),
      currencyHint: detectCurrency(name, sampledValues),
      unitHint: detectUnit(name),
      evidence
    };
  });

  const keyCandidates = profiles.filter(({ inferredRole }) => inferredRole === 'identifier').map(({ name }) => name);
  const rowGrain = keyCandidates.length
    ? { description: `Rows may represent one record per ${keyCandidates.slice(0, 3).join(', ')}`, evidence: 'Identifier-like columns were detected; uniqueness is estimated from a sample.' }
    : { description: 'No clear row identifier was detected', evidence: 'Review the column profile and identify a single or composite key if one exists.' };
  return { rowCount: totalRows, sampledRows: sample.length, sampleLimit: PROFILE_SAMPLE_LIMIT, columns: profiles, rowGrain,
    precisionRisks: scanIntegerPrecisionRisks(rows, columns) };
};

export const isValidColumnOverride = (override) => Boolean(override && typeof override === 'object'
  && TYPE_OPTIONS.includes(override.type) && ROLE_OPTIONS.includes(override.role));
