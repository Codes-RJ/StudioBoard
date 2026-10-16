import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createWorkspaceStream, restoreWorkspaceStream } from '../workspaceBackupStream';
import { saveLocalDataset, saveLocalSourceFiles, loadLocalDataset, loadLocalDatasetCatalog, loadLocalSourceFile, loadRestoredWorkspace } from '../localDatasetStore';
import { approveQualityRevision } from '../qualityReview';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); localStorage.clear(); vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => vi.unstubAllGlobals());
const fixture = async () => {
  const bytes = new Uint8Array(131_077); bytes.forEach((_, i) => { bytes[i] = i % 251; });
  const file = { id: 'archive', name: 'source.bin', size: bytes.length, type: 'application/octet-stream', blob: new Blob([bytes]) };
  await saveLocalSourceFiles([file]);
  const rawRows = Array.from({ length: 1027 }, (_, i) => ({ ID: String(i).padStart(6, '0'), value: i }));
  const dataset = approveQualityRevision({ id: 'backup-source', name: 'Backup source', isLocal: true, revision: 'r1', columns: ['ID', 'value'], rawRows,
    sourceRows: rawRows.map((row) => ({ ...row })), sourceColumns: ['ID', 'value'], cleaningHistory: [{ label: 'Legacy', rows: rawRows.map((row) => ({ ...row })) }], sourceFile: { ...file, blob: undefined } });
  await saveLocalDataset(dataset);
  const layout = { id: 'layout', name: 'Layout', sourceDatasetId: dataset.id, layout: [{ i: 'a', x: 0, y: 0, w: 4, h: 3, chartType: 'bar' }] };
  return { dataset, layout, bytes };
};
describe('record-stream workspace backups', () => {
  it('refuses an unsaved partial source rather than silently omitting originals and history', async () => {
    const workspace = await fixture(); const view = await loadLocalDataset(workspace.dataset.id, { workingOnly: true });
    await expect(createWorkspaceStream({ ...workspace, dataset: { ...view, revision: 'pending', name: 'Unsaved' } })).rejects.toThrow('Save the pending');
  });
  it('rejects checksum-correct missing history pages without publishing a partial workspace', async () => {
    const workspace = await fixture(); const backup = await createWorkspaceStream(workspace);
    const payloads = (await backup.text()).trim().split('\n').map((line) => JSON.parse(line).payload).filter((payload) => !(payload.type === 'rows' && payload.stream === 'history:0:rows' && payload.index === 1));
    payloads.at(-1).records = payloads.length - 1;
    let digest = ''; const lines = [];
    for (const payload of payloads) { digest = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(`${digest}\n${JSON.stringify(payload)}`))).toString('hex'); lines.push(JSON.stringify({ payload, digest })); }
    await expect(restoreWorkspaceStream(new Blob([lines.join('\n') + '\n']))).rejects.toThrow();
    expect((await loadLocalDatasetCatalog({ metadataOnly: true })).datasets).toHaveLength(1);
  });
  it('round-trips row pages, legacy history, exact binary originals and a recovery snapshot', async () => {
    const workspace = await fixture(); const progress = [];
    const backup = await createWorkspaceStream(workspace);
    const lines = (await backup.text()).trim().split('\n').map(JSON.parse);
    expect(lines[0].payload).toMatchObject({ version: 6, kind: 'analytics-dashboard-record-stream' });
    expect(lines.filter(({ payload }) => payload.type === 'rows')).toHaveLength(9);
    expect(lines.filter(({ payload }) => payload.type === 'file')).toHaveLength(3);
    const restored = await restoreWorkspaceStream(backup, { onProgress: (entry) => progress.push(entry) });
    expect(restored.persisted).toBe(true); expect(restored.dataset.metadataOnly).toBe(true);
    const loaded = await loadLocalDataset(restored.dataset.id);
    expect(loaded.rawRows).toEqual(workspace.dataset.rawRows); expect(loaded.sourceRows).toEqual(workspace.dataset.sourceRows);
    expect(loaded.cleaningHistory[0].rows).toEqual(workspace.dataset.rawRows);
    expect(loaded.qualityReview).toBeUndefined(); expect(loaded.qualityReviewRequired).toBe(true);
    const original = await loadLocalSourceFile(loaded.sourceFile.id);
    expect(new Uint8Array(await original.blob.arrayBuffer())).toEqual(workspace.bytes);
    expect((await loadRestoredWorkspace(loaded.id, { metadataOnly: true })).layout.id).toBe(restored.layout.id);
    expect(progress.length).toBe(lines.length);
  });
  it.each(['changed', 'truncated', 'trailing'])('rejects %s data without publishing or changing accepted sources', async (failure) => {
    const workspace = await fixture(); const backup = await createWorkspaceStream(workspace); const text = await backup.text();
    const damaged = failure === 'changed' ? text.replace('000512', '999512') : failure === 'truncated' ? text.slice(0, text.lastIndexOf('\n', text.length - 2) + 1) : text + text.split('\n')[1] + '\n';
    await expect(restoreWorkspaceStream(new Blob([damaged]))).rejects.toThrow();
    expect((await loadLocalDatasetCatalog({ metadataOnly: true })).datasets.map((source) => source.id)).toEqual([workspace.dataset.id]);
    expect((await loadLocalDataset(workspace.dataset.id)).rawRows).toEqual(workspace.dataset.rawRows);
  });
  it('cancels staged restore and supports a fresh retry', async () => {
    const workspace = await fixture(); const backup = await createWorkspaceStream(workspace); const controller = new AbortController();
    await expect(restoreWorkspaceStream(backup, { signal: controller.signal, onProgress: ({ records }) => { if (records === 3) controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
    expect((await loadLocalDatasetCatalog({ metadataOnly: true })).datasets).toHaveLength(1);
    expect((await restoreWorkspaceStream(backup)).persisted).toBe(true);
  });
});
