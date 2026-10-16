import { performance } from 'node:perf_hooks';

export function benchmarkOrigin(value = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8080') {
  const origin = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
    || !['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
    || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Capacity measurements require a disposable loopback preview origin.');
  }
  return origin.origin;
}

export const benchmarkCpuRate = () => {
  const rate = Number(process.env.BENCHMARK_CPU_THROTTLE || 1);
  if (![1, 4].includes(rate)) throw new Error('Use a bounded CPU throttle of 1 or 4.');
  return rate;
};

export async function observeBrowserJourney(page, cdp, { intervalMs = 100 } = {}) {
  const requests = new Set(); const workers = new Set();
  const counts = { requestsStarted: 0, requestsFinished: 0, requestsFailed: 0, workersCreated: 0, workersClosed: 0 };
  const started = (request) => { requests.add(request); counts.requestsStarted++; };
  const finished = (request) => { requests.delete(request); counts.requestsFinished++; };
  const failed = (request) => { requests.delete(request); counts.requestsFailed++; };
  const workerStarted = (worker) => {
    workers.add(worker); counts.workersCreated++;
    worker.once('close', () => { workers.delete(worker); counts.workersClosed++; });
  };
  page.on('request', started); page.on('requestfinished', finished); page.on('requestfailed', failed); page.on('worker', workerStarted);
  await page.addInitScript(() => {
    const state = { maximum50msTimerGapMs: 0, longTaskCount: 0, totalLongTaskMs: 0, longestTaskMs: 0, longTasksSupported: false };
    window.journeyTelemetry = state;
    let previous = performance.now();
    setInterval(() => { const now = performance.now(); state.maximum50msTimerGapMs = Math.max(state.maximum50msTimerGapMs, now - previous); previous = now; }, 50);
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      state.longTasksSupported = true;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTaskCount++; state.totalLongTaskMs += entry.duration; state.longestTaskMs = Math.max(state.longestTaskMs, entry.duration);
        }
      }).observe({ type: 'longtask', buffered: true });
    }
  });
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: benchmarkCpuRate() });
  const samples = []; const checkpoints = []; let pending; let stopped = false; let samplingFailure;
  const collect = async () => {
    if (pending || stopped) return;
    pending = (async () => {
      try {
        const { metrics } = await cdp.send('Performance.getMetrics');
        samples.push({ at: Date.now(), heapBytes: metrics.find(({ name }) => name === 'JSHeapUsedSize')?.value });
      } catch (error) { samplingFailure = error.message; }
    })();
    await pending; pending = null;
  };
  await collect();
  const timer = setInterval(() => { void collect(); }, intervalMs);
  const live = () => ({ unmatchedRequestEvents: requests.size, liveWorkers: workers.size, ...counts });
  return {
    live,
    async checkpoint(label) {
      await collect();
      const result = { label, at: Date.now(), ...live(), responsiveness: await page.evaluate(() => window.journeyTelemetry) };
      checkpoints.push(result); return result;
    },
    async waitForWorkersIdle(timeoutMs = 10_000) {
      const start = performance.now();
      while (workers.size) {
        if (performance.now() - start >= timeoutMs) throw new Error(`Worker cleanup exceeded ${timeoutMs} ms: ${workers.size} workers.`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return performance.now() - start;
    },
    async stop() {
      stopped = true; clearInterval(timer); await pending;
      page.off('request', started); page.off('requestfinished', finished); page.off('requestfailed', failed); page.off('worker', workerStarted);
    },
    summary() {
      const maximumGap = samples.length > 1 ? Math.max(...samples.slice(1).map((sample, index) => sample.at - samples[index].at)) : null;
      return { cpuThrottleRate: benchmarkCpuRate(), requestedHeapIntervalMs: intervalMs, heapSamples: samples.length,
        maximumSampledMainThreadHeapBytes: samples.length ? Math.max(...samples.map(({ heapBytes }) => heapBytes || 0)) : null,
        maximumObservedSampleGapMs: maximumGap,
        measurementValid: !samplingFailure && maximumGap !== null && maximumGap <= 30_000,
        validityPolicy: 'Sampling gaps above 30 seconds invalidate timing/capacity conclusions; preserve the run and investigate suspension, interruption or a stall separately.',
        samplingFailure, resources: live(), checkpoints,
        requestsWithoutTerminalEvent: [...requests].map((request) => ({ url: request.url(), type: request.resourceType() })),
        boundary: 'Chromium main-thread heap samples exclude worker heaps/GPU and can miss transient peaks. Actual sample gaps are recorded. Long tasks/timer gaps reset on full navigation. Page request events can lack terminal events when a worker target closes; unmatched events are observations, not proven active connections. Worker cleanup covers this owned page, not service workers or all browser resources. Actual streaming cancellation is checked separately at the owned HTTPS server. CPU throttle emulates slower computation, not physical RAM, storage, network or devices.' };
    },
  };
}
