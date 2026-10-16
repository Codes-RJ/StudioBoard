import { readFile } from 'node:fs/promises';
// Some exact-version npm archives publish their complete MIT copyright and
// permission notice inside README rather than a separate LICENSE file.
export const embeddedLicense = async (directory) => {
  const readme = await readFile(`${directory}/README.md`, 'utf8').catch(() => '');
  const section = readme.match(/(?:^|\n)(?:#+\s+License\s*\n|License\s*\n-+\s*\n)([\s\S]*?SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE\.)/i)?.[1];
  return section && /Copyright/i.test(section) && /Permission is hereby granted, free of charge/i.test(section) && /The above copyright notice/i.test(section) ? section.trim() : null;
};
