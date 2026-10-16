import { preview } from 'vite';

// Own the HTTP server directly. A shell -> npm -> Vite process tree can leave
// Playwright waiting for its shell after taskkill fails under Windows policies.
export default async function startPreview(config) {
  const target = new URL(config.projects[0].use.baseURL);
  if (target.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
    throw new Error('Automatic preview requires an HTTP loopback base URL. Start remote servers separately.');
  }
  if (!process.env.CI) {
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(1000) });
      await response.body?.cancel();
      if (response.ok) return; // Reused servers belong to their original owner.
    } catch { /* An unavailable local origin needs an owned preview. */ }
  }
  const server = await preview({ preview: {
    host: target.hostname === '[::1]' ? '::1' : '127.0.0.1',
    port: Number(target.port || 80), strictPort: true, open: false,
  } });
  return async () => {
    const closed = new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
    // HTTP keep-alive must not hold teardown open after browser assertions end.
    server.httpServer.closeAllConnections();
    await closed;
  };
}
