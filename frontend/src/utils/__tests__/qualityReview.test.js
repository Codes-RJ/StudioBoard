import { describe, expect, it } from 'vitest';
import { cleanDatasetRows, replayCleaningRecipe } from '../dataCleaner';
import { approveQualityRevision, getCellProvenance, isQualityApproved, qualityRevisionKey } from '../qualityReview';

describe('reviewed source revisions and preservation', () => {
  it('invalidates approval after a data revision or role correction', () => {
    const dataset = approveQualityRevision({ id: 'source', revision: 'v1', columns: ['value'], rawRows: [{ value: 2 }] });
    expect(isQualityApproved(dataset)).toBe(true);
    expect(isQualityApproved({ ...dataset, revision: 'v2' })).toBe(false);
    expect(isQualityApproved({ ...dataset, columnOverrides: { value: { type: 'number', role: 'identifier' } } })).toBe(false);
    expect(qualityRevisionKey({ ...dataset, checksum: 'old' })).toBe(qualityRevisionKey(dataset));
  });

  it('preserves blank rows and identifiers with exact per-column statistics and unresolved empty fields', () => {
    const source = [{ ID: ' 001 ', A: 1, B: 10, Empty: null }, { ID: '002', A: 2, B: 30, Empty: null },
      { ID: '003', A: 2, B: 100, Empty: null }, { ID: '', A: null, B: null, Empty: null }];
    const columns = [{ name: 'ID', type: 'string' }, ...['A', 'B', 'Empty'].map((name) => ({ name, type: 'number' }))];
    const options = { preserveRows: true, missingNumeric: 'mean', columnPolicies: { B: { method: 'median' } } };
    const result = replayCleaningRecipe(source, columns, [options]);
    expect(result.rawRows).toHaveLength(4);
    expect(result.rawRows[0].ID).toBe(' 001 ');
    expect(result.rawRows[3]).toEqual({ ID: '', A: 5 / 3, B: 30, Empty: null });
    const dataset = { id: 's', sourceId: 'original', sourceRows: source, rawRows: result.rawRows,
      cleaningLog: [{ operations: result.operationSteps[0] }] };
    expect(getCellProvenance(dataset, 3, 'A')).toMatchObject({ sourceRowId: 'original:row:4', original: null,
      current: 5 / 3, steps: [{ step: 1, method: 'mean', before: null, after: 5 / 3 }] });
    expect(source[3].A).toBeNull();
  });

  it('allows an explicit custom value in an entirely empty numeric column', () => {
    const result = cleanDatasetRows([{ amount: null }], [{ name: 'amount', type: 'number' }], {
      preserveRows: true, columnPolicies: { amount: { method: 'value', value: '7.125' } },
    });
    expect(result.rawRows[0].amount).toBe(7.125);
    expect(() => cleanDatasetRows([{ amount: null }], [{ name: 'amount', type: 'number' }], {
      columnPolicies: { amount: { method: 'value', value: '' } },
    })).toThrow('finite numeric');
  });

  it.each([{ removeDuplicates: true }, { removeEmptyRows: true }, { dropEmptyColumns: true }, { missingNumeric: 'dropRow' }])
    ('rejects destructive policies in a preserving workspace: %j', (policy) => {
      expect(() => cleanDatasetRows([{ amount: null }], ['amount'], { preserveRows: true, ...policy })).toThrow('preserves every');
    });
});
