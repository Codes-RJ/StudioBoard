import path from 'node:path';
import { benchmarkOrigin, observeBrowserJourney } from './browser-journey-telemetry.mjs';
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { approveImportedData, openWorkspaceActions } from '../e2e/review-helpers.js';
import { sampleBrowserMemory } from './browser-process-memory.mjs';

const outputDirectory = process.env.BENCHMARK_OUTPUT_DIR || 'audit-results';
const baseURL = benchmarkOrigin();
const samples = [];
const ready = async (page, rows) => {
  await expect(page.getByRole('textbox', { name: 'Ask a question about this dataset' })).toBeEnabled({ timeout: 60_000 });
  const table = page.getByRole('region', { name: /data preview$/ }).first();
  await expect(table).toBeVisible({ timeout: 60_000 });
  await expect(table.getByText(new RegExp(`of ${rows.toLocaleString('en-US')}$`))).toBeVisible();
  await expect(page.locator('[role="figure"] .animate-spin')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText(/Calculating chart over|Loading interactive renderer/)).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Retry chart' })).toHaveCount(0);
  await expect(page.locator('[role="figure"] [role="alert"]')).toHaveCount(0);
};

for (const spec of [{ rows: 100, columns: 8 }, { rows: 10_000, columns: 8 }, { rows: 1_000, columns: 100 }]) {
  const browser = await chromium.launch(); const memory = await sampleBrowserMemory(browser);
  const context = await browser.newContext({ locale: 'en-US' }); const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const fields = ['ID', 'Revenue', 'Region', ...Array.from({ length: spec.columns - 3 }, (_, i) => `Extra_${i}`)];
  const bytes = Buffer.from([fields.join(','), ...Array.from({ length: spec.rows }, (_, i) =>
    [String(i).padStart(7, '0'), i + 1, i % 2 ? 'East' : 'West', ...fields.slice(3).map(() => 'fixture')].join(','))].join('\r\n'));
  const cdp = await context.newCDPSession(page);
  const telemetry = await observeBrowserJourney(page, cdp);
  const sample = { ...spec, bytes: bytes.length };
  try {
    await page.goto(`${baseURL}/upload`);
    await telemetry.checkpoint('before-import');
    const start = performance.now();
    await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles({ name: 'journey.csv', mimeType: 'text/csv', buffer: bytes });
    const visualize = page.getByRole('button', { name: /visualize dashboard/i });
    await expect(visualize).toBeEnabled(); sample.fileToUploadReadyMs = performance.now() - start;
    const reviewStart = performance.now(); await visualize.click(); await approveImportedData(page, { timeout: 60_000 });
    sample.reviewAndApprovalMs = performance.now() - reviewStart;
    await ready(page, spec.rows); sample.fileToDashboardReadyMs = performance.now() - start;
    await telemetry.checkpoint('dashboard-ready');
    sample.mainThreadHeapBytes = (await cdp.send('Performance.getMetrics')).metrics.find(({ name }) => name === 'JSHeapUsedSize')?.value;
    const backupStart = performance.now(); const download = page.waitForEvent('download');
    await openWorkspaceActions(page);
    await page.getByRole('button', { name: 'Backup', exact: true }).click(); const file = await download; const path = await file.path();
    sample.backupMs = performance.now() - backupStart;
    const text = await readFile(path, 'utf8'); sample.backupBytes = Buffer.byteLength(text);
    const records = text.trim().split('\n').map((line) => JSON.parse(line).payload);
    expect(Buffer.concat(records.filter((record) => record.type === 'file').map((record) => Buffer.from(record.base64, 'base64')))).toEqual(bytes);
    await telemetry.checkpoint('backup-complete');
    await openWorkspaceActions(page);
    const restoreStart = performance.now(); await page.getByLabel('Choose workspace backup').setInputFiles(path);
    await approveImportedData(page, { timeout: 60_000 }); await ready(page, spec.rows); sample.restoreToDashboardReadyMs = performance.now() - restoreStart;
    await openWorkspaceActions(page);
    await page.getByRole('button', { name: 'Data Health' }).click();
    const originalDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Original File', exact: true }).click();
    expect(await readFile(await (await originalDownload).path())).toEqual(bytes);
    expect(errors).toEqual([]); sample.originalBytesVerified = true;
    sample.cleanupMs = await telemetry.waitForWorkersIdle();
    await telemetry.checkpoint('restore-original-and-cleanup-complete'); sample.passed = true;
  } catch (error) { sample.passed = false; sample.failure = error.message; process.exitCode = 1; }
  finally { await telemetry.stop(); sample.telemetry = telemetry.summary(); await memory.stop(); sample.processMemory = memory.summary(); await browser.close(); }
  samples.push(sample); console.log(JSON.stringify(sample));
}
await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, 'import-journey.json'), JSON.stringify({ measuredAt: new Date().toISOString(),
  hardware: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, physicalMemoryBytes: os.totalmem(), platform: os.platform() },
  scope: 'Fresh Chromium per fixture; actual CSV upload, quality dialog approval, rendered table row count, visible chart loading completion, backup and restore. Timings include automated clicks, not human review time. Original bytes verified after restore. No model downloads.',
  limitations: 'Three single-run desktop fixtures, not capacity limits, physical mobile evidence or all chart types. One-second process and requested 100ms main-thread heap samples miss transient peaks; heap excludes workers. CPU throttling is emulation. Does not measure GPU, physical weak devices, host concurrency, screen readers or complete browser resource idle.', samples }, null, 2));
