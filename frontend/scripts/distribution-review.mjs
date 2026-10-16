import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const GUID_MARKERS = ['emptyguid', 'Invalid argument; `value` has no value.'];
const digest = (value) => createHash('sha256').update(value).digest('hex');
export const REVIEWED_ONNX_ENTRIES = {
  'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs': 'c57ca56328877353a575e51bbca6f18450027d6c9bf2307a2cb2c41363b4de9f',
  'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm': '06ba057753da3847e4c24f02d91ab133455b0817c69a44993a9a53a2146df9e3',
  'node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs': '7c93a51e9906b246af505bbfbfa4e5806ebe70a081ab0ca0d34e1180293f4f8d',
};
const collectFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(directory, entry.name);
  return entry.isDirectory() ? collectFiles(target) : [target];
});

// Workers have separate Rollup module graphs; record them as well as main chunks.
export const distributionReviewPlugins = () => {
  const modules = new Set(); let workerId = 0;
  const plugin = (worker = false) => { let ssr = false; return {
    name: `distribution-review-${worker ? ++workerId : 'main'}`,
    apply: 'build',
    configResolved(config) { ssr = Boolean(config.build.ssr); },
    generateBundle(_options, bundle) {
      if (ssr) return;
      for (const output of Object.values(bundle)) if (output.type === 'chunk') for (const id of Object.keys(output.modules)) modules.add(id);
    },
    writeBundle() {
      if (worker || ssr) return;
      const root = process.cwd();
      const ids = [...modules].filter((id) => !id.startsWith('\0')).map((id) => path.relative(root, id.split('?')[0]).replaceAll('\\', '/')).sort();
      const onnxEntries = ids.filter((id) => /node_modules\/onnxruntime-web\/dist\//.test(id));
      const artifacts = collectFiles('dist').filter((name) => /\.(?:js|mjs|wasm)$/.test(name)).map((name) => {
        const bytes = fs.readFileSync(name);
        return { file: name.replaceAll('\\', '/').replace(/^dist\//, ''), sha256: digest(bytes),
          guidMarker: /\.(?:js|mjs)$/.test(name) && GUID_MARKERS.some((marker) => bytes.toString('utf8').includes(marker)) };
      });
      const entryReview = onnxEntries.map((file) => ({ file, sha256: digest(fs.readFileSync(file)),
        guidMarker: GUID_MARKERS.some((marker) => fs.readFileSync(file, 'utf8').includes(marker)) }));
      fs.mkdirSync('audit-results', { recursive: true });
      fs.writeFileSync('audit-results/distribution-review.json', JSON.stringify({ version: 1, modules: ids, onnxEntries: entryReview, artifacts }, null, 2));
    },
  }; };
  return { main: plugin(), worker: () => [plugin(true)] };
};

// This exception concerns an installed package absent from the shipped build.
// A different runtime entry or reintroduced bundled implementation fails closed.
export const validateInstalledOnlyGuid = (review, { hashFile, artifactFiles }) => {
  try {
    if (review.version !== 1 || !review.onnxEntries.length || !review.artifacts.length
      || review.modules.some((id) => /guid-typescript\//.test(id))
      || new Set(review.onnxEntries.map(({ file }) => file)).size !== review.onnxEntries.length
      || review.onnxEntries.some(({ file, sha256, guidMarker }) => guidMarker || REVIEWED_ONNX_ENTRIES[file] !== sha256 || hashFile(file) !== sha256)
      || !review.onnxEntries.some(({ file }) => file.endsWith('/ort.webgpu.bundle.min.mjs'))
      || review.artifacts.some(({ guidMarker }) => guidMarker)) return false;
    for (const { file, sha256 } of review.artifacts) {
      if (file.includes('..') || path.isAbsolute(file) || hashFile(path.join('dist', file)) !== sha256) return false;
    }
    const reviewed = new Set(review.artifacts.map(({ file }) => file));
    return reviewed.size === review.artifacts.length && artifactFiles.length === reviewed.size && artifactFiles.every((file) => reviewed.has(file));
  } catch { return false; }
};
export const reviewedInstalledOnlyGuid = () => {
  try {
    return validateInstalledOnlyGuid(JSON.parse(fs.readFileSync('audit-results/distribution-review.json', 'utf8')), {
      hashFile: (file) => digest(fs.readFileSync(file)),
      artifactFiles: collectFiles('dist').filter((name) => /\.(?:js|mjs|wasm)$/.test(name)).map((file) => file.replaceAll('\\', '/').replace(/^dist\//, '')),
    });
  } catch { return false; }
};
