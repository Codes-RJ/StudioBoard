import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { extractDocxParagraphs, parseLocalDocument } from '../documentImport';
import { approveQualityRevision } from '../qualityReview';
import { buildEvidenceIndex, retrieveSourceEvidence } from '../localAI/evidence';
describe('reviewable prose document evidence', () => {
  it('preserves paragraph text, Unicode boundaries and document block citations', async () => {
    const text = `${'a'.repeat(1999)}😀 rareDocumentMarker\n\nAnother paragraph`;
    const parsed = await parseLocalDocument({ name: 'notes.txt', size: text.length, text: async () => text });
    expect(parsed.rawRows.map((row) => row.Text).join('')).toBe(text.replace('\n\n', ''));
    expect(parsed.rawRows[0].Text).toHaveLength(1999);
    const dataset = approveQualityRevision({ id: 'doc', isLocal: true, name: 'notes', columns: parsed.fieldNames, ...parsed });
    const hits = retrieveSourceEvidence(dataset, buildEvidenceIndex(dataset), 'rareDocumentMarker').hits;
    expect(hits[0]).toMatchObject({ documentBlock: '2', sourceRowId: 'doc:row:2' });
  });
  it('extracts DOCX body and table paragraphs without executing XML or reading unrelated ZIP entries', () => {
    const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>First &amp; second</w:t></w:r></w:p><w:tbl><w:p><w:r><w:t>Table text</w:t></w:r></w:p></w:tbl></w:body></w:document>';
    expect(extractDocxParagraphs(zipSync({ 'word/document.xml': strToU8(xml), 'word/header1.xml': strToU8('Excluded') }))).toEqual(['First & second', 'Table text']);
  });
  it('rejects oversized files, unsupported formats and cancellation', async () => {
    await expect(parseLocalDocument({ name: 'big.pdf', size: 21 * 1024 * 1024 })).rejects.toThrow('20 MB');
    await expect(parseLocalDocument({ name: 'sheet.csv', size: 1 })).rejects.toThrow('Documents support');
    const controller = new AbortController(); controller.abort();
    await expect(parseLocalDocument({ name: 'notes.txt', size: 1 }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
