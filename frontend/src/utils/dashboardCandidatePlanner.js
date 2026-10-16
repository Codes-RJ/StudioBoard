import { aggregationFor, usableFields, buildGoalCards, normalizePlanningGroups } from './dashboardLayoutPlan';

const goalDefinitions = [
  { id: 'overview', label: 'Overview', description: 'A balanced view of key measures, categories, and trends.' },
  { id: 'trends', label: 'Trends', description: 'Emphasizes change over time and notable movement.' },
  { id: 'comparisons', label: 'Comparisons', description: 'Highlights differences between categories and measures.' },
  { id: 'distribution', label: 'Distribution', description: 'Shows spread, concentration, and category mix.' },
];

const scoreCandidate = (goal, cards, groups) => {
  const chartTypes = new Set(cards.map(({ chartType }) => chartType));
  const coverage = new Set(cards.flatMap(({ preferredX, preferredY }) => [preferredX, preferredY]).filter((name) => name && name !== '__count__'));
  const metricCoverage = groups.numeric.some((name) => coverage.has(name)) ? 1 : 0;
  const dimensionCoverage = groups.dimensions.some((name) => coverage.has(name)) ? 1 : 0;
  const timeCoverage = groups.date.some((name) => coverage.has(name)) ? 1 : 0;
  const relevance = goal === 'trends' ? (timeCoverage ? 1 : 0.35)
    : goal === 'comparisons' ? (dimensionCoverage ? 1 : 0.45)
      : goal === 'distribution' ? (metricCoverage ? 1 : 0.4) : 0.82;
  const variety = cards.length ? chartTypes.size / cards.length : 0;
  const fieldCoverage = (metricCoverage + dimensionCoverage + timeCoverage) / 3;
  const readability = cards.length >= 3 ? 1 : cards.length === 2 ? 0.8 : 0.5;
  return Math.round((relevance * 0.4 + fieldCoverage * 0.25 + variety * 0.2 + readability * 0.15) * 100);
};

export const generateDashboardCandidates = (datasetId, columnGroups, { goal = 'overview', limit = 3 } = {}) => {
  const groups = normalizePlanningGroups(columnGroups);
  if (!groups.all?.length) return [];
  const goals = goal === 'auto' ? goalDefinitions.map(({ id }) => id) : [goal, ...goalDefinitions.map(({ id }) => id).filter((id) => id !== goal)];
  const unique = new Set();
  return goals.map((goalId) => {
    const cards = buildGoalCards(goalId, groups);
    const signature = cards.map(({ chartType, preferredX, preferredY, aggregation }) => `${chartType}:${preferredX}:${preferredY}:${aggregation}`).join('|');
    if (!cards.length || unique.has(signature)) return null;
    unique.add(signature);
    const definition = goalDefinitions.find(({ id }) => id === goalId) || goalDefinitions[0];
    const { date, dimension, measure } = usableFields(groups);
    const warnings = [];
    if (goalId === 'trends' && !date) warnings.push('No usable date field is available; these cards show an overview instead of a time trend.');
    if (goalId === 'comparisons' && !dimension) warnings.push('No compact grouping field is available; use the table or choose a grouping manually.');
    if (measure && aggregationFor(measure) === 'average') warnings.push(`Averages of ${measure} are unweighted. Supply a denominator for weighted rates; adjust the aggregation if your row meaning requires it.`);
    return {
      id: `${datasetId}_${goalId}`,
      name: `${definition.label} dashboard`,
      goal: goalId,
      description: [definition.description, ...warnings].join(' '),
      profile: groups.planningProfile ? { sampledRows: groups.planningProfile.sampledRows, totalRows: groups.planningProfile.totalRows, complete: groups.planningProfile.complete } : null,
      score: scoreCandidate(goalId, cards, groups),
      coverage: [...new Set(cards.flatMap(({ preferredX, preferredY }) => [preferredX, preferredY]).filter((name) => name && name !== '__count__'))],
      layout: cards,
    };
  }).filter(Boolean).sort((a, b) => (goal === 'auto' ? 0 : Number(b.goal === goal) - Number(a.goal === goal)) || b.score - a.score).slice(0, Math.max(1, Math.min(4, limit)));
};
