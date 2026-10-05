import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// A build-time backport to the copied product, never the verified npm cache.
// Retire this patch when the pinned upstream includes the live-flush fix.
export const sessionSearchPatch = Object.freeze({
  id: 'session-search-live-persistence-v1',
  package: '@deepseek-ai/dsh-session-query-sqlite',
  version: '0.2.0-rc.2',
  file: 'lib/index.js',
  beforeSHA256: 'dbecf83320e10d93d735b3d01384ab817a0b90102ccecb0a22c013c71dfe70a0',
})
const sha256 = value => createHash('sha256').update(value).digest('hex')

export function patchSessionSearchSource(input) {
  if (sha256(input) !== sessionSearchPatch.beforeSHA256) {
    throw new Error('Session search backport input changed; review or retire the patch for the new Runtime')
  }
  let output = input.toString('utf8')
  for (const [before, after] of [
    ['samePersistenceSnapshots(persisted, after)', 'samePersistenceSnapshots(persisted, after, initiallyLive)'],
    ['function samePersistenceSnapshots(before, after)', 'function samePersistenceSnapshots(before, after, live)'],
    ['first.revision !== second.revision || !sameHeader', '(!live.has(id) && first.revision !== second.revision) || !sameHeader'],
  ]) {
    if (output.split(before).length !== 2) throw new Error('Unexpected session search patch site')
    output = output.replace(before, after)
  }
  return output
}

export async function patchSessionSearchRuntime(modules) {
  const root = join(modules, sessionSearchPatch.package)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== sessionSearchPatch.package || manifest.version !== sessionSearchPatch.version) {
    throw new Error('Session search backport requires a newly qualified Runtime')
  }
  const path = join(root, sessionSearchPatch.file)
  const output = patchSessionSearchSource(await readFile(path))
  await writeFile(path, output)
  return { ...sessionSearchPatch, afterSHA256: sha256(output) }
}
