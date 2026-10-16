import { withWorkerDatabase, readDatasetHeader, readDatasetRowPage, scanWorkerDatasetRows } from '../datasetWorkerReader';
import { buildEvidenceGraph, computeGraphMetric } from './graph';

const fieldsFor = (edge, side) => edge[`${side}Columns`] || [edge[`${side}Column`]];
export const runSavedGraph = async (operation, payload, { signal, onProgress, scan = scanWorkerDatasetRows } = {}) => {
  if (!['graph', 'graph-calculate'].includes(operation)) throw new Error('Unsupported graph operation.');
  const { datasets, relationships = [], graph, options = {} } = payload;
  const edges = operation === 'graph' ? relationships : (options.edgeIds || []).map((id) => graph.edges.find((edge) => edge.id === id)).filter(Boolean);
  const needed = operation === 'graph' ? null : new Set([options.sourceId, ...edges.flatMap((edge) => [edge.leftDatasetId, edge.rightDatasetId])]);
  let retainedRows = 0; let bytes = 0;
  const reserve = (row) => {
    bytes += JSON.stringify(row).length * 2;
    if (++retainedRows > 250_000 || bytes > 32 * 1024 * 1024) throw new Error('The reviewed graph exceeds its retained-data memory limit. Narrow the sources or scope; no sampled calculation was produced.');
  };
  const sources = [];
  for (const source of datasets) {
    if (needed && !needed.has(source.id)) continue;
    if (source?.kind !== 'local-dataset-reference') { sources.push(source); continue; }
    if (source.field) throw new Error('A graph requires dataset references.');
    const fields = new Set(edges.flatMap((edge) => ['left', 'right'].flatMap((side) => edge[`${side}DatasetId`] === source.id ? fieldsFor(edge, side) : [])));
    if (operation === 'graph') {
      const sampled = await withWorkerDatabase(async (database) => {
        const expected = { expectedRevision: source.revision, expectedStorageRevision: source.storageRevision, signal };
        const header = await readDatasetHeader(database, source.id, expected); const entityRows = [];
        for (let index = 0; index < Math.min(4, header.rowStorage.streams.rawRows.chunks); index++) {
          const page = await readDatasetRowPage(database, source.id, index, expected);
          for (const row of page.rows.slice(0, 2000 - entityRows.length)) {
            const projected = Object.fromEntries([...fields].map((field) => [field, row?.[field]])); reserve(projected); entityRows.push(projected);
          }
        }
        if (signal?.aborted) throw new DOMException('Graph preparation cancelled.', 'AbortError');
        await readDatasetHeader(database, source.id, expected);
        return { ...header, entityRows };
      });
      sources.push(sampled);
    } else {
      for (const reference of [options.metric, options.dimension]) {
        if (reference?.startsWith(`${source.id}::`)) fields.add(reference.slice(source.id.length + 2));
      }
      Object.keys(options.filtersByDataset?.[source.id] || {}).forEach((field) => fields.add(field));
      const rawRows = []; let header;
      await scan(source.id, (rows, info) => {
        header ||= info.header;
        for (const row of rows) { const projected = Object.fromEntries([...fields].map((field) => [field, row?.[field]])); reserve(projected); rawRows.push(projected); }
      }, { signal, onProgress: (progress) => onProgress?.({ ...progress, datasetId: source.id }), expectedRevision: source.revision, expectedStorageRevision: source.storageRevision });
      sources.push({ ...header, rawRows });
    }
  }
  // Sources read at different times must all remain current before publication.
  const result = operation === 'graph' ? buildEvidenceGraph(sources, relationships) : computeGraphMetric(sources, graph, options);
  const references = datasets.filter((source) => source.kind === 'local-dataset-reference' && (!needed || needed.has(source.id)));
  if (references.length) await withWorkerDatabase(async (database) => {
    for (const source of references) {
      await readDatasetHeader(database, source.id, { expectedRevision: source.revision, expectedStorageRevision: source.storageRevision });
    }
  });
  if (signal?.aborted) throw new DOMException('Graph preparation cancelled.', 'AbortError');
  return result;
};
