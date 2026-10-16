import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { scanIntegerPrecisionRisks } from '../numberSemantics';
import { analyzeDataQuality, cleanDatasetRows } from '../dataCleaner';
import { saveLocalDataset } from '../localDatasetStore';
import { encodeDatasetPayload } from '../datasetWorkerPayload';
import { computeSavedQuality } from '../savedQuality';

const fields = ['__proto__', 'constructor', 'toString'];
const fixture = () => ({ id: 'hostile-quality', revision: 'r1', columns: fields.map((name) => ({ name, type: 'string' })),
  rawRows: [JSON.parse('{"__proto__":"9007199254740993","constructor":"9007199254740993","toString":"9007199254740993"}'),
    JSON.parse('{"__proto__":null,"constructor":null,"toString":null}')] });

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); localStorage.clear(); });

describe('hostile field names through preprocessing', () => {
  it('keeps precision counters as own data without changing built-in prototypes', () => {
    const targets = [Object.prototype, Object, Object.prototype.toString];
    const before = targets.map((target) => Object.getOwnPropertyDescriptor(target, 'integer-text'));
    try {
      const result = scanIntegerPrecisionRisks(fixture().rawRows, fields);
      for (const field of fields) {
        expect(Object.hasOwn(result, field)).toBe(true);
        expect(result[field]).toEqual({ 'stored-number': 0, 'integer-text': 1 });
      }
      targets.forEach((target, index) => expect(Object.getOwnPropertyDescriptor(target, 'integer-text')).toEqual(before[index]));
    } finally {
      targets.forEach((target, index) => { if (before[index]) Object.defineProperty(target, 'integer-text', before[index]); else Reflect.deleteProperty(target, 'integer-text'); });
    }
  });

  it('counts literal header missing cells in an in-memory quality review', () => {
    const result = analyzeDataQuality(fixture());
    expect(result.missingCells).toBe(3);
    for (const field of fields) {
      expect(Object.hasOwn(result.missingByColumn, field)).toBe(true);
      expect(result.missingByColumn[field]).toBe(1);
    }
  });

  it('retains the same missing and precision evidence through saved-page review', async () => {
    const source = fixture();
    await saveLocalDataset(source);
    const result = await computeSavedQuality(encodeDatasetPayload({ dataset: source }).dataset);
    for (const field of fields) {
      expect(Object.hasOwn(result.quality.missingByColumn, field)).toBe(true);
      expect(result.quality.missingByColumn[field]).toBe(1);
      expect(Object.hasOwn(result.profile.precisionRisks, field)).toBe(true);
      expect(result.profile.precisionRisks[field]['integer-text']).toBe(1);
    }
  });

  it('replays explicit exact fills without losing a hostile header or source text', () => {
    const source = fixture();
    const columns = fields.map((name) => ({ name, type: 'number', role: 'measure', precision: 'exact' }));
    const columnPolicies = Object.fromEntries(fields.map((field) => [field, { method: 'mean' }]));
    const result = cleanDatasetRows(source.rawRows, columns, { columnPolicies, preserveRows: true });
    for (const field of fields) expect(result.rawRows[1][field]).toBe('9007199254740993');
    expect(source.rawRows[1].__proto__).toBeNull();
  });
});
