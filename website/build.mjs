import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCommunity } from './community-data.mjs';

const source = dirname(fileURLToPath(import.meta.url));
const output = resolve(source, '../dist/website');
// Only these public assets enter Pages; source, drafts and working files stay out.
const files = [
  'index.html', 'project.css', 'project.js', 'language.js', 'theme-init.js',
  'assets/eduwork.svg', 'assets/eduwork-blue.svg',
  'assets/screenshots/workspace.png', 'assets/screenshots/studio.png', 'assets/screenshots/litellm-models.png',
];
const data = process.argv.includes('--offline')
  ? JSON.parse(await readFile(join(source, 'assets/data/community.json'), 'utf8'))
  : await fetchCommunity();
// Fixed build directory under this checkout, never a path supplied by a caller.
if (output !== join(dirname(source), 'dist', 'website')) throw new Error('Unexpected output directory');
await rm(output, { recursive: true, force: true });
for (const file of files) {
  await mkdir(dirname(join(output, file)), { recursive: true });
  await copyFile(join(source, file), join(output, file));
}
await mkdir(join(output, 'assets/data'), { recursive: true });
await writeFile(join(output, 'assets/data/community.json'), JSON.stringify(data, null, 2) + '\n');
await writeFile(join(output, '.nojekyll'), '');
console.log(JSON.stringify({ output, stars: data.stars, release: data.release.tag, fetchedAt: data.fetchedAt }));
