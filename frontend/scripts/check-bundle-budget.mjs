import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);

const assetsDirectory = path.resolve(process.cwd(), 'dist', 'assets');
const budgets = [
  // The homepage now uses code-native SVG artwork; its route remains bounded.
  { label: 'editorial landing route', pattern: /^Landing-.*\.js$/, maximumBytes: 30_000, maximumGzipBytes: 10_000 },
  { label: 'feature guide route', pattern: /^HowItWorks-.*\.js$/, maximumBytes: 30_000, maximumGzipBytes: 10_000 },
  // Public pages use Framer Motion's small DOM entry; workspace routes stay steady.
  { label: 'public scroll motion', pattern: /^EditorialMotion-.*\.js$/, maximumBytes: 15_000, maximumGzipBytes: 6_000 },
  { label: 'dashboard route', pattern: /^Dashboard-.*\.js$/, maximumBytes: 135_000, maximumGzipBytes: 40_000 },
  { label: 'shared application entry', pattern: /^index-.*\.js$/, maximumBytes: 130_000, maximumGzipBytes: 48_000 },
  { label: 'chart vendor chunk', pattern: /^vendor-charts-.*\.js$/, maximumBytes: 500_000, maximumGzipBytes: 140_000 },
  { label: 'full Plotly fallback', pattern: /^plotly\.min-.*\.js$/, maximumBytes: 4_200_000, maximumGzipBytes: 1_350_000 },
  { label: 'cartesian renderer', pattern: /^plotly-cartesian\.min-.*\.js$/, maximumBytes: 1_700_000, maximumGzipBytes: 530_000 },
  { label: '3D renderer', pattern: /^plotly-gl3d\.min-.*\.js$/, maximumBytes: 2_000_000, maximumGzipBytes: 600_000 },
  { label: 'finance renderer', pattern: /^plotly-finance\.min-.*\.js$/, maximumBytes: 1_500_000, maximumGzipBytes: 470_000 },
  { label: 'grid vendor chunk', pattern: /^vendor-grid-.*\.js$/, maximumBytes: 300_000, maximumGzipBytes: 95_000 },
  { label: 'Excel vendor chunk', pattern: /^vendor-xlsx-.*\.js$/, maximumBytes: 520_000, maximumGzipBytes: 185_000 },
  // Streaming ZIP-byte verification adds ~3.6 kB gzip versus the previous
  // worker. Keep the raw ceiling; record this narrow security allowance.
  { label: 'spreadsheet parser worker', pattern: /^spreadsheetParser\.worker-.*\.js$/, maximumBytes: 400_000, maximumGzipBytes: 135_000 },
  { label: 'CSV parser worker', pattern: /^delimitedParser\.worker-.*\.js$/, maximumBytes: 30_000, maximumGzipBytes: 10_000 },
  // Calendar/precision validation and bounded working-only reads add ~0.8 kB
  // compressed. Keep the 40 kB raw ceiling and record the explicit allowance.
  { label: 'data assistant worker', pattern: /^aiAssistant\.worker-.*\.js$/, maximumBytes: 40_000, maximumGzipBytes: 14_000 }
];

const formatKilobytes = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

let assetNames;
try {
  assetNames = await readdir(assetsDirectory);
} catch (error) {
  console.error(`Bundle budget check requires a production build at ${assetsDirectory}.`);
  console.error(error.message);
  process.exit(1);
}

const failures = [];
for (const budget of budgets) {
  const matches = assetNames.filter((assetName) => budget.pattern.test(assetName));
  if (matches.length < (budget.minimumMatches || 1)) {
    failures.push(`${budget.label}: expected at least ${budget.minimumMatches || 1} output(s), found ${matches.length}`);
    continue;
  }

  for (const assetName of matches) {
    const assetPath = path.join(assetsDirectory, assetName);
    const { size } = await stat(assetPath);
    const summary = `${budget.label}: ${formatKilobytes(size)} / ${formatKilobytes(budget.maximumBytes)}`;
    if (size > budget.maximumBytes) failures.push(summary);
    else console.log(`PASS ${summary}`);
    if (budget.maximumGzipBytes) {
      const compressedSize = (await gzipAsync(await readFile(assetPath), { level: 9 })).length;
      const compressedSummary = `${budget.label} (gzip): ${formatKilobytes(compressedSize)} / ${formatKilobytes(budget.maximumGzipBytes)}`;
      if (compressedSize > budget.maximumGzipBytes) failures.push(compressedSummary);
      else console.log(`PASS ${compressedSummary}`);
    }
  }
}

if (failures.length > 0) {
  console.error('\nBundle budget exceeded:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
