// Sparkle delta updates for stable macOS releases. The publish stage patches
// each earlier release archive (see update-delta-bases.mjs) to the accepted
// application and proves that the patch rebuilds it.
import { rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { desktopVersion } from './desktop-build-plan.mjs'
import { capture, ensureDir, readJSON, run, sha256File } from './lib/build-util.mjs'

export function deltaName(product, version, from) {
  desktopVersion(from)
  return `${product}-${version}-macos-arm64-electron-from-${from}.delta`
}

export async function createMacDeltas({ binaryDelta, app, archiveBytes, bases, product, version, output, work }) {
  const deltas = []
  for (const base of bases) {
    await rm(work, { recursive: true, force: true })
    await ensureDir(work)
    await run('ditto', ['-x', '-k', base, work])
    const before = join(work, basename(app)), rebuilt = join(work, 'rebuilt.app')
    const { version: from } = await readJSON(join(before, 'Contents/Resources/release.json'))
    const patch = join(output, deltaName(product, version, from))
    await run(binaryDelta, ['create', before, app, patch])
    const { size } = await stat(patch)
    if (size > archiveBytes / 2) {
      console.log(`Skipping the delta from ${from}: it is larger than half of the full archive`)
      await rm(patch)
      continue
    }
    // BinaryDelta checks the rebuilt tree against the hash it recorded, which
    // covers contents and permissions. diff compares the rebuilt tree with the
    // accepted application independently of the tool that wrote the patch.
    await run(binaryDelta, ['apply', before, rebuilt, patch])
    await capture('diff', ['-rq', '--no-dereference', app, rebuilt])
    deltas.push({ from, name: basename(patch), bytes: size, sha256: await sha256File(patch) })
  }
  await rm(work, { recursive: true, force: true })
  return deltas
}
