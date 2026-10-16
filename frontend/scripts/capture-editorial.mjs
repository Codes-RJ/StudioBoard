import { openWorkspaceActions } from '../e2e/review-helpers.js';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('audit-results/redesign-2026-10-10');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1760 }], ['mobile', { width: 390, height: 844 }], ['tablet', { width: 768, height: 1024 }], ['laptop', { width: 1024, height: 768 }]]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    let errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    for (const route of ['/', '/how-it-works', '/upload', '/privacy', '/terms', '/dashboard', '/missing-redesign-page']) {
      errors = [];
      const response = await page.goto(`http://127.0.0.1:8080${route}`);
      await page.locator('h1').waitFor();
      if (route === '/dashboard') await page.locator('.recharts-wrapper').first().waitFor();
      const slug = route.slice(1) || 'home';
      await page.screenshot({ path: path.join(output, `${name}-${slug}.png`), fullPage: true });
      const measurements = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, fonts: [getComputedStyle(document.querySelector('h1')).fontFamily, getComputedStyle(document.body).fontFamily], background: getComputedStyle(document.body).backgroundColor }));
      results.push({ name, route, status: response.status(), ...measurements, errors: [...errors] });
      if (route === '/' || route === '/upload') await page.locator(route === '/' ? '.landing-hero' : '.import-surface').screenshot({ path: path.join(output, `${name}-${slug}-detail.png`) });
      if (route === '/how-it-works') await page.locator('#import').screenshot({ path: path.join(output, `${name}-guide-import-detail.png`) });
    }
    await context.close();
  }
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:8080/upload');
    await page.getByLabel('Choose a data file', { exact: true }).setInputFiles({ name: 'studio-review.csv', mimeType: 'text/csv', buffer: Buffer.from('region,revenue,orders\nNorth,120,8\nSouth,230,12\nWest,340,19\n') });
    await page.getByRole('button', { name: 'Visualize Dashboard', exact: true }).click();
    await page.getByRole('button', { name: 'Review Data', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Data Quality & Cleaning' });
    await review.waitFor();
    await page.screenshot({ path: path.join(output, `${name}-review-dialog.png`) });
    await review.getByRole('button', { name: 'Approve Data', exact: true }).click();
    await review.waitFor({ state: 'hidden' });
    await openWorkspaceActions(page);
    await page.getByRole('button', { name: 'Encrypted backup', exact: true }).click();
    const backup = page.getByRole('dialog', { name: 'Create encrypted backup' });
    await backup.waitFor();
    await page.screenshot({ path: path.join(output, `${name}-backup-dialog.png`) });
    await backup.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Edit dashboard', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Edit dashboard', exact: true });
    await editor.waitFor();
    await page.screenshot({ path: path.join(output, `${name}-editor-drawer.png`) });
    await editor.getByRole('button', { name: 'Add Bar graph', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    await page.getByText('Graph configuration is valid').last().waitFor();
    await page.screenshot({ path: path.join(output, `${name}-chart-configuration.png`) });
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(path.join(output, 'capture.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ routes: results.length, overflow: results.filter((item) => item.content > item.viewport), unexpectedErrors: results.filter((item) => item.errors.length && item.status !== 404), homeHeight: results.find((item) => item.name === 'desktop' && item.route === '/').height, output }, null, 2));
