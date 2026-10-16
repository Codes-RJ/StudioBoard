const retainedOperations = new Set(['clean', 'clean-preview', 'replay-cleaning-recipe', 'quality-profile', 'quality', 'profile', 'review-source-grain', 'discover-relationships', 'review-relationship', 'analyze-approved-relationship']);
export const assertTransformMemoryPolicy = (operation, payload) => {
  if (!retainedOperations.has(operation)) return;
  const arrays = new Set();
  const collect = (source) => { if (source?.kind === 'local-dataset-reference') return; if (Array.isArray(source?.rawRows)) arrays.add(source.rawRows); };
  collect(payload.dataset); (payload.datasets || []).forEach(collect);
  if (Array.isArray(payload.rows)) arrays.add(payload.rows);
  if (operation === 'quality-profile' && Array.isArray(payload.dataset?.sourceRows)) arrays.add(payload.dataset.sourceRows);
  let count = 0; let bytes = 0;
  for (const rows of arrays) for (const row of rows) {
    count++; bytes += JSON.stringify(row).length * 2;
    if (count > 250_000 || bytes > 32 * 1024 * 1024) throw new Error('This exact operation exceeds its combined 250,000-row / 32 MB retained-data policy. Narrow or split the source; saved records were retained.');
  }
};
