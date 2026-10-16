import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { loadEnv } from 'vite';
import { renderLoadingPage, renderPublicPage } from '../.prerender/prerender.js';
import { PUBLIC_ROUTES, APP_ROUTES, applyPageMetadata, pageMetadata, publicOrigin } from '../src/utils/seo.mjs';

const env = loadEnv('production', process.cwd(), 'VITE_');
const origin = publicOrigin(process.env.VITE_PUBLIC_SITE_URL ?? env.VITE_PUBLIC_SITE_URL ?? '');
const shell = await fs.readFile('dist/index.html', 'utf8');
for (const route of [...PUBLIC_ROUTES, ...APP_ROUTES, '/404.html']) {
  const dom = new JSDOM(shell);
  applyPageMetadata(dom.window.document, pageMetadata(route, { origin }));
  dom.window.document.getElementById('root').innerHTML = PUBLIC_ROUTES.includes(route) || route === '/404.html' ? renderPublicPage(route) : renderLoadingPage();
  const filename = route === '/' ? 'index.html' : route === '/404.html' ? '404.html' : `${route.slice(1)}/index.html`;
  await fs.mkdir(path.dirname(`dist/${filename}`), { recursive: true });
  await fs.writeFile(`dist/${filename}`, dom.serialize()); dom.window.close();
}
await fs.copyFile('src/assets/images/landing-social-preview.jpg', 'dist/social-preview.jpg');
const robots = origin ? `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n';
await fs.writeFile('dist/robots.txt', robots);
await fs.writeFile('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${origin ? PUBLIC_ROUTES.map((route) => `<url><loc>${origin}${route}</loc></url>`).join('') : ''}</urlset>\n`);
console.log(`Prerendered public pages and workspace metadata. Search indexing ${origin ? `configured for ${origin}` : 'disabled until VITE_PUBLIC_SITE_URL is set'}.`);
