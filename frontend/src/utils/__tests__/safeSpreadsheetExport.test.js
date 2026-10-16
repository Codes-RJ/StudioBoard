import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { safeSpreadsheetMatrix } from '../safeSpreadsheetExport';
import { validatePublicEnv } from '../../../scripts/public-env.mjs';

describe('safe exported copies', () => {
  it('neutralizes formulas in headers and values, preserving originals and numbers', () => {
    const rows = [{ '=header': '=HYPERLINK("https://example.com")', amount: -12, identifier: '0001',
      plus: ' +SUM(1,2)', minus: '-1+1', at: '@SUM(1,2)', tab: '\tformula', newline: '\r=1',
      object: { f: 'HYPERLINK("https://example.com")' } }];
    const original = JSON.stringify(rows);
    const matrix = safeSpreadsheetMatrix(rows);
    const csv = Papa.parse(Papa.unparse(matrix)).data;
    expect(csv[0][0]).toBe("'=header");
    expect(csv[1][0]).toBe("'=HYPERLINK(\"https://example.com\")");
    expect(csv[1].slice(1, 3)).toEqual(['-12', '0001']);
    expect(csv[1].slice(3, 8).every((value) => value.startsWith("'"))).toBe(true);
    const sheet = XLSX.utils.aoa_to_sheet(matrix);
    expect(Object.values(sheet).filter((cell) => cell && typeof cell === 'object').some((cell) => cell.f)).toBe(false);
    expect(JSON.stringify(rows)).toBe(original);
  });
  it('rejects unreviewed public build credentials without including their values', () => {
    expect(() => validatePublicEnv({ VITE_JWT_SECRET: 'fixture-do-not-report' })).toThrow('VITE_JWT_SECRET');
    expect(() => validatePublicEnv({ VITE_PUBLIC_SITE_URL: 'https://example.com' }, { JWT_SECRET: 'server-only' })).not.toThrow();
  });
});
