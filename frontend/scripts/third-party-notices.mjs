import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { reviewedInstalledOnlyGuid } from './distribution-review.mjs';
import { embeddedLicense } from './embedded-license.mjs';

const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
const missing = []; let found = 0;
const upstream = JSON.parse(await fs.readFile('notices/upstream/review.json', 'utf8').catch(() => '{"reviews":[]}'));
const noticeFiles = async (directory) => {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && /^(licen[cs]e|copying|copyright|notice)([._-].*)?$/i.test(entry.name)) result.push(path.join(directory, entry.name));
    if (entry.isDirectory() && entry.name === 'lib-vendor') for (const vendor of await fs.readdir(path.join(directory, entry.name), { withFileTypes: true })) {
      if (vendor.isDirectory()) result.push(...await noticeFiles(path.join(directory, entry.name, vendor.name)));
    }
  }
  return result;
};
const sections = [await fs.readFile('LICENSE', 'utf8'), 'Optional model licenses and runtime sources: see the project THIRD_PARTY_NOTICES.md.'];
for (const [directory, entry] of Object.entries(lock.packages || {}).filter(([name, entry]) => name && !entry.dev).sort(([a], [b]) => a.localeCompare(b))) {
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')); }
  catch { continue; }
  const files = await noticeFiles(directory);
  const texts = [];
  const embedded = await embeddedLicense(directory);
  if (embedded) texts.push(`${directory}/README.md (complete embedded license section)\n${embedded}`);
  for (const file of files) texts.push(`${file}\n${await fs.readFile(file, 'utf8')}`);
  const review = upstream.reviews.find((item) => item.package === `${manifest.name}@${manifest.version}`);
  for (const notice of review?.notices || []) {
    const text = await fs.readFile(path.join('notices/upstream', notice.file), 'utf8');
    if (createHash('sha256').update(text).digest('hex') !== notice.sha256) throw new Error(`Notice checksum changed: ${notice.file}`);
    texts.push(`${notice.url}\nSHA-256 ${notice.sha256}\n${text}`);
  }
  const installedOnly = manifest.name === 'guid-typescript' && manifest.version === '1.0.9' && reviewedInstalledOnlyGuid();
  if (installedOnly) texts.push('Installed dependency only: the reviewed WebGPU/WASM module graphs and checksummed JS/WASM distribution exclude this package and its WebGL implementation. No upstream license text is invented. Shipping node_modules or a WebGL/all runtime requires a new notice review.');
  if (!texts.length) missing.push(`${manifest.name}@${manifest.version}`); else if (!installedOnly) found += 1;
  sections.push(`${manifest.name}@${manifest.version}\n${typeof manifest.license === 'string' ? manifest.license : entry.license || 'See upstream license'}\n${texts.join('\n')}`);
}
sections.unshift(`Dependency notices generated from this installation. ${found} packages with local notice files.\nPackages requiring upstream notice review: ${missing.join(', ') || 'none detected'}.\n`);
await fs.writeFile('dist/third-party-notices.txt', sections.join('\n\n----------------------------------------\n\n'));
console.log(`Dependency notices: ${found} packages with notice files; ${missing.length} need upstream review.`);
if (process.argv.includes('--strict') && missing.length) {
  console.error(`Release notice review is incomplete: ${missing.join(', ')}.`);
  process.exitCode = 1;
}
