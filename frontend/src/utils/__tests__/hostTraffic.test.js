import { expect, it, vi } from 'vitest';
import { checkHostTraffic } from '../../../scripts/check-host-traffic.mjs';
it('requires explicit host authorization and bounds requests before transport', async () => {
  const fetcher = vi.fn();
  await expect(checkHostTraffic('https://owned.example', { fetcher })).rejects.toThrow('--authorized');
  await expect(checkHostTraffic('http://127.0.0.1:8080', { fetcher })).rejects.toThrow('--local-fixture');
  await expect(checkHostTraffic('https://owned.example', { authorized: true, requests: 101, fetcher })).rejects.toThrow('1-100');
  await expect(checkHostTraffic('https://owned.example/?token=private', { authorized: true, fetcher })).rejects.toThrow('only a public');
  expect(fetcher).not.toHaveBeenCalled();
});
it('records failing public responses without redirects, credentials or body reads', async () => {
  const cancel = vi.fn(async () => {}); const options = [];
  const fetcher = vi.fn(async (url, init) => { options.push(init); return { status: url.pathname === '/privacy' ? 503 : 200, headers: new Headers({ 'content-type': 'text/html' }), body: { cancel } }; });
  const result = await checkHostTraffic('https://owned.example', { authorized: true, requests: 4, concurrency: 2, fetcher, wait: async () => {} });
  expect(result.passed).toBe(false); expect(result.failedRequests).toBe(1); expect(cancel).toHaveBeenCalledTimes(4);
  expect(options.every((option) => option.credentials === 'omit' && option.redirect === 'manual' && !option.body)).toBe(true);
  expect(result.records.map((record) => record.pathname)).toEqual(['/', '/how-it-works', '/privacy', '/terms']);
});
