import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useDatasetSelection from '../useDatasetSelection';

const pending = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const initialDataset = { id: 'initial', isLocal: true, rawRows: [{ value: 1 }] };
const header = (id) => ({ id, name: id, metadataOnly: true, isLocal: true });

describe('dataset selection ownership', () => {
  it('aborts the previous load and refuses its late publication', async () => {
    const first = pending(); const second = pending();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const retain = vi.fn();
    const { result } = renderHook(() => useDatasetSelection({ initialDataset, loadLocalDatasetRecord: load, retainLocalDatasetRecord: retain }));
    act(() => result.current.setSelectedDataset(header('first')));
    act(() => result.current.setSelectedDataset(header('second')));
    expect(load.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => first.resolve({ ...initialDataset, id: 'first' }));
    expect(result.current.selectedDataset).toBe(initialDataset);
    expect(result.current.datasetLoadState.id).toBe('second');
    const selected = { ...initialDataset, id: 'second' };
    await act(async () => second.resolve(selected));
    expect(result.current.selectedDataset).toBe(selected);
    expect(result.current.selectedDatasetRef.current).toBe(selected);
    expect(result.current.datasetLoadState).toBeNull();
    expect(retain).toHaveBeenCalledExactlyOnceWith(selected);
  });

  it('retains the current source after failure and allows an explicit retry', async () => {
    const failed = pending(); const retried = pending();
    const load = vi.fn().mockReturnValueOnce(failed.promise).mockReturnValueOnce(retried.promise);
    const { result } = renderHook(() => useDatasetSelection({ initialDataset, loadLocalDatasetRecord: load, retainLocalDatasetRecord: vi.fn() }));
    act(() => result.current.setSelectedDataset(header('saved')));
    await act(async () => failed.reject(new Error('Source changed. Reload it.')));
    expect(result.current.selectedDataset).toBe(initialDataset);
    expect(result.current.datasetLoadState).toMatchObject({ status: 'error', error: 'Source changed. Reload it.' });
    act(() => result.current.setSelectedDataset(header('saved')));
    await act(async () => retried.resolve({ ...initialDataset, id: 'saved' }));
    expect(result.current.selectedDataset.id).toBe('saved');
    expect(result.current.datasetLoadState).toBeNull();
  });

  it('aborts on unmount and does not retain a late result', async () => {
    const work = pending(); const retain = vi.fn();
    const load = vi.fn().mockReturnValue(work.promise);
    const { result, unmount } = renderHook(() => useDatasetSelection({ initialDataset, loadLocalDatasetRecord: load, retainLocalDatasetRecord: retain }));
    act(() => result.current.setSelectedDataset(header('saved')));
    unmount();
    expect(load.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => work.resolve({ ...initialDataset, id: 'saved' }));
    expect(retain).not.toHaveBeenCalled();
  });
});
