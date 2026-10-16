import path from 'node:path';
import { benchmarkOrigin, observeBrowserJourney } from './browser-journey-telemetry.mjs';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { createCollection } from '../fixtures/collection.mjs';
import { findFixtureSource, importFixtureCollection, selectFixtureSource } from '../e2e/collection-helpers.mjs';
import { sampleBrowserMemory } from './browser-process-memory.mjs';

const fixtures = createCollection({ scale: 20 });
const outputDirectory = process.env.BENCHMARK_OUTPUT_DIR || 'audit-results';
await mkdir(outputDirectory, { recursive: true });
const baseURL = benchmarkOrigin();
const browser = await chromium.launch(); const memory = await sampleBrowserMemory(browser);
const context = await browser.newContext({ locale: 'en-US', baseURL }); const page = await context.newPage(); page.setDefaultTimeout(60_000);
const cdp = await context.newCDPSession(page); const telemetry = await observeBrowserJourney(page, cdp); const selections = []; let failure; let importMs; let lag; let workerCount; let telemetryReport;
await page.addInitScript(() => { let previous = performance.now(); window.fixtureMaximumTimerGap = 0;
  setInterval(() => { const now = performance.now(); window.fixtureMaximumTimerGap = Math.max(window.fixtureMaximumTimerGap, now - previous); previous = now; }, 50); });
try {
  const started = performance.now(); const catalog = await importFixtureCollection(page, fixtures, { reviewTimeout: 60_000 }); importMs = performance.now() - started;
  await telemetry.checkpoint('collection-import-and-review-complete');
  for (const fixture of fixtures) {
    const start = performance.now(); await selectFixtureSource(page, findFixtureSource(catalog, fixture));
    await telemetry.checkpoint(`selected-${fixture.id}`);
    selections.push({ id: fixture.id, rows: fixture.rows.length, columns: Object.keys(fixture.rows[0]).length, readyMs: performance.now() - start,
      mainThreadHeapBytes: (await cdp.send('Performance.getMetrics')).metrics.find(({ name }) => name === 'JSHeapUsedSize')?.value });
  }
  const deadline = performance.now() + 5_000;
  do {
    workerCount = (await cdp.send('Target.getTargets')).targetInfos.filter(({ type, url }) => type === 'worker' && /(?:Parser|Transforms|analysis|aiAssistant)\.worker-/.test(url)).length;
    if (!workerCount) break;
    if (performance.now() > deadline) throw new Error('Analytical workers remained after the final selection.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (workerCount);
  await telemetry.waitForWorkersIdle(); await telemetry.checkpoint('selection-cleanup-complete');
  lag = await page.evaluate(() => window.fixtureMaximumTimerGap);
} catch (error) {
  failure = error.message; process.exitCode = 1;
  await writeFile(path.join(outputDirectory, 'failure-page.txt'), await page.locator('body').innerText()).catch(() => {});
  await page.screenshot({ path: path.join(outputDirectory, 'failure-page.png'), fullPage: true, timeout: 10_000 }).catch(() => {});
}
finally { await telemetry.stop(); telemetryReport = telemetry.summary(); await memory.stop(); await browser.close(); }
await mkdir(outputDirectory, { recursive: true });
const report = { measuredAt: new Date().toISOString(), fixtureSources: fixtures.length, totalRows: fixtures.reduce((sum, fixture) => sum + fixture.rows.length, 0),
  passed: !failure && selections.length === 30, failure, importAndAutomatedReviewMs: importMs, maximumObserved50msTimerGapMs: lag,
  analyticalWorkersAfterFinalSelection: workerCount, telemetry: telemetryReport, processMemory: memory.summary(), selections,
  hardware: { cpu: os.cpus()[0]?.model, physicalMemoryBytes: os.totalmem(), logicalCpus: os.cpus().length },
  boundary: 'Thirty real CSV imports and source switches on desktop Chromium. Timings include automated quality approval; timer gaps include navigation and rendering. Worker disappearance is scoped to analytical worker URLs, not complete browser resource idle. Coarse sampled memory misses transient peaks; no physical mobile or hosting-concurrency guarantee.' };
await writeFile(path.join(outputDirectory, 'collection-journey.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, failure, fixtureSources: report.fixtureSources, totalRows: report.totalRows, importMs, selections: selections.length, processMemory: report.processMemory }));
