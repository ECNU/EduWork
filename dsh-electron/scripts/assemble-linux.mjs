// Assemble the Linux x64 Electron candidate used as the payload of the
// AppImage. The AppImage wrapper is created separately so the candidate can
// also be inspected and launched directly during local development.
import { chmod, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { assertPreparedNode } from '../../scripts/lib/node-runtime-contract.mjs'
import {
  capture, copyFileTo, copyTree, ensureDir, fullPath, isFile, isMainModule,
  pathExists, readJSON, runNode, sha256File, writeJSON, writeText,
} from '../../scripts/lib/build-util.mjs'
import { installDesktopConfig } from '../../scripts/install-desktop-config.mjs'
import { desktopVersion } from '../../scripts/desktop-build-plan.mjs'
import { pruneRuntimeFiles } from '../../scripts/lib/runtime-file-policy.mjs'
import { pruneElectronLocales } from './electron-locales.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))
const payloadFilters = {
  skipLinks: true,
  excludeFile: name => /\.(?:map|pdb|pyc)$/iu.test(name) || name.toLowerCase() === 'default_app.asar',
  excludeDir: name => name === '__pycache__',
}

export async function assembleLinux({ product, shellBuild, electronRuntime, output, version, node = process.execPath } = {}) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Linux AppImage assembly requires a Linux x64 host')
  if (!await isFile(join(electronRuntime, 'electron'))) {
    throw new Error('ElectronRuntime must point to the extracted Linux runtime containing electron')
  }
  output = fullPath(output)
  if (await pathExists(output)) throw new Error('Linux output must be a new directory')
  if (/(^|[\\/])current([\\/]|$)/iu.test(output)) throw new Error('Linux cannot replace current')
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version ?? '')) throw new Error('An explicit product version is required')

  const identity = await readJSON(join(product, 'assembly.json'))
  await runNode(join(scriptRoot, '../../scripts/verify-product-release-identity.mjs'), [product, version])
    .catch(() => { throw new Error('Product release identity verification failed') })
  const receipt = await readJSON(join(shellBuild, 'source-receipt.json'))
  if (identity.dshCommit !== receipt.dshCommit) throw new Error('Electron and product DSH versions differ')
  const nodeVersion = (await capture(node, ['--version'])).trim()
  assertPreparedNode(nodeVersion, receipt.host.nodeVersion)
  // Official Node archives place LICENSE beside `bin/`, next to the
  // executable's parent directory.
  const nodeLicense = join(dirname(dirname(node)), 'LICENSE')
  if (!await isFile(nodeLicense)) throw new Error('Use the extracted official Node distribution, including its LICENSE')

  await copyTree(electronRuntime, output, payloadFilters)
  const electronLocales = await pruneElectronLocales(output, 'linux')
  const app = join(output, 'resources/app')
  await ensureDir(app)
  for (const folder of ['lib', 'renderer', 'third-party']) {
    if (folder === 'renderer' && !await pathExists(join(shellBuild, folder))) continue
    await copyTree(join(shellBuild, folder), join(app, folder), payloadFilters)
  }
  await copyFileTo(join(shellBuild, 'LICENSE-DeepSeek'), join(app, 'LICENSE-DeepSeek'))
  await copyFileTo(join(shellBuild, 'source-receipt.json'), join(app, 'source-receipt.json'))
  await copyTree(product, join(output, 'resources/product'), { skipLinks: true })
  const runtimeFiles = await pruneRuntimeFiles(join(output, 'resources/product'), 'linux-x64')
  await ensureDir(join(output, 'resources/runtime'))
  await copyFileTo(node, join(output, 'resources/runtime/node'))
  await copyFileTo(nodeLicense, join(output, 'resources/runtime/LICENSE-Node'))
  await chmod(join(output, 'resources/runtime/node'), 0o755)

  const name = identity.brand.product.name
  await writeJSON(join(app, 'package.json'), {
    name: 'eduwork-desktop-electron', version: identity.dshVersion, private: true, type: 'module',
    main: 'lib/main.js', description: 'EduWork official DSH Electron integration', license: 'MulanPSL-2.0 AND MIT',
  })
  const config = {
    schemaVersion: 1, shell: 'electron', appId: `org.eduwork.${identity.distribution}.electron`,
    distribution: identity.distribution, productName: name, productVersion: version,
    product: '../product', node: '../runtime/node', updateChannel: 'disabled-candidate',
    updates: { provider: 'disabled', defaultPolicy: desktopVersion(version).channel }, configurationOwnership: 'user',
  }
  const policyPath = join(product, 'resources/desktop/configuration-policy.json')
  if (await pathExists(policyPath)) {
    const policy = await readJSON(policyPath)
    if (policy.schemaVersion !== 1 || !['user', 'publisher'].includes(policy.ownership)) throw new Error('Invalid desktop configuration ownership policy')
    config.configurationOwnership = policy.ownership
  }
  const bootstrap = JSON.parse(await capture(node, [join(scriptRoot, '../../scripts/check-publisher-bootstrap.mjs'), product, config.configurationOwnership])
    .catch(() => { throw new Error('Publisher bootstrap validation failed') }))
  if (bootstrap.enabled) config.updateChannel = 'disabled-candidate'
  if (identity.sourceAlpha && identity.automaticUpdates !== true) { config.sourceAlpha = true; config.appId += '.alpha' }
  await writeJSON(join(app, 'eduwork.desktop.json'), config)

  await rename(join(output, 'electron'), join(output, 'eduwork.bin'))
  await chmod(join(output, 'eduwork.bin'), 0o755)
  const launcher = `#!/bin/sh
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
restrict=0
if [ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then restrict=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns); fi
if [ "$restrict" = 1 ]; then exec "$here/eduwork.bin" --no-sandbox --password-store=gnome-libsecret "$@"; fi
exec "$here/eduwork.bin" --password-store=gnome-libsecret "$@"
`
  await writeText(join(output, 'eduwork'), launcher)
  await chmod(join(output, 'eduwork'), 0o755)
  let defaultConfig = join(product, 'resources/desktop/eduwork.jsonc')
  if (!await isFile(defaultConfig)) defaultConfig = ''
  await installDesktopConfig({ output, defaultConfig })
  await writeJSON(join(output, 'release.json'), {
    schemaVersion: 1, shell: 'electron', version, dshVersion: identity.dshVersion, dshCommit: identity.dshCommit,
    distribution: identity.distribution, productName: name, platform: 'linux-x64', electronLocales, nodeVersion,
    nodeSHA256: await sha256File(node), published: false, automaticUpdates: false, pluginPolicy: 'frozen-candidate',
    assembledAt: new Date().toISOString(), runtimeFiles,
  })
  await writeText(join(output, 'README.txt'), [
    `${name} — Linux x64 Electron candidate ${version}`, '',
    'Run ./eduwork from this directory. AppImage packages keep application files read-only and store user data under ~/.config/eduwork-electron.',
    'Software updates are disabled for this Linux prototype.',
  ].join('\n'))
  return output
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: {
    product: { type: 'string' }, 'shell-build': { type: 'string' }, 'electron-runtime': { type: 'string' },
    output: { type: 'string' }, version: { type: 'string' }, node: { type: 'string' },
  } })
  if (!values.product || !values['shell-build'] || !values['electron-runtime'] || !values.output || !values.version) {
    throw new Error('Use --product <dir> --shell-build <dir> --electron-runtime <dir> --output <dir> [--node <node>] --version <x.y.z>')
  }
  await assembleLinux({ product: values.product, shellBuild: values['shell-build'], electronRuntime: values['electron-runtime'], output: values.output, version: values.version, node: values.node ?? process.execPath })
}
