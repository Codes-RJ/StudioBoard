import { validateGraphConfiguration } from './graphConfiguration';

const layoutCard = (id, title, chartType, preferredX = '', preferredY = '', aggregation = 'sum') => ({
  i: id, title, chartType, preferredX, preferredY, aggregation, topN: 12,
  x: ((Number(id.slice(-1)) - 1) % 2) * 6,
  y: Math.floor((Number(id.slice(-1)) - 1) / 2) * 4,
  w: 6, h: chartType === 'kpi' ? 3 : 4,
});

const words = (field) => String(field).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase();
export const aggregationFor = (field) => {
  if (/\b(rate|ratio|percent|percentage|margin|price|average|avg|mean|age|duration|latency|temperature|balance|inventory|stock|mrr|arr|cac|score)\b|%/.test(words(field))) return 'average';
  return /\b(revenue|sales|amount|total|quantity|units|volume|cost|expense|spend|profit|loss)\b/.test(words(field)) ? 'sum' : 'average';
};
export const usableFields = (groups) => {
  const profile = groups.planningProfile;
  const state = (field) => profile?.fields?.[field];
  const cardinality = (field) => state(field)?.distinct ?? groups.cardinality?.[field];
  const coverage = (field) => state(field) ? state(field).populated / profile.sampledRows : 1;
  const measures = [...groups.measures].filter((field) => !state(field) || state(field).numeric > 0)
    .sort((a, b) => {
      const rank = (field) => coverage(field) * 3 + (state(field)?.distinct > 1 ? 1 : 0) + (aggregationFor(field) === 'sum' ? 0.25 : 0);
      return rank(b) - rank(a);
    });
  const dimensions = groups.dimensions.filter((field) => !groups.date.includes(field)
    && (!state(field) || state(field).populated > 0)
    && (cardinality(field) == null || cardinality(field) <= 50));
  dimensions.sort((a, b) => {
    const rank = (field) => coverage(field) + (cardinality(field) >= 2 && cardinality(field) <= 12 ? 2 : 0);
    return rank(b) - rank(a);
  });
  return { measure: measures[0] || '', secondMeasure: measures[1] || '', dimension: dimensions[0] || '',
    date: groups.date.find((field) => !state(field) || state(field).populated > 0) || '' };
};

export const buildGoalCards = (goal, groups) => {
  const { date, dimension, measure, secondMeasure } = usableFields(groups);
  const aggregation = aggregationFor(measure);
  const label = measure ? `${aggregation === 'sum' ? 'Total' : 'Average'} ${measure}` : 'Rows';
  const cards = [];
  const add = (title, type, x = '', y = '', aggregation = 'sum') => cards.push(layoutCard(`${goal}_candidate_${cards.length + 1}`, title, type, x, y, aggregation));
  const addKpi = () => add(measure ? label : 'Row count', 'kpi', '', measure || '__count__', measure ? aggregation : 'count');
  const addCategory = () => { if (dimension) add(`${label} by ${dimension}`, 'bar', dimension, measure || '__count__', measure ? aggregation : 'count'); };
  const addTrend = () => { if (date) add(`${label} over ${date}`, 'line', date, measure || '__count__', measure ? aggregation : 'count'); };

  if (goal === 'trends') {
    addTrend(); addKpi(); addCategory();
    if (measure) add(`${measure} distribution`, 'histogram', measure, '', 'auto');
  } else if (goal === 'comparisons') {
    addCategory(); addKpi();
    if (dimension && secondMeasure) add(`${aggregationFor(secondMeasure) === 'sum' ? 'Total' : 'Average'} ${secondMeasure} by ${dimension}`, 'bar', dimension, secondMeasure, aggregationFor(secondMeasure));
    addTrend();
  } else if (goal === 'distribution') {
    if (measure) add(`${measure} distribution`, 'histogram', measure, '', 'auto');
    if (dimension && measure) add(`${measure} spread by ${dimension}`, 'box', dimension, measure, 'average');
    addCategory(); addKpi();
  } else {
    addKpi(); addCategory(); addTrend();
    if (secondMeasure) add(`${measure} vs ${secondMeasure}`, 'scatter', measure, secondMeasure, 'auto');
    else if (measure) add(`${measure} distribution`, 'histogram', measure, '', 'auto');
  }
  if (!cards.some(({ chartType }) => chartType === 'table')) add('Source rows', 'table', '', '', 'auto');
  return cards.filter((card) => validateGraphConfiguration(card, groups).valid).slice(0, 4);
};

export const normalizePlanningGroups = (columnGroups) => {
  const groups = { all: [], numeric: [], dimensions: [], date: [], cardinality: {}, ...columnGroups };
  groups.measures ||= groups.numeric.filter((field) => !groups.dimensions.includes(field));
  const excluded = new Set([...(groups.identifiers || []), ...(groups.ignored || [])]);
  for (const key of ['numeric', 'measures', 'dimensions', 'date']) groups[key] = groups[key].filter((field) => !excluded.has(field));
  return groups;
};
