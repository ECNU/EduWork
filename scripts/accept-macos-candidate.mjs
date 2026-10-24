// Run the final macOS 26-built ZIP on the minimum supported OS. This shares
// release acceptance with the build job; it never rebuilds or re-signs the app.
import assert from 'node:assert/strict'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { acceptMacos } from './lib/macos-stages.mjs'
import { macosArchitecture } from './lib/macos-architecture.mjs'
import { capture, ensureDir, pathExists, readJSON, sha256File, statEntry, writeJSON } from './lib/build-util.mjs'

const [candidateArg, outputArg] = process.argv.slice(2)
if (!candidateArg || !outputArg || process.platform !== 'darwin') throw new Error('Use accept-macos-candidate.mjs <CI artifact directory> <new evidence directory> on macOS')
const candidate = resolve(candidateArg), output = resolve(outputArg)
const target = macosArchitecture()
const receipt = await readJSON(join(candidate, 'release-receipt.json'))
assert.equal(receipt.platform, target.archivePlatform)
assert.equal(receipt.passed, true)
assert.equal(receipt.minimumSystemVersion, '15.0')
assert.equal(receipt.asset.name, `${receipt.edition}-${receipt.version}-${target.archivePlatform}-electron.zip`)
const archive = join(candidate, receipt.asset.name)
assert.equal((await statEntry(archive)).size, receipt.asset.bytes)
assert.equal(await sha256File(archive), receipt.asset.sha256)
const os = (await capture('sw_vers', ['-productVersion'])).trim()
assert.match(os, /^15\./, 'Minimum-system acceptance must actually run on macOS 15')
if (await pathExists(output)) throw new Error('Acceptance requires a new output directory')
await ensureDir(join(output, 'evidence-public'))
const result = { passed: false, os, arch: target.arch, asset: receipt.asset, coreCommit: receipt.coreCommit }
try {
  result.checks = await acceptMacos({
    workspace: {
      resolvePath: path => path === 'desktop' ? candidate : join(output, path),
      parameters: { verifySnapshot: receipt.sourceSnapshotVerified },
    },
    coreRoot: dirname(dirname(fileURLToPath(import.meta.url))),
    name: receipt.edition,
    verifyPublisherBootstrap: false,
  })
  result.passed = true
} catch (error) {
  result.error = error.message
  throw error
} finally {
  await writeJSON(join(output, 'evidence-public/macos15-result.json'), result)
}
