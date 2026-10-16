// Constrain generation as well as validating every returned action in agent.js.
// These bounds guide the model; they do not grant tool execution authority.
const text = { type: 'string' };
const integer = { type: 'integer' };
const pageSize = (maximum) => ({ ...integer, minimum: 1, maximum });
const offset = { ...integer, minimum: 0 };
const aggregation = { enum: ['sum', 'average', 'count', 'min', 'max', 'median', 'weighted_average'] };
const chart = { title: text, chartType: { enum: ['bar', 'line', 'pie', 'table'] }, preferredX: text, preferredY: text, aggregation };
const tools = {
  retrieve: { query: text, sourceId: text, limit: pageSize(12) },
  list_sources: { query: text, offset, limit: pageSize(50) },
  inspect_schema: { sourceId: text, query: text, offset, limit: pageSize(100) },
  graph_retrieve: { query: text, sourceId: text, targetId: text, maxHops: pageSize(3) },
  calculate: { sourceId: text, metric: text, dimension: text, aggregation, weight: text, limit: pageSize(100) },
  graph_calculate: { sourceId: text, edgeIds: { type: 'array', items: text, minItems: 1, maxItems: 3 }, metric: text, dimension: text,
    aggregation: { enum: aggregation.enum.filter((value) => value !== 'weighted_average') }, limit: pageSize(100) },
  propose_chart: chart,
  list_charts: { offset, limit: pageSize(20) },
  propose_chart_edit: { cardId: text, ...chart },
  propose_layout: { title: text, density: { enum: ['compact', 'comfortable'] },
    cards: { type: 'array', items: { type: 'object', properties: chart, additionalProperties: false } } },
};
const requiredArgs = {
  retrieve: ['query'], calculate: ['metric', 'aggregation'], graph_calculate: ['sourceId', 'edgeIds', 'metric', 'aggregation'],
  propose_chart: ['title', 'chartType', 'preferredX', 'preferredY', 'aggregation'],
  propose_chart_edit: ['cardId', 'title', 'chartType', 'preferredX', 'preferredY', 'aggregation'], propose_layout: ['title', 'cards'],
};
const toolAction = (name, properties, required = requiredArgs[name] || []) => ({ type: 'object', additionalProperties: false,
  properties: { type: { const: 'tool' }, name: { const: name }, args: { type: 'object', properties, required, additionalProperties: false } }, required: ['type', 'name', 'args'] });

// Only schemas actually presented to the model are eligible for calculation.
// inspect_schema can add fields/sources on subsequent turns. This avoids both
// invented names and a grammar containing every field in a large collection.
const actionVariants = ({ sourceSchemas = [], selectedId, evidenceIds = [], allowFinal = true, reviewedEdgeIds, requiredMetric, requiredAggregation, chartCandidates } = {}) => {
  if (typeof allowFinal !== 'boolean' || !Array.isArray(sourceSchemas) || sourceSchemas.length > 8 || !Array.isArray(evidenceIds) || evidenceIds.length > 100
    || evidenceIds.some((id) => typeof id !== 'string')
    || (reviewedEdgeIds !== undefined && (!Array.isArray(reviewedEdgeIds) || reviewedEdgeIds.length > 40 || reviewedEdgeIds.some((id) => typeof id !== 'string')))
    || sourceSchemas.some((source) => typeof source?.id !== 'string' || !Array.isArray(source.fields)
      || source.fields.length > 640 || source.fields.some((field) => typeof field !== 'string'))) throw new Error('Invalid model schema context.');
  if (requiredMetric && !sourceSchemas.some((source) => source.id === requiredMetric.sourceId && source.fields.includes(requiredMetric.field))) throw new Error('Invalid requested measure context.');
  if (requiredAggregation && !aggregation.enum.includes(requiredAggregation)) throw new Error('Invalid requested aggregation context.');
  if (chartCandidates !== undefined && (!Array.isArray(chartCandidates) || chartCandidates.length > 6 || chartCandidates.some((card) => typeof card.preferredX !== 'string'
    || typeof card.preferredY !== 'string' || !aggregation.enum.includes(card.aggregation)))) throw new Error('Invalid verified chart context.');
  const actions = Object.entries(tools).filter(([name]) => name !== 'calculate').flatMap(([name, properties]) => {
    if (name === 'propose_chart' && chartCandidates !== undefined) return chartCandidates.map((card) => toolAction(name, { ...properties,
      preferredX: { const: card.preferredX }, preferredY: { const: card.preferredY }, aggregation: { const: card.aggregation } }));
    if (name !== 'graph_calculate' || reviewedEdgeIds === undefined) return [toolAction(name, properties)];
    if (!reviewedEdgeIds.length || !sourceSchemas.length) return [];
    const fields = [...new Set(sourceSchemas.flatMap((source) => source.fields.map((field) => `${source.id}::${field}`)))];
    return [toolAction(name, { ...properties, sourceId: { type: 'string', enum: sourceSchemas.map((source) => source.id) },
      edgeIds: { ...properties.edgeIds, items: { type: 'string', enum: [...new Set(reviewedEdgeIds)] } },
      metric: requiredMetric ? { const: `${requiredMetric.sourceId}::${requiredMetric.field}` } : { type: 'string', enum: [...fields, '__rows__'] },
      aggregation: requiredAggregation ? { enum: [requiredAggregation] } : properties.aggregation,
      ...(fields.length ? { dimension: { type: 'string', enum: fields } } : {}) })];
  });
  for (const source of sourceSchemas) {
    if (requiredMetric && source.id !== requiredMetric.sourceId) continue;
    const fields = [...new Set(source.fields)];
    const field = fields.length ? { type: 'string', enum: fields } : null;
    actions.push(toolAction('calculate', { sourceId: { const: source.id },
      metric: requiredMetric ? { const: requiredMetric.field } : { type: 'string', enum: [...new Set([...fields, '__rows__'])] },
      aggregation: requiredAggregation ? { enum: [requiredAggregation] } : aggregation,
      ...(field ? { dimension: field, weight: field } : {}), limit: pageSize(100) },
    source.id === selectedId ? requiredArgs.calculate : ['sourceId', ...requiredArgs.calculate]));
  }
  actions.push({ type: 'object', additionalProperties: false, properties: { type: { const: 'clarify' }, message: text }, required: ['type', 'message'] });
  if (allowFinal) actions.push({ type: 'object', additionalProperties: false, properties: { type: { const: 'final' },
    evidenceIds: { type: 'array', items: evidenceIds.length ? { type: 'string', enum: [...new Set(evidenceIds)] } : text, maxItems: evidenceIds.length ? 20 : 0 }, message: text },
  required: ['type', 'evidenceIds', 'message'] });
  return actions;
};

// Routing names describe a calculation's shape. They remain model choices,
// and map back to the existing allowlisted tool identity for execution.
export const calculationRoutes = {
  calculate: { tool: 'calculate', grouped: false, weighted: false },
  calculate_grouped: { tool: 'calculate', grouped: true, weighted: false },
  calculate_weighted: { tool: 'calculate', grouped: false, weighted: true },
  calculate_weighted_grouped: { tool: 'calculate', grouped: true, weighted: true },
  graph_calculate: { tool: 'graph_calculate', grouped: false },
  graph_calculate_grouped: { tool: 'graph_calculate', grouped: true },
};
export const createActionSchema = (context, actionName) => {
  const actions = actionVariants(context);
  const shape = Object.hasOwn(calculationRoutes, actionName) ? calculationRoutes[actionName] : null;
  let selected = actionName === undefined ? actions : actions.filter((action) => (action.properties.name?.const || action.properties.type.const) === (shape?.tool || actionName));
  if (shape) selected = selected.flatMap((action) => {
    const args = action.properties.args;
    if ((shape.grouped && !args.properties.dimension) || (shape.weighted && !args.properties.weight)) return [];
    const properties = { ...args.properties };
    if (shape.weighted && !properties.aggregation.enum.includes('weighted_average')) return [];
    if (!shape.weighted && properties.aggregation.enum.every((value) => value === 'weighted_average')) return [];
    if (!shape.grouped) delete properties.dimension;
    if (!shape.weighted) delete properties.weight;
    if (shape.grouped && context?.requiredGrouping) {
      const { sourceId, field } = context.requiredGrouping;
      const requested = shape.tool === 'graph_calculate' ? `${sourceId}::${field}` : field;
      if (!properties.dimension.enum?.includes(requested) || (shape.tool === 'calculate' && properties.sourceId.const !== sourceId)) return [];
      properties.dimension = { const: requested };
    }
    properties.aggregation = { enum: shape.weighted ? ['weighted_average'] : properties.aggregation.enum.filter((value) => value !== 'weighted_average') };
    return [{ ...action, properties: { ...action.properties, args: { ...args, properties,
      required: [...args.required, ...(shape.grouped ? ['dimension'] : []), ...(shape.weighted ? ['weight'] : [])] } } }];
  });
  if (context?.pendingChartType && actionName === 'propose_chart') selected = selected.map((action) => ({ ...action,
    properties: { ...action.properties, args: { ...action.properties.args, properties: { ...action.properties.args.properties,
      chartType: { const: context.pendingChartType } } } } }));
  if (!selected.length) throw new Error('The selected model action is unavailable.');
  const schema = JSON.stringify(selected.length === 1 && actionName !== undefined ? selected[0] : { anyOf: selected });
  if (schema.length > 64_000) throw new Error('Model schema exceeds the local allowance. Inspect a narrower set of fields.');
  return schema;
};

export const createActionSelectionSchema = (context) => {
  if (context?.requiredGrouping && (typeof context.requiredGrouping.sourceId !== 'string' || typeof context.requiredGrouping.field !== 'string'
    || !context.sourceSchemas?.some((source) => source.id === context.requiredGrouping.sourceId && source.fields.includes(context.requiredGrouping.field)))) throw new Error('Invalid requested grouping context.');
  if (context?.pendingChartType && !['bar', 'line', 'pie', 'table'].includes(context.pendingChartType)) throw new Error('Invalid pending chart context.');
  return JSON.stringify({ type: 'object', additionalProperties: false,
  properties: { action: { type: 'string', enum: [...new Set(actionVariants(context).flatMap((action) => {
    const name = action.properties.name?.const || action.properties.type.const;
    if (context?.missingMetric) return name === 'clarify' ? [name] : [];
    if (context?.pendingChartType) return ['propose_chart', 'clarify'].includes(name) ? [name] : [];
    if (context?.requiredMetric && context?.requiredAggregation && name === 'retrieve') return [];
    if (!['calculate', 'graph_calculate'].includes(name)) return [name];
    return Object.entries(calculationRoutes).filter(([route, shape]) => shape.tool === name
      && (!context?.requiredGrouping || shape.grouped)
      && (!shape.grouped || action.properties.args.properties.dimension) && (!shape.weighted || action.properties.args.properties.weight)
      && (() => { try { createActionSchema(context, route); return true; } catch { return false; } })()).map(([route]) => route);
  }))] }, then: { enum: ['answer', 'continue'] } },
  required: ['action', 'then'] });
};
