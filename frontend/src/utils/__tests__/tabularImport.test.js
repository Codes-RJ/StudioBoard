import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseDelimitedText, readSpreadsheetSheets, createDelimitedRowDecoder } from '../tabularImport';
import { createLocalDatasetFromRows } from '../localDataEngine';

describe('source-preserving tabular imports', () => {
  it('preserves prototype-shaped CSV headers as own string values and classifies them normally', () => {
    const parsed = parseDelimitedText('__proto__,constructor,toString,Value\n01,alpha,first,10\n02,beta,second,20\n');
    const dataset = createLocalDatasetFromRows({ name: 'hostile-headers.csv' }, parsed.rawRows, parsed.fieldNames);
    expect(dataset.rawRows).toEqual(JSON.parse('[{"__proto__":"01","constructor":"alpha","toString":"first","Value":"10"},{"__proto__":"02","constructor":"beta","toString":"second","Value":"20"}]'));
    expect(dataset.rawRows.every((row) => Object.hasOwn(row, '__proto__'))).toBe(true);
    expect(dataset.columns.find(({ name }) => name === '__proto__').type).toBe('number');
    expect(Object.getPrototypeOf(dataset.rawRows[0])).toBe(Object.prototype);
  });

  it('preserves duplicate hostile headers without colliding with existing generated names', () => {
    const parsed = parseDelimitedText('__proto__,__proto__,__proto___1\n01,02,03\n');
    expect(parsed.fieldNames).toEqual(['__proto__', '__proto___2', '__proto___1']);
    expect(Object.values(parsed.rawRows[0])).toEqual(['01', '02', '03']);
  });

  it('normalizes absent own columns to null rather than reading inherited data', () => {
    const row = Object.create(Object.fromEntries([['__proto__', 'inherited'], ['constructor', 'inherited']]));
    row.Value = '1';
    const dataset = createLocalDatasetFromRows({ name: 'missing.csv' }, [row], ['__proto__', 'constructor', 'Value']);
    expect(dataset.rawRows[0]).toEqual(JSON.parse('{"__proto__":null,"constructor":null,"Value":"1"}'));
  });

  it('retains one header identity across chunks and reports mismatches in later records', () => {
    const decoder = createDelimitedRowDecoder();
    expect(decoder.consume([])).toEqual([]);
    expect(decoder.consume([['__proto__', 'Value']])).toEqual([]);
    expect(decoder.consume([['01', '10'], ['02']])).toEqual(JSON.parse('[{"__proto__":"01","Value":"10"},{"__proto__":"02","Value":null}]'));
    expect(() => decoder.consume([['03', '30', 'extra']])).toThrow('data row 3');
  });
  it.each([['csv', ','], ['tsv', '\t'], ['txt', '|']])('retains blank records, blanks, zero-padded IDs and exact values in %s', (extension, separator) => {
    const text = ['ID,Value,Category', '001,10,A', ',,', '', '002,,B', '003,9007199254740993,true', '004,2026-10-01,TRUE']
      .map((line) => line.replaceAll(',', separator)).join('\n') + '\n';
    const parsed = parseDelimitedText(text);
    const dataset = createLocalDatasetFromRows({ name: `source.${extension}` }, parsed.rawRows, parsed.fieldNames);
    expect(dataset.rowCount).toBe(6);
    expect(dataset.rawRows[0]).toEqual({ ID: '001', Value: '10', Category: 'A' });
    expect(dataset.rawRows[1]).toEqual({ ID: '', Value: '', Category: '' });
    expect(dataset.rawRows[2]).toEqual({ ID: '', Value: null, Category: null });
    expect(dataset.rawRows[4]).toEqual({ ID: '003', Value: '9007199254740993', Category: 'true' });
    expect(dataset.rawRows[5].Value).toBe('2026-10-01');
  });

  it('rejects extra fields and broken quoting instead of silently discarding values', () => {
    expect(() => parseDelimitedText('A,B\n1,2,3\n')).toThrow(/Cannot safely import/);
    expect(() => parseDelimitedText('A,B\n1,"unclosed')).toThrow(/Cannot safely import/);
  });

  it('keeps cells when normalized names collide with generated suffixes', () => {
    const fields = ['A ', 'A', 'A (2)', 'A (2) '];
    const dataset = createLocalDatasetFromRows({ name: 'headers.csv' }, [{ 'A ': 1, A: 2, 'A (2)': 3, 'A (2) ': 4 }], fields);
    expect(new Set(dataset.columns.map(({ name }) => name)).size).toBe(4);
    expect(Object.values(dataset.rawRows[0])).toEqual([1, 2, 3, 4]);
  });

  it('retains empty Excel records within the worksheet range and recognizes dates', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Date', 'Amount', 'Empty'], [new Date('2026-10-01T00:00:00Z'), 10, null],
      [null, null, null], [new Date('2026-10-02T00:00:00Z'), 20, null],
    ]), 'Sales');
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const decoded = XLSX.read(buffer, { type: 'array', cellDates: true });
    const [sheet] = readSpreadsheetSheets(XLSX.utils.sheet_to_json, decoded);
    expect(sheet.rawRows).toHaveLength(3);
    expect(sheet.rawRows[1]).toEqual({ Date: null, Amount: null, Empty: null });
    expect(sheet.rawRows[0].Date).toMatch(/^2026-10-01/);
    expect(createLocalDatasetFromRows({ name: 'dates.xlsx' }, sheet.rawRows, sheet.fieldNames).metrics.columnGroups.date).toEqual(['Date']);
  });
});
