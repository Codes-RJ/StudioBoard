import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { approveQualityRevision } from '../qualityReview';
import { saveLocalDataset, scanLocalDatasetRows } from '../localDatasetStore';
import { encodeDatasetPayload } from '../datasetWorkerPayload';
import { buildEvidenceIndex, retrieveSourceEvidence } from '../localAI/evidence';
import { runSavedEvidence } from '../localAI/savedEvidence';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); localStorage.clear(); });
const fixture = () => {
  const fields = Array.from({ length: 40 }, (_, i) => `field${i}`);
  const rows = Array.from({ length: 4003 }, (_, i) => ({ ...Object.fromEntries(fields.map((name) => [name, 'ordinary'])),
    code: String(i).padStart(6, '0'), region: i % 2 ? 'West' : 'East', value: i === 4002 ? 99 : 1 }));
  rows[4002].field39 = `${'ordinary '.repeat(500)}rareGalaxyMarker`;
  return approveQualityRevision({ id: 'paged-evidence', isLocal: true, revision: 'r1', name: 'Evidence source', sourcePath: 'nested/source.csv', sheetName: 'Evidence',
    columns: [...fields.map((name) => ({ name })), { name: 'code' }, { name: 'region' }, { name: 'value', type: 'number' }], rawRows: rows });
};
describe('page-fed evidence preview and complete lexical retrieval', () => {
  it('preserves every preview position, summary and coverage count across saved pages', async () => {
    const dataset = fixture(); await saveLocalDataset(dataset);
    const progress = [];
    const index = await runSavedEvidence('index', { dataset: encodeDatasetPayload({ dataset }).dataset, filters: { region: 'East' } }, { onProgress: (entry) => progress.push(entry) });
    expect(index).toEqual(buildEvidenceIndex(dataset, { region: 'East' }));
    expect(index.coverage).toMatchObject({ sourceRows: 4003, eligibleRows: 2002, indexedRows: 668, completeRows: false });
    expect(index.records.find((record) => record.kind === 'summary').computation.results[0].value).toBe(2100);
    expect(progress).toHaveLength(8); expect(progress.at(-1)).toEqual({ scanned: 4003, total: 4003 });
  });
  it('finds the final row, a late field and unclipped Unicode text with correct original provenance', async () => {
    const dataset = fixture(); dataset.sourceRows = dataset.rawRows.map((row) => ({ ...row }));
    dataset.sourceRows[4002].field39 = '';
    dataset.cleaningLog = [{ operations: [{ kind: 'fill', column: 'field39', value: dataset.rawRows[4002].field39, method: 'explicit' }] }];
    await saveLocalDataset(dataset);
    const reference = encodeDatasetPayload({ dataset }).dataset;
    const index = await runSavedEvidence('index', { dataset: reference, filters: { region: 'East' } });
    const query = 'rare Galaxy Marker';
    const result = await runSavedEvidence('retrieve-source', { dataset: reference, index, query, options: { limit: 3 } });
    expect(result).toEqual(retrieveSourceEvidence(dataset, index, query, { limit: 3 }));
    expect(result.hits[0]).toMatchObject({ rowIndex: 4002, sourceRowId: 'paged-evidence:row:4003', worksheet: 'Evidence', transformedFields: ['field39'] });
    expect(result.hits[0].text).toContain('rareGalaxyMarker');
    expect(result.coverage).toMatchObject({ indexedRows: 2002, indexedColumns: 43, completeRows: true });
  });
  it('keeps explicit draft scope and rejects stale/unreviewed sources and failed scans', async () => {
    const dataset = fixture(); await saveLocalDataset(dataset);
    const reference = encodeDatasetPayload({ dataset }).dataset;
    const draft = approveQualityRevision({ ...dataset, revision: 'draft', rawRows: dataset.rawRows.slice(-1) });
    expect((await runSavedEvidence('index', { dataset: draft })).coverage.sourceRows).toBe(1);
    const scan = async (id, visit, options) => scanLocalDatasetRows(id, async (rows, info) => {
      visit(rows, info); if (info.offset === 0) await saveLocalDataset({ ...dataset, note: 'new storage generation' });
    }, options);
    await expect(runSavedEvidence('index', { dataset: reference }, { scan })).rejects.toThrow('changed during this scan');
    await expect(runSavedEvidence('index', { dataset: reference })).rejects.toThrow('changed during this scan');
    const unreviewed = { ...dataset }; delete unreviewed.qualityReview;
    await saveLocalDataset(unreviewed);
    await expect(runSavedEvidence('index', { dataset: encodeDatasetPayload({ dataset: unreviewed }).dataset })).rejects.toThrow('Review and save');
  });
  it('rejects pre-cancelled work and missing pages without producing partial coverage', async () => {
    const dataset = fixture(); await saveLocalDataset(dataset); const reference = encodeDatasetPayload({ dataset }).dataset;
    const controller = new AbortController(); controller.abort();
    await expect(runSavedEvidence('index', { dataset: reference }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const open = indexedDB.open('analytics-dashboard-local-data');
    const database = await new Promise((resolve) => { open.onsuccess = () => resolve(open.result); });
    const transaction = database.transaction('datasetRows', 'readwrite');
    transaction.objectStore('datasetRows').delete([dataset.id, reference.storageRevision, 'rawRows', 7]);
    await new Promise((resolve) => { transaction.oncomplete = resolve; }); database.close();
    await expect(runSavedEvidence('index', { dataset: reference })).rejects.toThrow('missing or incomplete');
  });
});
