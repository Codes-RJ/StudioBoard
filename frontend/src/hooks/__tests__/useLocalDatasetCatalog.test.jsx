import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useLocalDatasetCatalog from '../useLocalDatasetCatalog';
import { datasetCatalogMetadata } from '../../utils/datasetCatalogMetadata';

const mocks = vi.hoisted(() => ({
  deleteLocalDataset: vi.fn(),
  getLocalDatasetStorageStatus: vi.fn(),
  loadLocalDatasetCatalog: vi.fn(),
  loadLocalDataset: vi.fn(),
  requestPersistentLocalDatasetStorage: vi.fn(),
  saveLocalDataset: vi.fn()
}));

const storeLoader = async () => mocks;

const dataset = {
  id: 'local-1',
  name: 'Local data',
  columns: ['value'],
  rawRows: [{ value: 1 }],
  rowCount: 1
};

describe('useLocalDatasetCatalog', () => {
  it('retains a conflicting draft and saves an explicit copy before replacing it with the current source', async () => {
    const restored = { ...dataset, revision: 'r1', storageRevision: 'tab-version-1' };
    mocks.loadLocalDatasetCatalog.mockResolvedValue({ datasets: [datasetCatalogMetadata(restored)], discardedLegacyCount: 0 });
    const { result, unmount } = renderHook(() => useLocalDatasetCatalog({ initialDatasets: [], storeLoader }));
    await act(async () => Promise.resolve());
    const draft = { ...restored, rawRows: [{ value: 99 }] };
    mocks.saveLocalDataset.mockRejectedValueOnce(Object.assign(new Error('Other tab edited this source'), { code: 'DATASET_CONFLICT' }));
    act(() => result.current.updateLocalDatasetRecord(draft));
    await act(async () => result.current.flushLocalDatasetWrites());
    expect(result.current.localDatasets[0]).toBe(draft); expect(result.current.localSaveConflicts[0].id).toBe(dataset.id);
    expect(mocks.saveLocalDataset.mock.calls[0][1]).toEqual({ expectedStorageRevision: 'tab-version-1' });
    const saved = { ...dataset, rawRows: [{ value: 7 }], storageRevision: 'tab-version-2' };
    mocks.loadLocalDataset.mockResolvedValue(saved); mocks.saveLocalDataset.mockResolvedValueOnce('copy-version');
    let copy;
    await act(async () => { copy = await result.current.preserveLocalDatasetCopy(dataset.id); });
    expect(copy.id).not.toBe(dataset.id); expect(copy.rawRows).toEqual([{ value: 99 }]);
    expect(copy.qualityReview).toBeUndefined(); expect(result.current.localSaveConflicts).toEqual([]);
    expect(result.current.localDatasets.find(({ id }) => id === dataset.id)).toBe(saved);
    expect(mocks.saveLocalDataset.mock.calls[1][1]).toEqual({ expectedStorageRevision: null });
    unmount();
  });
  it('serializes overlapping saves against its own most recent committed version', async () => {
    mocks.loadLocalDatasetCatalog.mockResolvedValue({ datasets: [datasetCatalogMetadata({ ...dataset, storageRevision: 'v1' })], discardedLegacyCount: 0 });
    const { result, unmount } = renderHook(() => useLocalDatasetCatalog({ initialDatasets: [], storeLoader }));
    await act(async () => Promise.resolve());
    let finishFirst; mocks.saveLocalDataset.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; })).mockResolvedValueOnce('v3');
    let first; let second;
    await act(async () => { result.current.updateLocalDatasetRecord({ ...dataset, name: 'first' }); first = result.current.flushLocalDatasetWrites(); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { result.current.updateLocalDatasetRecord({ ...dataset, name: 'second' }); second = result.current.flushLocalDatasetWrites(); await vi.advanceTimersByTimeAsync(0); });
    expect(mocks.saveLocalDataset).toHaveBeenCalledTimes(1);
    await act(async () => { finishFirst('v2'); await first; await second; });
    expect(mocks.saveLocalDataset.mock.calls.map(([, options]) => options.expectedStorageRevision)).toEqual(['v1', 'v2']);
    expect(result.current.localSaveConflicts).toEqual([]); unmount();
  });
  it('restores summaries and keeps computation loads outside the catalog row cache', async () => {
    const second = { ...dataset, id: 'local-2' };
    mocks.loadLocalDatasetCatalog.mockResolvedValue({ datasets: [dataset, second].map(datasetCatalogMetadata), discardedLegacyCount: 0 });
    mocks.loadLocalDataset.mockImplementation(async (id) => id === dataset.id ? dataset : second);
    const { result, unmount } = renderHook(() => useLocalDatasetCatalog({ initialDatasets: [], storeLoader }));
    await act(async () => Promise.resolve());
    expect(mocks.loadLocalDatasetCatalog).toHaveBeenCalledWith({ metadataOnly: true });
    expect(mocks.loadLocalDataset).not.toHaveBeenCalled();
    expect(result.current.localDatasets.every((item) => !item.rawRows)).toBe(true);
    let loaded;
    await act(async () => { loaded = await result.current.loadLocalDatasetRecord(dataset.id); });
    expect(loaded.rawRows).toEqual(dataset.rawRows);
    expect(result.current.localDatasets.every((item) => !item.rawRows)).toBe(true);
    act(() => result.current.retainLocalDatasetRecord(loaded));
    expect(result.current.localDatasets.filter((item) => item.rawRows).map(({ id }) => id)).toEqual([dataset.id]);
    await act(async () => { loaded = await result.current.loadLocalDatasetRecord(second.id); });
    act(() => result.current.retainLocalDatasetRecord(loaded));
    expect(result.current.localDatasets.filter((item) => item.rawRows).map(({ id }) => id)).toEqual([second.id]);
    unmount();
  });
  it('approval waits for a background save started in the same turn before the store import resolves', async () => {
    const restored = { ...dataset, storageRevision: 'v1' };
    mocks.loadLocalDatasetCatalog.mockResolvedValue({ datasets: [datasetCatalogMetadata(restored)], discardedLegacyCount: 0 });
    const { result, unmount } = renderHook(() => useLocalDatasetCatalog({ initialDatasets: [], storeLoader }));
    await act(async () => Promise.resolve());
    let finishDraft;
    mocks.saveLocalDataset.mockImplementationOnce(() => new Promise(resolve => { finishDraft = resolve; })).mockResolvedValueOnce('v3');
    const draft = { ...restored, revision: 'reviewed-role' };
    const approved = { ...draft, qualityReview: { approvedAt: 'today' } };
    let saving; let committing;
    await act(async () => {
      result.current.updateLocalDatasetRecord(draft);
      saving = result.current.flushLocalDatasetWrites();
      committing = result.current.commitLocalDatasetRecord(approved, { expectedRevision: 'reviewed-role' });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.saveLocalDataset).toHaveBeenCalledTimes(1);
    expect(mocks.saveLocalDataset.mock.calls[0][0]).toBe(draft);
    await act(async () => { finishDraft('v2'); await saving; await committing; });
    expect(mocks.saveLocalDataset.mock.calls[1]).toEqual([approved, { expectedRevision: 'reviewed-role', expectedStorageRevision: 'v2' }]);
    expect(result.current.localDatasets[0]).toBe(approved);
    unmount();
  });
  it('does not evict unsaved rows when storage is full', async () => {
    const onPersistenceError = vi.fn();
    const { result, unmount } = renderHook(() => useLocalDatasetCatalog({ initialDatasets: [], storeLoader, onPersistenceError }));
    await act(async () => Promise.resolve());
    mocks.saveLocalDataset.mockRejectedValue(new Error('Quota exceeded'));
    act(() => { result.current.addLocalDatasetRecord(dataset); result.current.retainLocalDatasetRecord(null); });
    await act(async () => result.current.flushLocalDatasetWrites());
    expect(result.current.localDatasets[0]).toBe(dataset);
    expect(onPersistenceError).toHaveBeenCalled();
    unmount();
  });
  it('rejects a hydration that finishes after deletion or against a newer persisted revision', async () => {
    mocks.loadLocalDatasetCatalog.mockResolvedValue({ datasets: [datasetCatalogMetadata(dataset)], discardedLegacyCount: 0 });
    const { result, unmount } = renderHook(() => useLocalDatasetCatalog({ initialDatasets: [], storeLoader }));
    await act(async () => Promise.resolve());
    mocks.loadLocalDataset.mockResolvedValue({ ...dataset, revision: 'newer' });
    await expect(result.current.loadLocalDatasetRecord(dataset.id)).rejects.toThrow('changed in another tab');
    let resolveLoad;
    mocks.loadLocalDataset.mockImplementation(() => new Promise((resolve) => { resolveLoad = resolve; }));
    const loading = result.current.loadLocalDatasetRecord(dataset.id);
    const failedLoad = expect(loading).rejects.toThrow('no longer available');
    await act(async () => Promise.resolve());
    await act(async () => result.current.removeLocalDatasetRecord(dataset.id));
    resolveLoad(dataset); await failedLoad;
    expect(result.current.localDatasets).toEqual([]);
    unmount();
  });
  it('publishes review approval only after the source and approved record commit', async () => {
    const { result, unmount } = renderHook(() => useLocalDatasetCatalog({ initialDatasets: [], storeLoader }));
    await act(async () => Promise.resolve());
    act(() => result.current.addLocalDatasetRecord(dataset));
    let finishSave;
    mocks.saveLocalDataset.mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
    const approved = { ...dataset, qualityReview: { approvedAt: 'today' } };
    let committing;
    await act(async () => {
      committing = result.current.commitLocalDatasetRecord(approved, { expectedRevision: 'source-v1' });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.localDatasets[0].qualityReview).toBeUndefined();
    expect(mocks.saveLocalDataset.mock.calls[0][0]).toBe(dataset);
    expect(mocks.saveLocalDataset.mock.calls[1]).toEqual([approved, { expectedRevision: 'source-v1', expectedStorageRevision: null }]);
    await act(async () => { finishSave(); await committing; });
    expect(result.current.localDatasets[0]).toBe(approved);
    unmount();
  });

  it('keeps the source record when approval persistence fails', async () => {
    const { result, unmount } = renderHook(() => useLocalDatasetCatalog({ initialDatasets: [], storeLoader }));
    await act(async () => Promise.resolve());
    act(() => result.current.addLocalDatasetRecord(dataset));
    mocks.saveLocalDataset.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Disk quota exceeded'));
    await act(async () => {
      await expect(result.current.commitLocalDatasetRecord({ ...dataset, qualityReview: { approvedAt: 'today' } }))
        .rejects.toThrow('Disk quota exceeded');
    });
    expect(result.current.localDatasets[0]).toBe(dataset);
    const retry = { ...dataset, qualityReview: { approvedAt: 'today' } };
    await act(async () => { await result.current.commitLocalDatasetRecord(retry); });
    expect(result.current.localDatasets[0]).toBe(retry);
    unmount();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.loadLocalDatasetCatalog.mockResolvedValue({ datasets: [], discardedLegacyCount: 0 });
    mocks.requestPersistentLocalDatasetStorage.mockResolvedValue(true);
    mocks.saveLocalDataset.mockResolvedValue(undefined);
    mocks.deleteLocalDataset.mockResolvedValue(undefined);
    mocks.getLocalDatasetStorageStatus.mockResolvedValue({ nearlyFull: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes only the newest pending version of each dataset', async () => {
    const onPersistenceError = vi.fn();
    const { result, unmount } = renderHook(() => useLocalDatasetCatalog({
      initialDatasets: [],
      onPersistenceError,
      storeLoader
    }));
    await act(async () => Promise.resolve());

    act(() => {
      result.current.addLocalDatasetRecord(dataset);
      result.current.updateLocalDatasetRecord({ ...dataset, rawRows: [{ value: 2 }] });
    });
    await act(async () => {
      await result.current.flushLocalDatasetWrites();
    });

    expect(onPersistenceError).not.toHaveBeenCalled();
    expect(mocks.saveLocalDataset).toHaveBeenCalledTimes(1);
    expect(mocks.saveLocalDataset).toHaveBeenCalledWith(expect.objectContaining({ rawRows: [{ value: 2 }] }), { expectedStorageRevision: null });
    unmount();
  });

  it('cancels a pending write before deleting a dataset', async () => {
    const { result, unmount } = renderHook(() => useLocalDatasetCatalog({ initialDatasets: [], storeLoader }));
    await act(async () => Promise.resolve());

    act(() => {
      result.current.addLocalDatasetRecord(dataset);
      result.current.removeLocalDatasetRecord(dataset.id);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(mocks.deleteLocalDataset).toHaveBeenCalledWith(dataset.id, { expectedStorageRevision: null });
    expect(mocks.saveLocalDataset).not.toHaveBeenCalled();
    unmount();
  });

  it('adds a folder batch and persists every dataset', async () => {
    const { result, unmount } = renderHook(() => useLocalDatasetCatalog({ initialDatasets: [], storeLoader }));
    await act(async () => Promise.resolve());
    const overview = { ...dataset, id: 'overview', name: 'Folder overview' };

    act(() => result.current.addLocalDatasetRecords([overview, dataset]));
    expect(result.current.localDatasets.map(({ id }) => id)).toEqual(['overview', 'local-1']);
    await act(async () => result.current.flushLocalDatasetWrites());

    expect(mocks.saveLocalDataset).toHaveBeenCalledTimes(2);
    expect(mocks.saveLocalDataset).toHaveBeenCalledWith(overview, { expectedStorageRevision: null });
    expect(mocks.saveLocalDataset).toHaveBeenCalledWith(dataset, { expectedStorageRevision: null });
    unmount();
  });

  it('keeps previously stored datasets visible when a folder is imported before restore completes', async () => {
    let finishRestore;
    mocks.loadLocalDatasetCatalog.mockImplementation(() => new Promise((resolve) => { finishRestore = resolve; }));
    const onRestore = vi.fn();
    const { result, unmount } = renderHook(() => useLocalDatasetCatalog({
      initialDatasets: [], onRestore, storeLoader,
    }));
    const imported = { ...dataset, id: 'new-folder-source' };
    await act(async () => Promise.resolve());

    act(() => result.current.addLocalDatasetRecords([imported]));
    await act(async () => {
      finishRestore({ datasets: [dataset], discardedLegacyCount: 0 });
    });

    expect(result.current.localDatasets.map(({ id }) => id)).toEqual([imported.id, dataset.id]);
    expect(onRestore).not.toHaveBeenCalled();
    unmount();
  });

  it('does not restore a dataset deleted while the catalog was loading', async () => {
    let finishRestore;
    mocks.loadLocalDatasetCatalog.mockImplementation(() => new Promise((resolve) => { finishRestore = resolve; }));
    const { result, unmount } = renderHook(() => useLocalDatasetCatalog({
      initialDatasets: [dataset], storeLoader,
    }));
    await act(async () => Promise.resolve());

    let deletion;
    act(() => { deletion = result.current.removeLocalDatasetRecord(dataset.id); });
    await act(async () => {
      finishRestore({ datasets: [dataset], discardedLegacyCount: 0 });
      await deletion;
    });

    expect(result.current.localDatasets).toEqual([]);
    unmount();
  });
});
