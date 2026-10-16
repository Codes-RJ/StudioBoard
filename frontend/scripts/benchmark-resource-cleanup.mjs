import { chromium, expect } from '@playwright/test';
import https from 'node:https';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { benchmarkOrigin, observeBrowserJourney } from './browser-journey-telemetry.mjs';
import { approveImportedData } from '../e2e/review-helpers.js';

const output = process.env.BENCHMARK_OUTPUT_DIR || 'audit-results';
const baseURL = benchmarkOrigin();
const fixtureDirectory = path.join(output, 'synthetic-tls-fixture');
await mkdir(fixtureDirectory, { recursive: true });
const key = path.resolve(fixtureDirectory, 'key.pem'); const cert = path.resolve(fixtureDirectory, 'cert.pem');
await promisify(execFile)(process.platform === 'win32' ? 'openssl.exe' : 'openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
  '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
], { windowsHide: true });
const connections = { started: 0, closed: 0, finished: 0 };
const server = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
  connections.started++;
  response.on('finish', () => { connections.finished++; });
  response.on('close', () => { connections.closed++; });
  response.writeHead(200, { 'Content-Type': 'text/csv', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Private-Network': 'true' });
  if (request.url === '/complete.csv') { response.end('ID,Value\n001,1\n002,2\n'); return; }
  response.write('ID,Value\n');
  const timer = setInterval(() => response.write('fixture,1\n'), 100);
  response.on('close', () => { clearInterval(timer); });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
// Only this disposable context accepts the fixture's one-day self-signed cert.
const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
const page = await context.newPage(); const cdp = await context.newCDPSession(page);
const telemetry = await observeBrowserJourney(page, cdp);
const report = { connections, cases: [] };
try {
  await page.goto('/upload');
  await page.getByRole('button', { name: 'URL / Google Sheets', exact: true }).click();
  await page.locator('#import-url').fill(`https://127.0.0.1:${server.address().port}/fixture.csv`);
  await page.getByRole('button', { name: /Import & Visualize/ }).click();
  await expect.poll(() => connections.started).toBe(1);
  const cancelledAt = performance.now();
  await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
  await expect(page.getByRole('button', { name: /Import & Visualize/ })).toBeEnabled();
  await expect.poll(() => connections.closed).toBe(1);
  await telemetry.waitForWorkersIdle();
  report.cases.push({ kind: 'native-https-body-cancel', settledMs: performance.now() - cancelledAt,
    checkpoint: await telemetry.checkpoint('url-cancelled-and-server-closed') });

  await page.getByRole('button', { name: 'Drop Local File' }).click();
  const line = `001,1,${Array.from({ length: 10 }, () => 'synthetic-fixture-'.repeat(4)).join(',')}\n`;
  const bytes = Buffer.from(`ID,Value,${Array.from({ length: 10 }, (_, i) => `Text${i}`).join(',')}\n` + line.repeat(50_000));
  // Pass an actual fixture path: transferring a large base64 buffer through CDP
  // would measure automation serialization allocations inside the browser too.
  const fixturePath = path.resolve(output, 'cancel-fixture.csv');
  await writeFile(fixturePath, bytes);
  await page.locator('input[type="file"]:not([webkitdirectory])').first().setInputFiles(fixturePath);
  const createdBefore = telemetry.live().workersCreated;
  await page.getByRole('button', { name: /Visualize Dashboard/ }).click();
  await expect.poll(() => telemetry.live().workersCreated).toBeGreaterThan(createdBefore);
  const fileCancelledAt = performance.now();
  await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
  await expect(page.getByRole('button', { name: /Visualize Dashboard/ })).toBeEnabled();
  await telemetry.waitForWorkersIdle();
  const storedCounts = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('analytics-dashboard-local-data'); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result; const names = ['datasets', 'datasetMetadata', 'datasetRows', 'workspaceImports', 'stagedDatasets', 'stagedFiles', 'sourceFiles', 'sourceFileChunks'];
      const transaction = database.transaction(names); const result = {};
      for (const name of names) { const read = transaction.objectStore(name).count(); read.onsuccess = () => { result[name] = read.result; }; }
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
  expect(Object.values(storedCounts).every((count) => count === 0)).toBe(true);
  report.cases.push({ kind: 'real-csv-worker-cancel', fixtureBytes: bytes.length, settledMs: performance.now() - fileCancelledAt,
    storedCounts, checkpoint: await telemetry.checkpoint('file-cancelled-and-staging-empty') });

  await page.getByRole('button', { name: 'URL / Google Sheets', exact: true }).click();
  await page.locator('#import-url').fill(`https://127.0.0.1:${server.address().port}/complete.csv`);
  const completedAt = performance.now();
  await page.getByRole('button', { name: /Import & Visualize/ }).click();
  await approveImportedData(page, { timeout: 60_000 });
  await expect(page.getByRole('textbox', { name: 'Ask a question about this dataset' })).toBeEnabled();
  await expect.poll(() => ({ ...connections })).toEqual({ started: 2, closed: 2, finished: 1 });
  await telemetry.waitForWorkersIdle();
  report.cases.push({ kind: 'native-https-completion', settledMs: performance.now() - completedAt,
    checkpoint: await telemetry.checkpoint('url-completed-reviewed-and-server-closed') });
  report.passed = true;
} catch (error) { report.passed = false; report.failure = error.message; process.exitCode = 1; }
finally {
  await telemetry.stop(); report.telemetry = telemetry.summary();
  await browser.close();
  const closed = new Promise((resolve) => server.close(resolve)); server.closeAllConnections(); await closed;
}
report.measuredAt = new Date().toISOString();
report.boundary = 'Disposable desktop Chromium, owned HTTPS streaming fixture and real CSV worker. No external dataset/model traffic. Self-signed TLS accepted only for this fixture context; not hosted TLS acceptance. Cleanup counts are captured before forced browser/server teardown. Synthetic fixture certificate is not a production credential.';
await writeFile(path.join(output, 'resource-cleanup.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, failure: report.failure, cases: report.cases, resources: report.telemetry.resources }));
