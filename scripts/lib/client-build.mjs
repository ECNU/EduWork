// Shared pieces for the dsh-plugins/*/build-client.mjs builders: standard CLI
// contract, locked tsdown execution and locked dependency lookup.
import { readdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { isFile, isWindows, pathExists, readJSON, runNode } from './build-util.mjs'

// Every builder accepts the same option set (unused options are ignored), so
// the assembly orchestrator can invoke them uniformly.
export function parseBuilderArgs() {
  const { values } = parseArgs({
    options: {
      upstream: { type: 'string' },
      'dsh-lock': { type: 'string' },
      output: { type: 'string' },
      'runtime-packages': { type: 'string' },
      'artifact-services': { type: 'string' },
      version: { type: 'string' },
    },
  })
  return {
    upstream: values.upstream ?? '',
    dshLockPath: values['dsh-lock'] ?? '',
    output: values.output ?? '',
    runtimePackages: values['runtime-packages'] ?? '',
    artifactServices: values['artifact-services'] ?? '',
    version: values.version ?? '',
  }
}

export function lockedTsdownGatePath(upstream) {
  return join(upstream, 'node_modules/.bin', isWindows ? 'tsdown.cmd' : 'tsdown')
}

export async function assertLockedTsdown(upstream) {
  const gate = lockedTsdownGatePath(upstream)
  if (!await pathExists(gate)) throw new Error(`Locked DSH build dependencies are unavailable: ${gate}`)
}

// Run the locked tsdown through Node.js directly; the .bin shims need a shell
// on Windows and are not required once the JavaScript entry is resolved.
export async function runLockedTsdown(upstream, stage) {
  const packageRoot = join(upstream, 'node_modules/tsdown')
  const manifest = await readJSON(join(packageRoot, 'package.json'))
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.tsdown
  if (!bin) throw new Error('Locked tsdown package has no executable entry')
  await runNode(join(packageRoot, bin), ['--config', 'tsdown.config.ts'], { cwd: stage })
}

export async function findLockedZod(upstream) {
  const store = join(upstream, 'node_modules/.pnpm')
  const entries = (await readdir(store)).filter(name => name.startsWith('zod@')).sort().reverse()
  for (const entry of entries) {
    const candidate = join(store, entry, 'node_modules/zod')
    if (await isFile(join(candidate, 'package.json'))) return candidate
  }
  return null
}

export const symlinkType = isWindows ? 'junction' : 'dir'

// Junction on Windows (no privilege needed), directory symlink elsewhere;
// matches the New-Item link types the PowerShell builders used.
export async function linkDirectory(path, target) {
  await symlink(target, path, symlinkType)
}
