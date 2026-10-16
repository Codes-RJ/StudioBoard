import { spawnSync } from 'node:child_process';
import { createServer } from 'vite';

// Separate processes keep earlier fixtures/GC history out of later comparisons.
// This measures the JS accumulator, not IndexedDB, GPU/model or device capacity.
const fixtures = [
  { name: 'small', rows: 10_000, columns: 8, groups: 4, histories: 0 },
  { name: 'large', rows: 100_000, columns: 8, groups: 4, histories: 0 },
  { name: 'wide', rows: 25_000, columns: 80, groups: 4, histories: 0 },
  { name: 'high-cardinality', rows: 100_000, columns: 8, groups: 9000, histories: 0 },
  { name: 'legacy-history', rows: 100_000, columns: 8, groups: 4, histories: 3 },
];
if (process.argv.includes('--full')) fixtures.push({ name: 'million', rows: 1_000_000, columns: 8, groups: 4, histories: 0 });
const position = process.argv.indexOf('--case');
if (position < 0) {
  const report = { environment: { node: process.version, platform: process.platform, arch: process.arch },
    measurement: 'sampled process heap after each 512-row page; observed values include garbage awaiting GC, not guaranteed peak heap or browser capacity', results: [] };
  for (const fixture of fixtures) {
    let previous;
    for (const mode of ['full', 'paged']) {
      const child = spawnSync(process.execPath, ['--expose-gc', import.meta.filename, '--case', JSON.stringify({ ...fixture, mode })], { cwd: process.cwd(), encoding: 'utf8' });
      if (child.status !== 0) throw new Error(child.stderr || child.stdout || 'Benchmark failed.');
      const result = JSON.parse(child.stdout.trim()); report.results.push(result);
      if (result.sourceRows !== fixture.rows || result.contributingRows !== fixture.rows || result.totalGroups !== Math.min(fixture.groups, fixture.rows)) throw new Error(`Incorrect scope in ${fixture.name}.`);
      if (previous && previous.displayedSum !== result.displayedSum) throw new Error(`Calculation differs between full and paged inputs in ${fixture.name}.`);
      previous = result;
      console.error(`${fixture.name} ${mode}: ${result.elapsedMs} ms; sampled heap delta ${(result.observedHeapDeltaBytes / 1_000_000).toFixed(2)} MB`);
    }
  }
  console.log(JSON.stringify(report, null, 2));
} else {
  const fixture = JSON.parse(process.argv[position + 1]);
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  try {
    const { createScopedMetricAccumulator, computeScopedMetric } = await server.ssrLoadModule('/src/utils/analysisScope.js');
    global.gc?.();
    const baseline = process.memoryUsage().heapUsed; let maximum = baseline;
    const sample = () => { maximum = Math.max(maximum, process.memoryUsage().heapUsed); };
    const row = (i) => Object.fromEntries([['group', `G${i % fixture.groups}`], ['value', i % 1000],
      ...Array.from({ length: fixture.columns - 2 }, (_, column) => [`field${column}`, `fixture-${column}-${i}`])]);
    const dataset = { id: 'memory-fixture', columns: ['group', 'value'], rowCount: fixture.rows };
    const options = { metric: 'value', dimension: 'group' }; const started = performance.now(); let result;
    if (fixture.mode === 'full') {
      dataset.rawRows = Array.from({ length: fixture.rows }, (_, i) => row(i));
      dataset.sourceRows = dataset.rawRows.map((entry) => ({ ...entry }));
      dataset.cleaningHistory = Array.from({ length: fixture.histories }, () => ({ rows: dataset.rawRows.map((entry) => ({ ...entry })) }));
      sample(); result = computeScopedMetric(dataset, options); sample();
    } else {
      const accumulator = createScopedMetricAccumulator(dataset, options);
      for (let offset = 0; offset < fixture.rows; offset += 512) {
        const rows = Array.from({ length: Math.min(512, fixture.rows - offset) }, (_, i) => row(offset + i));
        accumulator.consume(rows); sample();
      }
      result = accumulator.finish(fixture.rows); sample();
    }
    console.log(JSON.stringify({ ...fixture, elapsedMs: Math.round(performance.now() - started), observedHeapDeltaBytes: maximum - baseline,
      sourceRows: result.sourceRows, contributingRows: result.contributingRows, totalGroups: result.totalGroups,
      displayedSum: result.results.reduce((total, group) => total + group.value, 0) }));
  } finally { await server.close(); }
}
