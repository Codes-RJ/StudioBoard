import { expect, test } from '@playwright/test';
import { readdir } from 'node:fs/promises';

test.skip(process.env.E2E_SERVER_WORKSPACE === 'true', 'Requires browser-local source storage.');

test('production workers scan calculations, retrieval, dashboard metrics and charts without full hydration', async ({ page }) => {
  test.setTimeout(90_000);
  const workerAsset = (await readdir('dist/assets')).find((name) => /^analysis\.worker-.*\.js$/.test(name));
  const transformAsset = (await readdir('dist/assets')).find((name) => /^localTransforms\.worker-.*\.js$/.test(name));
  expect(workerAsset).toBeTruthy();
  expect(transformAsset).toBeTruthy();
  await page.goto('/robots.txt');
  const result = await page.evaluate(async ({ asset, transformAsset }) => {
    const count = 20_003; const id = 'production-incremental'; const generation = 'fixture-generation';
    const fields = ['code', 'region', 'value', 'notes'];
    const revision = `${id}::r1::${count}::${fields.join('|')}::[]`;
    const spec = { length: count, chunks: Math.ceil(count / 512) };
    const header = { id, name: 'Production incremental fixture', revision: 'r1', isLocal: true,
      columns: fields.map((name) => ({ name, type: name === 'value' ? 'number' : 'string' })),
      qualityReviewRequired: true, qualityReview: { approvedAt: '2026-10-03', rows: count, revisionKey: revision },
      storageRevision: generation, rowStorage: { version: 1, generation, firstRowFields: fields,
        streams: { rawRows: spec, sourceRows: spec, 'history:0:rows': spec } }, cleaningHistory: [{ label: 'Fixture snapshot' }],
      metrics: { columnGroups: { numeric: ['value'], dimensions: ['region'], date: [] } } };
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('analytics-dashboard-local-data', 7);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('datasets', { keyPath: 'id' }).put(header);
        const store = request.result.createObjectStore('datasetRows', { keyPath: ['datasetId', 'generation', 'stream', 'index'] });
        for (let index = 0; index < spec.chunks; index++) {
          const rows = Array.from({ length: Math.min(512, count - index * 512) }, (_, i) => {
            const position = index * 512 + i;
            return { code: String(position).padStart(6, '0'), region: position % 2 ? 'West' : 'East', value: position === count - 1 ? 1000 : 1,
              notes: position === count - 1 ? 'late semantic marker' : 'ordinary' };
          });
          for (const stream of ['rawRows', 'sourceRows', 'history:0:rows']) store.put({ datasetId: id, generation, stream, index, rows });
        }
      };
      request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
    });
    const createWorker = (assetName) => {
      const workerURL = new URL(`/assets/${assetName}`, location.origin).href;
      const wrapper = `
      const stats = { streams: {}, maximumPageRows: 0, rowReads: 0 };
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function(key) {
        const request = get.call(this, key);
        if (this.name === 'datasetRows') {
          stats.rowReads++; stats.streams[key[2]] = (stats.streams[key[2]] || 0) + 1;
          request.addEventListener('success', () => { stats.maximumPageRows = Math.max(stats.maximumPageRows, request.result?.rows?.length || 0); });
        }
        return request;
      };
      const send = self.postMessage.bind(self);
      self.postMessage = (message) => send({ ...message, stats });
      await import(${JSON.stringify(workerURL)});
      send({ booted: true });`;
      const blobURL = URL.createObjectURL(new Blob([wrapper], { type: 'text/javascript' }));
      return { worker: new Worker(blobURL, { type: 'module' }), blobURL };
    };
    const { worker, blobURL } = createWorker(asset);
    const { worker: transformWorker, blobURL: transformBlobURL } = createWorker(transformAsset);
    const boot = (target) => new Promise((resolve, reject) => { target.onmessage = ({ data }) => { if (data.booted) resolve(); }; target.onerror = () => reject(new Error('Fixture worker failed.')); });
    const booted = Promise.all([boot(worker), boot(transformWorker)]);
    try {
      await booted;
      const request = (operation, payload, target = worker) => new Promise((resolve, reject) => {
        const progress = [];
        target.onmessage = ({ data }) => { if (data.progress) { progress.push(data.progress); return; } data.error ? reject(new Error(data.error)) : resolve({ ...data, progress }); };
        target.postMessage({ id: 'incremental-request', operation, payload });
      });
      const dataset = { kind: 'local-dataset-reference', id, revision, storageRevision: generation };
      const started = performance.now();
      const calculation = await request('calculate', { dataset, options: { metric: 'value', filters: { region: 'East' } } });
      const calculationMs = performance.now() - started;
      const index = await request('index', { dataset, filters: { region: 'East' } });
      const retrieval = await request('retrieve-source', { dataset, index: index.result, query: 'late semantic marker', options: { limit: 3 } });
      const metrics = await request('scoped-metrics', { dataset, filters: { region: 'East' } }, transformWorker);
      const chart = await request('chart-series', { rows: { ...dataset, field: 'rawRows' }, chartType: 'bar', aggregation: 'sum', selectedX: 'region', metricKey: 'value', visibleItems: 10 }, transformWorker);
      const report = await request('report-analysis', { dataset, filters: { region: 'East' } }, transformWorker);
      await request('semantic-init', { dataset });
      let cursor; let semantic;
      do { semantic = await request('semantic-next', { cursor, filters: { code: '020002' }, limit: 48 }); cursor = semantic.result.cursor; } while (!semantic.result.complete);
      return { calculation: calculation.result, calculationProgress: calculation.progress, calculationStats: calculation.stats,
        indexCoverage: index.result.coverage, indexSummary: index.result.records.find((record) => record.id.endsWith(':summary:value')), indexProgress: index.progress, indexStats: index.stats,
        retrieval: retrieval.result, retrievalProgress: retrieval.progress, retrievalStats: retrieval.stats,
        metrics: metrics.result, metricsProgress: metrics.progress, metricsStats: metrics.stats,
        chart: chart.result, chartProgress: chart.progress, chartStats: chart.stats,
        report: report.result, reportProgress: report.progress, reportStats: report.stats,
        semantic: semantic.result, semanticStats: semantic.stats, calculationMs };
    } finally { worker.terminate(); transformWorker.terminate(); URL.revokeObjectURL(blobURL); URL.revokeObjectURL(transformBlobURL); }
  }, { asset: workerAsset, transformAsset });
  expect(result.calculation).toMatchObject({ sourceRows: 20_003, eligibleRows: 10_002, contributingRows: 10_002 });
  expect(result.calculation.results[0].value).toBe(11_001);
  expect(result.calculationProgress).toHaveLength(40);
  expect(result.calculationStats).toEqual({ streams: { rawRows: 40 }, maximumPageRows: 512, rowReads: 40 });
  expect(result.semantic.records).toHaveLength(1);
  expect(result.semantic.records[0]).toMatchObject({ rowIndex: 20_002, sourceRowId: 'production-incremental:row:20003' });
  expect(result.semantic.records[0].text).toContain('late semantic marker');
  expect(result.indexCoverage).toMatchObject({ sourceRows: 20_003, eligibleRows: 10_002, indexedRows: 910 });
  expect(result.indexSummary.computation.results[0].value).toBe(11_001);
  expect(result.indexProgress).toHaveLength(40);
  expect(result.indexStats).toEqual({ streams: { rawRows: 80 }, maximumPageRows: 512, rowReads: 80 });
  expect(result.retrieval.hits[0]).toMatchObject({ rowIndex: 20_002, sourceRowId: 'production-incremental:row:20003' });
  expect(result.retrieval.coverage).toMatchObject({ indexedRows: 10_002, indexedColumns: 4, completeRows: true });
  expect(result.retrievalProgress).toHaveLength(40);
  expect(result.retrievalStats).toEqual({ streams: { rawRows: 120 }, maximumPageRows: 512, rowReads: 120 });
  expect(result.metrics).toMatchObject({ sourceRows: 20_003, rows: 10_002 });
  expect(result.metricsProgress).toHaveLength(40);
  expect(result.metricsStats).toEqual({ streams: { rawRows: 40 }, maximumPageRows: 512, rowReads: 40 });
  expect(result.chart).toMatchObject({ categoricalSeries: [{ name: 'East', value: 11_001 }, { name: 'West', value: 10_001 }], metricValue: 21_002, metricRange: { min: 1, max: 1000 } });
  expect(result.chartProgress).toHaveLength(40);
  expect(result.chartStats).toEqual({ streams: { rawRows: 80 }, maximumPageRows: 512, rowReads: 80 });
  expect(result.report.analysisScope).toMatchObject({ sourceRows: 20_003, eligibleRows: 10_002, filters: { region: 'East' } });
  expect(result.report.stats.value).toMatchObject({ type: 'number', sum: 11_001, median: 1, min: 1, max: 1000, missing: 0 });
  expect(result.report.quality).toMatchObject({ totalRows: 10_002, duplicateRows: 0, emptyRows: 0, missingCells: 0 });
  expect(result.report.insights).toContainEqual(expect.objectContaining({ kind: 'category', category: 'East', value: 11_001 }));
  expect(result.reportProgress.filter(({ phase }) => phase === 'quality')).toHaveLength(40);
  expect(result.reportProgress.filter(({ phase }) => phase === 'statistics')).toHaveLength(40);
  expect(result.reportStats).toEqual({ streams: { rawRows: 160 }, maximumPageRows: 512, rowReads: 160 });
  expect(result.semanticStats).toEqual({ streams: { rawRows: 160 }, maximumPageRows: 512, rowReads: 160 });
  await test.info().attach('incremental-worker-measurements.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});
