import { loadAssistantArtifact, saveAssistantArtifact, saveAssistantArtifacts } from '../localDatasetStore';
import { qualityRevisionKey } from '../qualityReview';
import { assertCurrentIndex, assertReviewed, citationEvidence, hasExactRowClause } from './evidence';
import { runLocalAgent } from './agent';
import { requireLocalLLM } from './releasePolicy';
import { embedLocalTexts, generateLocalAction, getLocalAIState } from './runtime';
import { semanticKey, SEMANTIC_VERSION, mergeSemanticHits } from './semantic';
import { encodeDatasetPayload } from '../datasetWorkerPayload';
import { entityKey, ENTITY_VERSION } from './entities';
import { withAssistantDeadline } from './deadline';

const requestAnalysisPage = (worker, operation, payload, { signal, onProgress, preserveWorker = false } = {}) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Cancelled.', 'AbortError')); return; }
  let finished = false; let timer;
  const clean = (failed = true) => { finished = true; clearTimeout(timer); if (failed || !preserveWorker) worker.terminate(); signal?.removeEventListener('abort', abort); };
  const resetDeadline = () => { clearTimeout(timer); timer = setTimeout(() => { clean(); reject(new Error('Evidence processing stopped reporting progress. Retry a smaller scope or use deterministic calculations.')); }, 60_000); };
  const abort = () => { clean(); reject(new DOMException('Analysis cancelled.', 'AbortError')); };
  signal?.addEventListener('abort', abort, { once: true });
  worker.onmessage = ({ data }) => {
    if (finished) return;
    if (data.progress) {
      try { resetDeadline(); onProgress?.(data.progress); } catch (error) { clean(); reject(error); }
      return;
    }
    clean(Boolean(data.error)); if (data.error) reject(new Error(data.error)); else resolve(data.result);
  };
  worker.onerror = worker.onmessageerror = () => { if (!finished) { clean(); reject(new Error('The local evidence worker stopped or returned an unreadable response.')); } };
  resetDeadline();
  try { worker.postMessage({ operation, payload: encodeDatasetPayload(payload) }); }
  catch (error) { clean(); reject(error); }
});
export const runAIAnalysis = async (operation, payload, options = {}) => {
  if (options.signal?.aborted) throw new DOMException('Cancelled.', 'AbortError');
  if (typeof Worker === 'undefined') throw new Error('Background evidence analysis is unavailable.');
  const worker = new Worker(new URL('./analysis.worker.js', import.meta.url), { type: 'module' });
  return requestAnalysisPage(worker, operation, payload, { ...options, preserveWorker: false });
};
const normalizedScope = (filters) => JSON.stringify(Object.entries(filters || {}).sort(([a], [b]) => a.localeCompare(b)));
const indexes = new Map();
export const clearMemoryEvidence = () => indexes.clear();
export const getEvidenceIndex = async (dataset, filters, signal) => {
  assertReviewed(dataset, { allowSavedMetadata: true });
  const id = `evidence:${dataset.id}:${normalizedScope(filters)}`;
  let index = indexes.get(id);
  if (!index) { try { index = (await loadAssistantArtifact(id))?.index; } catch { /* Search remains usable when persistence is unavailable. */ } }
  try { assertCurrentIndex(index, dataset, filters); }
  catch { index = await runAIAnalysis('index', { dataset, filters }, { signal }); }
  if (getLocalAIState().embeddings && !index.semanticComplete) {
    // Schema/summary + first row evidence, bounded separately from lexical coverage.
    const metadata = index.records.filter((record) => record.kind !== 'row');
    const rowRecords = index.records.filter((record) => record.kind === 'row');
    const records = [...metadata.slice(0, 16), ...Array.from({ length: Math.min(48, rowRecords.length) }, (_, i) => rowRecords[Math.floor(i * rowRecords.length / Math.min(48, rowRecords.length))])];
    for (let start = 0; start < records.length; start += 8) {
      const batch = records.slice(start, start + 8);
      const vectors = await embedLocalTexts(batch.map((r) => r.text.slice(0, 2_000)), { signal });
      batch.forEach((record, offset) => { record.vector = vectors[offset]; });
    }
    index.semanticComplete = true;
  }
  if (signal?.aborted) throw new DOMException('Cancelled.', 'AbortError');
  assertCurrentIndex(index, dataset, filters);
  indexes.set(id, index); if (indexes.size > 2) indexes.delete(indexes.keys().next().value);
  // Persist only a current source-bound artifact. Quota failure does not discard data.
  await saveAssistantArtifact({ id, datasetIds: [dataset.id], revision: qualityRevisionKey(dataset), index }).catch(() => {});
  return index;
};
export const searchLocalEvidence = async (dataset, query, { filters = {}, limit = 6, signal } = {}) => {
  const index = await getEvidenceIndex(dataset, filters, signal);
  const exact = hasExactRowClause(query);
  const queryVector = !exact && getLocalAIState().embeddings ? (await embedLocalTexts([String(query).slice(0, 2_000)], { signal }))[0] : null;
  const result = await runAIAnalysis('retrieve-source', { dataset, index, query, options: { limit, queryVector } }, { signal });
  if (queryVector) {
    const key = semanticKey(dataset, filters); const manifest = await loadAssistantArtifact(`${key}:manifest`).catch(() => null);
    if (manifest?.version === SEMANTIC_VERSION && manifest.revision === qualityRevisionKey(dataset)) {
      const semantic = await runAIAnalysis('semantic-retrieve', { key, revision: manifest.revision, query, options: { limit, queryVector } }, { signal });
      result.hits = mergeSemanticHits(result.hits, semantic.hits, limit);
      result.semanticRecords += manifest.records;
      result.coverage.semantic = { complete: manifest.complete, completedSourcePositions: manifest.completedRows, totalSourceRows: dataset.rawRows?.length ?? dataset.rowCount ?? dataset.rowStorage?.streams?.rawRows?.length, records: manifest.records };
    }
  }
  return { ...result, hits: result.hits.map(citationEvidence) };
};

export const buildCompleteEntityIndex = async (dataset, { signal, onProgress = () => {} } = {}) => {
  assertReviewed(dataset, { allowSavedMetadata: true });
  if (signal?.aborted) throw new DOMException('Cancelled.', 'AbortError');
  if (typeof Worker === 'undefined') throw new Error('Background evidence analysis is unavailable.');
  const key = entityKey(dataset); const revision = qualityRevisionKey(dataset); const id = `${key}:manifest`;
  let manifest = await loadAssistantArtifact(id); const previous = manifest;
  if (manifest?.revision !== revision || manifest.version !== ENTITY_VERSION) manifest = { id, datasetIds: [dataset.id], revision, version: ENTITY_VERSION,
    cursor: { row: 0, column: 0 }, records: 0, pages: 0, completedRows: 0, complete: false };
  const totalRows = dataset.rawRows?.length ?? dataset.rowCount ?? dataset.rowStorage?.streams?.rawRows?.length;
  if (!await saveAssistantArtifacts([manifest], { expectedArtifact: { id, value: previous } })) throw new Error('Save/reopen this source before indexing; another tab may have changed it.');
  if (manifest.complete) { onProgress({ ...manifest, totalRows }); return manifest; }
  const worker = new Worker(new URL('./analysis.worker.js', import.meta.url), { type: 'module' });
  try {
  while (!manifest.complete) {
    if (signal?.aborted) throw new DOMException('Indexing stopped; completed pages retained.', 'AbortError');
    const storage = await navigator.storage?.estimate?.();
    if (storage?.quota && storage.usage + 1_000_000 > storage.quota * 0.95) throw new Error('Storage is nearly full. Free space before resuming.');
    const page = await requestAnalysisPage(worker, 'entity-next', { dataset, cursor: manifest.cursor }, { signal, preserveWorker: true });
    const chunk = { id: `${key}:chunk:${manifest.pages}`, datasetIds: [dataset.id], revision, records: page.records };
    const next = { ...manifest, cursor: page.cursor, completedRows: page.completedRows, pages: manifest.pages + 1,
      records: manifest.records + page.records.length, complete: page.complete, fields: page.fields, coverage: page.coverage || manifest.coverage };
    if (signal?.aborted) throw new DOMException('Indexing stopped; completed pages retained.', 'AbortError');
    if (!await saveAssistantArtifacts([chunk, next], { expectedArtifact: { id, value: manifest } })) throw new Error('Source or indexing progress changed. Reopen the source before resuming.');
    manifest = next; onProgress({ ...manifest, totalRows });
  }
  onProgress({ ...manifest, totalRows }); return manifest;
  } finally { worker.terminate(); }
};

export const buildCompleteSemanticIndex = async (dataset, filters = {}, { signal, onProgress = () => {} } = {}) => {
  assertReviewed(dataset);
  if (signal?.aborted) throw new DOMException('Cancelled.', 'AbortError');
  if (typeof Worker === 'undefined') throw new Error('Background evidence analysis is unavailable.');
  if (!getLocalAIState().embeddings) throw new Error('Load the semantic search model first.');
  const key = semanticKey(dataset, filters); const revision = qualityRevisionKey(dataset);
  let manifest = await loadAssistantArtifact(`${key}:manifest`);
  const previousManifest = manifest;
  if (manifest?.revision !== revision || manifest.version !== SEMANTIC_VERSION) manifest = { id: `${key}:manifest`, datasetIds: [dataset.id], revision, version: SEMANTIC_VERSION,
    cursor: { row: 0, column: 0, offset: 0 }, records: 0, pages: 0, completedRows: 0, complete: false };
  onProgress({ completedRows: manifest.completedRows, totalRows: dataset.rawRows.length, records: manifest.records, complete: manifest.complete });
  if (manifest.complete) return manifest;
  if (!await saveAssistantArtifacts([manifest], { expectedArtifact: { id: manifest.id, value: previousManifest } })) throw new Error('Save this source first. If another tab is indexing it, stop that job before resuming here.');
  const worker = new Worker(new URL('./analysis.worker.js', import.meta.url), { type: 'module' });
  const requestPage = (operation, payload) => requestAnalysisPage(worker, operation, payload, { signal, preserveWorker: true });
  try {
    await requestPage('semantic-init', { dataset });
    while (!manifest.complete) {
      const status = await navigator.storage?.estimate?.();
      if (status?.quota && status.usage + 1_000_000 > status.quota * 0.95) throw new Error('Storage is nearly full. Completed index pages are retained; free space before resuming.');
      const page = await requestPage('semantic-next', { cursor: manifest.cursor, filters, limit: 48 });
      for (let offset = 0; offset < page.records.length; offset += 8) {
        const batch = page.records.slice(offset, offset + 8); const vectors = await embedLocalTexts(batch.map((record) => record.text), { signal });
        batch.forEach((record, i) => { record.vector = vectors[i]; });
      }
      if (signal?.aborted) throw new DOMException('Cancelled.', 'AbortError');
      const chunk = { id: `${key}:chunk:${manifest.pages}`, datasetIds: [dataset.id], revision, records: page.records };
      const nextManifest = { ...manifest, cursor: page.cursor, pages: manifest.pages + 1, records: manifest.records + page.records.length, completedRows: page.completedRows, complete: page.complete };
      if (!await saveAssistantArtifacts([chunk, nextManifest], { expectedArtifact: { id: manifest.id, value: manifest } })) throw new Error('Source or indexing progress changed in another tab. Completed pages are retained; reopen or resume the current source.');
      manifest = nextManifest;
      onProgress({ completedRows: manifest.completedRows, totalRows: dataset.rawRows.length, records: manifest.records, complete: manifest.complete });
    }
    return manifest;
  } finally { worker.terminate(); }
};
const askWithLocalAIScoped = async (query, dataset, { datasets = [dataset], relationships = [], layout, scopeFilters = {}, history = [], signal, onStep, mode = 'search' } = {}) => {
  if (mode === 'search') {
    const result = await searchLocalEvidence(dataset, query, { filters: scopeFilters, signal });
    return { intent: 'LOCAL_RETRIEVAL', directAnswer: result.invalidExactCriteria ? 'The quoted exact lookup does not name an available field in this reviewed source. Check the field name.'
      : result.hits.length ? 'Matching local evidence is listed below. Use calculation tools for full-dataset numerical questions.' : 'No matching evidence found in the indexed scope.',
      keyInsights: [], citations: result.hits, coverage: result.coverage, semanticRecords: result.semanticRecords };
  }
  requireLocalLLM();
  if (!getLocalAIState().llm) throw new Error('Load the browser LLM before choosing agent mode.');
  const approved = datasets.filter((source) => { try { assertReviewed(source, { allowSavedMetadata: true }); return !source.isFolderOverview; } catch { return false; } });
  if (!approved.some((source) => source.id === dataset.id)) approved.push(dataset);
  const graph = await runAIAnalysis('graph', { datasets: approved, relationships }, { signal });
  const initial = mode === 'rag' ? await searchLocalEvidence(dataset, query, { filters: scopeFilters, signal }) : null;
  const answer = await runLocalAgent({ query, datasets: approved, selectedId: dataset.id, graph, layout, scopeFilters, history, signal, onStep,
    initialEvidence: initial?.hits || [],
    generate: generateLocalAction,
    retrieve: (source, text, options) => searchLocalEvidence(source, text, { ...options, signal }),
    graphRetrieve: async (options) => {
      const neighborhood = await runAIAnalysis('neighborhood', { graph, options }, { signal });
      const source = approved.find((item) => item.id === options.sourceId); const key = entityKey(source);
      const manifest = await loadAssistantArtifact(`${key}:manifest`);
      if (manifest?.revision === qualityRevisionKey(source) && manifest.version === ENTITY_VERSION && !Object.keys(scopeFilters).length) {
        const entities = await runAIAnalysis('semantic-retrieve', { key, revision: manifest.revision, query: options.query, options: { limit: 6 } }, { signal });
        return { ...neighborhood, entityHits: entities.hits, entityCoverage: { complete: manifest.complete, completedRows: manifest.completedRows, records: manifest.records, fields: manifest.fields } };
      }
      return { ...neighborhood, entityCoverage: { complete: false, reason: 'No current entity index, or dashboard filters require row-scoped retrieval.' } };
    },
    calculate: (source, options) => runAIAnalysis('calculate', { dataset: source, options }, { signal }),
    graphCalculate: (options) => runAIAnalysis('graph-calculate', { datasets: approved, graph, options }, { signal }) });
  return { ...answer, graphCoverage: graph.coverage, ...(initial ? { coverage: initial.coverage, semanticRecords: initial.semanticRecords } : {}) };
};

export const askWithLocalAI = (query, dataset, options = {}) => withAssistantDeadline(async (signal) => {
  const { prepareAssistantMessage } = await import('../assistantConversation');
  const message = prepareAssistantMessage(query);
  if (signal.aborted) throw new DOMException('Cancelled.', 'AbortError');
  if (message.reply) return message.reply;
  return askWithLocalAIScoped(message.query, dataset, {
  ...options, signal, onStep: (step) => { if (!signal.aborted) options.onStep?.(step); }
});
}, options.signal);
