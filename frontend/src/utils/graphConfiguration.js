import { CHART_TYPE_VALUES } from './chartTypes';
import { isDateLikeValue } from './dateSemantics';

const unique = (values = []) => [...new Set(values.filter(Boolean))];
const columnName = (column) => (typeof column === 'string' ? column : column?.name);
export const isIdentifierColumnName = (name) => /(^|[\s_])(id|uuid|guid|sku|postal_code|zip_code)($|[\s_])/i.test(name);

const isNumericValue = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return false;
  return Number.isFinite(Number(value));
};

const isDateValue = isDateLikeValue;

const profileColumnValues = (rows, column) => {
  const values = rows
    .slice(0, 500)
    .map((row) => row?.[column])
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== '');
  const total = values.length;
  return {
    values,
    numericRatio: total ? values.filter(isNumericValue).length / total : 0,
    dateRatio: total ? values.filter(isDateValue).length / total : 0
  };
};

export const createColumnCardinalityCollector = (columns) => {
  const stats = new Map(columns.map((column) => [column, { populated: 0, values: new Set() }]));
  return {
    consume: (rows) => {
      for (const row of rows) for (const [column, state] of stats) {
        const value = row?.[column];
        if (value == null || String(value).trim() === '') continue;
        state.populated += 1;
        // The low-cardinality rule never accepts more than twelve distinct
        // values, so thirteen distinct strings prove rejection exactly.
        if (state.values.size < 13) state.values.add(String(value));
      }
    },
    finish: () => Object.fromEntries([...stats].map(([column, state]) => [column, { populated: state.populated, distinct: state.values.size }])),
  };
};

const inferLowCardinalityNumericColumns = (rows, numericColumns, fullCardinality) => {
  if (!numericColumns.length) return [];
  let stats = fullCardinality;
  if (!stats) {
    const collector = createColumnCardinalityCollector(numericColumns);
    collector.consume(rows); stats = collector.finish();
  }

  return numericColumns.filter((column) => {
    const { populated = 0, distinct = 0 } = stats[column] || {};
    if (populated < 3) return false;
    const maxDistinct = Math.min(12, Math.max(3, Math.ceil(populated * 0.1)));
    return distinct <= maxDistinct;
  });
};

export const inferColumnGroups = (columns = [], rows = [], suppliedGroups = {}, fullCardinality) => {
  const hasTypedColumns = columns.some((column) => typeof column === 'object' && Boolean(column?.type));
  const hasSuppliedClassification = [
    'numeric',
    'numericColumns',
    'categorical',
    'categoricalColumns',
    'date',
    'dateColumns',
    'dimensions',
    'measures',
    'measureColumns'
  ].some((key) => Array.isArray(suppliedGroups[key]));
  const all = unique([
    ...columns.map(columnName),
    ...(suppliedGroups.all || [])
  ]);
  const typedNumeric = columns
    .filter((column) => typeof column === 'object' && ['number', 'numeric', 'integer', 'float'].includes(String(column?.type).toLowerCase()))
    .map(columnName);
  const typedDate = columns
    .filter((column) => typeof column === 'object' && ['date', 'datetime', 'timestamp'].includes(String(column?.type).toLowerCase()))
    .map(columnName);
  const profiles = Object.fromEntries(all.map((column) => [column, profileColumnValues(rows, column)]));
  const suppliedNumeric = suppliedGroups.numeric || suppliedGroups.numericColumns || [];
  const inferredNumeric = all.filter((column) => profiles[column].numericRatio >= 0.8);
  const numeric = unique([
    ...suppliedNumeric,
    ...typedNumeric,
    ...inferredNumeric
  ]).filter((column) => all.includes(column));
  const inferredDate = all.filter((column) => !numeric.includes(column) && profiles[column].dateRatio >= 0.8);
  const date = unique([
    ...(suppliedGroups.date || suppliedGroups.dateColumns || []),
    ...typedDate,
    ...inferredDate
  ]).filter((column) => all.includes(column));
  const lowCardinalityNumeric = inferLowCardinalityNumericColumns(rows, numeric, fullCardinality);
  const inferredCategorical = all.filter((column) => !numeric.includes(column) && !date.includes(column));
  const categorical = unique([
    ...(suppliedGroups.categorical || suppliedGroups.categoricalColumns || []),
    ...inferredCategorical
  ]).filter((column) => all.includes(column));
  const dimensions = unique(
    suppliedGroups.dimensions?.length
      ? suppliedGroups.dimensions
      : [...date, ...categorical, ...lowCardinalityNumeric]
  ).filter((column) => all.includes(column));
  const measures = unique(
    (suppliedGroups.measures || suppliedGroups.measureColumns)?.length
      ? (suppliedGroups.measures || suppliedGroups.measureColumns)
      : numeric.filter((column) => !lowCardinalityNumeric.includes(column))
  ).filter((column) => all.includes(column));
  const cardinality = Object.fromEntries(all.map((column) => [
    column,
    new Set(profiles[column].values.map(String)).size
  ]));
  const coercedNumeric = inferredNumeric.filter((column) => (
    !typedNumeric.includes(column) &&
    !suppliedNumeric.includes(column) &&
    profiles[column].values.some((value) => typeof value === 'string')
  ));

  return {
    all,
    numeric,
    categorical,
    date,
    dimensions,
    measures,
    cardinality,
    coercedNumeric,
    classificationKnown: rows.length > 0 || hasTypedColumns || hasSuppliedClassification
  };
};

export const getDatasetColumnGroups = (dataset, { fullCardinality } = {}) => {
  const groups = inferColumnGroups(
    dataset?.columns || [],
    dataset?.rawRows || [],
    dataset?.metrics?.columnGroups || {},
    fullCardinality
  );
  const inferredRoles = Object.fromEntries(groups.all.filter(isIdentifierColumnName).map((name) => [name, { role: 'identifier' }]));
  const overrides = { ...inferredRoles, ...(dataset?.columnOverrides || {}) };
  const numeric = new Set(groups.numeric);
  const categorical = new Set(groups.categorical);
  const date = new Set(groups.date);
  const dimensions = new Set(groups.dimensions);
  const measures = new Set(groups.measures);

  for (const [name, override] of Object.entries(overrides)) {
    if (!groups.all.includes(name)) continue;
    if (['number', 'date', 'string'].includes(override?.type)) {
      numeric.delete(name);
      categorical.delete(name);
      date.delete(name);
      if (override.type === 'number') numeric.add(name);
      else if (override.type === 'date') date.add(name);
      else categorical.add(name);
      dimensions.delete(name);
      measures.delete(name);
      if (override.type === 'date' || override.type === 'string') dimensions.add(name);
      else measures.add(name);
    }
    if (override?.role === 'measure') {
      dimensions.delete(name);
      if (numeric.has(name)) measures.add(name);
    } else if (override?.role === 'dimension') {
      measures.delete(name);
      dimensions.add(name);
    } else if (override?.role === 'identifier' || override?.role === 'ignore') {
      numeric.delete(name);
      categorical.delete(name);
      date.delete(name);
      dimensions.delete(name);
      measures.delete(name);
    }
  }
  for (const [name, override] of Object.entries(overrides)) if (override?.precision === 'exact') { numeric.delete(name); measures.delete(name); }
  return {
    ...groups,
    numeric: [...numeric],
    categorical: [...categorical],
    date: [...date],
    dimensions: [...dimensions],
    measures: [...measures],
    identifiers: Object.entries(overrides).filter(([, value]) => value?.role === 'identifier').map(([name]) => name),
    ignored: Object.entries(overrides).filter(([, value]) => value?.role === 'ignore').map(([name]) => name)
  };
};

export const getGraphSelectorConfig = (chartType, columnGroups, selectedX = '') => {
  const groups = columnGroups || inferColumnGroups();
  const availableColumns = groups.all.filter((column) => !groups.identifiers?.includes(column) && !groups.ignored?.includes(column));
  const dimensionOptions = groups.dimensions.length ? groups.dimensions : availableColumns;
  const numericOptions = groups.numeric;
  const measureOptions = unique([...(groups.measures.length ? groups.measures : groups.numeric), '__count__']);
  const kpiMeasureOptions = unique(['__count__', ...measureOptions]);
  const curveMeasureOptions = unique([...(groups.measures.length ? groups.measures : groups.numeric), '__count__']);
  const otherDimensions = dimensionOptions.filter((column) => column !== selectedX);
  const base = {
    showX: false,
    showY: false,
    showZ: false,
    showSize: false,
    showColor: false,
    showGroup: false,
    showOpen: false,
    showHigh: false,
    showLow: false,
    xOptions: [],
    yOptions: [],
    zOptions: [],
    sizeOptions: [],
    colorOptions: [],
    groupOptions: [],
    openOptions: [],
    highOptions: [],
    lowOptions: []
  };

  switch (chartType) {
    case 'table':
    case 'parallelCoordinates':
      return base;
    case 'kpi':
      return { ...base, showY: true, yOptions: kpiMeasureOptions, yLabel: 'Metric' };
    case 'heatmap':
      return base;
    case 'gauge':
      return { ...base, showY: true, yOptions: numericOptions, yLabel: 'Metric' };
    case 'histogram':
    case 'ecdf':
      return { ...base, showX: true, xOptions: numericOptions, xLabel: chartType === 'histogram' ? 'Values' : 'Measure' };
    case 'sineWave':
      return { ...base, showX: true, xOptions: numericOptions, xLabel: 'Input / phase' };
    case 'spline':
    case 'smoothArea':
    case 'waveform':
      return {
        ...base,
        showX: true,
        showY: true,
        xOptions: dimensionOptions,
        yOptions: curveMeasureOptions,
        xLabel: 'Time / dimension',
        yLabel: 'Metric'
      };
    case 'box':
    case 'violin':
    case 'strip':
      return { ...base, showX: dimensionOptions.length > 0, showY: true, xOptions: dimensionOptions, yOptions: numericOptions, xLabel: 'Group', yLabel: 'Measure' };
    case 'scatter':
    case 'density': {
      const alternativeY = numericOptions.filter((column) => column !== selectedX);
      return { ...base, showX: true, showY: true, xOptions: numericOptions, yOptions: alternativeY.length ? alternativeY : numericOptions, xLabel: 'X Axis', yLabel: 'Y Axis' };
    }
    case 'bubble':
      return {
        ...base,
        showX: true,
        showY: true,
        showSize: true,
        xOptions: numericOptions,
        yOptions: numericOptions.filter((column) => column !== selectedX),
        sizeOptions: numericOptions,
        xLabel: 'X Axis',
        yLabel: 'Y Axis',
        sizeLabel: 'Bubble size'
      };
    case 'scatter3d':
    case 'surface3d':
    case 'mesh3d':
    case 'contour':
      return {
        ...base,
        showX: true,
        showY: true,
        showZ: true,
        xOptions: numericOptions,
        yOptions: numericOptions.filter((column) => column !== selectedX),
        zOptions: numericOptions,
        xLabel: 'X Axis', yLabel: 'Y Axis', zLabel: 'Z Axis'
      };
    case 'bubble4d':
      return {
        ...base,
        showX: true,
        showY: true,
        showZ: true,
        showSize: true,
        xOptions: numericOptions,
        yOptions: numericOptions.filter((column) => column !== selectedX),
        zOptions: numericOptions,
        sizeOptions: numericOptions,
        xLabel: 'X Axis', yLabel: 'Y Axis', zLabel: 'Z Axis', sizeLabel: '4th dimension (size)'
      };
    case 'stackedBar':
    case 'multiSpline':
    case 'streamgraph':
    case 'sunburst':
      return {
        ...base,
        showX: true,
        showY: true,
        showGroup: true,
        xOptions: dimensionOptions,
        yOptions: ['multiSpline', 'streamgraph'].includes(chartType) ? curveMeasureOptions : measureOptions,
        groupOptions: otherDimensions.length ? otherDimensions : dimensionOptions,
        xLabel: chartType === 'sunburst' ? 'Parent' : (['multiSpline', 'streamgraph'].includes(chartType) ? 'Time / dimension' : 'Dimension'),
        yLabel: 'Metric',
        groupLabel: chartType === 'sunburst' ? 'Child' : (chartType === 'multiSpline' ? 'Series group' : 'Wave group')
      };
    case 'rangeArea':
      return {
        ...base,
        showX: true,
        showY: true,
        showZ: true,
        xOptions: unique([...groups.date, ...dimensionOptions]),
        yOptions: numericOptions,
        zOptions: numericOptions,
        xLabel: 'Time / dimension',
        yLabel: 'Lower bound',
        zLabel: 'Upper bound'
      };
    case 'candlestick':
      return {
        ...base,
        showX: true,
        showY: true,
        showOpen: true,
        showHigh: true,
        showLow: true,
        xOptions: unique([...groups.date, ...dimensionOptions]),
        yOptions: numericOptions,
        openOptions: numericOptions,
        highOptions: numericOptions,
        lowOptions: numericOptions,
        xLabel: 'Time / category', yLabel: 'Close', openLabel: 'Open', highLabel: 'High', lowLabel: 'Low'
      };
    case 'polarScatter':
      return { ...base, showX: true, showY: true, xOptions: unique([...dimensionOptions, ...numericOptions]), yOptions: numericOptions, xLabel: 'Angle / category', yLabel: 'Radius' };
    case 'sankey': {
      return { ...base, showX: true, showY: true, xOptions: dimensionOptions, yOptions: otherDimensions.length ? otherDimensions : dimensionOptions, xLabel: 'Source', yLabel: 'Target' };
    }
    default:
      return { ...base, showX: true, showY: true, xOptions: dimensionOptions, yOptions: measureOptions, xLabel: 'Dimension', yLabel: 'Metric' };
  }
};

export const getGraphTypeCompatibility = (chartType, columnGroups) => {
  const groups = columnGroups || inferColumnGroups();
  if (groups.all.length === 0 || groups.classificationKnown === false) return { compatible: true, reason: '' };
    const numericRequirements = {
    gauge: 1,
    histogram: 1,
    box: 1,
    violin: 1,
    strip: 1,
    ecdf: 1,
    scatter: 2,
    density: 2,
    bubble: 3,
    heatmap: 2,
    contour: 3,
    scatter3d: 3,
    surface3d: 3,
    mesh3d: 3,
    bubble4d: 4,
    parallelCoordinates: 3,
    candlestick: 4,
    sineWave: 1,
    rangeArea: 2
  };
  const numericRequired = numericRequirements[chartType] || 0;
  if (numericRequired && groups.numeric.length < numericRequired) {
    const countLabel = ['zero', 'one', 'two', 'three', 'four'][numericRequired] || String(numericRequired);
    return { compatible: false, reason: `Needs at least ${countLabel} numeric ${numericRequired === 1 ? 'column' : 'columns'}.` };
  }
  if (['sankey', 'stackedBar', 'multiSpline', 'streamgraph', 'sunburst'].includes(chartType) && groups.dimensions.length < 2) {
    return { compatible: false, reason: 'Needs at least two dimension columns.' };
  }
  return { compatible: true, reason: '' };
};

export const validateGraphConfiguration = (configuration, columnGroups) => {
  const groups = columnGroups || inferColumnGroups();
  const compatibility = getGraphTypeCompatibility(configuration.chartType, groups);
  const issues = compatibility.compatible ? [] : [compatibility.reason];
  const selectors = getGraphSelectorConfig(configuration.chartType, groups, configuration.preferredX);
  const warnings = [];

  if (groups.all.length > 0 && groups.classificationKnown !== false && compatibility.compatible) {
    const selectorFields = [
      ['X', 'preferredX', 'x'], ['Y', 'preferredY', 'y'], ['Z', 'preferredZ', 'z'],
      ['Size', 'preferredSize', 'size'], ['Color', 'preferredColor', 'color'],
      ['Group', 'preferredGroup', 'group'], ['Open', 'preferredOpen', 'open'],
      ['High', 'preferredHigh', 'high'], ['Low', 'preferredLow', 'low']
    ];
    selectorFields.forEach(([fallbackLabel, field, selector]) => {
      if (!selectors[`show${fallbackLabel}`]) return;
      const value = configuration[field];
      const options = selectors[`${selector}Options`];
      if (!value) {
        issues.push(`Choose a ${(selectors[`${selector}Label`] || fallbackLabel).toLowerCase()}.`);
      } else if (!options.includes(value)) {
        issues.push(`Choose a valid ${(selectors[`${selector}Label`] || fallbackLabel).toLowerCase()}.`);
      }
    });
    if (['scatter', 'density', 'bubble', 'scatter3d', 'surface3d', 'mesh3d', 'contour', 'bubble4d', 'sankey'].includes(configuration.chartType) && configuration.preferredX && configuration.preferredX === configuration.preferredY) {
      issues.push('Choose two different columns.');
    }
    const distinctFields = configuration.chartType === 'candlestick'
      ? ['preferredY', 'preferredOpen', 'preferredHigh', 'preferredLow']
      : configuration.chartType === 'rangeArea'
        ? ['preferredY', 'preferredZ']
      : ['scatter3d', 'surface3d', 'mesh3d', 'contour'].includes(configuration.chartType)
        ? ['preferredX', 'preferredY', 'preferredZ']
        : configuration.chartType === 'bubble4d'
          ? ['preferredX', 'preferredY', 'preferredZ', 'preferredSize']
          : configuration.chartType === 'bubble'
            ? ['preferredX', 'preferredY', 'preferredSize']
          : [];
    const configuredValues = distinctFields.map((field) => configuration[field]).filter(Boolean);
    if (new Set(configuredValues).size !== configuredValues.length) {
      issues.push('Choose a different column for each encoded dimension.');
    }
  }

  const dimensionCardinality = groups.cardinality?.[configuration.preferredX] || 0;
  const cardinalityLimits = { pie: 12, funnel: 20, treemap: 40, bar: 50 };
  const cardinalityLimit = cardinalityLimits[configuration.chartType];
  if (cardinalityLimit && dimensionCardinality > cardinalityLimit) {
    warnings.push(`${configuration.preferredX} has ${dimensionCardinality} distinct values; use Top N or a lower-cardinality dimension for a clearer ${configuration.chartType} chart.`);
  }
  const coercedColumns = unique([
    configuration.preferredX, configuration.preferredY, configuration.preferredZ,
    configuration.preferredSize, configuration.preferredOpen, configuration.preferredHigh,
    configuration.preferredLow
  ])
    .filter((column) => groups.coercedNumeric?.includes(column));
  if (coercedColumns.length) {
    warnings.push(`${coercedColumns.join(', ')} ${coercedColumns.length === 1 ? 'is' : 'are'} numeric-looking text and will be coerced to numbers.`);
  }

  const compatibleTypes = CHART_TYPE_VALUES
    .filter((value) => getGraphTypeCompatibility(value, groups).compatible);
  return { valid: issues.length === 0, issues: unique(issues), warnings: unique(warnings), compatibleTypes };
};

export const repairGraphConfiguration = (configuration, columnGroups) => {
  const selectors = getGraphSelectorConfig(configuration.chartType, columnGroups, configuration.preferredX);
  const preferredX = selectors.showX
    ? (selectors.xOptions.includes(configuration.preferredX) ? configuration.preferredX : (selectors.xOptions[0] || ''))
    : '';
  const repairedSelectors = getGraphSelectorConfig(configuration.chartType, columnGroups, preferredX);
  const repair = (showKey, optionsKey, value) => repairedSelectors[showKey]
    ? (repairedSelectors[optionsKey].includes(value) ? value : (repairedSelectors[optionsKey][0] || ''))
    : '';
  const repaired = {
    ...configuration,
    preferredX,
    preferredY: repair('showY', 'yOptions', configuration.preferredY),
    preferredZ: repair('showZ', 'zOptions', configuration.preferredZ),
    preferredSize: repair('showSize', 'sizeOptions', configuration.preferredSize),
    preferredColor: repair('showColor', 'colorOptions', configuration.preferredColor),
    preferredGroup: repair('showGroup', 'groupOptions', configuration.preferredGroup),
    preferredOpen: repair('showOpen', 'openOptions', configuration.preferredOpen),
    preferredHigh: repair('showHigh', 'highOptions', configuration.preferredHigh),
    preferredLow: repair('showLow', 'lowOptions', configuration.preferredLow)
  };
  const distinctFields = configuration.chartType === 'candlestick'
    ? ['preferredY', 'preferredOpen', 'preferredHigh', 'preferredLow']
    : configuration.chartType === 'rangeArea'
      ? ['preferredY', 'preferredZ']
    : configuration.chartType === 'bubble'
      ? ['preferredX', 'preferredY', 'preferredSize']
      : ['scatter3d', 'surface3d', 'mesh3d', 'contour'].includes(configuration.chartType)
        ? ['preferredX', 'preferredY', 'preferredZ']
        : configuration.chartType === 'bubble4d'
          ? ['preferredX', 'preferredY', 'preferredZ', 'preferredSize']
          : [];
  const used = new Set();
  distinctFields.forEach((field) => {
    const selector = field.replace('preferred', '').toLowerCase();
    const options = field === 'preferredY' ? repairedSelectors.yOptions : repairedSelectors[`${selector}Options`];
    const candidate = repaired[field];
    repaired[field] = candidate && !used.has(candidate)
      ? candidate
      : (options.find((option) => !used.has(option)) || candidate || '');
    if (repaired[field]) used.add(repaired[field]);
  });
  return repaired;
};
