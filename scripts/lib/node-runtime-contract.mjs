import { readFileSync } from 'node:fs'

// One security pin for the build toolchain, packaged Host and media runtime.
// A matching old Host receipt is not sufficient to admit an old executable.
const manifest = JSON.parse(readFileSync(new URL('../../dsh-desktop/internal/productruntime/builtin/node-runtime-manifest.json', import.meta.url), 'utf8'))
export const pinnedNodeVersion = `v${manifest.nodeVersion}`

export function assertPinnedNodeVersion(actual = process.version, label = 'Node.js build toolchain') {
  if (actual !== pinnedNodeVersion) throw new Error(`${label} must use pinned ${pinnedNodeVersion}; found ${actual}`)
}

export function assertPreparedNode(actual, prepared) {
  assertPinnedNodeVersion(actual, 'Packaged Node.js')
  if (prepared !== actual) throw new Error('Node and qualified Host runtime versions differ; rebuild the Host with the pinned Node.js')
}
