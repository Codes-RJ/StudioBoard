import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { PUBLIC_ROUTES } from '../src/utils/seo.mjs';

// Deliberately small, paced static-route probe. No workspace payloads/accounts.
export async function checkHostTraffic(value, { authorized = false, localFixture = false, requests = 12, concurrency = 2,
  fetcher = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const origin = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || (!local && origin.protocol !== 'https:') || (local && !['http:', 'https:'].includes(origin.protocol))) throw new Error('Supply only a public HTTPS origin, or an explicitly selected loopback fixture origin.');
  if (local ? !localFixture : !authorized) throw new Error(local ? 'Loopback checks require --local-fixture.' : 'Public traffic checks require --authorized for a host you control.');
  if (!Number.isInteger(requests) || requests < 1 || requests > 100 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) throw new Error('Use 1-100 requests and 1-5 concurrent requests.');
  const records = []; let index = 0; let nextStart = performance.now(); const started = performance.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, async () => {
    while (index < requests) {
      const item = index++; const pathname = PUBLIC_ROUTES[item % PUBLIC_ROUTES.length];
      const slot = Math.max(performance.now(), nextStart); nextStart = slot + 250; await wait(Math.max(0, slot - performance.now()));
      const start = performance.now();
      try {
        const response = await fetcher(new URL(pathname, origin), { method: 'GET', redirect: 'manual', credentials: 'omit',
          signal: AbortSignal.timeout(5_000), headers: { 'Accept-Encoding': 'gzip, br' } });
        await response.body?.cancel();
        records.push({ index: item, pathname, status: response.status, elapsedMs: performance.now() - start,
          passed: response.status === 200 && /text\/html/i.test(response.headers.get('content-type') || '') });
      } catch (error) { records.push({ index: item, pathname, passed: false, elapsedMs: performance.now() - start, error: error.name }); }
    }
  }));
  const timings = records.map((record) => record.elapsedMs).sort((a, b) => a - b);
  return { origin: origin.origin, measuredAt: new Date().toISOString(), requests, concurrency, maximumScheduledStartsPerSecond: 4,
    elapsedMs: performance.now() - started, passed: records.every((record) => record.passed), failedRequests: records.filter((record) => !record.passed).length,
    p95HeaderMilliseconds: timings[Math.ceil(timings.length * .95) - 1], records: records.sort((a, b) => a.index - b.index),
    boundary: 'Bounded public HTML response-header probe; bodies are cancelled. Not full downloads, browser execution, burst capacity or proof of hundreds of simultaneous users. Never automatically run against an unchosen public host.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(3);
    if (args.some((arg) => !/^(--authorized|--local-fixture|--requests=\d+|--concurrency=\d+)$/.test(arg))) throw new Error('Unknown traffic-check argument.');
    const number = (name, fallback) => Number(args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
    const report = await checkHostTraffic(process.argv[2], { authorized: args.includes('--authorized'), localFixture: args.includes('--local-fixture'), requests: number('requests', 12), concurrency: number('concurrency', 2) });
    console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
