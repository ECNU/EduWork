// Assembles Wails and/or Electron desktop candidates from the same frozen
// desktop product. Node.js port of assemble-desktop-candidate.ps1.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { fullPath, isMainModule, pathExists, runNode } from './lib/build-util.mjs'
import { assembleOfficialHost } from '../dsh-desktop/scripts/assemble-official-host.mjs'
import { assembleWindows } from '../dsh-electron/scripts/assemble-windows.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

export async function assembleDesktopCandidate({
  shell,
  product,
  hostAdapter,
  outputRoot,
  version,
  electronShellBuild = '',
  electronRuntime = '',
  node = process.execPath,
} = {}) {
  if (!['electron', 'wails', 'both'].includes(shell)) throw new Error('Shell must be electron, wails or both')
  const repository = fullPath(join(scriptRoot, '..'))
  outputRoot = fullPath(outputRoot)
  if (/(^|[\\/])current([\\/]|$)/i.test(outputRoot)) throw new Error('Candidates must be assembled separately from current')
  if (['electron', 'both'].includes(shell) && (!electronShellBuild || !electronRuntime)) {
    throw new Error('ElectronShellBuild and ElectronRuntime are required for Electron')
  }
  const selected = shell === 'both' ? ['wails', 'electron'] : [shell]
  // Preflight both outputs before creating either. No promotion, backup, or cleanup
  // is implicit in this entry point; it only consumes the same frozen product.
  for (const entry of selected) {
    if (await pathExists(join(outputRoot, `${entry}-candidate`))) throw new Error(`Candidate already exists: ${entry}`)
  }
  await runNode(join(repository, 'dsh-host/install-product-host.mjs'), ['--product', product, '--adapter', hostAdapter])
    .catch(() => { throw new Error('Desktop Host product preparation failed') })
  for (const entry of selected) {
    const destination = join(outputRoot, `${entry}-candidate`)
    if (entry === 'wails') {
      await assembleOfficialHost({ product, hostAdapter, output: destination, version, node })
    } else {
      await assembleWindows({ product, shellBuild: electronShellBuild, electronRuntime, output: destination, version, node })
    }
  }
  console.log(`Desktop candidates assembled from the same product: ${outputRoot}`)
  return outputRoot
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      shell: { type: 'string' },
      product: { type: 'string' },
      'host-adapter': { type: 'string' },
      'output-root': { type: 'string' },
      version: { type: 'string' },
      'electron-shell-build': { type: 'string' },
      'electron-runtime': { type: 'string' },
      node: { type: 'string' },
    },
  })
  if (!values.shell || !values.product || !values['host-adapter'] || !values['output-root'] || !values.version) {
    throw new Error('Use --shell electron|wails|both --product <dir> --host-adapter <dir> --output-root <dir> --version <x.y.z> [--electron-shell-build <dir>] [--electron-runtime <dir>] [--node <node>]')
  }
  await assembleDesktopCandidate({
    shell: values.shell,
    product: values.product,
    hostAdapter: values['host-adapter'],
    outputRoot: values['output-root'],
    version: values.version,
    electronShellBuild: values['electron-shell-build'] ?? '',
    electronRuntime: values['electron-runtime'] ?? '',
    node: values.node ?? process.execPath,
  })
}
