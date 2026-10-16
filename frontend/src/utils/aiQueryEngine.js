import { generateSuggestedPrompts, getDatasetRevision } from './aiDatasetIdentity.js';
import { matchesScope } from './analysisScope.js';
import { dateGroupKey, isDateLikeValue } from './dateSemantics.js';
import { assertMeasurePrecision } from './numberSemantics.js';
import { calculateCorrelationSummary, createRunningMetric, aggregateMetricValues } from './chartDataTransforms.js';
import { addFinite, finiteResult } from './finiteArithmetic.js';
import { prepareAssistantMessage } from './assistantConversation.js';

export { generateSuggestedPrompts, getDatasetRevision };

/**
 * Deterministic local-first natural-language analytics.
 * Produces an inspectable plan, calculations, confidence and assumptions.
 */
const PROFILE_SAMPLE_LIMIT = 10_000;
const COMMON_VALUE_LIMIT = 20;

const normalizeText = (value) => String(value ?? '')
  .replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9.%<>=-]+/g, ' ')
  .replace(/\s+/g, ' ').trim();
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const round = (value, digits) => Number.isFinite(value)
  ? digits === undefined ? value : Math.round(value * (10 ** digits)) / (10 ** digits) : null;
const isMissing = (value) => value === null || value === undefined || String(value).trim() === '';
const toNumber = (value) => isMissing(value) ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
const toTimestamp = (value) => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};
const formatNumber = (value) => value == null ? 'uncomputable' : Number(value).toLocaleString(undefined, { maximumSignificantDigits: 12 });
const singularize = (word) => word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;

const SYNONYMS = {
  revenue: ['sales', 'income', 'turnover', 'mrr', 'arr', 'gmv'],
  sales: ['revenue', 'orders', 'bookings', 'mrr'],
  cost: ['expense', 'spend', 'price', 'fee', 'cac'],
  customer: ['client', 'user', 'account', 'subscriber'],
  churn: ['attrition', 'cancellation', 'lost customers'],
  profit: ['margin', 'net income', 'earnings', 'loss', 'gain', 'deficit'],
  quantity: ['units', 'volume', 'count'],
  category: ['segment', 'type', 'group', 'plan', 'tier', 'region', 'status'],
  date: ['time', 'month', 'year', 'day', 'week', 'quarter', 'period', 'timestamp']
};

const phraseInQuery = (query, phrase) => {
  const normalized = normalizeText(phrase);
  if (!normalized) return false;
  return [normalized, singularize(normalized), `${normalized}s`].some((candidate) =>
    new RegExp(`(^| )${escapeRegex(candidate)}( |$)`, 'i').test(query));
};
const aliasesForColumn = (name) => {
  const normalized = normalizeText(name);
  const aliases = new Set([normalized, singularize(normalized)]);
  const tokens = new Set(normalized.split(' '));
  if (['date', 'time', 'timestamp', 'month', 'year', 'week', 'quarter'].some((token) => tokens.has(token))) {
    ["date", ...SYNONYMS.date].forEach((term) => aliases.add(term));
    return [...aliases];
  }
  for (const [concept, synonyms] of Object.entries(SYNONYMS)) {
    const vocabulary = [concept, ...synonyms];
    if (vocabulary.some((term) => phraseInQuery(normalized, term) || phraseInQuery(term, normalized))) {
      vocabulary.forEach((term) => aliases.add(normalizeText(term)));
    }
  }
  return [...aliases].filter(Boolean);
};
const editDistance = (left, right) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0]; previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length];
};
const declaredColumnNames = (dataset) => {
  const declared = (dataset?.columns || []).map((column) =>
    typeof column === 'string' ? column : column?.name).filter(Boolean);
  return [...new Set([...declared, ...Object.keys(dataset?.rawRows?.[0] || {})])]
    .filter((name) => dataset?.columnOverrides?.[name]?.role !== 'ignore');
};
const declaredType = (dataset, name) => String((dataset?.columns || []).find((entry) =>
  typeof entry === 'object' && entry?.name === name)?.type || dataset?.columnOverrides?.[name]?.type || '').toLowerCase();

/** Build once per dataset revision. The UI performs this work in a Web Worker. */
export const buildDatasetProfile = (dataset) => {
  const rows = Array.isArray(dataset?.rawRows) ? dataset.rawRows : [];
  const supplied = dataset?.metrics?.columnGroups || {};
  const sample = rows.slice(0, PROFILE_SAMPLE_LIMIT);
  const columns = declaredColumnNames(dataset).map((name) => {
    let missingCount = 0; let numericCount = 0; let dateCount = 0;
    const average = createRunningMetric('average'); let numericMin = Infinity; let numericMax = -Infinity;
    let dateMin = Infinity; let dateMax = -Infinity;
    const frequencies = new Map();
    for (const row of sample) {
      const value = row?.[name];
      if (isMissing(value)) { missingCount += 1; continue; }
      const numeric = toNumber(value);
      if (numeric !== null) {
        numericCount += 1; average.consume(numeric);
        numericMin = Math.min(numericMin, numeric); numericMax = Math.max(numericMax, numeric);
      }
      const timestamp = toTimestamp(value);
      if (timestamp !== null && isDateLikeValue(value)) {
        dateCount += 1; dateMin = Math.min(dateMin, timestamp); dateMax = Math.max(dateMax, timestamp);
      }
      if (frequencies.size < 1_000 || frequencies.has(String(value))) {
        frequencies.set(String(value), (frequencies.get(String(value)) || 0) + 1);
      }
    }
    const validCount = sample.length - missingCount;
    const override = dataset?.columnOverrides?.[name];
    const typeHint = declaredType(dataset, name);
    let type = 'categorical';
    if (override?.precision === 'exact' && override?.role === 'measure') type = 'exact';
    else if (override?.role === 'identifier' || override?.role === 'ignore') type = override.role;
    else if (override?.role === 'dimension') type = typeHint === 'date' ? 'date' : 'categorical';
    else if (override?.type === 'date' || ['date', 'datetime', 'timestamp'].includes(typeHint) || supplied.date?.includes(name)) type = 'date';
    else if (override?.type === 'number' || ['number', 'numeric', 'integer', 'float'].includes(typeHint) || supplied.numeric?.includes(name)) type = 'numeric';
    else if (override?.type === 'string') type = 'categorical';
    else if (validCount && dateCount / validCount >= 0.8) type = 'date';
    else if (validCount && numericCount / validCount >= 0.8) type = 'numeric';
    return {
      name, type, aliases: aliasesForColumn(name), sampled: sample.length, missingCount, validCount,
      uniqueCount: frequencies.size,
      commonValues: [...frequencies.entries()].sort((a, b) => b[1] - a[1]).slice(0, COMMON_VALUE_LIMIT)
        .map(([value, count]) => ({ value, count })),
      ...(type === 'numeric' ? { min: numericCount ? numericMin : null, max: numericCount ? numericMax : null,
        mean: average.finish() } : {}),
      ...(type === 'date' ? { minDate: dateCount ? new Date(dateMin).toISOString() : null,
        maxDate: dateCount ? new Date(dateMax).toISOString() : null } : {})
    };
  });
  return {
    revision: getDatasetRevision(dataset), rowCount: rows.length, sampledRows: sample.length, columns,
    numeric: columns.filter(({ type }) => type === 'numeric').map(({ name }) => name),
    date: columns.filter(({ type }) => type === 'date').map(({ name }) => name),
    categorical: columns.filter(({ type }) => type === 'categorical').map(({ name }) => name)
  };
};

const scoreColumn = (query, column) => {
  const normalizedQuery = normalizeText(query); const normalizedName = normalizeText(column.name || column);
  if (phraseInQuery(normalizedQuery, normalizedName)) return 100 + normalizedName.split(' ').length;
  const alias = (column.aliases || aliasesForColumn(normalizedName)).find((item) => phraseInQuery(normalizedQuery, item));
  if (alias) return 70 + alias.split(' ').length;
  const queryTokens = new Set(normalizedQuery.split(' ').map(singularize));
  const nameTokens = normalizedName.split(' ').map(singularize);
  const overlap = nameTokens.filter((token) => queryTokens.has(token)).length;
  if (overlap) return 30 + overlap / nameTokens.length * 20;
  const fuzzy = nameTokens.some((nameToken) => nameToken.length >= 5 && [...queryTokens]
    .some((queryToken) => queryToken.length >= 5 && editDistance(nameToken, queryToken) <= 2));
  return fuzzy ? 20 : 0;
};
export const rankColumnsInQuery = (query, columns = []) => columns
  .map((column) => typeof column === 'string' ? { name: column, aliases: aliasesForColumn(column) } : column)
  .map((column) => ({ name: column?.name, score: scoreColumn(query, column || {}) }))
  .filter(({ name, score }) => name && score > 0)
  .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map(({ name }) => name);
const rankedTyped = (query, profile, types) => rankColumnsInQuery(query,
  profile.columns.filter(({ type }) => types.includes(type)));

const resolveValueFilters = (query, profile) => {
  const normalized = normalizeText(query); const filters = [];
  for (const column of profile.columns) {
    const pattern = new RegExp(`${escapeRegex(normalizeText(column.name))}\\s*(>=|<=|=|is|equals|>|<|above|below|over|under|at least|at most)\\s+([^,;]+?)(?=\\s+(?:and|or|by|from|between)\\s+|$)`, 'i');
    const explicit = normalized.match(pattern);
    if (explicit) {
      const aliases = { is: '=', equals: '=', above: '>', over: '>', below: '<', under: '<', 'at least': '>=', 'at most': '<=' };
      const value = explicit[2].trim();
      const namesAnotherColumn = profile.columns.some(({ name }) => normalizeText(name) === normalizeText(value));
      const valueMatchesType = column.type === 'numeric'
        ? toNumber(value) !== null
        : column.type === 'date'
          ? toTimestamp(value) !== null
          : true;
      // Phrases such as "revenue over month" describe a grouping axis, not a
      // comparison. Only accept explicit filters whose right-hand side can be
      // a value of the referenced column.
      if (!namesAnotherColumn && valueMatchesType) {
        filters.push({ column: column.name, operator: aliases[explicit[1]] || explicit[1], value });
      }
    } else if (column.type === 'categorical') {
      const hits = column.commonValues.filter(({ value }) => phraseInQuery(normalized, value));
      if (hits.length === 1) filters.push({ column: column.name, operator: '=', value: hits[0].value });
    }
  }
  return filters;
};
const resolveDateRange = (query, profile) => {
  const column = rankedTyped(query, profile, ['date'])[0] || profile.date[0];
  if (!column) return null;
  const iso = '(\\d{4}[-/]\\d{1,2}[-/]\\d{1,2})';
  let match = query.match(new RegExp(`between\\s+${iso}\\s+and\\s+${iso}`, 'i')) ||
    query.match(new RegExp(`from\\s+${iso}\\s+(?:to|through|until)\\s+${iso}`, 'i'));
  if (match) return { column, start: match[1], end: match[2] };
  const after = query.match(new RegExp(`(?:after|since)\\s+${iso}`, 'i'));
  const before = query.match(new RegExp(`before\\s+${iso}`, 'i'));
  if (after || before) return { column, start: after?.[1] || null, end: before?.[1] || null };
  match = query.match(/last\s+(\d+)\s+(day|week|month|quarter|year)s?/i);
  if (!match) return null;
  const maxDate = profile.columns.find(({ name }) => name === column)?.maxDate;
  if (!maxDate) return null;
  const end = new Date(maxDate);
  const days = { day: 1, week: 7, month: 30.4375, quarter: 91.3125, year: 365.25 }[match[2].toLowerCase()] * Math.min(Number(match[1]), 10_000);
  return { column, start: new Date(end.getTime() - days * 86400000).toISOString(), end: end.toISOString(), relative: match[0] };
};
const applyFilters = (rows, filters, range) => rows.filter((row) => {
  for (const filter of filters) {
    if (filter.source === 'dashboard') {
      if (!matchesScope(row, { [filter.column]: filter.value })) return false;
      continue;
    }
    const left = toNumber(row?.[filter.column]); const right = toNumber(filter.value);
    if (['>', '<', '>=', '<='].includes(filter.operator) && left !== null && right !== null) {
      if (filter.operator === '>' && !(left > right)) return false;
      if (filter.operator === '<' && !(left < right)) return false;
      if (filter.operator === '>=' && !(left >= right)) return false;
      if (filter.operator === '<=' && !(left <= right)) return false;
    } else if (normalizeText(row?.[filter.column]) !== normalizeText(filter.value)) return false;
  }
  if (range) {
    const value = toTimestamp(row?.[range.column]);
    if (value === null || (range.start && value < Date.parse(range.start)) ||
      (range.end && value > Date.parse(range.end) + (String(range.end).length <= 10 ? 86399999 : 0))) return false;
  }
  return true;
});
const normalizeScopeFilters = (scopeFilters, profile) => {
  const knownColumns = new Set(profile.columns.map(({ name }) => name));
  return Object.entries(scopeFilters || {})
    .filter(([column, value]) => knownColumns.has(column) && !isMissing(value))
    .map(([column, value]) => ({ column, operator: '=', value, source: 'dashboard' }));
};

const aggregationFromQuery = (query) => {
  if (/\b(average|avg|mean)\b/i.test(query)) return 'average';
  if (/\b(median|p50)\b/i.test(query)) return 'median';
  if (/\b(max|maximum|highest|largest)\b/i.test(query)) return 'max';
  if (/\b(min|minimum|lowest|smallest)\b/i.test(query)) return 'min';
  if (/\b(count|how many|number of)\b/i.test(query)) return 'count';
  return 'sum';
};
const aggregate = (rows, metric, type) => {
  if (metric === '__count__') return rows.length;
  if (type === 'count') return rows.filter((row) => !isMissing(row?.[metric])).length;
  const running = type === 'median' ? null : createRunningMetric(type);
  const values = type === 'median' ? [] : null;
  for (const row of rows) {
    const value = toNumber(row?.[metric]);
    if (value === null) continue;
    running?.consume(value);
    values?.push(value);
  }
  return values ? aggregateMetricValues(values, 'median') : running.finish();
};
const groupRows = (rows, dimension, metric, aggregation, overrides) => {
  const groups = new Map();
  for (const row of rows) {
    const key = dateGroupKey(row?.[dimension], overrides?.[dimension]) ?? 'Unknown';
    if (!groups.has(key)) groups.set(key, { rowCount: 0, populatedCount: 0,
      running: aggregation === 'median' || metric === '__count__' ? null : createRunningMetric(aggregation),
      values: aggregation === 'median' ? [] : null });
    const stats = groups.get(key); stats.rowCount += 1;
    if (!isMissing(row?.[metric])) stats.populatedCount += 1;
    if (metric !== '__count__') stats.running?.consume(row?.[metric]);
    const value = toNumber(row?.[metric]);
    if (value !== null) {
      stats.values?.push(value);
    }
  }
  return [...groups].map(([name, stats]) => {
    let value = stats.running?.finish();
    if (metric === '__count__') value = stats.rowCount;
    else if (aggregation === 'count') value = stats.populatedCount;
    else if (aggregation === 'median') {
      value = aggregateMetricValues(stats.values, 'median');
    }
    return { name, value: round(value), count: stats.rowCount };
  }).filter(({ value }) => value !== null);
};

const summarizeDuplicates = (rows, columns, limit = PROFILE_SAMPLE_LIMIT) => {
  const sample = rows.slice(0, limit);
  const seen = new Set(); let duplicates = 0;
  for (const row of sample) {
    const signature = JSON.stringify(columns.map((column) => row?.[column] ?? null));
    if (seen.has(signature)) duplicates += 1;
    else seen.add(signature);
  }
  return { duplicates, sampledRows: sample.length, truncated: rows.length > sample.length };
};

const summarizeColumn = (rows, column, type) => {
  let missing = 0; let count = 0; let numericCount = 0;
  const average = createRunningMetric('average');
  let min = Infinity; let max = -Infinity; let minDate = Infinity; let maxDate = -Infinity;
  const frequencies = new Map();
  for (const row of rows) {
    const raw = row?.[column];
    if (isMissing(raw)) { missing += 1; continue; }
    count += 1;
    if (type === 'numeric') {
      const value = toNumber(raw); if (value === null) continue;
      numericCount += 1; average.consume(value);
      min = Math.min(min, value); max = Math.max(max, value);
    } else if (type === 'date') {
      const value = toTimestamp(raw); if (value === null) continue;
      minDate = Math.min(minDate, value); maxDate = Math.max(maxDate, value);
    } else if (frequencies.size < 1_000 || frequencies.has(String(raw))) {
      frequencies.set(String(raw), (frequencies.get(String(raw)) || 0) + 1);
    }
  }
  const mean = average.finish();
  const scale = numericCount ? Math.max(Math.abs(min), Math.abs(max)) : 0;
  let variance = 0;
  if (scale) for (const row of rows) {
    const value = toNumber(row?.[column]);
    if (value !== null) variance += ((value / scale - mean / scale) ** 2) / numericCount;
  }
  return {
    count, missing,
    ...(type === 'numeric' ? { min: numericCount ? min : null, max: numericCount ? max : null, mean, standardDeviation: numericCount ? round(Math.sqrt(variance) * scale) : null } : {}),
    ...(type === 'date' ? { minDate: Number.isFinite(minDate) ? new Date(minDate).toISOString() : null, maxDate: Number.isFinite(maxDate) ? new Date(maxDate).toISOString() : null } : {}),
    ...(type === 'categorical' ? { uniqueCount: frequencies.size, commonValues: [...frequencies].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([value, frequency]) => ({ value, frequency })) } : {})
  };
};

export const computeCorrelation = (rows, colA, colB) => {
  const { value, pairCount } = calculateCorrelationSummary(rows, colA, colB);
  return { r: pairCount < 3 || value === null ? null : round(value, 3), n: pairCount };
};
export const computeLossProfit = (rows, metric) => {
  const values = rows.map((row) => toNumber(row?.[metric])).filter((value) => value !== null);
  const losses = values.filter((value) => value < 0); const gains = values.filter((value) => value > 0);
  const totalLoss = losses.reduce(addFinite, 0); const totalGain = gains.reduce(addFinite, 0);
  return { totalLoss, totalGain, net: addFinite(totalGain, totalLoss), lossEntries: losses.length, gainEntries: gains.length, allPositive: values.length > 0 && losses.length === 0 };
};
export const computeTrendChange = (rows, metric, dateColumn, dimension, overrides) => {
  let ordered = dateColumn ? rows.map((row) => ({ row, time: toTimestamp(row?.[dateColumn]) })).filter(({ time }) => time !== null).sort((a, b) => a.time - b.time).map(({ row }) => row) : [];
  if (ordered.length < 4) ordered = rows;
  const midpoint = Math.floor(ordered.length / 2); const earlier = ordered.slice(0, midpoint); const recent = ordered.slice(midpoint);
  const firstTotal = aggregate(earlier, metric, 'sum') || 0; const secondTotal = aggregate(recent, metric, 'sum') || 0; const delta = finiteResult(secondTotal - firstTotal, 'trend difference');
  const map = new Map();
  if (dimension) for (const [period, multiplier] of [[earlier, -1], [recent, 1]]) for (const row of period) {
    const name = dateGroupKey(row?.[dimension], overrides?.[dimension]) ?? 'Unknown'; map.set(name, addFinite(map.get(name) || 0, (toNumber(row?.[metric]) || 0) * multiplier));
  }
  const contributors = [...map].map(([name, change]) => ({ name, change: round(change) })).sort((a, b) => a.change - b.change);
  return { direction: delta < 0 ? 'decrease' : delta > 0 ? 'increase' : 'no change', delta: round(delta), pctChange: firstTotal ? round(delta / Math.abs(firstTotal) * 100, 1) : null,
    firstTotal: round(firstTotal), secondTotal: round(secondTotal), firstCount: earlier.length, secondCount: recent.length,
    topDecliners: contributors.filter(({ change }) => change < 0).slice(0, 3), topGrowers: contributors.filter(({ change }) => change > 0).sort((a, b) => b.change - a.change).slice(0, 3), contributors };
};

/** Convert a question into a transparent query plan. */
export const interpretQuery = (query, profile, context = null) => {
  const raw = String(query || '').trim(); const lower = normalizeText(raw);
  const metrics = rankedTyped(raw, profile, ['numeric']); const dimensions = rankedTyped(raw, profile, ['categorical', 'date']);
  const filters = resolveValueFilters(raw, profile); const dateRange = resolveDateRange(raw, profile);
  const assumptions = [];
  const explicitAggregation = /\b(sum|total|average|avg|mean|median|p50|max|maximum|highest|largest|min|minimum|lowest|smallest|count|how many|number of)\b/.test(lower);
  let aggregation = aggregationFromQuery(lower);
  const limitMatch = lower.match(/\b(?:top|bottom|first|last)\s+(\d+)\b/);
  let limit = Math.min(Number(limitMatch?.[1] || 5), 50);
  const explicitOrder = /\b(top|bottom|highest|lowest|largest|smallest|best|worst)\b/.test(lower);
  let order = /\b(bottom|lowest|smallest|worst)\b/.test(lower) ? 'asc' : 'desc';
  let intent = 'AGGREGATION_BY_DIMENSION';
  let explicitIntent = true;
  const asksDatasetOverview = /\b(explain|summari[sz]e|overview|describe|introduce|understand|explore)\w*\b.*\b(dataset|data|table|file)\b/.test(lower)
    || /\b(tell me about|walk me through|what is in)\b.*\b(dataset|data|table|file)\b/.test(lower)
    || /\b(what does (?:this )?(?:dataset|data|table|file) contain|key insights|key takeaways|big picture|schema|data types|what columns)\b/.test(lower);
  if (/\b(duplicate|duplicated|repeated|identical)\s+(row|record|entry)s?\b/.test(lower)) intent = 'DUPLICATE_ROWS';
  else if (/\bhow many (row|record|entry)s?\b|\b(row|record) count\b/.test(lower)) intent = 'ROW_COUNT';
  else if (/\b(missing|null|blank|empty cell|complete|completeness|coverage)\w*|\bfully populated\b/.test(lower)) intent = 'MISSING_VALUES';
  else if (/\b(data quality|quality issue|dirty data|clean is|reliable is|problems? with (?:the )?data)\b/.test(lower)) intent = 'DATA_QUALITY';
  else if (asksDatasetOverview) intent = 'DATASET_SUMMARY';
  else if (/\b(unique|distinct|different|possible)\s+(value|category|label|option)s?\b|\bwhat values\b|\bhow many unique\b|\bmost common\b|\bfrequency of\b/.test(lower)) intent = 'DISTINCT_VALUES';
  else if (/\b(correlat|relationship between|associated with|related to)\w*/.test(lower)) intent = 'CORRELATION_ANALYSIS';
  else if (/\b(outlier|anomal|unusual|extreme|spike)\w*/.test(lower)) intent = 'OUTLIER_DETECTION';
  else if (/\b(loss|losing|negative profit|deficit|profit|gain)\w*/.test(lower)) intent = 'LOSS_PROFIT';
  else if (/\b(why|decreas|declin|dropp|fall|fell|increas|grow|grew|rising|change|trend|happened)\w*|last period/.test(lower)) intent = /\bwhy\b|decreas|declin|dropp|fall|fell|increas|grow|grew|happened|last period/.test(lower) ? 'TREND_CHANGE_DIAGNOSIS' : 'TREND_ANALYSIS';
  else if (/\b(compare|versus|vs|difference between)\b/.test(lower)) intent = 'COMPARISON';
  else if (/\b(percent|percentage|share|contribution|portion|mix)\w*/.test(lower)) intent = 'PERCENTAGE_CONTRIBUTION';
  else if (/\b(top|bottom|highest|lowest|largest|smallest|best|worst|rank)\w*/.test(lower)) intent = 'RANKING';
  else if ((metrics.length || dimensions.length) && /\b(explain|describe|profile|distribution|statistics|stats|spread|range|typical|common values?)\b/.test(lower) && !/\b(by|per|across|for each)\b/.test(lower)) intent = 'COLUMN_PROFILE';
  else if (!dimensions.length && metrics.length) { intent = 'SINGLE_METRIC'; explicitIntent = false; }
  else explicitIntent = false;
  const isFollowUp = Boolean(context && /^(now\b|and\b|what about\b|how about\b|only\b|instead\b|same\b|then\b)/.test(lower));
  if (isFollowUp) {
    if (!metrics.length) metrics.push(...(context.metrics || []).filter((name) => profile.numeric.includes(name)));
    if (!dimensions.length) dimensions.push(...(context.dimensions || []).filter((name) => profile.date.includes(name) || profile.categorical.includes(name)));
    if (!explicitIntent && context.intent && context.intent !== 'CLARIFICATION_REQUIRED') intent = context.intent;
    if (!explicitAggregation && context.aggregation) aggregation = context.aggregation;
    if (!limitMatch && context.limit) limit = context.limit;
    if (!explicitOrder && context.order) order = context.order;
    assumptions.push('Continued the measure, grouping, and calculation from the previous answer where they were not restated.');
  }
  const selectedMetrics = metrics.slice(0, intent === 'CORRELATION_ANALYSIS' ? 2 : 1); const selectedDimensions = dimensions.slice(0, 2);
  if (!selectedMetrics.length && aggregation === 'count' && !['DATASET_SUMMARY', 'DATA_QUALITY', 'DUPLICATE_ROWS', 'ROW_COUNT', 'MISSING_VALUES', 'DISTINCT_VALUES', 'COLUMN_PROFILE'].includes(intent)) selectedMetrics.push('__count__');
  if (!selectedMetrics.length && profile.numeric.length && !['DATASET_SUMMARY', 'DATA_QUALITY', 'DUPLICATE_ROWS', 'ROW_COUNT', 'MISSING_VALUES', 'DISTINCT_VALUES', 'COLUMN_PROFILE'].includes(intent)) { selectedMetrics.push(profile.numeric[0]); assumptions.push(`No measure was named; used "${profile.numeric[0]}".`); }
  if (!selectedDimensions.length && profile.categorical.length && ['AGGREGATION_BY_DIMENSION', 'RANKING', 'PERCENTAGE_CONTRIBUTION', 'COMPARISON'].includes(intent)) { selectedDimensions.push(profile.categorical[0]); assumptions.push(`No grouping column was named; used "${profile.categorical[0]}".`); }
  if (!selectedDimensions.length && profile.date.length && ['TREND_ANALYSIS', 'TREND_CHANGE_DIAGNOSIS'].includes(intent)) { selectedDimensions.push(profile.date[0]); assumptions.push(`No time column was named; used "${profile.date[0]}".`); }
  const comparisonValues = [];
  if (intent === 'COMPARISON') {
    for (const column of profile.columns.filter(({ type }) => type === 'categorical')) {
      const matches = column.commonValues.filter(({ value }) => phraseInQuery(lower, value)).map(({ value }) => value);
      if (matches.length >= 2) {
        if (!selectedDimensions.includes(column.name)) selectedDimensions.unshift(column.name);
        comparisonValues.push(...matches.slice(0, 2));
        break;
      }
    }
  }
  let confidence = 0.55 + Math.min(metrics.length + dimensions.length, 2) * 0.17 + (filters.length ? 0.08 : 0) - assumptions.length * (isFollowUp ? 0.04 : 0.18);
  if (['DATASET_SUMMARY', 'DATA_QUALITY', 'DUPLICATE_ROWS', 'ROW_COUNT', 'MISSING_VALUES'].includes(intent)) confidence = 0.95;
  return { query: raw, intent, metrics: selectedMetrics, dimensions: selectedDimensions, filters, dateRange, comparisonValues, aggregation, limit, order, assumptions, confidence: Math.max(0.1, Math.min(confidence, 0.99)) };
};

const envelope = (plan, rows, directAnswer, keyInsights, extra = {}) => ({ query: plan.query, intent: plan.intent, directAnswer, keyInsights,
  interpretation: { intent: plan.intent, metrics: plan.metrics, dimensions: plan.dimensions, filters: plan.filters, dashboardFilters: plan.scopeFilters, dateRange: plan.dateRange, comparisonValues: plan.comparisonValues, aggregation: plan.aggregation, order: plan.order, limit: plan.limit, matchedRows: rows.length },
  confidence: round(plan.confidence, 2), assumptions: plan.assumptions, ...extra });
const clarify = (plan, profile, reason) => ({ query: plan.query, intent: 'CLARIFICATION_REQUIRED', directAnswer: reason, keyInsights: [],
  interpretation: { ...plan, dashboardFilters: plan.scopeFilters || [], matchedRows: null }, confidence: round(plan.confidence, 2), assumptions: plan.assumptions,
  clarification: { question: reason, options: [...profile.numeric.slice(0, 4), ...profile.categorical.slice(0, 2)] }, recommendedCard: null });

const formatAggregationMetric = (aggregation, metric) => {
  if (aggregation === 'count' && metric === 'rows') return 'Row count';
  const labels = {
    sum: 'Total',
    average: 'Average',
    median: 'Median',
    min: 'Minimum',
    max: 'Maximum',
    count: 'Count of'
  };
  return `${labels[aggregation] || aggregation || 'Value of'} ${metric}`.trim();
};

/** Execute synchronously. UI callers invoke this inside aiAssistant.worker.js. */
export const analyzeQueryWithData = (query, dataset, suppliedProfile = null, options = {}) => {
  const message = prepareAssistantMessage(query);
  if (message.reply) return message.reply;
  return analyzePreparedQuery(message.query, dataset, suppliedProfile, options);
};

/** Worker entry: the client has already handled conversation and polite prefixes. */
export const analyzePreparedQuery = (query, dataset, suppliedProfile = null, { scopeFilters = {}, context = null } = {}) => {
  if (!Array.isArray(dataset?.rawRows) || !dataset.rawRows.length) return { error: 'No active dataset to analyze. Please select or import a dataset first.' };
  if (!String(query || '').trim()) return { error: 'Please enter a question.' };
  const profile = suppliedProfile?.revision === getDatasetRevision(dataset) ? suppliedProfile : buildDatasetProfile(dataset);
  const plan = interpretQuery(query, profile, context);
  if (profile.columns.some((column) => column.type === 'exact' && rankedTyped(query, { ...profile, columns: [column] }, ['exact']).length)) return clarify(plan, profile, 'Use the exact decimal calculator or the validated AI calculation tool for this exact measure; this deterministic assistant uses native numbers.');
  plan.scopeFilters = normalizeScopeFilters(scopeFilters, profile);
  if (plan.confidence < 0.5) return clarify(plan, profile, 'I could not confidently identify the columns to analyze. Please name a measure or category.');
  if (plan.intent === 'CORRELATION_ANALYSIS' && plan.metrics.length < 2) return clarify(plan, profile, 'Correlation needs two numeric columns. Which two measures should I compare?');
  const rows = applyFilters(dataset.rawRows, [...plan.scopeFilters, ...plan.filters], plan.dateRange);
  if (!rows.length) return envelope(plan, rows, 'No rows match the interpreted query and dashboard filters.', ['Try removing or broadening a filter.'], { recommendedCard: null });
  const metric = plan.metrics[0]; const dimension = plan.dimensions[0];
  for (const measure of plan.metrics.filter((name) => name !== '__count__')) for (const row of rows) assertMeasurePrecision(dataset, measure, row?.[measure]);
  if (plan.intent === 'DATASET_SUMMARY') {
    const cells = rows.length * profile.columns.length;
    const missing = profile.columns.reduce((sum, column) => sum + rows.reduce((count, row) => count + (isMissing(row?.[column.name]) ? 1 : 0), 0), 0);
    const firstDate = profile.columns.find(({ type }) => type === 'date');
    const commonCategory = profile.columns.find(({ type, commonValues }) => type === 'categorical' && commonValues.length)?.commonValues[0];
    const scopeText = rows.length === profile.rowCount ? `${profile.rowCount.toLocaleString()} rows` : `${rows.length.toLocaleString()} of ${profile.rowCount.toLocaleString()} rows in the current dashboard scope`;
    const insights = [
      `Measures: ${profile.numeric.join(', ') || 'none detected'}`,
      `Dimensions: ${[...profile.date, ...profile.categorical].join(', ') || 'none detected'}`,
      `Completeness in this scope: ${cells ? round((cells - missing) / cells * 100, 1) : 100}%`
    ];
    if (firstDate?.minDate) insights.push(`${firstDate.name} spans ${firstDate.minDate.slice(0, 10)} to ${firstDate.maxDate.slice(0, 10)}.`);
    if (commonCategory) insights.push(`Most common profiled category: ${commonCategory.value} (${commonCategory.count.toLocaleString()} rows).`);
    return envelope(plan, rows, `This is a tabular dataset with ${scopeText} and ${profile.columns.length} columns. It contains ${profile.numeric.length} measures, ${profile.categorical.length} categorical dimensions, and ${profile.date.length} date fields.`, insights, { recommendedCard: null });
  }
  if (plan.intent === 'DATA_QUALITY') {
    const missing = profile.columns.reduce((sum, column) => sum + rows.reduce((count, row) => count + (isMissing(row?.[column.name]) ? 1 : 0), 0), 0);
    const cells = rows.length * profile.columns.length;
    const duplicates = summarizeDuplicates(rows, profile.columns.map(({ name }) => name));
    return envelope(plan, rows, `The current scope is ${cells ? round((cells - missing) / cells * 100, 1) : 100}% complete, with ${missing.toLocaleString()} missing cells and ${duplicates.duplicates.toLocaleString()} duplicate rows${duplicates.truncated ? ' in the profiled sample' : ''}.`,
      [`Rows checked for duplicates: ${duplicates.sampledRows.toLocaleString()}`, `Columns checked: ${profile.columns.length}`, 'Type validity and business-rule validity require domain-specific constraints.'], { recommendedCard: null });
  }
  if (plan.intent === 'DUPLICATE_ROWS') {
    const duplicates = summarizeDuplicates(rows, profile.columns.map(({ name }) => name));
    return envelope(plan, rows, `${duplicates.duplicates.toLocaleString()} duplicate rows were found among ${duplicates.sampledRows.toLocaleString()} checked rows${duplicates.truncated ? '; the result is sample-based' : ''}.`,
      [duplicates.truncated ? `For predictable memory use, duplicate detection checks the first ${PROFILE_SAMPLE_LIMIT.toLocaleString()} matching rows.` : 'Every matching row was checked.', 'Rows are duplicates only when every displayed column value matches.'], { recommendedCard: null });
  }
  if (plan.intent === 'ROW_COUNT') {
    return envelope(plan, rows, `There are ${rows.length.toLocaleString()} rows in the current analytical scope.`,
      [plan.scopeFilters.length || plan.filters.length || plan.dateRange ? `Unfiltered dataset rows: ${profile.rowCount.toLocaleString()}` : 'No filters were applied.'],
      { recommendedCard: { title: 'Row count', chartType: 'kpi', preferredY: '__count__', aggregation: 'count' } });
  }
  if (plan.intent === 'MISSING_VALUES') {
    const ranked = profile.columns.map((column) => {
      const count = rows.reduce((sum, row) => sum + (isMissing(row?.[column.name]) ? 1 : 0), 0);
      return { name: column.name, count, rate: rows.length ? count / rows.length * 100 : 0 };
    }).sort((a, b) => b.count - a.count);
    return envelope(plan, rows, `Found ${ranked.reduce((sum, item) => sum + item.count, 0).toLocaleString()} missing cells across ${rows.length.toLocaleString()} matching rows.`, ranked.slice(0, 5).map((item) => `${item.name}: ${item.count.toLocaleString()} missing (${round(item.rate, 1)}%)`), { recommendedCard: null });
  }
  if (['COLUMN_PROFILE', 'DISTINCT_VALUES'].includes(plan.intent)) {
    const target = [...plan.metrics, ...plan.dimensions][0];
    if (!target) return clarify(plan, profile, 'Which column should I explain?');
    const column = profile.columns.find(({ name }) => name === target);
    const details = summarizeColumn(rows, target, column.type);
    if (plan.intent === 'DISTINCT_VALUES' && column.type !== 'categorical') {
      return envelope(plan, rows, `"${target}" is ${column.type}; use a range or column-profile question instead of listing distinct values.`, [`Non-missing values: ${details.count.toLocaleString()}`], { recommendedCard: null });
    }
    if (column.type === 'numeric') {
      return envelope(plan, rows, `"${target}" is numeric with ${details.count.toLocaleString()} populated values. It ranges from ${formatNumber(details.min)} to ${formatNumber(details.max)}, with a mean of ${formatNumber(details.mean)}.`,
        [`Missing: ${details.missing.toLocaleString()}`, `Standard deviation: ${formatNumber(details.standardDeviation)}`], { recommendedCard: { title: `${target} distribution`, chartType: 'histogram', preferredX: target, aggregation: 'auto' } });
    }
    if (column.type === 'date') {
      return envelope(plan, rows, `"${target}" is a date column spanning ${details.minDate?.slice(0, 10) || 'unknown'} to ${details.maxDate?.slice(0, 10) || 'unknown'}.`, [`Populated: ${details.count.toLocaleString()}`, `Missing: ${details.missing.toLocaleString()}`], { recommendedCard: null });
    }
    return envelope(plan, rows, `"${target}" is categorical with ${details.uniqueCount.toLocaleString()} profiled values.`,
      details.commonValues.slice(0, plan.limit).map(({ value, frequency }) => `${value}: ${frequency.toLocaleString()} rows`), { recommendedCard: { title: `Count by ${target}`, chartType: 'bar', preferredX: target, preferredY: '__count__', aggregation: 'count' } });
  }
  if (plan.intent === 'CORRELATION_ANALYSIS') {
    const [left, right] = plan.metrics; const correlation = computeCorrelation(rows, left, right);
    const strength = correlation.r === null ? 'unavailable' : Math.abs(correlation.r) >= 0.7 ? 'strong' : Math.abs(correlation.r) >= 0.4 ? 'moderate' : 'weak';
    return envelope(plan, rows, correlation.r === null ? `Correlation is unavailable for "${left}" and "${right}": at least three complete pairs and variation in both columns are required.` : `"${left}" and "${right}" have ${correlation.r === 0 ? 'no measured linear correlation' : `a ${strength} ${correlation.r < 0 ? 'negative' : 'positive'} correlation`} (Pearson r = ${correlation.r}, n = ${correlation.n.toLocaleString()}).`,
      ['Correlation describes association, not causation.', `${correlation.n.toLocaleString()} complete pairs were used.`], { recommendedCard: { title: `${left} vs ${right}`, chartType: 'scatter', preferredX: left, preferredY: right, aggregation: 'auto' } });
  }
  if (plan.intent === 'LOSS_PROFIT') {
    const result = computeLossProfit(rows, metric);
    const grouping = dimension || profile.categorical[0] || '';
    const recommendedCard = grouping
      ? { title: `${metric} by ${grouping}`, chartType: 'bar', preferredX: grouping, preferredY: metric, aggregation: 'sum' }
      : { title: `${metric} distribution`, chartType: 'histogram', preferredX: metric, aggregation: 'auto' };
    return envelope(plan, rows, result.allPositive ? `No negative values were found in "${metric}"; total gains are ${formatNumber(result.totalGain)}.` : `Losses total ${formatNumber(Math.abs(result.totalLoss))}; gains total ${formatNumber(result.totalGain)}; net is ${formatNumber(result.net)}.`,
      [`Losing rows: ${result.lossEntries.toLocaleString()}`, `Gaining rows: ${result.gainEntries.toLocaleString()}`], { recommendedCard });
  }
  if (plan.intent === 'OUTLIER_DETECTION') {
    let count = 0; let mean = 0; let squaredDifference = 0;
    for (const row of rows) {
      const value = toNumber(row?.[metric]);
      if (value === null) continue;
      count += 1; const delta = value - mean; mean += delta / count; squaredDifference += delta * (value - mean);
    }
    const deviation = count ? Math.sqrt(squaredDifference / count) : 0;
    let outlierCount = 0; let strongest = null;
    if (deviation) for (const row of rows) {
      const value = toNumber(row?.[metric]); if (value === null) continue;
      const z = Math.abs((value - mean) / deviation);
      if (z > 2) { outlierCount += 1; if (!strongest || z > strongest.z) strongest = { value, z }; }
    }
    const grouping = dimension || profile.categorical[0] || '';
    const recommendedCard = grouping
      ? { title: `Outliers in ${metric} by ${grouping}`, chartType: 'strip', preferredX: grouping, preferredY: metric, aggregation: 'auto' }
      : { title: `Outliers in ${metric}`, chartType: 'box', preferredY: metric, aggregation: 'auto' };
    return envelope(plan, rows, strongest ? `Found ${outlierCount.toLocaleString()} statistical outliers in "${metric}". The most extreme value is ${formatNumber(strongest.value)} (${round(strongest.z, 1)} standard deviations from the mean).` : `No values in "${metric}" exceed the 2-standard-deviation outlier threshold.`,
      [`Mean: ${formatNumber(mean)}`, `Valid values analyzed: ${count.toLocaleString()}`], { recommendedCard });
  }
  if (['TREND_ANALYSIS', 'TREND_CHANGE_DIAGNOSIS'].includes(plan.intent)) {
    const dateColumn = profile.date.includes(dimension) ? dimension : profile.date[0];
    if (!dateColumn) return clarify(plan, profile, 'A trend question needs a date or time column. Which column represents time?');
    if (plan.intent === 'TREND_CHANGE_DIAGNOSIS') {
      const contributor = plan.dimensions.find((item) => item !== dateColumn) || profile.categorical[0] || null;
      const change = computeTrendChange(rows, metric, dateColumn, contributor, dataset.columnOverrides); const leaders = change.direction === 'decrease' ? change.topDecliners : change.topGrowers;
      return envelope(plan, rows, `"${metric}" ${change.direction === 'no change' ? 'did not change' : `${change.direction}d`} from ${formatNumber(change.firstTotal)} to ${formatNumber(change.secondTotal)}${change.pctChange === null ? '' : ` (${change.pctChange > 0 ? '+' : ''}${change.pctChange}%)`}.`,
        [`Earlier period: ${formatNumber(change.firstTotal)}`, `Recent period: ${formatNumber(change.secondTotal)}`, ...(leaders[0] ? [`Largest contributor: ${leaders[0].name} (${leaders[0].change > 0 ? '+' : ''}${formatNumber(leaders[0].change)})`] : [])],
        { recommendedCard: { title: `${metric} trend`, chartType: 'area', preferredX: dateColumn, preferredY: metric, aggregation: 'sum' }, filterAction: leaders[0] && contributor ? { column: contributor, value: leaders[0].name } : null });
    }
  }
  if (plan.intent === 'SINGLE_METRIC') {
    const value = aggregate(rows, metric, plan.aggregation);
    const metricSummary = formatAggregationMetric(plan.aggregation, metric);
    return envelope(plan, rows, `${metricSummary} is ${formatNumber(value)} across ${rows.length.toLocaleString()} matching rows.`, [`Rows analyzed: ${rows.length.toLocaleString()}`], { recommendedCard: { title: metricSummary, chartType: 'kpi', preferredY: metric, aggregation: plan.aggregation } });
  }
  if (!dimension) return clarify(plan, profile, 'Please name a category or date column to group the result.');
  const groupedRows = plan.intent === 'COMPARISON' && plan.comparisonValues.length
    ? rows.filter((row) => plan.comparisonValues.some((value) => normalizeText(row?.[dimension]) === normalizeText(value)))
    : rows;
  const grouped = groupRows(groupedRows, dimension, metric || '__count__', plan.aggregation, dataset.columnOverrides);
  grouped.sort((a, b) => plan.order === 'asc' ? a.value - b.value : b.value - a.value);
  const shown = grouped.slice(0, plan.limit); const total = grouped.reduce((sum, item) => sum + item.value, 0); const top = shown[0];
  if (plan.intent === 'COMPARISON' && grouped.length < 2) return clarify(plan, profile, `I found fewer than two "${dimension}" groups to compare. Name the two values you want compared.`);
  const metricLabel = metric === '__count__' ? 'rows' : metric;
  const metricSummary = formatAggregationMetric(plan.aggregation, metricLabel);
  const answer = plan.intent === 'PERCENTAGE_CONTRIBUTION' ? `${top?.name || 'No group'} contributes ${total ? round(top.value / total * 100, 1) : 0}% of ${metricSummary}.`
    : plan.intent === 'COMPARISON' ? `${shown[0].name} is ${formatNumber(Math.abs(shown[0].value - shown[1].value))} ${shown[0].value >= shown[1].value ? 'higher' : 'lower'} than ${shown[1].name} for ${metricSummary}.`
      : `${top?.name || 'No group'} ${plan.order === 'asc' ? 'is lowest' : 'leads'} with ${formatNumber(top?.value || 0)} ${metricSummary}.`;
  const trendGroup = ['TREND_ANALYSIS'].includes(plan.intent)
    ? plan.dimensions.find((item) => item !== dimension && profile.categorical.includes(item))
    : null;
  return envelope(plan, groupedRows, answer, shown.map((item, index) => `${index + 1}. ${item.name}: ${formatNumber(item.value)}${plan.intent === 'PERCENTAGE_CONTRIBUTION' && total ? ` (${round(item.value / total * 100, 1)}%)` : ''}`),
    { recommendedCard: { title: `${metricSummary} by ${dimension}`, chartType: trendGroup ? 'multiSpline' : profile.date.includes(dimension) ? 'area' : plan.intent === 'PERCENTAGE_CONTRIBUTION' && grouped.length <= 8 ? 'pie' : 'bar', preferredX: dimension, preferredY: metric, preferredGroup: trendGroup || '', aggregation: plan.aggregation, ...(plan.intent === 'RANKING' ? { topN: plan.limit } : {}) }, filterAction: top ? { column: dimension, value: top.name } : null });
};
