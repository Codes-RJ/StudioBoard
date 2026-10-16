import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export async function readStreamBackup(path) {
  const records = (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse); let previous = '';
  for (const record of records) {
    const digest = createHash('sha256').update(`${previous}\n${JSON.stringify(record.payload)}`).digest('hex');
    if (digest !== record.digest) throw new Error('Downloaded backup checksum mismatch.'); previous = digest;
  }
  const manifest = records[0].payload;
  if (records.at(-1).payload.type !== 'end' || records.at(-1).payload.records !== records.length - 1) throw new Error('Incomplete downloaded backup.');
  const datasets = manifest.datasets.map((header) => ({ ...header, ...Object.fromEntries(['rawRows', 'sourceRows'].filter((stream) => header.rowStorage.streams[stream]).map((stream) => [stream,
    records.filter(({ payload }) => payload.type === 'rows' && payload.datasetId === header.id && payload.stream === stream).flatMap(({ payload }) => payload.rows)])) }));
  return { ...manifest, datasets, dataset: datasets.find((source) => source.id === manifest.selectedDatasetId) };
}
