// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { REVIEWED_ONNX_ENTRIES, validateInstalledOnlyGuid } from '../../../scripts/distribution-review.mjs';
const fixture = () => ({ version: 1, modules: ['node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs'],
  onnxEntries: Object.entries(REVIEWED_ONNX_ENTRIES).map(([file, sha256]) => ({ file, sha256, guidMarker: false })),
  artifacts: [{ file: 'assets/runtime.js', sha256: 'fixture-digest', guidMarker: false }] });
const files = { hashFile: (file) => REVIEWED_ONNX_ENTRIES[file] || 'fixture-digest', artifactFiles: ['assets/runtime.js'] };
describe('installed-only GUID distribution exception', () => {
  it('accepts only a complete unchanged reviewed build', () => {
    expect(validateInstalledOnlyGuid(fixture(), files)).toBe(true);
    expect(validateInstalledOnlyGuid(fixture(), { ...files, hashFile: () => 'changed' })).toBe(false);
    expect(validateInstalledOnlyGuid(fixture(), { ...files, artifactFiles: ['assets/runtime.js', 'unreviewed.wasm'] })).toBe(false);
  });
  it('rejects shipped GUID modules, different runtime entries and known implementation markers', () => {
    const module = fixture(); module.modules.push('node_modules/guid-typescript/dist/guid.js');
    expect(validateInstalledOnlyGuid(module, files)).toBe(false);
    const webgl = fixture(); webgl.onnxEntries.push({ file: 'node_modules/onnxruntime-web/dist/ort.all.min.mjs', sha256: 'fixture-digest' });
    expect(validateInstalledOnlyGuid(webgl, files)).toBe(false);
    const marker = fixture(); marker.artifacts[0].guidMarker = true;
    expect(validateInstalledOnlyGuid(marker, files)).toBe(false);
  });
  it('rejects missing graphs, duplicate artifacts and path traversal', () => {
    expect(validateInstalledOnlyGuid({}, files)).toBe(false);
    const duplicate = fixture(); duplicate.artifacts.push(duplicate.artifacts[0]);
    expect(validateInstalledOnlyGuid(duplicate, files)).toBe(false);
    const traversal = fixture(); traversal.artifacts[0].file = '../unreviewed.js';
    expect(validateInstalledOnlyGuid(traversal, files)).toBe(false);
  });
});
