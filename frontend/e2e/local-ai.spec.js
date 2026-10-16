import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { approveImportedData } from './review-helpers';

test('local evidence search persists a scoped conversation without model or API requests', async ({ page }) => {
  const requests = []; const errors = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() }));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/upload');
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'private-ai-fixture.csv', mimeType: 'text/csv',
    buffer: Buffer.from('ID,Region,Revenue,Notes\n001,East,0.0001,private-sentinel-evidence\n002,West,0.0002,ordinary note\n') });
  await page.getByRole('button', { name: /visualize dashboard/i }).click();
  await approveImportedData(page);
  const selectedDataset = page.getByRole('combobox', { name: 'Select dataset', exact: true });
  const datasetId = await selectedDataset.inputValue();
  await page.getByRole('button', { name: 'Browser AI and local search', exact: true }).click();
  await page.getByRole('combobox', { name: 'Assistant mode' }).selectOption('search');
  await page.getByRole('textbox', { name: 'Ask a question about this dataset' }).fill('private-sentinel-evidence');
  await page.getByRole('button', { name: /^Ask$/ }).click();
  await expect(page.getByText(/^Source evidence \(\d+\)$/)).toBeVisible();
  await page.getByText(/^Source evidence \(\d+\)$/).click();
  await expect(page.getByText(/Notes: private-sentinel-evidence/)).toBeVisible();
  await expect(page.getByText(/Search coverage: 2 of 2 eligible rows/)).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open('analytics-dashboard-local-data');
    return new Promise((resolve) => { request.onsuccess = () => {
      const db = request.result; const read = db.transaction('assistantArtifacts').objectStore('assistantArtifacts').getAll();
      read.onsuccess = () => { db.close(); resolve(read.result.some((record) => record.messages?.some((message) => message.text === 'private-sentinel-evidence'))); };
    }; });
  })).toBe(true);
  await page.reload();
  // The sample dashboard can render before IndexedDB restores this source.
  // Wait for the saved selection before clicking controls that will remount.
  await expect(selectedDataset).toHaveValue(datasetId);
  await page.getByRole('button', { name: 'Browser AI and local search', exact: true }).click();
  await page.getByRole('combobox', { name: 'Assistant mode' }).selectOption('search');
  await page.getByRole('button', { name: 'Expand assistant details', exact: true }).click();
  await expect(page.getByText(/^Source evidence \(\d+\)$/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear Chat' }).click();
  await expect(page.getByText(/^Source evidence \(\d+\)$/)).toHaveCount(0);
  await page.reload();
  await expect(selectedDataset).toHaveValue(datasetId);
  await page.getByRole('button', { name: 'Browser AI and local search', exact: true }).click();
  await page.getByRole('combobox', { name: 'Assistant mode' }).selectOption('search');
  await expect(page.getByText(/^Source evidence \(\d+\)$/)).toHaveCount(0);
  for (const request of requests) {
    expect(new URL(request.url).origin).toBe(new URL(test.info().project.use.baseURL).origin);
    expect(new URL(request.url).pathname).not.toMatch(/^\/api/);
    expect(request.method).toBe('GET');
    expect(`${request.url} ${request.body || ''}`).not.toMatch(/private-ai-fixture|private-sentinel-evidence|Revenue|Notes/);
  }
  expect(errors).toEqual([]);
});

test('release offers optional semantic search and excludes experimental generation', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Browser AI and local search', exact: true }).click();
  const mode = page.getByRole('combobox', { name: 'Assistant mode' });
  await expect(mode.locator('option[value="agent"]')).toHaveCount(0);
  await expect(mode.locator('option[value="rag"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download / load semantic search' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download / load LLM' })).toHaveCount(0);
});

test('compiled model worker starts and refuses inference before an explicit model load', async ({ page }) => {
  const remoteRequests = [];
  page.on('request', (request) => { if (new URL(request.url()).origin !== new URL(test.info().project.use.baseURL).origin) remoteRequests.push(request.url()); });
  const workerFile = readdirSync(resolve('dist/assets')).find((name) => /^runtime\.worker-.*\.js$/.test(name));
  expect(workerFile).toBeTruthy();
  await page.goto('/dashboard');
  const replies = await page.evaluate(async (filename) => {
    const worker = new Worker(`/assets/${filename}`, { type: 'module' });
    const request = (operation, payload = {}) => new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => resolve(data);
      worker.onerror = () => reject(new Error('Model worker failed to start.'));
      worker.postMessage({ id: operation, operation, payload });
    });
    try { return [await request('generate', { messages: [] }), await request('load-llm'), await request('embed', { texts: ['local-only-sentinel'] }), await request('unsupported-operation')]; }
    finally { worker.terminate(); }
  }, workerFile);
  expect(replies.slice(0, 2).every(({ error }) => error.includes('disabled in this build'))).toBe(true);
  expect(replies.slice(2).map(({ error }) => error)).toEqual(['Load the semantic search model first.', 'Unsupported model operation.']);
  expect(remoteRequests).toEqual([]);
});
