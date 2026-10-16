export const ASSISTANT_DEADLINE_MS = 75_000;

// Bound the whole question, including retrieval and every planning turn. The
// per-worker deadlines alone would allow several minutes of repeated work.
export const withAssistantDeadline = (task, signal) => {
  if (signal?.aborted) return Promise.reject(new DOMException('Analysis cancelled.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const controller = new AbortController(); let settled = false; let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); callback(value);
    };
    const cancel = () => { controller.abort(); finish(reject, new DOMException('Analysis cancelled.', 'AbortError')); };
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      finish(reject, new Error('The assistant reached its 75-second question limit. Its workers were cancelled. Narrow the question or use deterministic calculations.'));
    }, ASSISTANT_DEADLINE_MS);
    // Observe late resolution/rejection even after cancellation; it cannot
    // publish an answer or become an unhandled rejection.
    Promise.resolve().then(() => { if (!controller.signal.aborted) return task(controller.signal); })
      .then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
};
