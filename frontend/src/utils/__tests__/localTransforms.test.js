import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLocalTransform } from '../localTransforms';
import { rememberStoredDataset } from '../datasetWorkerPayload';

afterEach(() => vi.unstubAllGlobals());
const installWorker = (postError) => {
  let worker;
  vi.stubGlobal('Worker', class {
    constructor() { worker = this; }
    terminate = vi.fn();
    postMessage = vi.fn(() => { if (postError) throw postError; });
  });
  return () => worker;
};
describe('transform scan progress lifecycle', () => {
  it('keeps cleaning snapshots explicit when their row array belongs to an earlier saved revision', async () => {
    const current = installWorker();
    const source = { id: 'fixture', columns: ['value'], rawRows: [{ value: 1 }], revision: 'old-role' };
    rememberStoredDataset(source, 'old-pages');
    const request = runLocalTransform('replay-cleaning-recipe', { rows: source.rawRows, columns: source.columns, recipe: [] });
    const message = current().postMessage.mock.calls[0][0];
    expect(message.payload.rows).toBe(source.rawRows);
    current().onmessage({ data: { id: message.id, result: { rawRows: source.rawRows } } });
    await expect(request).resolves.toEqual({ rawRows: source.rawRows });
  });
  it('ignores other request IDs and retains a progressing request until its final result', async () => {
    const current = installWorker(); const onProgress = vi.fn();
    const request = runLocalTransform('scoped-metrics', {}, { onProgress });
    const id = current().postMessage.mock.calls[0][0].id;
    current().onmessage({ data: { id: 'another-request', progress: { scanned: 99 } } });
    expect(onProgress).not.toHaveBeenCalled();
    current().onmessage({ data: { id, progress: { scanned: 512, total: 1027 } } });
    expect(onProgress).toHaveBeenCalledWith({ scanned: 512, total: 1027 });
    expect(current().terminate).not.toHaveBeenCalled();
    current().onmessage({ data: { id, result: { rows: 1027 } } });
    await expect(request).resolves.toEqual({ rows: 1027 });
    expect(current().terminate).toHaveBeenCalledTimes(1);
  });
  it('releases the worker when a progress handler fails', async () => {
    const current = installWorker();
    const request = runLocalTransform('chart-series', {}, { onProgress: () => { throw new Error('Fixture progress failure.'); } });
    const id = current().postMessage.mock.calls[0][0].id;
    current().onmessage({ data: { id, progress: { scanned: 512 } } });
    await expect(request).rejects.toThrow('Fixture progress failure');
    expect(current().terminate).toHaveBeenCalledTimes(1);
  });
  it('terminates the active scan when cancelled', async () => {
    const current = installWorker(); const controller = new AbortController();
    const request = runLocalTransform('scoped-metrics', {}, { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(current().terminate).toHaveBeenCalledTimes(1);
  });
  it('releases failed transports before rejecting the operation', async () => {
    const current = installWorker(new Error('Fixture transport failed.'));
    await expect(runLocalTransform('scoped-metrics', {})).rejects.toThrow('Fixture transport failed');
    expect(current().terminate).toHaveBeenCalledTimes(1);
  });
});
