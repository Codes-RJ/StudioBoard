import { encodeDatasetPayload } from './datasetWorkerPayload';
import { assertTransformMemoryPolicy } from './transformMemoryPolicy';

/** Execute CPU-heavy local work in a module worker and always clean it up. */
export const runLocalTransform = (operation, payload, { signal, onProgress } = {}) => new Promise((resolve, reject) => {
  if (typeof Worker === 'undefined') {
    reject(new Error('This browser does not support background data processing.'));
    return;
  }
  const worker = new Worker(new URL('./localTransforms.worker.js', import.meta.url), { type: 'module' });
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const terminate = () => {
    signal?.removeEventListener('abort', abort);
    worker.terminate();
  };
  const abort = () => {
    terminate();
    reject(new DOMException('Background processing was cancelled.', 'AbortError'));
  };
  if (signal?.aborted) {
    abort();
    return;
  }
  signal?.addEventListener('abort', abort, { once: true });
  worker.onmessage = ({ data }) => {
    if (data.id !== id) return;
    if (data.progress) {
      try { onProgress?.(data.progress); } catch (error) { terminate(); reject(error); }
      return;
    }
    terminate();
    if (data.error) reject(new Error(data.error));
    else resolve(data.result);
  };
  worker.onerror = () => {
    terminate();
    reject(new Error('The background data worker could not start.'));
  };
  try {
    const encoded = encodeDatasetPayload(payload);
    // Editing uses the displayed bounded snapshot. An unchanged array can be
    // shared by successive role revisions while their background save replaces
    // old storage pages; it must not become an obsolete saved-row reference.
    if (['clean', 'clean-preview', 'replay-cleaning-recipe'].includes(operation) && Array.isArray(payload.rows)) encoded.rows = payload.rows;
    assertTransformMemoryPolicy(operation, encoded);
    worker.postMessage({ id, operation, payload: encoded });
  }
  catch (error) { terminate(); reject(error); }
});
