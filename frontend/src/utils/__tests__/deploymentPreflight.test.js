// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { checkDeployment } from '../../../scripts/deployment-preflight.mjs';
const origin = 'https://fixture.example';
const fetcher = (change = () => {}) => async (url) => {
  const path = new URL(url).pathname;
  const publicPage = ['/', '/how-it-works', '/privacy', '/terms'].includes(path);
  const headers = { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Strict-Transport-Security': 'max-age=31536000', 'X-Robots-Tag': 'noindex, follow',
    'Content-Security-Policy': "script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; frame-ancestors 'none'" };
  let body = `<h1>Fixture</h1><meta name="robots" content="${publicPage ? 'index,follow' : 'noindex,follow'}">${publicPage ? `<link rel="canonical" href="${url}">` : ''}<script src="/assets/index-abcdefgh.js"></script>`;
  let status = path.startsWith('/__') || path === '/api/config' ? 404 : 200;
  if (path === '/robots.txt') body = `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml`;
  if (path === '/sitemap.xml') body = ['/', '/how-it-works', '/privacy', '/terms'].map((path) => `<loc>${origin}${path}</loc>`).join('');
  if (path.startsWith('/assets/')) { body = 'fixture'; headers['Cache-Control'] = 'public,max-age=31536000,immutable'; headers['Content-Encoding'] = 'gzip'; }
  const response = { body, headers, status }; change(path, response); return new Response(response.body, response);
};
describe('deployed personal site preflight', () => {
  it('accepts public metadata, private noindex, actual 404 and hardened delivery', async () => {
    expect((await checkDeployment(origin, { fetcher: fetcher() })).passed).toBe(true);
  });
  it('fails soft-404s, wrong canonicals and missing edge protection', async () => {
    const report = await checkDeployment(origin, { fetcher: fetcher((path, response) => {
      if (path.startsWith('/__')) response.status = 200;
      if (path === '/') { response.body = response.body.replace(origin, 'https://wrong.example'); delete response.headers['Strict-Transport-Security']; }
    }) });
    expect(report.passed).toBe(false);
    expect(report.checks.filter(({ passed }) => !passed).map(({ name }) => name)).toContain('/__deployment_missing_route__: HTTP status');
    expect(report.checks.find(({ name }) => name === '/: public canonical').passed).toBe(false);
  });
  it('rejects invalid origins and cross-origin redirects without following them', async () => {
    await expect(checkDeployment('http://fixture.example')).rejects.toThrow('HTTPS');
    await expect(checkDeployment(`${origin}/path`)).rejects.toThrow('origin');
    const report = await checkDeployment(origin, { fetcher: async () => new Response(null, { status: 302, headers: { Location: 'https://other.example/' } }) });
    expect(report.passed).toBe(false); expect(report.checks[0].error).toContain('outside');
  });
});
