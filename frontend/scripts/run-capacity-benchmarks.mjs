import { spawn } from 'node:child_process';
import startPreview from './playwright-preview.mjs';
import { benchmarkCpuRate } from './browser-journey-telemetry.mjs';

benchmarkCpuRate();
const only = process.argv.slice(2);
if (only.length > 1 || (only.length && !/^--only=(import|collection|cleanup)$/.test(only[0]))) {
  throw new Error('Use --only=import, --only=collection or --only=cleanup, or no selector for all measurements.');
}
const scripts = { import: 'benchmark-import-journey.mjs', collection: 'benchmark-collection-journey.mjs', cleanup: 'benchmark-resource-cleanup.mjs' };
process.env.BENCHMARK_OUTPUT_DIR ||= `audit-results/capacity-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8080';
const close = await startPreview({ projects: [{ use: { baseURL } }] });
try {
  for (const script of only.length ? [scripts[only[0].slice('--only='.length)]] : Object.values(scripts)) {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [`scripts/${script}`], { stdio: 'inherit', windowsHide: true });
      child.once('error', reject); child.once('exit', resolve);
    });
    if (code !== 0) process.exitCode = 1;
  }
} finally { await close?.(); }
