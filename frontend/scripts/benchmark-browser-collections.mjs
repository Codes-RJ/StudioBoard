import { chromium, expect } from '@playwright/test';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { sampleBrowserMemory } from './browser-process-memory.mjs';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8080';
const samples = []; const browser = await chromium.launch();
const memory = await sampleBrowserMemory(browser);
const stress = process.argv.includes('--stress');
const scenarios = stress
  ? [{ count: 1, rows: 50_001, columns: 8, kind: 'large-high-cardinality' }, { count: 1, rows: 2049, columns: 250, kind: 'wide' }]
  : [10, 50, 100].map((count) => ({ count, rows: 1027, columns: 4, kind: 'collection' }));
const workerAsset = (await readdir('dist/assets')).find((name) => /^localTransforms\.worker-.*\.js$/.test(name));
if (!workerAsset) throw new Error('Build the application first.');
try {
  for (const scenario of scenarios) {
    const { count, rows: rowsPerSource, columns, kind } = scenario;
    const context = await browser.newContext(); const page = await context.newPage(); const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await page.goto(`${baseURL}/robots.txt`);
    await page.evaluate(async ({ count, rowsPerSource, columns, kind, stress }) => {
      const request = indexedDB.open('analytics-dashboard-local-data', 7);
      await new Promise((resolve, reject) => {
        request.onupgradeneeded = () => {
          const database = request.result; database.createObjectStore('datasets', { keyPath: 'id' }); database.createObjectStore('datasetMetadata', { keyPath: 'id' });
          const rows = database.createObjectStore('datasetRows', { keyPath: ['datasetId', 'generation', 'stream', 'index'] }); rows.createIndex('datasetId', 'datasetId');
          for (const name of ['sourceFiles', 'assistantArtifacts', 'workspaceRestores', 'workspaceImports']) database.createObjectStore(name, { keyPath: 'id' });
          const fileChunks = database.createObjectStore('sourceFileChunks', { keyPath: ['fileId', 'generation', 'index'] }); fileChunks.createIndex('fileId', 'fileId'); fileChunks.createIndex('sessionId', 'sessionId');
          for (const name of ['stagedDatasets', 'stagedFiles']) database.createObjectStore(name, { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
        };
        request.onerror = () => reject(request.error); request.onsuccess = () => resolve();
      });
      const database = request.result;
      const transaction = database.transaction(['datasets', 'datasetMetadata', 'datasetRows'], 'readwrite');
      const fields = ['ID', 'Amount', 'Region', 'Text', ...Array.from({ length: columns - 4 }, (_, i) => `Extra_${i}`)];
      for (let source = 0; source < count; source++) {
        const id = `collection-${String(source).padStart(3, '0')}`; const generation = `fixture-${source}`; const rows = rowsPerSource;
        const spec = { length: rows, chunks: Math.ceil(rows / 512) }; const revisionKey = `${id}::r1::${rows}::${fields.join('|')}::[]`;
        const header = { id, name: id, isLocal: true, revision: 'r1', storageRevision: generation,
          columns: fields.map((name) => ({ name, type: name === 'Amount' ? 'number' : 'string' })), qualityReviewRequired: true,
          qualityReview: { rows, revisionKey, approvedAt: '2026-10-03' }, cleaningHistory: [{ label: 'Fixture history' }],
          rowStorage: { version: 1, generation, firstRowFields: fields, streams: { rawRows: spec, sourceRows: spec, 'history:0:rows': spec } },
          metrics: { columnGroups: { all: fields, numeric: ['Amount'], measures: ['Amount'], dimensions: ['Region'], categorical: ['Region', 'Text'], date: [] } } };
        transaction.objectStore('datasets').put(header);
        const { rowStorage, cleaningHistory, ...metadata } = header;
        transaction.objectStore('datasetMetadata').put({ ...metadata, metadataOnly: true, rowCount: rows, datasetRevision: `${id}::r1::${rows}::${fields.join('|')}`, revisionKey });
        for (let index = 0; index < spec.chunks; index++) {
          const pageRows = Array.from({ length: Math.min(512, rows - index * 512) }, (_, i) => ({
            ID: String(index * 512 + i).padStart(6, '0'), Amount: 2,
            Region: kind === 'large-high-cardinality' ? `Group_${index * 512 + i}` : i % 2 ? 'East' : 'West',
            Text: 'Fixture only '.repeat(stress ? 2 : 20),
            ...Object.fromEntries(fields.slice(4).map((field) => [field, `value_${index * 512 + i}`])) }));
          for (const stream of Object.keys(header.rowStorage.streams)) transaction.objectStore('datasetRows').put({ datasetId: id, generation, stream, index, rows: pageRows });
        }
      }
      await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); }); database.close();
    }, { count, rowsPerSource, columns, kind, stress });
    await page.addInitScript(() => {
      window.fixtureRowReads = []; const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (key) {
        const request = get.call(this, key);
        if (this.name === 'datasetRows') request.addEventListener('success', () => window.fixtureRowReads.push({ id: key[0], stream: key[2], rows: request.result?.rows?.length || 0 }));
        return request;
      };
    });
    await cdp.send('HeapProfiler.collectGarbage'); const started = performance.now();
    await page.goto(`${baseURL}/dashboard`);
    const selector = page.getByRole('combobox', { name: 'Select dataset', exact: true });
    await expect(selector).toHaveValue('collection-000', { timeout: 60_000 });
    await page.getByRole('textbox', { name: 'Ask a question about this dataset' }).waitFor();
    const coldStartupMs = performance.now() - started; const coldHeap = (await cdp.send('Performance.getMetrics')).metrics.find(({ name }) => name === 'JSHeapUsedSize')?.value;
    const coldReads = await page.evaluate(() => window.fixtureRowReads);
    const warm = performance.now(); await page.reload();
    await expect(selector).toHaveValue('collection-000', { timeout: 60_000 });
    await page.getByRole('textbox', { name: 'Ask a question about this dataset' }).waitFor(); const warmStartupMs = performance.now() - warm;
    const last = `collection-${String(count - 1).padStart(3, '0')}`;
    // A one-source stress fixture must actually reopen it, not reuse the warm
    // selection or count row reads left over from startup as new completion.
    await selector.selectOption(''); await expect(selector).toHaveValue('');
    await page.evaluate(() => { window.fixtureRowReads = []; });
    const selected = performance.now(); await selector.selectOption(last);
    await expect(selector).toHaveValue(last, { timeout: 60_000 });
    await page.waitForFunction(({ id, chunks }) => window.fixtureRowReads.filter((read) => read.id === id && read.stream === 'rawRows').length >= chunks,
      { id: last, chunks: Math.ceil(rowsPerSource / 512) });
    const selectionMs = performance.now() - selected;
    const heapAfterSelection = (await cdp.send('Performance.getMetrics')).metrics.find(({ name }) => name === 'JSHeapUsedSize')?.value;
    const reads = await page.evaluate(() => window.fixtureRowReads);
    if (reads.some((read) => read.stream !== 'rawRows' || read.rows > 512)) throw new Error('Selection unexpectedly hydrated original/history streams or oversized pages.');
    const marker = `fixture-cancel-${kind}`;
    const cancellation = await page.evaluate(async ({ asset, marker, rowsPerSource, fields }) => {
      const worker = new Worker(new URL(`/assets/${asset}?${marker}`, location.origin), { type: 'module' });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('No progress before cancellation timeout.')); }, 20_000);
        worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('Fixture worker failed.')); };
        worker.onmessage = ({ data }) => {
          if (data.error) { clearTimeout(timer); worker.terminate(); reject(new Error(data.error)); }
          else if (data.progress) { const started = performance.now(); window.fixtureCancelStarted = started; worker.terminate(); const terminateCallMs = performance.now() - started; clearTimeout(timer); resolve({ terminateCallMs, atProgress: data.progress }); }
        };
        worker.postMessage({ id: 'fixture-cancel', operation: 'report-analysis', payload: { dataset: { kind: 'local-dataset-reference', id: 'collection-000', storageRevision: 'fixture-0', revision: `collection-000::r1::${rowsPerSource}::${fields.join('|')}::[]` } } });
      });
    }, { asset: workerAsset, marker, rowsPerSource, fields: ['ID', 'Amount', 'Region', 'Text', ...Array.from({ length: columns - 4 }, (_, i) => `Extra_${i}`)] });
    const deadline = performance.now() + 5000;
    while ((await cdp.send('Target.getTargets')).targetInfos.some(({ url }) => url.includes(marker))) {
      if (performance.now() >= deadline) throw new Error('Cancelled worker remained attached after five seconds.');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    cancellation.cancelToWorkerGoneMs = await page.evaluate(() => performance.now() - window.fixtureCancelStarted);
    samples.push({ scenario: kind, sources: count, rowsPerSource, columns, streamsPerSource: 3, coldStartupMs, warmStartupMs, selectionMs, coldHeap, heapAfterSelection,
      coldMainThreadRowReads: coldReads.length, mainThreadStreamsRead: [...new Set(reads.map(({ stream }) => stream))], cancellation,
      browserCapabilities: await page.evaluate(() => ({ userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory, webGPUAPI: Boolean(navigator.gpu) })) });
    console.log(JSON.stringify(samples.at(-1))); await context.close();
  }
} finally { await memory.stop(); await browser.close(); }
await mkdir('audit-results', { recursive: true });
await writeFile(`audit-results/browser-${stress ? 'stress' : 'collections'}.json`, JSON.stringify({ measuredAt: new Date().toISOString(), browser: 'Chromium desktop, headless',
  hardware: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, physicalMemoryBytes: os.totalmem(), platform: os.platform(), node: process.version },
  processMemory: memory.summary(),
  limits: 'Main-thread heap snapshots plus coarse whole-browser process-memory samples; transient peaks remain excluded. Startup waits for the first saved selection, and selection clears the previous source/read counters and waits for the newly published source. Seeded read completion is not file parsing/full chart/UI readiness or physical-device capacity. Cancellation includes target disappearance observed on the same page clock; full UI/resource idle is not established.', samples }, null, 2));
