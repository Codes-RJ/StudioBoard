import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let runtime; let instances;
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.stubEnv('VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM', 'true'); instances = [];
  vi.stubGlobal('Worker', class {
    constructor() { instances.push(this); }
    terminate = vi.fn(); postMessage = vi.fn();
    reply(result) { this.onmessage({ data: { id: this.postMessage.mock.calls.at(-1)[0].id, result } }); }
  });
  runtime = await import('../localAI/runtime');
});
afterEach(() => { runtime.stopLocalModels(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('terminates a hung request on a fixed deadline and permits a fresh model load', async () => {
  const hung = runtime.embedLocalTexts(['fixture']); const rejected = expect(hung).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(60_000); await rejected;
  expect(instances[0].terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  const reload = runtime.loadLocalModel('embeddings'); instances[1].reply({ ready: true }); await reload;
  expect(runtime.getLocalAIState().embeddings).toBe(true);
});
it('cleans failed message transports and rejects overlapping model operations', async () => {
  const active = runtime.embedLocalTexts(['fixture']);
  await expect(runtime.embedLocalTexts(['other'])).rejects.toThrow('Another model operation');
  instances[0].reply([[1]]); await active;
  instances[0].postMessage.mockImplementation(() => { throw new Error('Fixture DataClone failure'); });
  await expect(runtime.embedLocalTexts(['fixture'])).rejects.toThrow('DataClone');
  expect(instances[0].terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it('reports worker/device failures as errors, and ignores events from retired workers', async () => {
  const active = runtime.generateLocalAction([]); const rejected = expect(active).rejects.toThrow('worker stopped');
  instances[0].onerror(); await rejected;
  const next = runtime.embedLocalTexts(['fixture']); instances[0].onerror();
  expect(instances[1].terminate).not.toHaveBeenCalled(); instances[1].reply([[1]]); await next;
  expect(vi.getTimerCount()).toBe(0);
});
it('cancels pending model work and cannot mark a stopped load ready', async () => {
  const load = runtime.loadLocalModel('embeddings'); instances[0].reply({ ready: true }); runtime.stopLocalModels();
  await expect(load).rejects.toMatchObject({ name: 'AbortError' }); expect(runtime.getLocalAIState().embeddings).toBe(false);
  const controller = new AbortController(); const active = runtime.embedLocalTexts(['fixture'], { signal: controller.signal });
  const rejected = expect(active).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
it('unloads the worker when generation returns a context or device error', async () => {
  const active = runtime.generateLocalAction([]); const rejected = expect(active).rejects.toThrow('context window');
  const current = instances[0]; current.onmessage({ data: { id: current.postMessage.mock.calls[0][0].id, error: 'Fixture context window exceeded' } });
  await rejected; expect(current.terminate).toHaveBeenCalledOnce(); expect(runtime.getLocalAIState().llm).toBe(false);
});
