// Optional maintainer command. Fetch only registry metadata and pinned license
// texts from the declared upstream repositories; never execute downloaded code.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { embeddedLicense } from './embedded-license.mjs';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const sources = {
  'agent-base': { repo: 'TooTallNate/node-agent-base' }, 'https-proxy-agent': { repo: 'TooTallNate/node-https-proxy-agent' },
  'guid-typescript': { repo: 'NicolasDeveloper/guid-typescript' }, 'victory-vendor': { repo: 'FormidableLabs/victory' },
  '@napi-rs/canvas-win32-x64-msvc': { repo: 'Brooooooklyn/canvas', metadataPackage: '@napi-rs/canvas' },
  'onnxruntime-common': { repo: 'microsoft/onnxruntime' }, 'onnxruntime-node': { repo: 'microsoft/onnxruntime' },
  'onnxruntime-web': { repo: 'microsoft/onnxruntime', installedCommit: '__commit.txt' },
};
const root = 'notices/upstream'; await mkdir(root, { recursive: true }); const reviews = [];
for (const [directory, locked] of Object.entries(lock.packages).filter(([directory, locked]) => directory && !locked.dev)) {
  let pkg; try { pkg = JSON.parse(await readFile(`${directory}/package.json`, 'utf8')); } catch { continue; }
  const files = (await readdir(directory)).filter((file) => /^(licen[cs]e|copying|copyright|notice)([._-].*)?$/i.test(file));
  if (files.length || await embeddedLicense(directory)) continue;
  const source = sources[pkg.name]; if (!source) { reviews.push({ package: `${pkg.name}@${pkg.version}`, status: 'unresolved: no configured upstream' }); continue; }
  const review = { package: `${pkg.name}@${pkg.version}`, declaredLicense: pkg.license || locked.license, repository: `https://github.com/${source.repo}`, notices: [] };
  try {
    const metadataURL = `https://registry.npmjs.org/${encodeURIComponent(source.metadataPackage || pkg.name)}/${pkg.version}`;
    const response = await fetch(metadataURL, { signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw new Error(`Registry metadata HTTP ${response.status}`);
    const metadata = await response.json(); review.metadataURL = metadataURL;
    const declaredRepository = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url;
    const declared = /github\.com[/:]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(declaredRepository || '');
    const repo = declared?.[1] || source.repo; review.repository = `https://github.com/${repo}`;
    let revision = metadata.gitHead;
    if (source.installedCommit) revision = (await readFile(`${directory}/${source.installedCommit}`, 'utf8')).trim();
    if (!revision && (pkg.name.startsWith('onnxruntime-') || pkg.name === 'victory-vendor')) {
      const ref = pkg.version.includes('-dev.') ? pkg.version.split('-').at(-1) : `v${pkg.version}`;
      const lookup = `https://api.github.com/repos/${repo}/commits/${ref}`;
      const commit = await fetch(lookup, { headers: { 'User-Agent': 'analytics-dashboard-notice-review' }, signal: AbortSignal.timeout(15_000) });
      if (!commit.ok) throw new Error(`Published release/source ref could not be resolved: HTTP ${commit.status}`);
      revision = (await commit.json()).sha; review.revisionLookup = lookup;
    }
    if (!revision || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Exact published source commit is unavailable; do not substitute an unpinned default branch.');
    review.revision = revision;
    for (const name of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'LICENSE.MD', 'license', 'COPYING', 'NOTICE', 'ThirdPartyNotices.txt']) {
      const url = `https://raw.githubusercontent.com/${repo}/${revision}/${name}`;
      const fetched = await fetch(url, { signal: AbortSignal.timeout(15_000) }); if (fetched.status === 404) continue; if (!fetched.ok) throw new Error(`Upstream HTTP ${fetched.status}`);
      const text = await fetched.text(); if (!text.trim() || text.length > 2_000_000 || /<html/i.test(text)) throw new Error('Unexpected notice content.');
      const file = `${pkg.name.replaceAll('/', '_').replaceAll('@', '')}-${pkg.version}-${name}`;
      await writeFile(`${root}/${file}`, text); review.notices.push({ file, url, sha256: createHash('sha256').update(text).digest('hex') });
    }
    review.status = review.notices.some(({ file }) => /LICENSE|COPYING/.test(file)) ? 'pinned upstream notices captured; distribution scope still needs review' : 'unresolved: upstream commit has no configured license file';
  } catch (error) { review.status = `unresolved: ${error.message}`; }
  reviews.push(review); console.log(`${review.package}: ${review.status}`);
}
await writeFile(`${root}/review.json`, JSON.stringify({ reviewedAt: new Date().toISOString(), reviews,
  boundary: 'Source commit and notice checksums, not legal certification or proof for separately downloaded model/native binaries.' }, null, 2));
if (reviews.some(({ status }) => status.startsWith('unresolved'))) process.exitCode = 1;
