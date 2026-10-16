import { getDatasetColumnNames, aggregateMetricValues, toNumber } from '../chartDataTransforms';
import { qualityRevisionKey } from '../qualityReview';
import { relationshipNeedsReview } from '../datasetRelationships';
import { assertReviewed, terms } from './evidence';
import { matchesScope, assertCalculationRole } from '../analysisScope';
import { createExactMetric, parseExactDecimal, compareExact, formatExact } from '../exactDecimal';
import { dateGroupKey } from '../dateSemantics';
import { assertMeasurePrecision } from '../numberSemantics';

const fieldsFor = (edge, side) => edge[`${side}Columns`] || [edge[`${side}Column`]];
const key = (row, fields) => {
  const values = fields.map((field) => row?.[field]);
  if (values.some((v) => v == null || String(v).trim() === '')) return null;
  // Tuple encoding preserves composite boundaries and identifier formatting.
  return JSON.stringify(values.map((v) => String(v).trim()));
};
const currentEdge = (edge, datasets) => {
  if (edge.status !== 'approved' || relationshipNeedsReview(edge, datasets)) return false;
  return ['left', 'right'].every((side) => {
    const dataset = datasets.find((d) => d.id === edge[`${side}DatasetId`]);
    try { assertReviewed(dataset); } catch { return false; }
    return !edge[`${side}RevisionKey`] || edge[`${side}RevisionKey`] === qualityRevisionKey(dataset);
  });
};
export const buildEvidenceGraph = (datasets, relationships) => {
  const sources = datasets.filter((d) => { try { assertReviewed(d); return !d.isFolderOverview; } catch { return false; } });
  const nodes = sources.flatMap((source) => [
    { id: source.id, kind: 'source', datasetId: source.id, label: source.sourcePath || source.name, revision: qualityRevisionKey(source), rows: source.rawRows?.length ?? source.rowStorage?.streams?.rawRows?.length, fields: getDatasetColumnNames(source).length },
    ...getDatasetColumnNames(source).map((field) => ({ id: `${source.id}::${field}`, kind: 'field', datasetId: source.id, field, label: field }))
  ]);
  const ids = new Set(sources.map((d) => d.id));
  const edges = relationships.filter((edge) => ids.has(edge.leftDatasetId) && ids.has(edge.rightDatasetId) && currentEdge(edge, sources)).filter((edge) => {
    const left = fieldsFor(edge, 'left'); const right = fieldsFor(edge, 'right');
    return left.length > 0 && left.length === right.length && ['left', 'right'].every((side) => {
      const source = sources.find((d) => d.id === edge[`${side}DatasetId`]);
      return fieldsFor(edge, side).every((field) => getDatasetColumnNames(source).includes(field));
    });
  }).map((edge) => ({ ...edge, leftRevisionKey: qualityRevisionKey(sources.find((d) => d.id === edge.leftDatasetId)),
    rightRevisionKey: qualityRevisionKey(sources.find((d) => d.id === edge.rightDatasetId)) }));
  const links = nodes.filter((node) => node.kind === 'field').map((node) => ({ from: node.datasetId, to: node.id, kind: 'has-field' }));
  let entityCount = 0;
  for (const source of sources) {
    const keyFields = new Set(edges.flatMap((edge) => edge.leftDatasetId === source.id ? fieldsFor(edge, 'left') : edge.rightDatasetId === source.id ? fieldsFor(edge, 'right') : []));
    for (const field of keyFields) {
      const seen = new Set();
      for (const [rowIndex, row] of (source.entityRows || source.rawRows || []).slice(0, 2_000).entries()) {
        if (seen.size >= 50 || entityCount >= 1_000) break;
        const value = key(row, [field]); if (value === null || seen.has(value)) continue;
        seen.add(value); const id = `${source.id}::entity:${field}:${seen.size}`;
        nodes.push({ id, kind: 'entity', datasetId: source.id, field, label: String(row[field]).slice(0, 300), rowIndex, revision: qualityRevisionKey(source) });
        links.push({ from: `${source.id}::${field}`, to: id, kind: 'has-value' }); entityCount += 1;
      }
    }
  }
  const communities = summarizeGraphCommunities({ nodes, edges });
  return { nodes, edges, links, communities, coverage: { approvedSources: sources.length, acceptedEdges: edges.length, excludedEdges: relationships.length - edges.length,
    communities: communities.length, communityMethod: 'connected components of approved source relationships; deterministic structural summaries',
    entityNodes: entityCount, entities: 'bounded examples from first 2,000 source rows; 50 per key field; 1,000 total', execution: 'complete eligible source rows' } };
};

export const summarizeGraphCommunities = ({ nodes, edges }) => {
  const sources = nodes.filter((node) => node.kind === 'source'); const remaining = new Set(sources.map((node) => node.id)); const communities = [];
  const adjacency = new Map(sources.map((source) => [source.id, []]));
  for (const edge of edges) { adjacency.get(edge.leftDatasetId)?.push(edge.rightDatasetId); adjacency.get(edge.rightDatasetId)?.push(edge.leftDatasetId); }
  while (remaining.size) {
    const queue = [remaining.values().next().value]; const sourceIds = []; remaining.delete(queue[0]);
    for (let i = 0; i < queue.length; i += 1) {
      const id = queue[i]; sourceIds.push(id);
      for (const neighbor of adjacency.get(id)) if (remaining.delete(neighbor)) queue.push(neighbor);
    }
    const members = sourceIds.map((id) => sources.find((source) => source.id === id)); const ids = new Set(sourceIds);
    const relationships = edges.filter((edge) => ids.has(edge.leftDatasetId) && ids.has(edge.rightDatasetId));
    communities.push({ id: `community:${sourceIds.slice().sort().join('|')}`, sourceIds, edgeIds: relationships.map((edge) => edge.id),
      sources: members.map(({ id, label, revision, rows, fields }) => ({ id, label, revision, rows, fields })),
      summary: `${members.length} approved sources, ${relationships.length} reviewed relationships. Sources: ${members.map((source) => `${source.label} (${source.rows} rows, ${source.fields} fields)`).join('; ')}. Source row counts describe individual tables and cannot be added as a joined metric.`,
      method: 'approved connected component; source metadata, no inferred causal or document entities' });
  }
  return communities;
};

export const findReviewedPaths = (graph, from, to, maxHops = 3) => {
  if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > 3) throw new Error('Traversal is bounded to 1–3 hops.');
  if (from === to) return [];
  const paths = []; const queue = [{ source: from, edges: [], visited: [from] }];
  let explored = 0;
  while (queue.length) {
    if (++explored > 1_000) throw new Error('Graph traversal exceeds the safety limit; narrow the sources.');
    const item = queue.shift();
    for (const edge of graph.edges) {
      const next = edge.leftDatasetId === item.source ? edge.rightDatasetId : edge.rightDatasetId === item.source ? edge.leftDatasetId : null;
      if (!next || item.visited.includes(next)) continue;
      const path = [...item.edges, edge.id];
      if (next === to) paths.push(path);
      else if (path.length < maxHops) queue.push({ source: next, edges: path, visited: [...item.visited, next] });
      if (paths.length > 20) throw new Error('Too many relationship paths; specify the reviewed path.');
    }
  }
  return paths;
};
export const retrieveGraphNeighborhood = (graph, { query = '', sourceId, targetId = '', maxHops = 3 } = {}) => {
  if (!graph.nodes.some((node) => node.kind === 'source' && node.id === sourceId)) throw new Error('Unknown or unreviewed source.');
  if (targetId && !graph.nodes.some((node) => node.kind === 'source' && node.id === targetId)) throw new Error('Unknown or unreviewed target source.');
  const component = graph.communities?.find((community) => community.sourceIds.includes(sourceId));
  const connected = component && new Set(component.sourceIds);
  const queryTerms = new Set(terms(query));
  const relevant = graph.nodes.filter((node) => (!connected || connected.has(node.datasetId)) && terms(node.label).some((token) => queryTerms.has(token))).slice(0, 30);
  const targets = targetId ? [targetId] : [...new Set(relevant.map((node) => node.datasetId))].filter((id) => id !== sourceId).slice(0, 5);
  const paths = targets.flatMap((id) => findReviewedPaths(graph, sourceId, id, maxHops).map((edges) => ({ targetId: id, edgeIds: edges })));
  const nearby = graph.edges.filter((edge) => edge.leftDatasetId === sourceId || edge.rightDatasetId === sourceId).slice(0, 30);
  const communities = (graph.communities || []).filter((community) => community.sourceIds.includes(sourceId)).slice(0, 1);
  return { relevant, nearby, paths, communities, ambiguous: targets.some((target) => paths.filter((path) => path.targetId === target).length > 1), coverage: graph.coverage };
};

/** Follow an explicit reviewed path. Reject measure fan-out, never silently sum it. */
export const computeGraphMetric = (datasets, graph, { sourceId, edgeIds, metric, dimension = '', aggregation = 'sum', filtersByDataset = {}, limit = 20 } = {}) => {
  if (!Array.isArray(edgeIds) || !edgeIds.length || edgeIds.length > 3 || new Set(edgeIds).size !== edgeIds.length) throw new Error('Choose an explicit path of 1–3 reviewed edges.');
  if (!['sum', 'average', 'count', 'min', 'max', 'median'].includes(aggregation)) throw new Error('Unsupported graph aggregation.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid result limit.');
  const source = datasets.find((d) => d.id === sourceId); assertReviewed(source);
  let tuples = source.rawRows.map((row, index) => ({ [sourceId]: { row, index } })).filter((tuple) => matchesScope(tuple[sourceId].row, filtersByDataset[sourceId]));
  const visited = new Set([sourceId]); const joins = [];
  for (const id of edgeIds) {
    const edge = graph.edges.find((e) => e.id === id);
    if (!edge || !currentEdge(edge, datasets)) throw new Error('Relationship is unavailable or stale.');
    const leftVisited = visited.has(edge.leftDatasetId); const rightVisited = visited.has(edge.rightDatasetId);
    if (leftVisited === rightVisited) throw new Error('Edges must form one connected, acyclic reviewed path.');
    const oldSide = leftVisited ? 'left' : 'right'; const newSide = leftVisited ? 'right' : 'left';
    const oldId = edge[`${oldSide}DatasetId`]; const newId = edge[`${newSide}DatasetId`];
    const nextSource = datasets.find((d) => d.id === newId); assertReviewed(nextSource);
    const lookup = new Map(); let nextEligible = 0;
    nextSource.rawRows.forEach((row, index) => {
      if (!matchesScope(row, filtersByDataset[newId])) return;
      nextEligible += 1;
      const value = key(row, fieldsFor(edge, newSide)); if (value === null) return;
      const bucket = lookup.get(value) || []; bucket.push({ row, index }); lookup.set(value, bucket);
    });
    const next = []; let unmatchedTuples = 0; const matchedSourceRows = new Set();
    for (const tuple of tuples) {
      const value = key(tuple[oldId].row, fieldsFor(edge, oldSide));
      const matches = value === null ? [] : lookup.get(value) || [];
      if (!matches.length) unmatchedTuples += 1;
      for (const match of matches) {
        if (next.length >= 250_000) throw new Error('Join exceeds the 250,000 matched-row safety limit.');
        matchedSourceRows.add(match.index); next.push({ ...tuple, [newId]: match });
      }
    }
    joins.push({ relationshipId: id, from: oldId, to: newId, leftRevisionKey: edge.leftRevisionKey, rightRevisionKey: edge.rightRevisionKey,
      inputTuples: tuples.length, matchedTuples: next.length, unmatchedTuples, unmatchedSourceRows: nextEligible - matchedSourceRows.size,
      leftColumns: fieldsFor(edge, 'left'), rightColumns: fieldsFor(edge, 'right') });
    visited.add(newId); tuples = next;
  }
  for (const [id, filters] of Object.entries(filtersByDataset)) {
    const ds = datasets.find((d) => d.id === id);
    if (!visited.has(id) || Object.keys(filters).some((field) => !getDatasetColumnNames(ds).includes(field))) throw new Error('Filter is outside the reviewed path.');
  }
  const parse = (reference) => {
    const pos = String(reference).indexOf('::'); const id = String(reference).slice(0, pos); const field = String(reference).slice(pos + 2);
    if (pos < 0 || !visited.has(id) || !getDatasetColumnNames(datasets.find((d) => d.id === id)).includes(field)) throw new Error('Field is outside the reviewed path.');
    return [id, field];
  };
  const [metricId, metricField] = metric === '__rows__' ? [null, null] : parse(metric);
  const [dimensionId, dimensionField] = dimension ? parse(dimension) : [null, null];
  if (metricId) assertCalculationRole(datasets.find((d) => d.id === metricId), metricField, aggregation !== 'count');
  if (dimensionId) assertCalculationRole(datasets.find((d) => d.id === dimensionId), dimensionField, false);
  if (metric === '__rows__') aggregation = 'count';
  const metricSource = datasets.find((d) => d.id === metricId);
  const exact = aggregation !== 'count' && metricSource?.columnOverrides?.[metricField]?.precision === 'exact';
  const groups = new Map(); const seen = new Set(); let missingRows = 0;
  for (const tuple of tuples) {
    const value = metric === '__rows__' ? 1 : tuple[metricId].row[metricField];
    if (metricId && aggregation !== 'count') assertMeasurePrecision(metricSource, metricField, value);
    const valid = aggregation === 'count' ? value != null && String(value).trim() !== '' : exact ? parseExactDecimal(value) !== null : toNumber(value) !== null;
    if (valid && metricId) {
      const rowId = tuple[metricId].index;
      if (seen.has(rowId)) throw new Error('This path repeats measure rows. Choose a different grain or path before aggregation to avoid double counting.');
      seen.add(rowId);
    }
    if (!valid) missingRows += 1;
    const group = dimension ? dateGroupKey(tuple[dimensionId].row[dimensionField], datasets.find((d) => d.id === dimensionId).columnOverrides?.[dimensionField]) : 'All joined rows';
    if (!groups.has(group)) { if (groups.size >= 10_000) throw new Error('Too many graph groups.'); groups.set(group, exact ? createExactMetric(aggregation) : []); }
    if (exact) groups.get(group).consume(value); else groups.get(group).push(value);
  }
  const results = [...groups].map(([group, values]) => ({ group, value: exact ? values.result() : aggregateMetricValues(values, metric === '__rows__' ? 'count' : aggregation) }))
    .sort((a, b) => (a.value === null) - (b.value === null) || (a.value === null ? 0 : exact ? compareExact(b.value, a.value) : b.value - a.value));
  if (exact) results.forEach((result) => { if (result.value !== null) result.value = formatExact(result.value); });
  return { metric, dimension, aggregation, matchedRows: tuples.length, missingRows, joins, totalGroups: results.length, results: results.slice(0, limit),
    precision: exact ? 'exact decimal/rational strings; no rounding' : 'IEEE-754', unit: metricSource?.columnOverrides?.[metricField]?.unit || null,
    sourceGrains: [...visited].map((id) => ({ id, grain: datasets.find((d) => d.id === id).rowGrain || null })),
    scope: 'full approved sources; filtered inner joins; unique measure rows', sourceRevisions: [...visited].map((id) => ({ id, revision: qualityRevisionKey(datasets.find((d) => d.id === id)) })) };
};
