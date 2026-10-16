import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { securityHeaders } from './security-headers.mjs';
import { APP_ROUTES, PUBLIC_ROUTES } from '../src/utils/seo.mjs';

const directory = fileURLToPath(new URL('..', import.meta.url));
// A production origin is supplied by the operator. Previews never inherit it.
const preview = process.env.CONTEXT && process.env.CONTEXT !== 'production';
const env = { ...process.env, VITE_ENABLE_SERVER_WORKSPACE: 'false',
  VITE_ENABLE_EXPERIMENTAL_LOCAL_LLM: 'false', ...(preview ? { VITE_PUBLIC_SITE_URL: '' } : {}) };
const code = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['scripts/build-model-evaluation.mjs', '--release'], {
    cwd: directory, env, stdio: 'inherit', windowsHide: true,
  });
  child.once('error', reject); child.once('exit', (status) => resolve(status ?? 1));
});
if (code !== 0) process.exitCode = code;
else {
  const header = (route, values) => `${route}\n${Object.entries(values).map(([key, value]) => `  ${key}: ${value}`).join('\n')}\n`;
  let headers = header('/*', { ...securityHeaders, 'Strict-Transport-Security': 'max-age=31536000' });
  headers += header('/assets/*', { 'Cache-Control': 'public, max-age=31536000, immutable' });
  const revalidate = { 'Cache-Control': 'no-cache' };
  for (const route of PUBLIC_ROUTES) {
    headers += header(route, revalidate);
    headers += header(route === '/' ? '/index.html' : `${route}/*`, revalidate);
  }
  for (const route of APP_ROUTES) {
    const values = { ...revalidate, 'X-Robots-Tag': 'noindex, follow' };
    headers += header(route, values) + header(`${route}/*`, values);
  }
  for (const route of ['/404.html', '/robots.txt', '/sitemap.xml', '/third-party-notices.txt']) headers += header(route, revalidate);
  const redirects = ['/api /404.html 404!', '/api/* /404.html 404!', '/metrics /404.html 404!',
    ...[...PUBLIC_ROUTES, ...APP_ROUTES].filter((route) => route !== '/').map((route) => `${route} ${route}/index.html 200`),
    '/* /404.html 404'].join('\n') + '\n';
  await writeFile(new URL('../dist/_headers', import.meta.url), headers);
  await writeFile(new URL('../dist/_redirects', import.meta.url), redirects);
  console.log('Generated Netlify static headers/routes. Upload dist only; hosted edge acceptance is still required.');
}
