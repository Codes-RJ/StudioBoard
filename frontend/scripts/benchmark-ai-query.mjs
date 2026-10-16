import { analyzeQueryWithData, buildDatasetProfile } from '../src/utils/aiQueryEngine.js';

const sizes = process.argv.includes('--full') ? [10_000, 100_000, 1_000_000] : [10_000, 100_000];

for (const size of sizes) {
  const rows = Array.from({ length: size }, (_, index) => ({
    Date: new Date(2025, 0, 1 + (index % 365)).toISOString().slice(0, 10),
    Region: ['North', 'South', 'East', 'West'][index % 4],
    Revenue: index % 1_000,
    Cost: index % 400
  }));
  const dataset = {
    id: `assistant-benchmark-${size}`,
    columns: [
      { name: 'Date', type: 'date' },
      { name: 'Region', type: 'string' },
      { name: 'Revenue', type: 'number' },
      { name: 'Cost', type: 'number' }
    ],
    rawRows: rows
  };
  const profileStarted = performance.now();
  const profile = buildDatasetProfile(dataset);
  const queryStarted = performance.now();
  const result = analyzeQueryWithData(
    'Top 5 Region by Revenue where Revenue >= 100',
    dataset,
    profile
  );
  console.log(JSON.stringify({
    rows: size,
    profileMs: Math.round(queryStarted - profileStarted),
    queryMs: Math.round(performance.now() - queryStarted),
    matchedRows: result.interpretation.matchedRows
  }));
}
