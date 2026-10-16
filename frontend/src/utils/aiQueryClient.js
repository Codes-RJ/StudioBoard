import { getDatasetRevision } from './aiDatasetIdentity';
import { encodeDatasetPayload } from './datasetWorkerPayload';
import { assertTransformMemoryPolicy } from './transformMemoryPolicy';
import { prepareAssistantMessage } from './assistantConversation';
import { ASSISTANT_DEADLINE_MS } from './localAI/deadline';

let worker = null;
let initializedRevision = '';
let initialization = null;
let requestSequence = 0;
const callbacks = new Map();
const pendingQueries = new Map();

const disposeWorker = (reason = 'Assistant processing was cancelled.', aborted = true) => {
  worker?.terminate();
  worker = null;
  initializedRevision = '';
  initialization = null;
  for (const callback of callbacks.values()) {
    callback.reject(aborted ? new DOMException(reason, 'AbortError') : new Error(reason));
  }
  callbacks.clear();
  pendingQueries.clear();
};

const ensureWorker = () => {
  if (worker || typeof Worker === 'undefined') return worker;
  worker = new Worker(new URL('./aiAssistant.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const callback = callbacks.get(data.id);
    if (!callback) return;
    callbacks.delete(data.id);
    if (data.error) callback.reject(new Error(data.error));
    else callback.resolve(data.result);
  };
  worker.onerror = () => disposeWorker('The assistant worker could not start.', false);
  worker.onmessageerror = () => disposeWorker('The assistant returned an unreadable response. Please try again.', false);
  return worker;
};

const post = (operation, payload) => new Promise((resolve, reject) => {
  const instance = ensureWorker();
  if (!instance) {
    reject(new Error('Background processing is unavailable.'));
    return;
  }
  const id = `assistant_${Date.now()}_${requestSequence++}`;
  callbacks.set(id, { resolve, reject });
  try { const encoded = encodeDatasetPayload(payload); assertTransformMemoryPolicy('quality', encoded); instance.postMessage({ id, operation, ...encoded }); }
  catch (error) { callbacks.delete(id); reject(error); }
});

const initialize = async (dataset) => {
  const revision = getDatasetRevision(dataset);
  if (initializedRevision === revision) return revision;
  if (initialization?.revision === revision) return initialization.promise;
  if (initializedRevision || initialization) disposeWorker('The selected dataset changed.');
  const owner = { revision, promise: null };
  const promise = post('initialize', { dataset }).then(() => {
    if (initialization !== owner) throw new DOMException('The selected dataset changed.', 'AbortError');
    initializedRevision = revision;
    initialization = null;
    return revision;
  }).catch((error) => {
    if (initialization === owner) initialization = null;
    throw error;
  });
  owner.promise = promise;
  initialization = owner;
  return promise;
};

const withCancellation = (promise, signal) => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Assistant processing was cancelled.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => {
      disposeWorker();
      reject(new DOMException('Assistant processing was cancelled.', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
};

/** Ask a question without blocking React. Equal in-flight questions share work. */
export const askDatasetQuestion = async (query, dataset, { signal, scopeFilters = {}, context = null } = {}) => {
  if (signal?.aborted) throw new DOMException('Assistant processing was cancelled.', 'AbortError');
  const message = prepareAssistantMessage(query);
  if (message.reply) return message.reply;
  query = message.query;
  if (typeof Worker === 'undefined') {
    assertTransformMemoryPolicy('quality', { dataset });
    if (signal?.aborted) throw new DOMException('Assistant processing was cancelled.', 'AbortError');
    const { analyzeQueryWithData } = await import('./aiQueryEngine');
    if (signal?.aborted) throw new DOMException('Assistant processing was cancelled.', 'AbortError');
    return analyzeQueryWithData(query, dataset, null, { scopeFilters, context });
  }
  const revision = getDatasetRevision(dataset);
  const normalizedQuery = String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const normalizedScope = Object.fromEntries(Object.entries(scopeFilters).sort(([left], [right]) => left.localeCompare(right)));
  const normalizedContext = context ? {
    intent: context.intent,
    metrics: context.metrics || [],
    dimensions: context.dimensions || [],
    aggregation: context.aggregation,
    order: context.order,
    limit: context.limit
  } : null;
  const key = `${revision}::${normalizedQuery}::${JSON.stringify(normalizedScope)}::${JSON.stringify(normalizedContext)}`;
  let pending = pendingQueries.get(key);
  if (!pending) {
    // One deadline covers initialization and calculation together. Disposing
    // rejects the active request and lets the next question start a new worker.
    const timer = setTimeout(() => {
      if (pendingQueries.get(key) === pending) {
        disposeWorker('The assistant reached its 75-second question limit. Please narrow the question and try again.', false);
      }
    }, ASSISTANT_DEADLINE_MS);
    pending = initialize(dataset).then(() => post('query', {
      query, revision, scopeFilters: normalizedScope, context: normalizedContext
    })).finally(() => {
      clearTimeout(timer);
      if (pendingQueries.get(key) === pending) pendingQueries.delete(key);
    });
    pendingQueries.set(key, pending);
  }
  return withCancellation(pending, signal);
};

export const cancelAssistantWork = () => disposeWorker();
