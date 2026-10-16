import { describe, it, expect } from 'vitest';
import { buildSemanticPage, mergeSemanticHits } from '../localAI/semantic';
import { approveQualityRevision } from '../qualityReview';
describe('complete resumable semantic chunks', () => {
  it('covers late columns and all long-cell characters over resumable bounded pages', () => {
    const rows = [{ id: '001', notes: 'long-cell '.repeat(700), lastField: 'late evidence' }, { id: '002', notes: 'ordinary', lastField: 'tail' }];
    const data = approveQualityRevision({ id: 'semantic-source', isLocal: true, revision: 'r1', rawRows: rows, columns: Object.keys(rows[0]).map((name) => ({ name })) });
    let cursor = { row: 0, column: 0, offset: 0 }; const records = []; let complete = false;
    while (!complete) {
      const page = buildSemanticPage(data, cursor, {}, 1); expect(page.records).toHaveLength(1);
      expect(page.records[0].text.length).toBeLessThanOrEqual(1_602);
      records.push(...page.records); cursor = page.cursor; complete = page.complete;
    }
    expect(records.at(-1)).toMatchObject({ sourceRowId: 'semantic-source:row:2', fields: ['id', 'notes', 'lastField'] });
    expect(records.some((record) => record.text.includes('late evidence'))).toBe(true);
    for (const [rowIndex, row] of rows.entries()) for (const field of Object.keys(row)) {
      const spans = records.filter((record) => record.rowIndex === rowIndex).flatMap((record) => record.spans.map((span) => ({ ...span, text: record.text.slice(span.textStart, span.textEnd) }))).filter((span) => span.field === field);
      expect(spans.map((span) => span.text).join('')).toBe(row[field]);
      expect(spans[0].start).toBe(0);
      expect(spans.at(-1).end).toBe(row[field].length);
      spans.slice(1).forEach((span, index) => expect(span.start).toBe(spans[index].end));
    }
    expect(cursor).toEqual({ row: 2, column: 0, offset: 0 });
    const filtered = buildSemanticPage(data, undefined, { id: '002' }); expect(filtered.records.every((record) => record.rowIndex === 1)).toBe(true);
  });
  it('keeps the strongest duplicate citation when combining lexical and semantic hits', () => {
    expect(mergeSemanticHits([{ id: 'same', score: 2 }, { id: 'other', score: 1 }], [{ id: 'same', score: 0.5 }], 2)).toEqual([{ id: 'same', score: 2 }, { id: 'other', score: 1 }]);
  });
});
