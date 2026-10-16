import { unzipSync } from 'fflate';
import { validateWorkbookArchive } from './workbookArchivePolicy';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_TEXT = 10 * 1024 * 1024;
const cancel = (signal) => { if (signal?.aborted) throw new DOMException('Document import cancelled.', 'AbortError'); };
export const extractDocxParagraphs = (bytes) => {
  validateWorkbookArchive(bytes, { maxBytes: 20 * 1024 * 1024, requireZip: true });
  const files = unzipSync(bytes, { filter: (file) => file.name === 'word/document.xml' && file.originalSize <= 4 * 1024 * 1024 });
  if (!files['word/document.xml'] || files['word/document.xml'].length > 4 * 1024 * 1024) throw new Error('The DOCX body is missing or exceeds the 4 MB XML limit.');
  const xml = new DOMParser().parseFromString(new TextDecoder('utf-8', { fatal: true }).decode(files['word/document.xml']), 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('The DOCX body contains invalid XML.');
  const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  return [...xml.getElementsByTagNameNS(namespace, 'p')].map((paragraph) => [...paragraph.getElementsByTagNameNS(namespace, 't')].map((node) => node.textContent).join('')).filter((text) => text.trim());
};
export const parseLocalDocument = async (file, { signal, onProgress } = {}) => {
  cancel(signal);
  if (!file?.name || file.size > MAX_BYTES) throw new Error('Choose a document of at most 20 MB.');
  const extension = file.name.split('.').pop().toLowerCase(); const rows = []; let characters = 0;
  const append = (paragraph, page = '') => {
    characters += paragraph.length;
    if (characters > MAX_TEXT) throw new Error('Extracted document text exceeds 10 million characters.');
    for (let start = 0; start < paragraph.length;) {
      let end = Math.min(start + 2000, paragraph.length);
      if (end < paragraph.length && /[\uD800-\uDBFF]/.test(paragraph[end - 1])) end--;
      rows.push({ Document: file.name, Page: page, Block: String(rows.length + 1), Text: paragraph.slice(start, end) }); start = end;
      if (rows.length > 20_000) throw new Error('Document extraction exceeds 20,000 blocks.');
    }
  };
  if (['txt', 'md'].includes(extension)) {
    const text = await file.text(); cancel(signal); text.split(/\r?\n\s*\r?\n/).filter((text) => text.trim()).forEach((text) => append(text));
  } else if (extension === 'docx') {
    const paragraphs = extractDocxParagraphs(new Uint8Array(await file.arrayBuffer())); cancel(signal); paragraphs.forEach((text) => append(text));
  } else if (extension === 'pdf') {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: false });
    const abort = () => { void task.destroy(); }; signal?.addEventListener('abort', abort, { once: true });
    try {
      const pdf = await task.promise; if (pdf.numPages > 500) throw new Error('PDF extraction supports at most 500 pages.');
      for (let page = 1; page <= pdf.numPages; page++) {
        cancel(signal); const content = await (await pdf.getPage(page)).getTextContent();
        append(content.items.map((item) => item.str ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join(''), String(page));
        onProgress?.({ rows: rows.length, page, totalPages: pdf.numPages });
      }
    } finally { signal?.removeEventListener('abort', abort); await task.destroy(); }
  } else throw new Error('Documents support prose TXT, Markdown, PDF text layers, and DOCX body paragraphs.');
  cancel(signal);
  if (!rows.length || !rows.some((row) => row.Text.trim())) throw new Error('No readable text was extracted. Scanned PDFs require OCR, which is unavailable in this importer.');
  return { rawRows: rows, fieldNames: ['Document', 'Page', 'Block', 'Text'], document: { format: extension, blocks: rows.length,
    extraction: extension === 'pdf' ? 'PDF text layer; page order; reading order may differ from visual layout; no OCR' : extension === 'docx' ? 'DOCX body paragraphs, including table text; headers, notes, images and page breaks are excluded' : 'prose paragraphs', textCharacters: characters } };
};
