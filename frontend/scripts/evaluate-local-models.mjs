import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { approveImportedData } from '../e2e/review-helpers.js';
import { createCollection } from '../fixtures/collection.mjs';
import { collectionModelCases, independentModelCases } from '../fixtures/modelCollection.mjs';
import { approveCollectionRelationships, findFixtureSource, importFixtureCollection, selectFixtureSource } from '../e2e/collection-helpers.mjs';
import { scoreModelAnswer, findFreshEvaluationAnswer } from './model-evaluation-score.mjs';
import { selectEvaluationCases } from './model-evaluation-options.mjs';
if (!process.argv.includes('--download-models')) throw new Error('Fixture-only model downloads require --download-models against a production preview.');
const collection = process.argv.includes('--collection'); const fixtures = collection ? createCollection() : null;
const baselineCases = JSON.parse(await readFile(new URL('./model-evaluation-cases.json', import.meta.url), 'utf8'));
const independent = process.argv.includes('--independent');
if (independent && !collection) throw new Error('Independent questions require the synthetic collection.');
const cases = collection ? { thresholds: baselineCases.thresholds, cases: independent ? independentModelCases() : collectionModelCases() } : baselineCases;
const { selected: selectedCases, diagnostic: boundedSelection } = selectEvaluationCases(cases.cases, process.argv);
const diagnostic = independent || boundedSelection;
const nativeRecovery = process.argv.includes('--native-recovery');
if (nativeRecovery && (!boundedSelection || selectedCases.length !== 1 || !collection)) throw new Error('Native recovery requires one explicitly selected synthetic collection case.');
const traceLifecycle = process.argv.includes('--trace-lifecycle') || nativeRecovery;
if (traceLifecycle && !diagnostic) throw new Error('Lifecycle tracing requires a bounded diagnostic case selection.');
const outputDirectory = process.env.MODEL_EVALUATION_OUTPUT_DIR || 'audit-results';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8080';
const origin = new URL(baseURL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || !['http:', 'https:'].includes(origin.protocol)
  || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Model evaluation is limited to a disposable loopback preview origin.');
const angle = process.argv.find((value) => value.startsWith('--gpu-angle='))?.split('=')[1];
if (angle && !['d3d11', 'vulkan', 'metal', 'gl'].includes(angle)) throw new Error('Choose a reviewed GPU backend: d3d11, vulkan, metal or gl.');
const channel = process.argv.find((value) => value.startsWith('--browser-channel='))?.split('=')[1];
if (channel && !['chrome', 'msedge'].includes(channel)) throw new Error('Choose an installed Chrome or Edge channel.');
const browser = await chromium.launch({ channel, headless: !process.argv.includes('--headed'), args: angle ? [`--use-angle=${angle}`] : [] }); const context = await browser.newContext({ baseURL }); const page = await context.newPage();
const results = []; const evaluatedSpecs = []; let failure; let fixtureSources = []; let capabilities; let cacheProbe; let recoveryProbe; let diagnostics;
const networkFailures = [];
const assetFailures = [];
const generatedActions = [];
const plannerStages = [];
const hostTicks = []; const lifecycleEvents = []; const hostTraceStarted = performance.now();
const hostTimer = traceLifecycle ? setInterval(() => {
  hostTicks.push({ utcMs: Date.now(), elapsedMs: performance.now() - hostTraceStarted });
  if (hostTicks.length > 2000) hostTicks.shift();
}, 500) : null;
if (traceLifecycle) await page.addInitScript(() => {
  window.fixtureAssistantLifecycle = [];
  window.fixtureAssistantWorkerStages = [];
  const recordStage = (event) => {
    window.fixtureAssistantWorkerStages.push({ utcMs: Date.now(), elapsedMs: performance.now(), ...event });
    if (window.fixtureAssistantWorkerStages.length > 1000) window.fixtureAssistantWorkerStages.shift();
  };
  const NativeWorker = window.Worker;
  let workerSequence = 0;
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      const path = new URL(String(url), location.href).pathname;
      this.fixtureWorkerId = ++workerSequence;
      this.fixtureTraced = /^\/assets\/(runtime|analysis)\.worker-/.test(path);
      this.fixtureRequestSequence = 0;
      if (this.fixtureTraced) {
        recordStage({ phase: 'worker-created', workerId: this.fixtureWorkerId, asset: path });
        this.addEventListener('message', ({ data }) => {
          if (data?.progress) return;
          recordStage({ phase: 'reply', workerId: this.fixtureWorkerId,
            requestSequence: this.fixtureRequestSequence, hasError: Boolean(data?.error) });
        });
        this.addEventListener('error', () => recordStage({ phase: 'worker-error', workerId: this.fixtureWorkerId }));
      }
    }
    postMessage(message, ...args) {
      if (window.fixtureOverflowNext && message?.operation === 'generate') {
        message = structuredClone(message);
        message.payload.messages = [{ role: 'user', content: '数'.repeat(5000) }];
        delete message.payload.schemaContext.preparedPlans;
        window.fixtureOverflowNext = false;
        recordStage({ phase: 'native-overflow-injected', workerId: this.fixtureWorkerId });
      }
      if (this.fixtureTraced) recordStage({ phase: 'request', workerId: this.fixtureWorkerId,
        requestSequence: ++this.fixtureRequestSequence, operation: message?.operation });
      return super.postMessage(message, ...args);
    }
    terminate() {
      if (this.fixtureTraced) recordStage({ phase: 'worker-terminated', workerId: this.fixtureWorkerId });
      return super.terminate();
    }
  };
  let previous = performance.now();
  setInterval(() => {
    const now = performance.now(); const ask = document.querySelector('[data-assistant-lifecycle]');
    const models = document.querySelector('[data-model-lifecycle]');
    window.fixtureAssistantLifecycle.push({ utcMs: Date.now(), elapsedMs: now, timerGapMs: now - previous,
      askDisabled: ask?.disabled ?? null, ask: ask ? JSON.parse(ask.dataset.assistantLifecycle) : null,
      models: models ? JSON.parse(models.dataset.modelLifecycle) : null });
    if (window.fixtureAssistantLifecycle.length > 1000) window.fixtureAssistantLifecycle.shift();
    previous = now;
  }, 250);
});
const lifecycleEvent = (phase, caseId) => {
  if (traceLifecycle) lifecycleEvents.push({ phase, caseId, utcMs: Date.now(), elapsedMs: performance.now() - hostTraceStarted });
};
// Instrument only the disposable fixture worker, before its module executes.
// This records asset paths (never queries/payloads) for strict-policy diagnostics.
await context.route(/\/assets\/runtime\.worker-[^/]+\.js$/, async (route) => {
  const response = await route.fetch();
  const source = await response.text();
  const probe = `let fixtureFetch=self.fetch.bind(self);Object.defineProperty(self,'fetch',{configurable:true,get:()=>fixtureFetch,set:(next)=>{fixtureFetch=async(...args)=>{try{return await next(...args)}catch(error){const url=new URL(args[0] instanceof Request?args[0].url:String(args[0]),self.location.href);console.warn('fixture-asset-failure:'+url.origin+url.pathname);throw error}}}});const fixturePost=self.postMessage.bind(self);self.postMessage=(value,...args)=>{if(typeof value?.result==='string')console.log('fixture-action:'+value.result);if(value?.progress?.stage)console.log('fixture-planner-stage:'+JSON.stringify(value.progress));return fixturePost(value,...args)};`;
  await route.fulfill({ response, body: probe + source });
});
page.on('console', (message) => {
  if (message.text().startsWith('fixture-asset-failure:')) assetFailures.push(message.text().slice(22));
  if (message.text().startsWith('fixture-action:')) generatedActions.push(message.text().slice(15));
  if (message.text().startsWith('fixture-planner-stage:')) plannerStages.push(JSON.parse(message.text().slice(22)));
});
page.on('requestfailed', (request) => {
  const url = new URL(request.url());
  networkFailures.push({ asset: `${url.origin}${url.pathname}`, error: request.failure()?.errorText });
});
const loadTimeout = Number(process.env.MODEL_LOAD_TIMEOUT_MS || 180_000);
if (!Number.isFinite(loadTimeout) || loadTimeout < 1_000 || loadTimeout > 600_000) throw new Error('MODEL_LOAD_TIMEOUT_MS must be between 1000 and 600000.');
const waitForModel = async (target) => {
  await page.waitForFunction((target) => [...document.querySelectorAll('button')].filter((button) => button.textContent === 'Loaded').length >= target
    || document.querySelector('[role="alert"]')?.textContent, target, { timeout: loadTimeout });
  if (await page.getByRole('button', { name: 'Loaded', exact: true }).count() < target)
    throw new Error(`Model load failed: ${await page.getByRole('alert').first().innerText()}`);
};
const openModelControls = async () => {
  const button = page.getByRole('button', { name: 'Browser AI and local search', exact: true });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
};
const fixtureThreads = () => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('analytics-dashboard-local-data'); open.onerror = () => reject(open.error);
  open.onsuccess = () => { const database = open.result; const read = database.transaction('assistantArtifacts').objectStore('assistantArtifacts').getAll();
    read.onsuccess = () => { resolve(read.result.filter((artifact) => artifact.id.startsWith('conversation:'))); database.close(); };
    read.onerror = () => { database.close(); reject(read.error); }; };
}));
try {
  await page.goto(`${baseURL}/upload`);
  capabilities = await page.evaluate(async () => ({ webGPU: Boolean(navigator.gpu), adapter: Boolean(await navigator.gpu?.requestAdapter()), userAgent: navigator.userAgent }));
  console.log(JSON.stringify({ phase: 'capabilities', capabilities }));
  if (collection) {
    const catalog = await importFixtureCollection(page, fixtures);
    await approveCollectionRelationships(page, fixtures, catalog);
    await selectFixtureSource(page, findFixtureSource(catalog, fixtures[0]));
  } else {
    await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({ name: 'model-fixture.csv', mimeType: 'text/csv', buffer: Buffer.from(cases.csv) });
    await page.getByRole('button', { name: /visualize dashboard/i }).click(); await approveImportedData(page);
  }
  fixtureSources = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('analytics-dashboard-local-data'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const database = open.result; const read = database.transaction('datasetMetadata').objectStore('datasetMetadata').getAll();
      read.onsuccess = () => { resolve(read.result); database.close(); }; read.onerror = () => { database.close(); reject(read.error); }; };
  }));
  await page.getByRole('button', { name: 'Browser AI and local search', exact: true }).click();
  if (!await page.getByRole('button', { name: 'Download / load LLM', exact: true }).count())
    throw new Error('Generation is disabled. Evaluate only a separate build with VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM=true; keep release builds disabled.');
  for (const label of ['Download / load semantic search', 'Download / load LLM']) {
    if (label.includes('LLM') && !capabilities.adapter) { console.log('Skipping LLM: no WebGPU adapter. Semantic-only results cannot pass the full evaluation.'); continue; }
    console.log(JSON.stringify({ phase: 'loading', label }));
    await page.getByRole('button', { name: label, exact: true }).click();
    await waitForModel(label.includes('LLM') ? 2 : 1);
  }
  if (!collection) {
    await page.getByRole('button', { name: 'Build / resume full semantic index' }).click();
    await expect(page.getByText(/^Semantic index complete:/)).toBeVisible({ timeout: 180_000 });
  }
  const deadline = performance.now() + 12 * 60_000;
  for (const template of selectedCases) {
    if (performance.now() > deadline) throw new Error('The bounded fixture evaluation reached its twelve-minute question budget.');
    let spec = template;
    if (collection) {
      const source = findFixtureSource(fixtureSources, template.dataset);
      spec = { ...template, ...(template.graph ? { expectedGraphSources: 30, expectedGraphEdges: 20,
        expectedPathSourceIds: [source.id, findFixtureSource(fixtureSources, fixtures.find((item) => item.id === template.targetDataset.replace('-zones', '-entities'))).id,
          findFixtureSource(fixtureSources, fixtures.find((item) => item.id === template.targetDataset)).id],
        metric: `${source.id}::${template.metric}`, dimension: `${findFixtureSource(fixtureSources, fixtures.find((item) => item.id === template.targetDataset)).id}::${template.dimension}` } : {}) };
      if (await page.getByRole('combobox', { name: 'Select dataset', exact: true }).inputValue() !== source.id) await selectFixtureSource(page, source);
      const summary = page.getByRole('button', { name: 'Browser AI and local search', exact: true });
      if (!await page.getByLabel('Assistant mode').isVisible()) await summary.click();
      if (spec.mode === 'search') {
        await page.getByRole('button', { name: 'Build / resume full semantic index' }).click();
        await expect(page.getByText(/^Semantic index complete:/)).toBeVisible({ timeout: 180_000 });
      }
    }
    console.log(JSON.stringify({ phase: 'asking', id: spec.id }));
    lifecycleEvent('case-selected', spec.id);
    if (!capabilities.adapter && spec.mode !== 'search') continue;
    await openModelControls();
    await page.getByLabel('Assistant mode').selectOption(spec.mode);
    // Let React's mode/scope reset and IndexedDB conversation restore settle
    // before submitting; otherwise the reset can cancel this fixture question.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const clear = page.getByRole('button', { name: 'Clear Chat' }); if (!spec.followUp && await clear.count()) await clear.click();
    for (const polite of spec.politeTurns || []) {
      await page.getByRole('textbox', { name: 'Ask a question about this dataset' }).fill(polite);
      await page.getByRole('button', { name: /^Ask$/ }).click();
      await expect(page.getByRole('button', { name: /^Ask$/ })).toBeEnabled({ timeout: 5_000 });
    }
    const activeId = await page.getByRole('combobox', { name: 'Select dataset', exact: true }).inputValue();
    const activeSource = fixtureSources.find((source) => source.id === activeId);
    const sourceRevision = activeSource?.revisionKey || activeSource?.qualityReview?.revisionKey;
    if (!sourceRevision) throw new Error('The selected fixture source has no reviewed revision.');
    spec = { ...spec, expectedDatasetId: activeId };
    evaluatedSpecs.push(spec);
    const previousUserIds = (await fixtureThreads()).flatMap((thread) => thread.messages || []).filter((message) => message.role === 'user').map((message) => message.id);
    await page.getByRole('textbox', { name: 'Ask a question about this dataset' }).fill(spec.query);
    const started = performance.now(); await page.getByRole('button', { name: /^Ask$/ }).click();
    lifecycleEvent('ask-clicked', spec.id);
    await expect(page.getByText(spec.query, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Ask$/ })).toBeEnabled({ timeout: 90_000 });
    lifecycleEvent('ask-enabled', spec.id);
    let answer;
    await expect.poll(async () => {
      answer = findFreshEvaluationAnswer(await fixtureThreads(), { query: spec.query, previousUserIds, mode: spec.mode, sourceRevision });
      return Boolean(answer);
    }, { timeout: 10_000 }).toBe(true);
    results.push({ id: spec.id, dataset: spec.dataset?.id, mode: spec.mode,
      requestScope: { datasetId: activeId, revision: sourceRevision, mode: spec.mode, freshMessageOnly: true },
      ...scoreModelAnswer(spec, answer, fixtureSources), elapsedMs: performance.now() - started, answer });
    console.log(JSON.stringify({ phase: 'answer', id: spec.id, passed: results.at(-1).passed, elapsedMs: results.at(-1).elapsedMs, error: answer.error }));
    if (collection && spec.mode !== 'search' && !answer.error && (answer.graphCoverage?.approvedSources !== 30 || answer.graphCoverage?.acceptedEdges !== 20 || answer.graphCoverage?.excludedEdges !== 0))
      throw new Error(`Incomplete fixture graph scope: ${JSON.stringify(answer.graphCoverage || { error: answer.error })}`);
    if (spec.mode !== 'search' && await page.getByRole('button', { name: 'Loaded', exact: true, includeHidden: true }).count() < 2)
      throw new Error(`The model worker was unloaded after ${spec.id}; the failed answer is preserved. Reload recovery needs a separate bounded diagnostic.`);
  }
  if (nativeRecovery) {
    const spec = evaluatedSpecs[0];
    const counts = () => page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('analytics-dashboard-local-data'); open.onerror = () => reject(open.error);
      open.onsuccess = () => { const db = open.result; const tx = db.transaction(['datasetMetadata', 'sourceFiles', 'assistantArtifacts']); const value = {};
        for (const name of ['datasetMetadata', 'sourceFiles', 'assistantArtifacts']) { const read = tx.objectStore(name).count(); read.onsuccess = () => { value[name] = read.result; }; }
        tx.oncomplete = () => { db.close(); resolve(value); }; tx.onabort = () => reject(tx.error);
      };
    }));
    const before = await counts();
    const ask = async () => {
      const previousUserIds = (await fixtureThreads()).flatMap((thread) => thread.messages || []).filter((message) => message.role === 'user').map((message) => message.id);
      await page.getByRole('textbox', { name: 'Ask a question about this dataset' }).fill(spec.query);
      await page.getByRole('button', { name: /^Ask$/ }).click();
      await expect(page.getByRole('button', { name: /^Ask$/ })).toBeEnabled({ timeout: 90_000 });
      let answer;
      await expect.poll(async () => {
        answer = findFreshEvaluationAnswer(await fixtureThreads(), { query: spec.query, previousUserIds, mode: spec.mode, sourceRevision: results[0].requestScope.revision });
        return Boolean(answer);
      }, { timeout: 10_000 }).toBe(true);
      return answer;
    };
    console.log(JSON.stringify({ phase: 'native-context-overflow' }));
    await page.evaluate(() => { window.fixtureOverflowNext = true; });
    const overflow = await ask();
    if (!/prompt tokens exceed context window/i.test(overflow.error || '')) throw new Error('Native tokenizer overflow was not observed.');
    await expect(page.getByRole('button', { name: 'Loaded', exact: true, includeHidden: true })).toHaveCount(0);
    recoveryProbe = { nativeTokenizerOverflow: { error: overflow.error, askRecovered: true, modelsUnloaded: true },
      actualGPUDeviceLoss: { status: 'not exercised', reason: 'No supported mechanism exposes the model-owned GPU device; synthetic worker errors are separate evidence.' } };
    await openModelControls();
    for (const [label, target] of [['Download / load semantic search', 1], ['Download / load LLM', 2]]) {
      await page.getByRole('button', { name: label, exact: true }).click(); await waitForModel(target);
    }
    console.log(JSON.stringify({ phase: 'native-inference-cancellation' }));
    const stageCount = plannerStages.length;
    await page.getByRole('textbox', { name: 'Ask a question about this dataset' }).fill(spec.query);
    await page.getByRole('button', { name: /^Ask$/ }).click();
    await expect.poll(() => plannerStages.length > stageCount, { timeout: 15_000 }).toBe(true);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Ask$/ })).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Loaded', exact: true, includeHidden: true })).toHaveCount(0);
    recoveryProbe.nativeInferenceCancellation = { observedGenerationStart: true, askRecovered: true, modelsUnloaded: true };
    await openModelControls();
    await context.route(/^https:\/\//, (route) => route.abort());
    for (const [label, target] of [['Download / load semantic search', 1], ['Download / load LLM', 2]]) {
      await page.getByRole('button', { name: label, exact: true }).click(); await waitForModel(target);
    }
    const retry = await ask();
    const retryScore = scoreModelAnswer(spec, retry, fixtureSources);
    if (!retryScore.passed) throw new Error('The native recovery retry did not answer the original question correctly.');
    const after = await counts();
    if (after.datasetMetadata !== before.datasetMetadata || after.sourceFiles !== before.sourceFiles || after.assistantArtifacts < before.assistantArtifacts) throw new Error('Native recovery lost fixture artifacts.');
    recoveryProbe.cachedOfflineReloadAndRetry = { embeddings: true, llm: true, passed: true, before, after };
  }
  console.log(JSON.stringify({ phase: 'cached-model-reload' }));
  await openModelControls();
  await page.getByRole('button', { name: 'Stop / unload models', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Loaded', exact: true })).toHaveCount(0);
  await context.route(/^https:\/\//, (route) => route.abort());
  await page.getByRole('button', { name: 'Download / load semantic search', exact: true }).click();
  await waitForModel(1);
  await page.getByRole('button', { name: 'Delete downloaded models', exact: true }).click();
  await expect(page.getByText('Model caches deleted. Source data and conversations retained.', { exact: true })).toBeVisible({ timeout: 30_000 });
  const retained = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('analytics-dashboard-local-data'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result; const transaction = db.transaction(['datasetMetadata', 'assistantArtifacts', 'sourceFiles']); const result = {};
      for (const name of ['datasetMetadata', 'assistantArtifacts', 'sourceFiles']) { const read = transaction.objectStore(name).count(); read.onsuccess = () => { result[name] = read.result; }; }
      transaction.oncomplete = () => { db.close(); resolve(result); }; transaction.onabort = () => reject(transaction.error);
    };
  }));
  cacheProbe = { reloadedWithoutHTTPS: true, deletedModelCache: true, retained };
  if (retained.datasetMetadata !== fixtureSources.length || retained.sourceFiles !== (collection ? 30 : 1) || !retained.assistantArtifacts) throw new Error('Model deletion did not retain fixture source/conversation storage.');
} catch (error) {
  failure = error.message;
  lifecycleEvent('evaluation-failed');
  diagnostics = await page.locator('body').innerText().catch(() => 'No readable fixture page.');
  diagnostics = diagnostics.slice(-12_000);
}
finally {
  if (hostTimer) clearInterval(hostTimer);
  try {
    if (traceLifecycle) {
      let traceTimer;
      const browserTrace = await Promise.race([
        page.evaluate(() => ({ ticks: window.fixtureAssistantLifecycle, workerStages: window.fixtureAssistantWorkerStages })).catch(() => null),
        new Promise((resolve) => { traceTimer = setTimeout(() => resolve(null), 10_000); }),
      ]).finally(() => clearTimeout(traceTimer));
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(`${outputDirectory}/assistant-lifecycle.json`, JSON.stringify({ hostTicks, browserTicks: browserTrace?.ticks ?? null,
        workerStages: browserTrace?.workerStages ?? null, events: lifecycleEvents,
        boundary: 'Explicit bounded synthetic diagnostic only. Host ticks 500 ms, last 2000 retained; browser ticks 250 ms and worker stage events each retain last 1000 and reset on full navigation. Browser trace read capped at 10 seconds; null means unavailable. DOM states and operation-only worker stages contain no prompt/row payload. Scheduling gaps do not by themselves establish their physical cause.' }, null, 2));
    }
  } finally {
    try { await context.close(); } finally { await browser.close(); }
  }
}
const toolSteps = results.flatMap(({ answer }) => answer.steps || []); const invalidToolRate = toolSteps.length ? toolSteps.filter((step) => !step.success).length / toolSteps.length : null;
const timings = results.map(({ elapsedMs }) => elapsedMs).sort((a, b) => a - b); const p95 = timings[Math.ceil(timings.length * .95) - 1] ?? null;
const numericCases = results.filter(({ numericCase }) => numericCase);
const numericAccuracy = numericCases.length ? numericCases.filter(({ passed }) => passed).length / numericCases.length : null;
const fabricatedCitations = results.reduce((count, result) => count + result.invalidCitations.length, 0);
const planningRoutes = Object.fromEntries([...new Set(results.flatMap(({ answer }) => answer.planning?.routes || []))].map((route) => [route,
  results.filter(({ answer }) => answer.planning?.routes?.includes(route)).length]));
const passed = !diagnostic && !failure && results.length === cases.cases.length && results.every((result) => result.passed) && numericAccuracy >= cases.thresholds.numericAccuracy && fabricatedCitations <= cases.thresholds.fabricatedCitations && invalidToolRate !== null && invalidToolRate <= cases.thresholds.invalidToolRateMaximum && p95 <= cases.thresholds.p95AnswerMilliseconds;
await mkdir(outputDirectory, { recursive: true }); await writeFile(`${outputDirectory}/${independent ? 'independent' : collection ? 'collection' : 'local'}-model-${diagnostic ? 'diagnostic' : 'evaluation'}.json`, JSON.stringify({ measuredAt: new Date().toISOString(), evaluationVersion: 2,
  answerScopePolicy: 'fresh user-message identity, selected source revision, mode and empty dashboard filter scope; direct numeric/citation source checked',
  planner: 'hybrid: explicit request binding and model-selected prepared candidates; staged model tools for unbound requests; validated read-only execution', planningRoutes,
  fixtureOnly: true, fixtureSources: collection ? 30 : 1, completedCases: results.length, expectedCases: cases.cases.length, selectedCases: selectedCases.length, diagnostic,
  browser: channel || 'Chromium', capabilities, cacheProbe, recoveryProbe, diagnostics, generatedActions, plannerStages, assetFailures: assetFailures.slice(0, 20), networkFailures: networkFailures.slice(0, 20), models: 'configured MiniLM and Qwen assets; live downloads explicitly requested', thresholds: cases.thresholds, passed, failure, numericAccuracy, fabricatedCitations, invalidToolRate, p95, results,
  limitations: 'Synthetic desktop fixture suite, not a production quality guarantee. Collection mode includes thirty sources, retrieval-first RAG, follow-ups, proposals and five reviewed two-hop graph questions. Citation identities/revisions/fields/row ranges are checked against actual saved fixture metadata. Prose factuality, native tokenizer overflow, actual GPU loss and physical-device behavior remain outside this run.' }, null, 2));
console.log(JSON.stringify({ passed, failure, numericAccuracy, fabricatedCitations, invalidToolRate, p95, cases: results.map(({ id, passed }) => ({ id, passed })) })); if (!passed) process.exitCode = 1;
