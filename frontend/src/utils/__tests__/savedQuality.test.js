import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { saveLocalDataset } from '../localDatasetStore';
import { encodeDatasetPayload } from '../datasetWorkerPayload';
import { analyzeDataQuality } from '../dataCleaner';
import { profileDataset } from '../datasetProfiler';
import { scanSavedQuality, computeSavedQuality, loadBoundedTransformDataset } from '../savedQuality';
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); localStorage.clear(); });
describe('saved quality and bounded edits', () => {
  it.each([1027, 25003])('matches full quality and strided profile for %i rows', async (count) => {
    const rawRows = Array.from({ length: count }, (_, i) => ({ ID: String(i), value: i % 7 ? i : null, text: i % 13 ? 'Mixed' : ' padded ' })); rawRows[13] = rawRows[12];
    const source = { id: 'quality', columns: Object.keys(rawRows[0]), revision: 'r1', rawRows, sourceRows: rawRows.map((row) => ({ ...row, text: ' original ' })) };
    await saveLocalDataset(source);
    const reference = encodeDatasetPayload({ dataset: source }).dataset;
    const result = await computeSavedQuality(reference);
    expect(result.quality).toEqual(analyzeDataQuality(source)); expect(result.profile).toEqual(profileDataset(source, result.quality.missingByColumn));
    expect(result.sourceQuality).toEqual(analyzeDataQuality({ ...source, rawRows: source.sourceRows }));
  });
  it('rejects an excessive retained edit and cancellation before publishing', async () => {
    const source = { id: 'edit', columns: ['value'], rawRows: [{ value: 1 }, { value: 2 }] }; await saveLocalDataset(source);
    await expect(loadBoundedTransformDataset(source.id, {}, { rows: 1 })).rejects.toThrow('policy');
    const controller = new AbortController(); controller.abort();
    await expect(scanSavedQuality(encodeDatasetPayload({ dataset: source }).dataset, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
