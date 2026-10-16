import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { PUBLIC_ROUTES, APP_ROUTES, publicOrigin } from '../src/utils/seo.mjs';

// Read-only checks against a chosen deployment. No accounts, workspace data,
// load generation, domain changes or publication are performed.
export async function checkDeployment(value, { fetcher = fetch } = {}) {
  const origin = publicOrigin(value);
  if (!origin || !String(value).startsWith('https://')) throw new Error('Supply a public HTTPS origin with no path, credentials, query or fragment.');
  const checks = []; const add = (name, passed) => checks.push({ name, passed: Boolean(passed) });
  const request = async (pathname) => {
    let url = new URL(pathname, origin);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetcher(url.href, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'Accept-Encoding': 'gzip, br' } });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        await response.body?.cancel(); url = new URL(response.headers.get('location'), url);
        if (url.origin !== origin || url.protocol !== 'https:') throw new Error('Deployment redirects outside the chosen HTTPS origin.');
        continue;
      }
      let body = ''; const reader = response.body?.getReader(); const parts = []; let size = 0;
      if (reader) {
        try {
          while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
            if (size > 1024 * 1024) throw new Error('Preflight response exceeds its 1 MiB inspection limit.'); parts.push(next.value); }
        } finally { await reader.cancel().catch(() => {}); }
        const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
        body = new TextDecoder().decode(bytes);
      }
      return { status: response.status, headers: response.headers, body };
    }
    throw new Error('Deployment redirect limit reached.');
  };
  let asset;
  for (const route of [...PUBLIC_ROUTES, ...APP_ROUTES, '/__deployment_missing_route__']) {
    try {
      const response = await request(route); const document = new JSDOM(response.body); const head = document.window.document;
      const missing = route === '/__deployment_missing_route__'; const publicPage = PUBLIC_ROUTES.includes(route);
      add(`${route}: HTTP status`, response.status === (missing ? 404 : 200));
      add(`${route}: HTML content type`, response.headers.get('content-type')?.includes('text/html'));
      add(`${route}: HTML revalidation`, /no-cache|no-store|max-age=0\b|must-revalidate/.test(response.headers.get('cache-control') || ''));
      add(`${route}: content sniffing disabled`, response.headers.get('x-content-type-options') === 'nosniff');
      add(`${route}: referrers disabled`, response.headers.get('referrer-policy') === 'no-referrer');
      const csp = response.headers.get('content-security-policy') || '';
      add(`${route}: CSP script/worker boundary`, /script-src\s+'self'/.test(csp) && /worker-src\s+'self'/.test(csp)
        && /frame-ancestors\s+'none'/.test(csp) && !csp.split(';').some((directive) => /^\s*script-src/.test(directive) && /'unsafe-eval'|'unsafe-inline'/.test(directive)));
      add(`${route}: HTTPS HSTS`, /max-age=([1-9]\d*)\b/i.test(response.headers.get('strict-transport-security') || ''));
      const robots = head.querySelector('meta[name="robots"]')?.content || '';
      if (publicPage) {
        add(`${route}: public prerendered content`, Boolean(head.querySelector('h1')?.textContent.trim()));
        add(`${route}: public canonical`, head.querySelector('link[rel="canonical"]')?.href === `${origin}${route}`);
        add(`${route}: public indexing enabled`, /\bindex\b/.test(robots) && !/noindex/.test(robots));
      } else {
        add(`${route}: private/error noindex`, /noindex/.test(robots));
        if (!missing) add(`${route}: noindex response header`, /noindex/.test(response.headers.get('x-robots-tag') || ''));
      }
      if (route === '/') asset = [...head.querySelectorAll('script[src]')].map((script) => script.getAttribute('src')).find((src) => /^\/assets\/.+-[\w-]{8,}\.js$/.test(src));
      document.window.close();
    } catch (error) { checks.push({ name: `${route}: readable response`, passed: false, error: error.message }); }
  }
  try {
    const sitemap = await request('/sitemap.xml'); const locations = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    add('Sitemap: only the configured public pages', sitemap.status === 200 && locations.length === PUBLIC_ROUTES.length
      && PUBLIC_ROUTES.every((route) => locations.includes(`${origin}${route}`)));
    const robots = await request('/robots.txt');
    add('Robots: public crawling and chosen sitemap', robots.status === 200 && robots.body.includes(`Sitemap: ${origin}/sitemap.xml`) && !/^Disallow:\s*\/\s*$/m.test(robots.body));
    add('Personal deployment: API remains disabled', (await request('/api/config')).status === 404);
    add('Landing: hashed application script found', Boolean(asset));
    if (asset) { const response = await request(asset); const cache = response.headers.get('cache-control') || '';
      add('Hashed asset: immutable cache', response.status === 200 && /immutable/.test(cache) && /max-age=31536000\b/.test(cache));
      add('Hashed asset: compression', /gzip|br/.test(response.headers.get('content-encoding') || '')); }
  } catch (error) { checks.push({ name: 'Metadata/asset responses readable', passed: false, error: error.message }); }
  return { origin, passed: checks.every((check) => check.passed), checks,
    boundary: 'Read-only personal-edition delivery smoke checks. Does not establish traffic capacity, TLS certificate policy, complete security, accessibility or AI quality.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const report = await checkDeployment(process.argv[2]); console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
