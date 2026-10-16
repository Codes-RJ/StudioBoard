import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import useDatasetExport from '../useDatasetExport';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  exportLocalDataset: vi.fn(),
  startOperation: vi.fn(),
}));

vi.mock('../../services/api', () => ({ default: { post: mocks.post, get: mocks.get } }));
vi.mock('../../utils/localDataEngine', () => ({ exportLocalDataset: mocks.exportLocalDataset }));
vi.mock('../../context/OperationStatusContext', () => ({
  useOperationStatus: () => ({ startOperation: mocks.startOperation }),
}));

beforeEach(() => {
  mocks.startOperation.mockReturnValue({ update: vi.fn(), succeed: vi.fn(), fail: vi.fn(), cancel: vi.fn() });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useDatasetExport', () => {
  it('exports a local dataset entirely in the browser', async () => {
    const dataset = { id: 'local_1', name: 'Sales', isLocal: true, rawRows: [{ revenue: 12 }] };
    mocks.exportLocalDataset.mockResolvedValue(true);
    const { result } = renderHook(() => useDatasetExport(dataset));

    await act(async () => result.current.handleExportSnapshot('csv'));

    expect(mocks.exportLocalDataset).toHaveBeenCalledWith(expect.objectContaining({ ...dataset, rowCount: 1, analysisScope: { eligibleRows: 1, sourceRows: 1, filters: {} } }), 'csv');
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.startOperation.mock.results[0].value.succeed).toHaveBeenCalledWith('Downloaded CSV file: 1 eligible rows of 1 source rows.');
  });
  it('exports the same filtered scope as the dashboard without changing source rows', async () => {
    const dataset = { id: 'local_1', rawRows: [{ region: 'East coast', revenue: 1 }, { region: 'West', revenue: 9 }] };
    const { result } = renderHook(() => useDatasetExport(dataset, { region: 'east' }));
    await act(async () => result.current.handleExportSnapshot('csv'));
    expect(mocks.exportLocalDataset.mock.calls[0][0].rawRows).toEqual([{ region: 'East coast', revenue: 1 }]);
    expect(dataset.rawRows).toHaveLength(2);
  });

  it('queues a server export and removes Parquet when switching to local data', async () => {
    mocks.post.mockResolvedValue({ data: { id: 'job_1' } });
    const serverDataset = { id: 'server_1', name: 'Server data' };
    const localDataset = { id: 'local_1', name: 'Local data', rawRows: [{ revenue: 12 }] };
    const { result, rerender } = renderHook(({ dataset }) => useDatasetExport(dataset), {
      initialProps: { dataset: serverDataset },
    });

    await act(async () => result.current.handleExportSnapshot('parquet'));
    expect(mocks.post).toHaveBeenCalledWith('/analytics/jobs/export', { datasetId: 'server_1', format: 'parquet' });
    expect(mocks.exportLocalDataset).not.toHaveBeenCalled();

    act(() => result.current.setExportFormat('parquet'));
    rerender({ dataset: localDataset });
    await waitFor(() => expect(result.current.exportFormat).toBe('csv'));
  });
});
