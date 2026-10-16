import { describe, it, expect } from 'vitest';
import { modelJson, fitModelMessages, inspectSourceSchema, inspectQuestionSchema, promptSources, sourceMentioned } from '../localAI/context';
describe('bounded local model context', () => {
  it('never truncates JSON in the middle of a token and declares omitted evidence', () => {
    const value = { hits: Array.from({ length: 100 }, (_, i) => ({ id: `evidence:${i}`, text: '"\\\n'.repeat(2_000) })) };
    const text = modelJson(value); expect(() => JSON.parse(text)).not.toThrow(); expect(text.length).toBeLessThanOrEqual(6_000);
    expect(JSON.stringify(JSON.parse(text))).toMatch(/omitted|Omitted|shortened/);
    const messages = [{ role: 'system', content: 'tools' }, { role: 'user', content: 'schema' }, ...Array.from({ length: 10 }, () => ({ role: 'user', content: 'x'.repeat(3_000) }))];
    const fitted = fitModelMessages(messages, 8_000); expect(fitted[0].content).toBe('tools'); expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(8_000);
  });
  it('makes fields beyond the original 50-field prompt cap discoverable', () => {
    const source = { id: 'wide', columns: Array.from({ length: 120 }, (_, i) => ({ name: `field_${i}`, type: 'number' })), columnOverrides: { field_119: { role: 'identifier' } } };
    expect(inspectSourceSchema(source, { query: 'field_119' }).fields).toEqual([{ name: 'field_119', type: 'number', role: 'identifier' }]);
    expect(inspectSourceSchema(source, { offset: 100 }).nextOffset).toBeNull();
    expect(() => inspectSourceSchema(source, { limit: 1_000 })).toThrow();
  });
  it('rejects oversized immutable question/schema context instead of truncating identities', () => {
    expect(() => fitModelMessages([{ role: 'system', content: 'tools' }, { role: 'user', content: '東京'.repeat(10_000) }]))
      .toThrow('context budget');
    const text = modelJson({ id: 'source-' + 'x'.repeat(9_000), text: 'fixture' }, 6_000);
    expect(JSON.parse(text)).toMatchObject({ contextOmitted: true });
    expect(text).not.toContain('source-');
  });
  it('prioritizes a named late field while preserving its override and complete schema discovery', () => {
    const source = { id: 'wide', columns: Array.from({ length: 120 }, (_, i) => ({ name: `field_${i}`, type: 'number' })),
      columnOverrides: { field_119: { precision: 'exact' } } };
    const schema = inspectQuestionSchema(source, 'Sum field_119 across all rows');
    expect(schema.totalFields).toBe(120); expect(schema.fields).toHaveLength(20);
    expect(schema.fields[0]).toEqual({ name: 'field_119', type: 'number', precision: 'exact' });
    expect(source.columns[0].name).toBe('field_0');
    expect(inspectSourceSchema(source, { offset: 100 }).fields).toHaveLength(20);
  });
  it('matches literal header and filename boundaries without regex execution or partial-ID matches', () => {
    const source = { id: 'a', name: 'folder\\sales[2026].csv', columns: ['ID', 'Amount (USD)', '.*'] };
    expect(inspectQuestionSchema(source, 'Provide Amount (USD)', 1).fields[0].name).toBe('Amount (USD)');
    expect(sourceMentioned(source, 'Use sales[2026].csv')).toBe(true);
    expect(sourceMentioned(source, 'Use sales2026.csv')).toBe(false);
    expect(inspectQuestionSchema(source, 'anything', 1).fields[0].name).toBe('ID');
  });
  it('puts explicitly named later sources in the bounded catalog without losing the selected source', () => {
    const sources = Array.from({ length: 30 }, (_, i) => ({ id: `source-${i}`, name: `table-${i}.csv` }));
    const shown = promptSources(sources, 'source-0', 'Join table-29.csv through table-28.csv');
    expect(shown).toHaveLength(8); expect(shown.slice(0, 3).map((source) => source.id)).toEqual(['source-0', 'source-28', 'source-29']);
    expect(sources[1].id).toBe('source-1');
  });
});
