import Papa from 'papaparse';
import { createDelimitedRowDecoder, assertDelimitedParseErrors, trimDelimitedTerminator } from './tabularImport';

self.onmessage = async ({ data }) => {
  const { id, file } = data;
  try {
    const trailing = await file.slice(Math.max(0, file.size - 2)).text();
    let rawRows = []; let failed = false;
    const decoder = createDelimitedRowDecoder();
    Papa.parse(file, { header: false, dynamicTyping: false, skipEmptyLines: false, chunkSize: 1024 * 1024,
      chunk: (result, parser) => {
        if (failed) return;
        try {
          assertDelimitedParseErrors(result.errors);
          const rows = decoder.consume(result.data);
          if (rawRows.length + rows.length > 1_000_001) throw new Error('The file exceeds the 1,000,000-row import limit.');
          for (const row of rows) rawRows.push(row);
          self.postMessage({ id, progress: { rows: rawRows.length, bytes: result.meta.cursor, totalBytes: file.size } });
        } catch (error) {
          failed = true; parser.abort(); rawRows = [];
          self.postMessage({ id, error: error.message });
        }
      },
      complete: () => {
        if (failed) return;
        trimDelimitedTerminator(rawRows, trailing);
        self.postMessage({ id, rawRows, fieldNames: decoder.fieldNames });
      },
      error: (error) => { failed = true; self.postMessage({ id, error: error.message || 'Unable to read this file.' }); }
    });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Unable to parse this file.' });
  }
};
