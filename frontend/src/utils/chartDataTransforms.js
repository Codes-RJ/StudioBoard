import { addFinite, meanFinite, midpointFinite } from './finiteArithmetic';
export const unique = (values) => [...new Set(values.filter(Boolean))];

export const getDatasetColumnNames = (dataset) => (Array.isArray(dataset?.columns) ? dataset.columns : [])
  .map((column) => (typeof column === 'string' ? column : column?.name))
  .filter(Boolean);

export const toNumber = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

/** Constant-state aggregation for operations that do not require sorting. */
export const createRunningMetric = (aggregation) => {
  if (!['sum', 'average', 'min', 'max', 'count'].includes(aggregation)) throw new Error('This aggregation needs a separate working-memory policy.');
  let populated = 0; let count = 0; let sum = 0; let mean = 0; let minimum = Infinity; let maximum = -Infinity;
  return {
    consume: (value) => {
      if (value != null && String(value).trim() !== '') populated += 1;
      const number = toNumber(value);
      if (number === null) return;
      count += 1;
      if (aggregation === 'sum') sum = addFinite(sum, number);
      if (aggregation === 'average') {
        sum += number;
        mean = addFinite(mean * ((count - 1) / count), number / count);
      }
      if (aggregation === 'min') minimum = Math.min(minimum, number);
      if (aggregation === 'max') maximum = Math.max(maximum, number);
    },
    finish: () => aggregation === 'count' ? populated : !count ? null : aggregation === 'sum' ? sum
      : aggregation === 'average' ? Number.isFinite(sum) ? sum / count : mean
        : aggregation === 'min' ? minimum : maximum,
  };
};

export const resolveAggregationMode = (aggregation, chartType) => {
  if (aggregation && aggregation !== 'auto') {
    return aggregation;
  }

  if (chartType === 'gauge') {
    return 'average';
  }

  if (['line', 'stepLine', 'spline', 'smoothArea', 'multiSpline', 'streamgraph', 'rangeArea', 'waveform', 'scatter'].includes(chartType)) {
    return 'average';
  }

  return 'sum';
};

export const aggregateMetricValues = (values, aggregation) => {
  const numericValues = values.map(toNumber).filter((value) => value !== null);

  if (aggregation === 'count') {
    return values.filter((value) => value !== null && value !== undefined && String(value).trim() !== '').length;
  }

  if (!numericValues.length) {
    return null;
  }

  switch (aggregation) {
    case 'sum':
      return numericValues.reduce(addFinite, 0);
    case 'average':
      return meanFinite(numericValues);
    case 'median': {
      const sorted = [...numericValues].sort((left, right) => left - right);
      const middleIndex = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? midpointFinite(sorted[middleIndex - 1], sorted[middleIndex])
        : sorted[middleIndex];
    }
    case 'min':
      return numericValues.reduce((minimum, value) => Math.min(minimum, value), Infinity);
    case 'max':
      return numericValues.reduce((maximum, value) => Math.max(maximum, value), -Infinity);
    default:
      return numericValues.reduce(addFinite, 0);
  }
};

export const buildCategoricalSeries = (rows, categoryKey, metricKey, aggregation, limit, dimensionKey = (value) => value) => {
  if (!categoryKey) {
    return [];
  }

  const grouped = rows.reduce((accumulator, row) => {
    const rawCategory = dimensionKey(row?.[categoryKey]);
    const category = rawCategory === null || rawCategory === undefined || rawCategory === ''
      ? 'Unspecified'
      : String(rawCategory);

    if (!accumulator.has(category)) {
      accumulator.set(category, []);
    }

    accumulator.get(category).push(metricKey === '__count__' ? 1 : row?.[metricKey]);
    return accumulator;
  }, new Map());

  return [...grouped.entries()]
    .map(([name, values]) => ({
      name,
      value: aggregateMetricValues(values, metricKey === '__count__' ? 'count' : aggregation)
    }))
    .sort((left, right) => (left.value === null) - (right.value === null) || right.value - left.value)
    .slice(0, limit);
};

export const buildTrendSeries = (rows, xKey, metricKey, aggregation, limit, dimensionKey = (value) => value) => {
  if (!rows.length) {
    return [];
  }

  if (!xKey) {
    return rows.slice(0, limit)
      .map((row, index) => ({
        x: `Row ${index + 1}`,
        y: metricKey === '__count__'
          ? index + 1
          : toNumber(row?.[metricKey])
      }))
      .filter((point) => point.y !== null);
  }

  const grouped = rows.reduce((accumulator, row) => {
    const rawValue = dimensionKey(row?.[xKey]);
    const key = rawValue === null || rawValue === undefined || rawValue === ''
      ? 'Unspecified'
      : String(rawValue);

    if (!accumulator.has(key)) {
      accumulator.set(key, []);
    }

    accumulator.get(key).push(metricKey === '__count__' ? 1 : row?.[metricKey]);
    return accumulator;
  }, new Map());

  const entries = [...grouped.entries()];
  // ISO dates sort by their timestamps; other dimensions retain source order.
  if (entries.every(([name]) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(name) && Number.isFinite(Date.parse(name)))) {
    entries.sort(([left], [right]) => Date.parse(left) - Date.parse(right));
  }
  return entries
    .slice(0, limit)
    .map(([name, values]) => ({
      x: name,
      y: aggregateMetricValues(values, metricKey === '__count__' ? 'count' : aggregation)
    }));
};

export const buildSankeyData = (rows, sourceKey, targetKey, limit = 14) => {
  if (!sourceKey || !targetKey || sourceKey === targetKey) {
    return { nodes: [], links: [] };
  }

  const grouped = rows.reduce((accumulator, row) => {
    const source = row?.[sourceKey];
    const target = row?.[targetKey];

    if (source == null || target == null || String(source).trim() === '' || String(target).trim() === '') {
      return accumulator;
    }

    const key = JSON.stringify([String(source), String(target)]);
    accumulator.set(key, {
      source: String(source),
      target: String(target),
      value: (accumulator.get(key)?.value || 0) + 1
    });
    return accumulator;
  }, new Map());

  const links = [...grouped.values()]
    .sort((left, right) => right.value - left.value)
    .slice(0, limit);
  const nodeNames = unique(links.flatMap((link) => [link.source, link.target]));
  const nodes = nodeNames.map((name) => ({ name }));

  return {
    nodes,
    links: links.map((link) => ({
      source: nodeNames.indexOf(link.source),
      target: nodeNames.indexOf(link.target),
      value: link.value
    }))
  };
};

export const calculateCorrelationSummary = (rows, firstKey, secondKey) => {
  const pairedValues = rows
    .map((row) => [toNumber(row?.[firstKey]), toNumber(row?.[secondKey])])
    .filter(([firstValue, secondValue]) => firstValue !== null && secondValue !== null);

  const pairCount = pairedValues.length;
  const unavailable = { value: null, pairCount };
  if (pairCount < 2) return unavailable;

  // Scaling preserves Pearson correlation and avoids overflow for finite
  // measurements near Number.MAX_VALUE, including their squared deviations.
  let firstScale = 0; let secondScale = 0;
  for (const [first, second] of pairedValues) {
    firstScale = Math.max(firstScale, Math.abs(first));
    secondScale = Math.max(secondScale, Math.abs(second));
  }
  if (!firstScale || !secondScale) return unavailable;
  const firstValues = pairedValues.map(([value]) => value / firstScale);
  const secondValues = pairedValues.map(([, value]) => value / secondScale);
  const firstMean = firstValues.reduce((sum, value) => sum + value, 0) / firstValues.length;
  const secondMean = secondValues.reduce((sum, value) => sum + value, 0) / secondValues.length;

  let numerator = 0;
  let firstVariance = 0;
  let secondVariance = 0;

  for (let index = 0; index < pairedValues.length; index += 1) {
    const firstDelta = firstValues[index] - firstMean;
    const secondDelta = secondValues[index] - secondMean;

    numerator += firstDelta * secondDelta;
    firstVariance += firstDelta ** 2;
    secondVariance += secondDelta ** 2;
  }

  if (firstVariance === 0 || secondVariance === 0) {
    return unavailable;
  }

  const value = numerator / (Math.sqrt(firstVariance) * Math.sqrt(secondVariance));
  return { value: Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : null, pairCount };
};

export const calculateCorrelation = (rows, firstKey, secondKey) => calculateCorrelationSummary(rows, firstKey, secondKey).value;

export const buildHeatmapMatrix = (rows, numericColumns) => numericColumns.map((rowKey) => ({
  key: rowKey,
  values: numericColumns.map((columnKey) => {
    const { value, pairCount } = calculateCorrelationSummary(rows, rowKey, columnKey);
    return { key: columnKey, value: value === null ? null : Math.round(value * 100) / 100, pairCount };
  })
}));
