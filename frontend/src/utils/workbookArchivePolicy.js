import { Unzip, UnzipInflate } from 'fflate';

export const MAX_WORKBOOK_EXPANDED_BYTES = 200 * 1024 * 1024;
export const MAX_WORKBOOK_ARCHIVE_ENTRIES = 10_000;

/** Count streamed inflated bytes before handing an XLSX archive to SheetJS. */
export const validateWorkbookArchive = (buffer, { maxBytes = MAX_WORKBOOK_EXPANDED_BYTES, signal, requireZip = false } = {}) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    if (requireZip) throw new Error('This workbook/document is not a valid ZIP archive.');
    return; // Legacy binary XLS is not ZIP.
  }
  const overLimit = () => new Error(`The expanded archive exceeds its ${Math.ceil(maxBytes / 1024 / 1024)} MB safety policy.`);
  let total = 0; let entries = 0; let failure;
  const unzip = new Unzip((file) => {
    if (++entries > MAX_WORKBOOK_ARCHIVE_ENTRIES) throw new Error('The workbook contains too many archive entries.');
    if (file.originalSize > maxBytes) throw overLimit();
    file.ondata = (error, chunk) => {
      if (error) { failure = error; return; }
      total += chunk.length;
      if (total > maxBytes) { failure = overLimit(); file.terminate(); }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
    unzip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
    if (failure) throw failure;
  }
  if (!entries) throw new Error('The workbook ZIP contains no usable entries.');
};
