import { findReviewedPaths } from './graph';
import { assertCalculationRole } from '../analysisScope';
import { assertReviewed } from './evidence';
import { sourceMentioned } from './context';

// Bind explicit calculations and a two-measure average comparison. Unsupported
// filters, negation, weighting and ambiguous fields/paths still clarify; execution checks grain.
export const compileCalculationPlans = ({ question, requirements, datasets, selectedId, graph }) => {
  const { metric, grouping, aggregation, ambiguousGrouping, ambiguousMetric, missingMetric } = requirements;
  if (requirements.comparison) {
    const measures = requirements.comparison;
    const owner = datasets.find((source) => source.id === measures[0].sourceId);
    try {
      assertReviewed(owner, { allowSavedMetadata: true });
      measures.forEach(({ field }) => assertCalculationRole(owner, field));
    } catch { return { status: 'unbound', plans: [] }; }
    if (owner.id !== selectedId || /\b(?:where|with|filter|excluding|except|only|weighted|by|per|for|in|from|between|during|since|until|before|after)\b/i.test(question))
      return { status: 'unsupported', reason: 'Choose one reviewed source and a plain average of each measure for this comparison.', plans: [] };
    return { status: 'ready', plans: measures.map(({ sourceId, field }, index) => ({ id: `compare${index + 1}`, name: 'calculate',
      args: { sourceId, metric: field, aggregation: 'average' }, completion: index ? 'answer' : 'continue',
      description: `Calculate the full-source average of ${field} for the requested two-measure comparison.` })) };
  }
  if (ambiguousGrouping || ambiguousMetric) return { status: 'ambiguous', reason: 'Which source owns the requested measure or grouping field?', plans: [] };
  if (missingMetric) return { status: 'unavailable', reason: `The requested measure "${missingMetric}" is unavailable in the presented source metadata. Which available measure should I use?`, plans: [] };
  if (requirements.missingGrouping) return { status: 'unavailable', reason: `The grouping field "${requirements.missingGrouping}" is unavailable in the presented source metadata. Which source or grouping field should I use?`, plans: [] };
  if (!metric || !aggregation || missingMetric) return { status: 'unbound', plans: [] };
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const owner = datasets.find((source) => source.id === metric.sourceId);
  const filters = {};
  let remaining = question;
  const highestGroup = grouping && new RegExp('\\bwhich\\s+["\']?' + escape(grouping.field) + '(?![\\p{L}\\p{N}_])\\s+has\\s+(?:the\\s+)?highest\\b', 'iu');
  const isHighestGroupRequest = Boolean(highestGroup?.test(question));
  if (isHighestGroupRequest) remaining = remaining.replace(highestGroup, ' ');
  for (const column of owner?.columns || []) {
    const field = typeof column === 'string' ? column : column.name;
    const pattern = new RegExp('\\b(?:where|with)\\s+' + escape(field) + '\\s+(?:contains?|containing)\\s+(["\'])([^"\']{1,100})\\1', 'giu');
    remaining = remaining.replace(pattern, (match, quote, value) => {
      if (filters[field] && filters[field] !== value) return match;
      filters[field] = value;
      return ' ';
    });
  }
  remaining = remaining.replace(/\bexcluding missing values\b|\bfor those results\b|\bfor\s+each\s+[\w ()-]+(?=,|\s+show\b)/gi, '')
    .replace(/\b(?:for|in|from)\s+(?:this|the|same)\s+(?:[\w-]+\s+)?(?:source|dataset|table)\b|\b(?:before|after)\s+a\s+follow-up\b/gi, '')
    .replace(/\bfor\s+(?:the\s+)?rows?\b/gi, '')
    .replace(/\bif\s+there\s+are\s+more\s+than\s+20\s+groups,?\s+show\s+the\s+highest\s+20\s+and\s+say\s+(?:the\s+)?answer\s+is\s+limited\b/gi, '')
    .replace(/\b(?:in|from|through|to)\s+[\w./\\-]+\.(?:csv|xlsx?|tsv)\b/gi, '');
  const multiple = /\b(?:and|then)\s+(?:(?:calculate|compute|show)\s+(?:the\s+)?)?(?:sum|total|average|mean|median|min|max|count)\b/i.test(remaining)
    || datasets.some((source) => source.columns.some((column) => new RegExp('\\band\\s+["\']?' + escape(typeof column === 'string' ? column : column.name) + '(?![\\p{L}\\p{N}_])', 'iu').test(remaining)));
  if (/\b(?:not|never|don't|without|except|only|where|with|for|in|from|between|during|since|until|before|after|top|bottom|first|last|greater|less|above|below|versus|compare|difference|ratio|percent|percentage|filter|multiplied|divided|multiply|divide|rank|highest|lowest)\b|[<>!=]=?/i.test(remaining)
    || multiple) return {
    status: 'unsupported', reason: 'This request includes a restriction or comparison I cannot bind safely. Apply the intended dashboard filters, then ask for a single calculation; specify comparison measures separately.', plans: [] };
  const weights = aggregation === 'weighted_average' ? (owner?.columns || []).map((column) => typeof column === 'string' ? column : column.name)
    .filter((field) => new RegExp('\\b(?:using|weighted\\s+by|weight\\s+by)\\s+["\']?' + escape(field) + '(?![\\p{L}\\p{N}_])', 'iu').test(question)) : [];
  if (aggregation === 'weighted_average' && weights.length !== 1) return { status: 'unbound', plans: [] };
  const dimensionOwner = grouping && datasets.find((source) => source.id === grouping.sourceId);
  try {
    assertReviewed(owner, { allowSavedMetadata: true });
    assertCalculationRole(owner, metric.field, aggregation !== 'count');
    if (weights.length) assertCalculationRole(owner, weights[0]);
    if (dimensionOwner) { assertReviewed(dimensionOwner, { allowSavedMetadata: true }); assertCalculationRole(dimensionOwner, grouping.field, false); }
  } catch { return { status: 'unbound', plans: [] }; }
  if (!grouping || grouping.sourceId === metric.sourceId) return { status: 'ready', plans: [{ id: 'p1', name: 'calculate',
    args: { sourceId: metric.sourceId, metric: metric.field, aggregation, ...(weights.length ? { weight: weights[0] } : {}), ...(grouping ? { dimension: grouping.field } : {}), ...(isHighestGroupRequest ? { limit: 100 } : {}), ...(Object.keys(filters).length ? { filters } : {}) },
    completion: requirements.chartType ? 'continue' : 'answer',
    description: `${aggregation} of ${metric.field} in ${owner.sourcePath || owner.name || owner.id}${weights.length ? ` weighted by ${weights[0]}` : ''}${grouping ? ` grouped by ${grouping.field}` : ''}` }] };
  if (Object.keys(filters).length) return { status: 'unsupported', reason: 'A row filter across a reviewed relationship cannot yet be bound safely. Filter a single source or ask for the joined calculation without that filter.', plans: [] };
  if (weights.length) return { status: 'unsupported', reason: 'Weighted averages across relationships need an explicitly supported joined weight and grain. Choose a single source or an unweighted calculation.', plans: [] };
  if (!graph || metric.sourceId !== selectedId) return { status: 'unbound', plans: [] };
  let paths;
  try { paths = findReviewedPaths(graph, metric.sourceId, grouping.sourceId); }
  catch { return { status: 'ambiguous', reason: 'Specify a narrower approved relationship path.', plans: [] }; }
  const named = datasets.filter((source) => sourceMentioned(source, question)).map((source) => source.id);
  paths = paths.filter((edgeIds) => {
    const ids = new Set(edgeIds.flatMap((id) => { const edge = graph.edges.find((item) => item.id === id); return [edge.leftDatasetId, edge.rightDatasetId]; }));
    return named.every((id) => ids.has(id));
  });
  if (!paths.length) return { status: 'unavailable', reason: 'No current approved relationship path connects the requested sources. Review the relationship or choose another grouping.', plans: [] };
  if (paths.length > 1) return { status: 'ambiguous', reason: 'Which approved relationship path should this calculation use? More than one connects these sources.', plans: [] };
  const edgeIds = paths[0];
  return { status: 'ready', plans: [{ id: 'p1', name: 'graph_calculate', args: { sourceId: metric.sourceId, edgeIds,
    metric: `${metric.sourceId}::${metric.field}`, dimension: `${grouping.sourceId}::${grouping.field}`, aggregation, ...(isHighestGroupRequest ? { limit: 100 } : {}) },
    completion: requirements.chartType ? 'continue' : 'answer',
    description: `${aggregation} of ${metric.field} in ${owner.sourcePath || owner.name || owner.id} grouped by ${grouping.field} in ${dimensionOwner.sourcePath || dimensionOwner.name || dimensionOwner.id}; approved path: ${edgeIds.join(' -> ')}` }] };
};

export const compileRetrievalPlans = ({ question, selectedId, initialEvidence = [] }) => {
  if (!/\b(?:find|locate|which|search|show)\b[^.!?]*\b(?:row|record|passage|paragraph|page|document)\b/i.test(question)) return [];
  return [{ id: 'r1', name: 'retrieve', args: { sourceId: selectedId, query: question, limit: 6 }, completion: 'answer',
    description: 'Retrieve supporting rows or passages from the selected reviewed source and return their citations. No arithmetic or unsupported summary. Current evidence excerpts: '
      + initialEvidence.filter((record) => record.kind === 'row').slice(0, 2).map((record) => String(record.text).slice(0, 250)).join(' | ') }];
};
