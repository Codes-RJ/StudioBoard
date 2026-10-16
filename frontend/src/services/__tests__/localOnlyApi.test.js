import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => vi.resetModules());
import api, { resolveApiUrl } from '../api';

describe('personal API boundary', () => {
  it.each(['get', 'post', 'put', 'delete'])('blocks %s before the adapter receives private data', async (method) => {
    const adapter = vi.fn();
    await expect(api.request({ method, url: '/datasets/private-name', data: { secret: 'private-cell' }, adapter }))
      .rejects.toMatchObject({ code: 'LOCAL_ONLY_WORKSPACE' });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('blocks URL construction for alternate API transports', () => {
    expect(() => resolveApiUrl('/analytics/live/private-id/stream')).toThrow('Server requests are disabled');
  });
});
