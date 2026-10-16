import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

const output = path.resolve('src/assets/images/landing-social-preview.jpg');
const server = await preview({ preview: { host: '127.0.0.1', port: 4173, strictPort: false, open: false } });
let browser;
try {
  const port = server.httpServer.address().port;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const response = await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`Landing preview returned ${response?.status() ?? 'no response'}`);
  await page.locator('h1').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await page.screenshot({ path: output, type: 'jpeg', quality: 88, animations: 'disabled' });
  console.log(`Captured the actual landing page: ${output}`);
} finally {
  await browser?.close();
  const closed = new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
  server.httpServer.closeAllConnections();
  await closed;
}
