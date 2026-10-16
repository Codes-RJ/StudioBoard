import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { validateWorkbookArchive } from '../workbookArchivePolicy';
import { createLocalDatasetFromRows } from '../localDataEngine';

describe('untrusted archives and keys', () => {
  it('rejects expanded bytes even when the local declared size is forged', () => {
    const zipped = zipSync({ 'xl/worksheets/sheet1.xml': new Uint8Array(128 * 1024).fill(65) });
    new DataView(zipped.buffer).setUint32(22, 1, true);
    expect(() => validateWorkbookArchive(zipped, { maxBytes: 1024 })).toThrow();
    expect(() => validateWorkbookArchive(zipSync({ 'small.xml': new Uint8Array([1, 2, 3]) }), { maxBytes: 1024 })).not.toThrow();
    expect(() => validateWorkbookArchive(new Uint8Array([1, 2, 3]), { requireZip: true })).toThrow('valid ZIP');
  });
  it('preserves prototype-shaped column names as data without altering object prototypes', () => {
    const row = JSON.parse('{"__proto__":"original","constructor":"value","Amount":"12"}');
    const source = createLocalDatasetFromRows({ name: 'fixture.csv' }, [row], Object.keys(row));
    expect(Object.hasOwn(source.rawRows[0], '__proto__')).toBe(true);
    expect(source.rawRows[0].__proto__).toBe('original');
    expect({}.polluted).toBeUndefined();
  });
});
