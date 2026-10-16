import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { securityHeaders } from '../../../scripts/security-headers.mjs';

describe('deployment header parity', () => {
  it('uses the preview policy on static hosts without disabling workers or WASM', () => {
    const vercel = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf8'));
    const global = Object.fromEntries(vercel.headers.find((item) => item.source === '/(.*)').headers.map(({ key, value }) => [key, value]));
    expect(global).toEqual(securityHeaders);
    for (const filename of ['nginx.conf', 'nginx.local.conf']) {
      const config = fs.readFileSync(path.resolve(filename), 'utf8');
      for (const [name, value] of Object.entries(securityHeaders)) expect(config).toContain(`add_header ${name} "${value}" always;`);
    }
    expect(global['Content-Security-Policy']).toContain("worker-src 'self' blob:");
    expect(global['Content-Security-Policy']).not.toContain("'unsafe-eval'");
  });
});
