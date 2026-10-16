import Papa from 'papaparse';

// Match Papa's existing duplicate-header names while constructing data through
// own properties, including __proto__. The same decoder spans worker chunks.
export const createDelimitedRowDecoder = () => {
  let fieldNames; let rowNumber = 0;
  return {
    get fieldNames() { return fieldNames; },
    consume: (records) => {
      let start = 0;
      if (!fieldNames && records.length) {
        const headers = records[0].map((name) => name.replace(/^\uFEFF/, ''));
        const used = new Set(headers); const counts = new Map();
        fieldNames = headers.map((header) => {
          const count = counts.get(header) || 0;
          counts.set(header, count + 1);
          if (!count) return header;
          let suffix = count; let unique;
          do { unique = `${header}_${suffix++}`; } while (used.has(unique));
          used.add(unique); return unique;
        });
        start = 1;
      }
      return records.slice(start).map((values) => {
        rowNumber++;
        if (values.length > fieldNames.length) throw new Error(`Cannot safely import this file: Too many fields (data row ${rowNumber}). Check the delimiter and quoting; no rows were imported.`);
        return Object.fromEntries(fieldNames.map((name, index) => [name, values[index] ?? null]));
      });
    },
  };
};

export const assertDelimitedParseErrors = (errors) => {
  const fatal = errors.find(({ code }) => !['TooFewFields', 'UndetectableDelimiter'].includes(code));
  if (fatal) throw new Error(`Cannot safely import this file: ${fatal.message}${Number.isInteger(fatal.row) ? ` (record ${fatal.row + 1})` : ''}. Check the delimiter and quoting; no rows were imported.`);
};

export const trimDelimitedTerminator = (rawRows, trailing) => {
  // A final line terminator is not a record. Interior blank records are retained.
  if (/(?:\r\n|\r|\n)$/.test(trailing) && rawRows.length
      && Object.values(rawRows.at(-1)).every((value) => value === '' || value === null)) {
    rawRows.pop();
  }
};

/** Keep source values verbatim; convert them only during explicit analysis. */
export const parseDelimitedText = (text) => {
  const result = Papa.parse(text, { header: false, dynamicTyping: false, skipEmptyLines: false });
  assertDelimitedParseErrors(result.errors);
  const decoder = createDelimitedRowDecoder();
  const rawRows = decoder.consume(result.data);
  trimDelimitedTerminator(rawRows, text);
  return { rawRows, fieldNames: decoder.fieldNames };
};

export const readSpreadsheetSheets = (sheetToRows, workbook) => workbook.SheetNames.map((name) => {
  const rawRows = sheetToRows(workbook.Sheets[name], { defval: null, blankrows: true })
    .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
      [key, value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : value])));
  return { name, rawRows, fieldNames: Object.keys(rawRows[0] || {}) };
});
