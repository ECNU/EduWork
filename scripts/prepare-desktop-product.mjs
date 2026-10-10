// Prepares the shared desktop product tree from a validated Web assembly and
// the desktop Host adapter build. Node.js port of prepare-desktop-product.ps1.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  copyFileTo, copyTree, fullPath, isMainModule, pathExists, readJSON, sha256File, writeJSON,
} from './lib/build-util.mjs'
import { copyDshPackagePayload, installLockedDshPackage } from './lib/dsh-packages.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

export async function prepareDesktopProduct({ webAssembly, hostAdapter, output, oidcSnapshot = '', studioSnapshot = '', version = '', brandingBuild = '' } = {}) {
  const repository = fullPath(join(scriptRoot, '..'))
  webAssembly = fullPath(webAssembly)
  output = fullPath(output)
  if (await pathExists(output)) throw new Error('Desktop product output must be a new directory')
  if (/(^|[\\/])current([\\/]|$)/i.test(output)) throw new Error('Desktop candidates cannot replace current')
  const identity = await readJSON(join(webAssembly, 'assembly.json'))
  if (identity.pluginMode === 'npm' && (oidcSnapshot || studioSnapshot)) {
    throw new Error('An npm desktop product preserves the tested Web packages; assemble an explicit development Web product to use snapshot overrides')
  }
  const hostReceipt = await readJSON(join(hostAdapter, 'receipt.json'))
  if (identity.kind !== 'eduwork-web' || identity.dshCommit !== hostReceipt.upstreamCommit || identity.dshVersion !== hostReceipt.upstreamVersion) {
    throw new Error('Product and desktop Host baselines differ')
  }
  await copyTree(webAssembly, output)
  const modules = join(output, 'd/node_modules')
  await copyTree(join(hostAdapter, 'desktop-host'), join(modules, '@deepseek-ai/dsh-desktop-host'))
  const adapters = {}
  for (const folder of ['desktop-boundary', 'credentials-native', 'desktop-services', 'artifact-preview-native']) {
    const source = join(repository, `dsh-plugins/${folder}`)
    const manifest = await readJSON(join(source, 'package.json'))
    const destination = join(modules, manifest.name)
    if (await pathExists(destination)) {
      // Existing preview package is already part of the frozen product; only
      // its Host modules change for the new transport, with no client rebuild.
      await copyTree(join(source, 'lib'), join(destination, 'lib'))
    } else {
      await copyDshPackagePayload(source, destination)
    }
    for (const peerName of Object.keys(manifest.peerDependencies ?? {})) {
      if (peerName.startsWith('@deepseek-ai/dsh-')) manifest.peerDependencies[peerName] = identity.dshVersion
    }
    await writeJSON(join(destination, 'package.json'), manifest)
    adapters[manifest.name] = { version: manifest.version, source: `dsh-plugins/${folder}` }
  }
  if (oidcSnapshot) {
    identity.managedPackages['@eduwork/dsh-oidc'] = await installLockedDshPackage({
      destination: join(modules, '@eduwork/dsh-oidc'),
      lockPath: oidcSnapshot,
      requiredFiles: ['lib/index.js', 'lib/client.js'],
    })
  }
  if (studioSnapshot) {
    identity.managedPackages['@eduwork/dsh-knowledge-studio'] = await installLockedDshPackage({
      destination: join(modules, '@eduwork/dsh-knowledge-studio'),
      lockPath: studioSnapshot,
      requiredFiles: ['lib/index.js', 'lib/client.js'],
    })
  }
  if (version) {
    if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('An explicit valid product version is required')
    identity.version = version
  }
  if (brandingBuild) {
    const branding = join(modules, '@chatecnu-work/dsh-client-ui-branding/lib')
    const hashes = {}
    for (const file of ['index.js', 'theme.js', 'client.js']) {
      const inputFile = join(fullPath(brandingBuild), file)
      await copyFileTo(inputFile, join(branding, file))
      hashes[file] = await sha256File(inputFile)
    }
    identity.brandingBuild = hashes
  }
  identity.desktopAdapters = adapters
  identity.desktopHost = hostReceipt
  await writeJSON(join(output, 'assembly.json'), identity)
  console.log(`Shared desktop product prepared: ${output}`)
  return output
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'web-assembly': { type: 'string' },
      'host-adapter': { type: 'string' },
      output: { type: 'string' },
      'oidc-snapshot': { type: 'string' },
      'studio-snapshot': { type: 'string' },
      version: { type: 'string' },
      'branding-build': { type: 'string' },
    },
  })
  if (!values['web-assembly'] || !values['host-adapter'] || !values.output) {
    throw new Error('Use --web-assembly <dir> --host-adapter <dir> --output <dir> [--oidc-snapshot <LOCK.json>] [--studio-snapshot <LOCK.json>] [--version <x.y.z>] [--branding-build <lib>]')
  }
  await prepareDesktopProduct({
    webAssembly: values['web-assembly'],
    hostAdapter: values['host-adapter'],
    output: values.output,
    oidcSnapshot: values['oidc-snapshot'] ?? '',
    studioSnapshot: values['studio-snapshot'] ?? '',
    version: values.version ?? '',
    brandingBuild: values['branding-build'] ?? '',
  })
}
