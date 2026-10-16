import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { distributionReviewPlugins } from './scripts/distribution-review.mjs';
import fs from 'node:fs';
import { securityHeaders } from './scripts/security-headers.mjs';
import { validatePublicEnv } from './scripts/public-env.mjs';
import { PUBLIC_ROUTES, APP_ROUTES, normalizeRoute } from './src/utils/seo.mjs';

const backendProxy = {
  '/api/health': {
    target: 'http://127.0.0.1:5000', changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/health/, '/health')
  },
  '/api': { target: 'http://127.0.0.1:5000', changeOrigin: true }
};

export default defineConfig(({ mode }) => {
  const distribution = distributionReviewPlugins();
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  validatePublicEnv(env, process.env);
  const serverEnabled = (process.env.VITE_ENABLE_SERVER_WORKSPACE ?? env.VITE_ENABLE_SERVER_WORKSPACE) === 'true';
  const rejectPersonalApi = (server, preview = false) => {
    server.middlewares.use((request, response, next) => {
    if (preview) for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (!serverEnabled && (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/metrics')) {
      response.statusCode = 404;
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify({ detail: { code: 'LOCAL_ONLY_WORKSPACE', message: 'Server workspace endpoints are disabled.' } }));
      return;
    }
    const route = normalizeRoute(pathname);
    if (APP_ROUTES.includes(route)) response.setHeader('X-Robots-Tag', 'noindex, follow');
    if (preview && [...PUBLIC_ROUTES, ...APP_ROUTES].includes(route) && ['GET', 'HEAD'].includes(request.method)) {
      const file = new URL(route === '/' ? './dist/index.html' : `./dist${route}/index.html`, import.meta.url);
      if (fs.existsSync(file)) {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(request.method === 'HEAD' ? undefined : fs.readFileSync(file)); return;
      }
    }
    const resource = /^\/(assets|src|node_modules|@[^/]+)\//.test(pathname) || ['/@vite/client', '/@react-refresh', '/favicon.ico', '/favicon.svg', '/robots.txt', '/sitemap.xml', '/social-preview.jpg', '/third-party-notices.txt'].includes(pathname);
    if (!resource && ![...PUBLIC_ROUTES, ...APP_ROUTES].includes(route)) {
      response.statusCode = 404; response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.setHeader('X-Robots-Tag', 'noindex');
      const notFound = new URL('./dist/404.html', import.meta.url);
      response.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : '<!doctype html><html lang="en"><head><meta name="robots" content="noindex"><title>Page Not Found</title></head><body><h1>Page Not Found</h1><a href="/">Home</a></body></html>'); return;
    }
    next();
    });
  };
  return {
  worker: { format: 'es', plugins: distribution.worker },
  ssr: { noExternal: ['react-icons'] },
  plugins: [react(), tailwindcss(), distribution.main, { name: 'personal-workspace-boundary', configureServer: (server) => rejectPersonalApi(server), configurePreviewServer: (server) => rejectPersonalApi(server, true) }],
  server: {
    port: 5173,
    open: true,
    proxy: serverEnabled ? backendProxy : undefined
  },
  // Only separately enabled legacy builds proxy to the API.
  preview: {
    port: 8080,
    proxy: serverEnabled ? backendProxy : undefined
  },
  build: {
    outDir: 'dist',
    // Do not publish application source by default. Error-monitoring builds can
    // opt in and upload maps privately with VITE_SOURCEMAP=true.
    sourcemap: process.env.VITE_SOURCEMAP === 'true',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules[\\/](@?react|react-dom|react-router|react-router-dom)[\\/]/.test(id)) return 'vendor-react';
          if (id.includes('node_modules/recharts/')) return 'vendor-charts';
          // xlsx is dynamically imported (Excel-only path), so it gets its own
          // lazy chunk instead of weighing down every first load.
          if (id.includes('node_modules/xlsx/')) return 'vendor-xlsx';
          if (id.includes('node_modules/papaparse/')) return 'vendor-parsing';
          if (/node_modules[\\/](react-grid-layout|react-table)[\\/]/.test(id)) return 'vendor-grid';
          return undefined;
        }
      }
    }
  }
  };
});
