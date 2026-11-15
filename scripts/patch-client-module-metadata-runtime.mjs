import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Build-time adaptation of the copied product, not the verified npm input.
// Old updaters unlink shared backup files after launching the new Host. On
// Windows that changes ctime without changing the loaded plugin's code.
// Keep this guard until the pinned upstream handles metadata-only changes.
export const clientModuleMetadataPatch = Object.freeze({
  id: 'client-module-ctime-only-rebuild-v1',
  package: '@deepseek-ai/dsh-client-modules',
  version: '0.2.2-rc.3',
  file: 'lib/index.js',
  beforeSHA256: 'a1056961926b9524a3940db3fb1cd84b5880eed54f06b8efaafa7c120b0d7602',
})
const reviewedHashes = new Map([
  ['0.2.2-rc.2', '14a3b96d88bbb153b06cc78b770bfc87c17b1fa21aa732df9873db3039f0371b'],
  [clientModuleMetadataPatch.version, clientModuleMetadataPatch.beforeSHA256],
])
const sha256 = value => createHash('sha256').update(value).digest('hex')

export function patchClientModuleMetadataSource(input, version = clientModuleMetadataPatch.version) {
  if (sha256(input) !== reviewedHashes.get(version)) {
    throw new Error('Client module metadata input changed; review or retire the patch for the new Runtime')
  }
  const before = '\t\tconst bundle = readFileSync(record.meta.clientPath);\n\t\trecord.baseline = baseline;'
  const after = `\t\tconst bundle = readFileSync(record.meta.clientPath);
\t\t// Removing an old updater backup link changes ctime, not the plugin code.
\t\t// Advance the watch baseline without tearing down the live client graph.
\t\t// Preserve explicit rebuilds (mtime changes), including lazy chunk rebuilds
\t\t// whose entry bundle can stay byte-identical. Changed bytes always reload.
\t\tif (baseline.mtimeMs === record.baseline.mtimeMs && bundle.equals(record.bundle)) {
\t\t\trecord.baseline = baseline;
\t\t\treturn record.entry.rev;
\t\t}
\t\trecord.baseline = baseline;`
  const source = input.toString('utf8')
  if (source.split(before).length !== 2) throw new Error('Unexpected client module metadata patch site')
  return source.replace(before, after)
}

export async function patchClientModuleMetadataRuntime(modules) {
  const root = join(modules, clientModuleMetadataPatch.package)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== clientModuleMetadataPatch.package || !reviewedHashes.has(manifest.version)) {
    throw new Error('Client module metadata patch requires a newly qualified Runtime')
  }
  const path = join(root, clientModuleMetadataPatch.file)
  const output = patchClientModuleMetadataSource(await readFile(path), manifest.version)
  await writeFile(path, output)
  return { ...clientModuleMetadataPatch, version: manifest.version, beforeSHA256: reviewedHashes.get(manifest.version), afterSHA256: sha256(output) }
}
