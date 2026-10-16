import { describe, expect, it } from 'vitest';
import { filterAndPaginateLocalData } from '../localDataEngine';
describe('exact bounded sorted pages', () => {
  it.each(['asc', 'desc'])('matches a stable complete sort in %s order across late rows and ties', (order) => {
    const rows = Array.from({ length: 20003 }, (_, i) => ({ value: i % 17 === 0 ? null : i % 37, label: i % 3 ? 'East' : 'West', index: i }));
    const expected = rows.filter((row) => row.label === 'East').sort((a, b) => a.value == null || b.value == null ? (a.value == null) - (b.value == null) : (order === 'desc' ? -1 : 1) * (a.value - b.value));
    for (const page of [1, 3, 300]) {
      expect(filterAndPaginateLocalData(rows, { page, limit: 50, sort: 'value', order, filters: { label: 'east' } })).toEqual({ data: expected.slice((page - 1) * 50, page * 50), total: expected.length, page, limit: 50 });
    }
    expect(rows[0].index).toBe(0);
  });
  it('rejects excessive retained positions explicitly', () => {
    expect(() => filterAndPaginateLocalData([], { page: 1001, limit: 50, sort: 'value' })).toThrow('50,000');
  });
});
