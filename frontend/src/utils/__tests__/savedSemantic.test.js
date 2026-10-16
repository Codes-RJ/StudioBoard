import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { approveQualityRevision } from '../qualityReview';
import { saveLocalDataset, deleteLocalDataset } from '../localDatasetStore';
import { encodeDatasetPayload } from '../datasetWorkerPayload';
import { createSavedSemanticPager } from '../localAI/savedSemantic';
import { buildSemanticPage } from '../localAI/semantic';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); localStorage.clear(); });
const fixture = () => {
  const rows = Array.from({ length: 1027 }, (_, i) => ({ code: String(i).padStart(5, '0'), notes: i === 1026 ? 'tail evidence' : 'ordinary' }));
  return approveQualityRevision({ id: 'semantic-pages', name: 'Semantic pages', revision: 'r1', isLocal: true,
    rawRows: rows, columns: [{ name: 'code' }, { name: 'notes' }] });
};
const collect = async (pager, filters = {}, limit = 48) => {
  const records = []; let cursor; let complete = false;
  while (!complete) {
    const page = await pager.next(cursor, filters, limit);
    records.push(...page.records); cursor = page.cursor; complete = page.complete;
  }
  return { records, cursor };
};

describe('bounded saved semantic paging', () => {
  it('retains full row identities and text across storage page boundaries and resume cursors', async () => {
    const dataset = fixture(); dataset.rawRows[511].notes = 'long-cell '.repeat(750);
    await saveLocalDataset(dataset);
    const actual = await collect(createSavedSemanticPager(encodeDatasetPayload({ dataset }).dataset));
    const expected = []; let cursor; let complete = false;
    while (!complete) { const page = buildSemanticPage(dataset, cursor); expected.push(...page.records); cursor = page.cursor; complete = page.complete; }
    expect(actual.records).toEqual(expected); expect(actual.cursor).toEqual(cursor);
    expect(actual.records.at(-1)).toMatchObject({ rowIndex: 1026, sourceRowId: 'semantic-pages:row:1027' });
  });
  it('reuses only the current immutable row page and never reads source/history pages without cleaning', async () => {
    const dataset = fixture(); await saveLocalDataset(dataset);
    const streams = []; const original = IDBObjectStore.prototype.get;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (key) {
      if (this.name === 'datasetRows') streams.push([key[2], key[3]]);
      return original.call(this, key);
    });
    try {
      const pager = createSavedSemanticPager(encodeDatasetPayload({ dataset }).dataset);
      const first = await pager.next(undefined, {}, 1);
      await pager.next(first.cursor, {}, 1);
      expect(streams).toEqual([['rawRows', 0]]);
      const boundary = await pager.next({ row: 512, column: 0, offset: 0 }, {}, 1);
      await pager.next(boundary.cursor, {}, 1);
      expect(streams).toEqual([['rawRows', 0], ['rawRows', 1]]);
    } finally { spy.mockRestore(); }
  });
  it('covers filters beyond two empty pages and preserves original provenance on later pages', async () => {
    const dataset = fixture(); dataset.sourceRows = dataset.rawRows.map((row) => ({ ...row }));
    dataset.sourceRows[1026].notes = '';
    dataset.cleaningLog = [{ operations: [{ kind: 'fill', column: 'notes', value: 'tail evidence', method: 'explicit' }] }];
    await saveLocalDataset(dataset);
    const pager = createSavedSemanticPager(encodeDatasetPayload({ dataset }).dataset);
    const result = await collect(pager, { code: '01026' });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toEqual(buildSemanticPage(dataset, undefined, { code: '01026' }).records[0]);
    expect(result.records[0].transformedFields).toEqual(['notes']);
    expect(result.cursor.row).toBe(1027);
    expect(await pager.next(result.cursor)).toMatchObject({ complete: true, records: [] });
  });
  it('revalidates cached pages after storage-only changes and deletion', async () => {
    const dataset = fixture(); await saveLocalDataset(dataset);
    const pager = createSavedSemanticPager(encodeDatasetPayload({ dataset }).dataset);
    const first = await pager.next(undefined, {}, 1);
    await saveLocalDataset({ ...dataset, relationshipNote: 'changed' });
    await expect(pager.next(first.cursor)).rejects.toThrow('changed during this scan');
    await deleteLocalDataset(dataset.id);
    await expect(pager.next(first.cursor)).rejects.toThrow('deleted during this scan');
  });
  it('rejects unreviewed sources and invalid cursors instead of creating incomplete indexes', async () => {
    const dataset = fixture(); delete dataset.qualityReview; await saveLocalDataset(dataset);
    const pager = createSavedSemanticPager(encodeDatasetPayload({ dataset }).dataset);
    await expect(pager.next()).rejects.toThrow('Review and save');
    await expect(pager.next({ row: -1, column: 0, offset: 0 })).rejects.toThrow('Invalid semantic cursor');
  });
});
