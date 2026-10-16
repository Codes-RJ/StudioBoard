import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getLocalDatasetStorageStatus,
  requestPersistentLocalDatasetStorage,
  resolveLegacyDatasetCatalog
} from '../localDatasetStore';

afterEach(() => {
  vi.restoreAllMocks();
  delete navigator.storage;
});

describe('resolveLegacyDatasetCatalog', () => {
  it('migrates only a complete legacy dataset', () => {
    const catalog = JSON.stringify([{
      id: 'complete',
      columns: [{ name: 'value' }],
      rawRows: [{ value: 1 }, { value: 2 }],
      rowCount: 2
    }]);

    expect(resolveLegacyDatasetCatalog(catalog)).toEqual({
      datasets: [expect.objectContaining({ id: 'complete' })],
      discardedCount: 0
    });
  });

  it('rejects a legacy dataset whose stored rows are only a preview', () => {
    const catalog = JSON.stringify([{
      id: 'partial',
      columns: [{ name: 'value' }],
      rawRows: [{ value: 1 }],
      rowCount: 600
    }]);

    expect(resolveLegacyDatasetCatalog(catalog)).toEqual({
      datasets: [],
      discardedCount: 1
    });
  });

  it('reports storage pressure and requests persistent browser storage', async () => {
    const estimate = vi.fn().mockResolvedValue({ usage: 91, quota: 100 });
    const persist = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate, persist }
    });

    await expect(getLocalDatasetStorageStatus()).resolves.toMatchObject({ ratio: 0.91, nearlyFull: true });
    await expect(requestPersistentLocalDatasetStorage()).resolves.toBe(true);
  });
});
