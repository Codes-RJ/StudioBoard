import { requireLocalLLM } from './releasePolicy';
let worker; let sequence = 0; let epoch = 0; const pending = new Map();
const subscribers = new Set();
let state = { embeddings: false, llm: false, loading: false, progress: '', error: '' };
const publish = (patch) => { state = { ...state, ...patch }; subscribers.forEach((listener) => listener(state)); };
export const getLocalAIState = () => state;
export const subscribeLocalAI = (listener) => { subscribers.add(listener); listener(state); return () => subscribers.delete(listener); };
const releaseWorker = (error) => {
  epoch += 1;
  worker?.terminate(); worker = null;
  for (const { reject, clean } of pending.values()) { clean(); reject(error); }
  pending.clear(); publish({ embeddings: false, llm: false, loading: false, progress: '' });
};
export const stopLocalModels = () => releaseWorker(new DOMException('Local model processing cancelled.', 'AbortError'));
const deadlines = { 'load-embeddings': 180_000, 'load-llm': 180_000, embed: 60_000, generate: 60_000, 'clear-cache': 15_000 };
const request = (operation, payload, { signal, onProgress } = {}) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Cancelled.', 'AbortError')); return; }
  if (typeof Worker === 'undefined') { reject(new Error('Background model processing is unavailable.')); return; }
  if (pending.size) { reject(new Error('Another model operation is running. Wait for it or stop the models.')); return; }
  if (!worker) {
    worker = new Worker(new URL('./runtime.worker.js', import.meta.url), { type: 'module' });
    const activeWorker = worker;
    worker.onmessage = ({ data }) => {
      if (worker !== activeWorker) return;
      const task = pending.get(data.id); if (!task) return;
      if (data.progress) {
        try { task.onProgress?.(data.progress); } catch (error) { releaseWorker(error); publish({ error: error.message }); }
        return;
      }
      pending.delete(data.id); task.clean();
      if (data.error) {
        if (task.operation === 'generate') { releaseWorker(new Error(data.error)); publish({ error: data.error }); }
        task.reject(new Error(data.error));
      } else task.resolve(data.result);
    };
    worker.onerror = worker.onmessageerror = () => {
      if (worker !== activeWorker) return;
      const error = new Error('The model worker stopped or returned an unreadable response. Reload the model and try again.');
      releaseWorker(error); publish({ error: error.message });
    };
  }
  const id = `model_${sequence++}`;
  const abort = () => stopLocalModels();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    const error = new Error('Local model processing timed out. The worker was unloaded; reload a model or use deterministic calculations.');
    releaseWorker(error); publish({ error: error.message });
  }, deadlines[operation] || 60_000);
  pending.set(id, { resolve, reject, operation, onProgress, clean: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); } });
  try { worker.postMessage({ id, operation, payload }); }
  catch (error) { releaseWorker(error); publish({ error: error.message }); }
});
export const loadLocalModel = async (kind, { signal } = {}) => {
  if (kind === 'llm') requireLocalLLM();
  if (!['embeddings', 'llm'].includes(kind) || state.loading) throw new Error('Choose one model download at a time.');
  publish({ loading: true, error: '', progress: 'Starting model download…' });
  const loadingEpoch = epoch;
  try {
    await request(`load-${kind}`, {}, { signal, onProgress: (event) => publish({ progress: event.text || `${event.status || 'Loading'} ${event.file || ''} ${event.progress == null ? '' : `${Math.round(event.progress)}%`}` }) });
    if (epoch !== loadingEpoch || signal?.aborted) throw new DOMException('Local model processing cancelled.', 'AbortError');
    publish({ [kind]: true, loading: false, progress: 'Model ready in this browser.' });
  } catch (error) { publish({ loading: false, error: error.name === 'AbortError' ? '' : error.message }); throw error; }
};
export const embedLocalTexts = (texts, options) => request('embed', { texts }, options);
export const generateLocalAction = async (messages, { schemaContext, ...options } = {}) => {
  requireLocalLLM();
  return request('generate', { messages, schemaContext }, options);
};
export const clearLocalModelCache = async () => { stopLocalModels(); await request('clear-cache', {}); stopLocalModels(); };
