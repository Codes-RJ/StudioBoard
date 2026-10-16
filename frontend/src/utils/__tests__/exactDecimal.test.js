import { describe, expect, it } from 'vitest';
import { computeScopedMetric } from '../analysisScope';
import { cleanDatasetRows, computeColumnStats } from '../dataCleaner';
import { dateGroupKey } from '../dateSemantics';
const data = (values) => ({ id: 'exact', columns: [{ name: 'amount', type: 'number' }, { name: 'weight', type: 'number' }], columnOverrides: { amount: { precision: 'exact', unit: 'USD' } }, rawRows: values.map((amount) => ({ amount, weight: '1' })) });
describe('reviewed exact decimal execution', () => {
  it.each([['sum', ['0.1', '0.2'], '0.3'], ['sum', ['9007199254740993', '1'], '9007199254740994'], ['sum', ['1e200', '-1e200', '0.0000000001'], '0.0000000001'], ['average', ['1', '0', '0'], '1/3'], ['median', ['0.1', '0.2'], '0.15'], ['weighted_average', ['0.1', '0.2'], '0.15']])('%s preserves %j', (aggregation, values, expected) => {
    expect(computeScopedMetric(data(values), { metric: 'amount', aggregation, weight: aggregation === 'weighted_average' ? 'weight' : '' }).results[0].value).toBe(expected);
  });
  it('refuses already-rounded integers and ambiguous formatted measures', () => {
    for (const value of [9007199254740992, '$1', '1,000', '3%']) expect(() => computeScopedMetric(data([value]), { metric: 'amount' })).toThrow();
  });
  it('uses exact fills and report totals without changing originals', () => {
    const source = data(['0.1', '0.2', '']);
    const cleaned = cleanDatasetRows(source.rawRows, [{ name: 'amount', type: 'number', precision: 'exact' }], { missingNumeric: 'mean' });
    expect(cleaned.rawRows[2].amount).toBe('0.15'); expect(source.rawRows[2].amount).toBe('');
    expect(computeColumnStats(source.rawRows, ['amount'], source.columnOverrides).amount).toMatchObject({ type: 'exact', sum: '0.3', mean: '0.15', missing: 1 });
    expect(() => cleanDatasetRows(data(['1', '0', '0', '']).rawRows, [{ name: 'amount', type: 'number', precision: 'exact' }], { missingNumeric: 'mean' })).toThrow('repeats');
  });
  it('keeps date-only groups and requires explicit instant zones', () => {
    expect(dateGroupKey('2026-10-03', { dateKind: 'date-only', timeZone: 'America/New_York' })).toBe('2026-10-03');
    expect(dateGroupKey('2026-10-03T00:30:00Z', { dateKind: 'instant-day', timeZone: 'America/New_York' })).toBe('2026-10-02');
    expect(() => dateGroupKey('2026-02-31', { dateKind: 'date-only' })).toThrow();
    expect(() => dateGroupKey('2026-10-03T00:30:00', { dateKind: 'instant-day' })).toThrow('offset');
  });
});
