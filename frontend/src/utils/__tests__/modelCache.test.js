import { describe, expect, it, vi } from 'vitest';
import { deleteModelAssetCaches, MODEL_CACHE_NAMES } from '../localAI/modelCache';

describe('offline model cache deletion', () => {
  it('deletes only dedicated model namespaces without fetching an absent model manifest', async () => {
    const names = new Set([...MODEL_CACHE_NAMES, 'workspace-backups', 'unrelated-assets']);
    const storage = { delete: vi.fn(async (name) => names.delete(name)) };
    await deleteModelAssetCaches(storage);
    expect(storage.delete.mock.calls.map(([name]) => name)).toEqual(MODEL_CACHE_NAMES);
    expect([...names]).toEqual(['workspace-backups', 'unrelated-assets']);
  });
  it('reports unavailable storage rather than claiming that deletion succeeded', async () => {
    await expect(deleteModelAssetCaches(undefined)).rejects.toThrow('unavailable');
  });
});
