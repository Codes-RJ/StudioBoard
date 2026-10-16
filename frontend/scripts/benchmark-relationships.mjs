import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { discoverDatasetRelationships } from '../src/utils/datasetRelationships.js';

// Measures the relationship engine only. Browser parsing, worker cloning,
// IndexedDB, rendering, and peak memory need separate browser measurements.
const cases = [[10, 1000], [50, 1000], [100, 1000]];
if (process.argv.includes('--near-limit')) cases.push([100, 10_000]);
console.log(JSON.stringify({ node: process.version, platform: process.platform, cpu: cpus()[0]?.model, columns: 8 }));
for (const [files, rowsPerFile] of cases) {
  const datasets = Array.from({ length: files }, (_, index) => ({
    id: `d${index}`, name: `file${index}`, updatedAt: 'r1',
    columns: Array.from({ length: 8 }, (_, column) => ({ name: `Key${column}` })),
    rawRows: Array.from({ length: rowsPerFile }, (_, row) => Object.fromEntries(
      Array.from({ length: 8 }, (_, column) => [`Key${column}`, String((row + index * 7 + column * 3) % 1500)]),
    )),
  }));
  const started = performance.now();
  const relationships = discoverDatasetRelationships(datasets);
  if (relationships.length !== 20 || relationships.some(({ matchedDistinct }) => !matchedDistinct)) {
    throw new Error('The benchmark returned incomplete relationship evidence.');
  }
  console.log(JSON.stringify({ files, rows: files * rowsPerFile, suggestions: relationships.length, elapsedMs: Math.round(performance.now() - started) }));
}
