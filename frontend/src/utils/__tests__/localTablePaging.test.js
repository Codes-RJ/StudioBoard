import { describe, expect, it, vi } from 'vitest';
import { filterAndPaginateLocalData } from '../localDataEngine';

describe('bounded unsorted table pages', () => {
  const rows = Object.freeze(Array.from({ length: 10_003 }, (_, i) => Object.freeze({ code: String(i).padStart(5, '0'), region: i % 2 ? 'West' : 'EAST coast', amount: i })));
  it('reads the requested unfiltered slice without constructing a full filtered array', () => {
    const input = [...rows]; input.filter = vi.fn(() => { throw new Error('Full-array filtering should not run.'); });
    expect(filterAndPaginateLocalData(input, { page: 201, limit: 50 })).toEqual({ data: rows.slice(10_000), total: 10_003, page: 201, limit: 50 });
    expect(input.filter).not.toHaveBeenCalled();
  });
  it('counts the full filtered scope while retaining only the requested matches', () => {
    const expected = rows.filter((row) => row.region.toLowerCase().includes('east') && row.code.includes('00'));
    const result = filterAndPaginateLocalData(rows, { page: 2, limit: 13, filters: { region: ' EAST ', code: '00', unused: ' ' } });
    expect(result).toEqual({ data: expected.slice(13, 26), total: expected.length, page: 2, limit: 13 });
    expect(filterAndPaginateLocalData(rows, { filters: { region: 'absent' } })).toMatchObject({ data: [], total: 0 });
  });
  it('retains existing sorted and complete-export scope without mutating source order', () => {
    expect(filterAndPaginateLocalData(rows, { sort: 'amount', order: 'desc', limit: 2 }).data).toEqual([rows.at(-1), rows.at(-2)]);
    expect(filterAndPaginateLocalData(rows, { limit: 0, filters: { code: '10002' } })).toMatchObject({ data: [rows.at(-1)], total: 1, limit: 1 });
    expect(rows[0].amount).toBe(0);
  });
});
