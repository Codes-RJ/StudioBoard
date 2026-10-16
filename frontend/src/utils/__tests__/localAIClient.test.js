import { afterEach, describe, expect, it, vi } from 'vitest';
const artifacts = vi.hoisted(() => new Map());
vi.mock('../localDatasetStore', () => ({
  loadAssistantArtifact: vi.fn(async (id) => artifacts.get(id)),
  saveAssistantArtifact: vi.fn(),
  saveAssistantArtifacts: vi.fn(async (records) => { records.forEach((record) => artifacts.set(record.id, structuredClone(record))); return true; }),
}));
vi.mock('../localAI/runtime', () => ({ embedLocalTexts: vi.fn(), generateLocalAction: vi.fn(), getLocalAIState: () => ({ embeddings: true }) }));
import { askWithLocalAI, buildCompleteEntityIndex, buildCompleteSemanticIndex, runAIAnalysis } from '../localAI/client';
import { approveQualityRevision } from '../qualityReview';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); artifacts.clear(); });
const installWorker = (postError, respond) => {
  let worker;
  vi.stubGlobal('Worker', class {
    constructor() { worker = this; }
    terminate = vi.fn();
    postMessage = vi.fn((message) => { if (postError) throw postError; respond?.(this, message); });
  });
  return () => worker;
};

describe('analysis worker progress and cancellation', () => {
  it('handles greetings in every assistant mode without loading a model or starting a worker', async () => {
    const worker = vi.fn(); vi.stubGlobal('Worker', worker);
    for (const mode of ['search', 'rag', 'agent']) {
      await expect(askWithLocalAI('Hello', null, { mode })).resolves.toMatchObject({ intent: 'CONVERSATION' });
    }
    expect(worker).not.toHaveBeenCalled();
  });
  it('keeps a progressing request alive until its final calculation result', async () => {
    const current = installWorker(); const onProgress = vi.fn();
    const request = runAIAnalysis('calculate', { dataset: {} }, { onProgress });
    current().onmessage({ data: { progress: { scanned: 512, total: 1027 } } });
    expect(onProgress).toHaveBeenCalledWith({ scanned: 512, total: 1027 });
    expect(current().terminate).not.toHaveBeenCalled();
    current().onmessage({ data: { result: { sourceRows: 1027 } } });
    await expect(request).resolves.toEqual({ sourceRows: 1027 });
    expect(current().terminate).toHaveBeenCalledTimes(1);
  });
  it('releases a worker if the progress callback fails', async () => {
    const current = installWorker();
    const request = runAIAnalysis('calculate', {}, { onProgress: () => { throw new Error('Progress handler failed.'); } });
    current().onmessage({ data: { progress: { scanned: 512 } } });
    await expect(request).rejects.toThrow('Progress handler failed');
    expect(current().terminate).toHaveBeenCalledTimes(1);
  });
  it('terminates active scans on abort and does not start an already cancelled request', async () => {
    const current = installWorker(); const controller = new AbortController();
    const request = runAIAnalysis('calculate', {}, { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(current().terminate).toHaveBeenCalledTimes(1);
    await expect(runAIAnalysis('calculate', {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(current().terminate).toHaveBeenCalledTimes(1);
  });
  it('releases failed transports before rejecting the request', async () => {
    const current = installWorker(new Error('Fixture transport failed.'));
    await expect(runAIAnalysis('calculate', {})).rejects.toThrow('Fixture transport failed');
    expect(current().terminate).toHaveBeenCalledTimes(1);
  });
  it('unloads a silent worker while progress keeps legitimate long scans alive', async () => {
    vi.useFakeTimers(); const current = installWorker();
    const request = runAIAnalysis('calculate', {}); const rejected = expect(request).rejects.toThrow('stopped reporting progress');
    await vi.advanceTimersByTimeAsync(50_000); current().onmessage({ data: { progress: { scanned: 512 } } });
    await vi.advanceTimersByTimeAsync(50_000); expect(current().terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000); await rejected; expect(current().terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('releases unreadable responses and ignores callbacks after cancellation', async () => {
    const current = installWorker(); const onProgress = vi.fn(); const controller = new AbortController();
    const request = runAIAnalysis('calculate', {}, { signal: controller.signal, onProgress }); const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected; current().onmessage({ data: { progress: { scanned: 512 } } });
    expect(onProgress).not.toHaveBeenCalled();
    const broken = runAIAnalysis('calculate', {}); const failed = expect(broken).rejects.toThrow('unreadable response');
    current().onmessageerror(); await failed; expect(current().terminate).toHaveBeenCalledOnce();
  });
  it.each([['entity', buildCompleteEntityIndex], ['semantic', (source) => buildCompleteSemanticIndex(source)]])('%s indexing retains completed pages after a silent worker and resumes from its saved cursor', async (kind, build) => {
    vi.useFakeTimers();
    const source = approveQualityRevision({ id: 'fixture', name: 'fixture', revision: 'r1', isLocal: true,
      rawRows: [{ ID: '001' }, { ID: '002' }], columns: [{ name: 'ID', type: 'string' }] });
    let pages = 0;
    const first = installWorker(undefined, (worker, message) => {
      if (message.operation === 'semantic-init') queueMicrotask(() => worker.onmessage({ data: { result: { ready: true } } }));
      else if (++pages === 1) queueMicrotask(() => worker.onmessage({ data: { result: { records: [], cursor: { row: 1, column: 0, offset: 0 }, completedRows: 1, complete: false } } }));
    });
    const request = build(source); const rejected = expect(request).rejects.toThrow('stopped reporting progress');
    await vi.advanceTimersByTimeAsync(0); expect(pages).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000); await rejected;
    expect(first().terminate).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    const manifest = [...artifacts.values()].find((record) => record.id.endsWith(':manifest'));
    expect(manifest).toMatchObject({ completedRows: 1, complete: false, pages: 1 });
    const resumed = installWorker(undefined, (worker, message) => {
      if (message.operation === 'semantic-init') queueMicrotask(() => worker.onmessage({ data: { result: { ready: true } } }));
      else {
        expect(message.payload.cursor.row).toBe(1);
        queueMicrotask(() => worker.onmessage({ data: { result: { records: [], cursor: { row: 2, column: 0, offset: 0 }, completedRows: 2, complete: true } } }));
      }
    });
    await expect(build(source)).resolves.toMatchObject({ completedRows: 2, complete: true, pages: 2 });
    expect(resumed().terminate).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
