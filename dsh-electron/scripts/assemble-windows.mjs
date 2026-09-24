// Assembles the independent Windows Electron candidate from the frozen desktop
// product, the shell build and the verified Electron runtime. Node.js port of
// assemble-windows.ps1.
import { rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  capture, copyFileTo, copyTree, ensureDir, fullPath, isFile, isMainModule,
  pathExists, readJSON, run, runNode, sha256File, writeJSON, writeText,
} from '../../scripts/lib/build-util.mjs'
import { setDesktopIcon } from '../../scripts/set-desktop-icon.mjs'
import { installDesktopConfig } from '../../scripts/install-desktop-config.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

// robocopy /XF *.map *.pdb *.pyc default_app.asar /XD __pycache__ /XJ
const payloadFilters = {
  skipLinks: true,
  excludeFile: name => /\.(?:map|pdb|pyc)$/i.test(name) || name.toLowerCase() === 'default_app.asar',
  excludeDir: name => name === '__pycache__',
}

export async function assembleWindows({
  product,
  shellBuild,
  electronRuntime,
  output,
  version,
  node = process.execPath,
  updateManifestURL = '',
  updateDefaultPolicy = '',
} = {}) {
  if (!updateDefaultPolicy) updateDefaultPolicy = /-dev[.]/.test(version ?? '') ? 'development' : 'stable'
  if (!['stable', 'development'].includes(updateDefaultPolicy)) throw new Error('Update policy must be stable or development')
  if (!await isFile(join(electronRuntime, 'electron.exe'))) {
    throw new Error('ElectronRuntime must point to the extracted runtime containing electron.exe, not its cache parent')
  }
  output = fullPath(output)
  if (await pathExists(output)) throw new Error('Electron output must be a new directory')
  if (/(^|[\\/])current([\\/]|$)/i.test(output)) throw new Error('Electron cannot replace current')
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version ?? '')) throw new Error('An explicit product version is required')
  const identity = await readJSON(join(product, 'assembly.json'))
  await runNode(join(scriptRoot, '../../scripts/verify-product-release-identity.mjs'), [product, version])
    .catch(() => { throw new Error('Product release identity verification failed') })
  const receipt = await readJSON(join(shellBuild, 'source-receipt.json'))
  if (identity.dshCommit !== receipt.dshCommit) throw new Error('Electron and product DSH versions differ')
  const nodeVersion = (await capture(node, ['--version'])).trim()
  if (nodeVersion !== receipt.host.nodeVersion) throw new Error('Node and qualified Host runtime versions differ')
  const nodeLicense = join(dirname(node), 'LICENSE')
  if (!await isFile(nodeLicense)) throw new Error('Use the extracted official Node distribution, including its LICENSE beside node.exe')

  await copyTree(electronRuntime, output, payloadFilters)
  const app = join(output, 'resources/app')
  await ensureDir(app)
  await copyTree(join(shellBuild, 'lib'), join(app, 'lib'), payloadFilters)
  await copyTree(join(shellBuild, 'renderer'), join(app, 'renderer'), payloadFilters)
  await copyTree(join(shellBuild, 'third-party'), join(app, 'third-party'), payloadFilters)
  await copyFileTo(join(shellBuild, 'LICENSE-DeepSeek'), join(app, 'LICENSE-DeepSeek'))
  await copyTree(product, join(output, 'resources/product'), payloadFilters)
  await ensureDir(join(output, 'resources/runtime'))
  await copyFileTo(node, join(output, 'resources/runtime/node.exe'))
  await copyFileTo(nodeLicense, join(output, 'resources/runtime/LICENSE-Node'))
  await copyFileTo(join(shellBuild, 'source-receipt.json'), join(app, 'source-receipt.json'))
  const name = identity.brand.product.name
  await writeJSON(join(app, 'package.json'), {
    name: 'eduwork-desktop-electron',
    version: identity.dshVersion,
    private: true,
    type: 'module',
    main: 'lib/main.js',
    description: 'EduWork official DSH Electron integration',
    license: 'MIT',
  })
  const config = {
    schemaVersion: 1,
    shell: 'electron',
    appId: `org.eduwork.${identity.distribution}.electron`,
    distribution: identity.distribution,
    productName: name,
    productVersion: version,
    product: '../product',
    node: '../runtime/node.exe',
    updateChannel: 'disabled-candidate',
    configurationOwnership: 'user',
  }
  const policyPath = join(product, 'resources/desktop/configuration-policy.json')
  if (await pathExists(policyPath)) {
    const policy = await readJSON(policyPath)
    if (policy.schemaVersion !== 1 || !['user', 'publisher'].includes(policy.ownership)) throw new Error('Invalid desktop configuration ownership policy')
    config.configurationOwnership = policy.ownership
  }
  config.updates = { defaultPolicy: updateDefaultPolicy }
  if (identity.distribution === 'eduwork') {
    config.updates.provider = 'github'
    config.updates.repository = 'ecnu/EduWork'
    config.updateChannel = 'github'
  }
  if (updateManifestURL) {
    config.updates = { provider: 'static', manifestURL: updateManifestURL, defaultPolicy: updateDefaultPolicy }
    config.updateChannel = 'configured'
  }
  const bootstrap = JSON.parse(await capture(node, [join(scriptRoot, '../../scripts/check-publisher-bootstrap.mjs'), product, config.configurationOwnership])
    .catch(() => { throw new Error('Publisher bootstrap validation failed') }))
  if (bootstrap.enabled) config.updateChannel = bootstrap.softwareUpdates ? 'publisher-bootstrap' : 'disabled-candidate'
  await writeJSON(join(app, 'eduwork.desktop.json'), config)

  const updaterPath = join(output, 'resources/update/EduWork-Updater.exe')
  await ensureDir(dirname(updaterPath))
  await run('go', ['build', '-trimpath', '-ldflags', '-s -w -H windowsgui', '-o', updaterPath, './cmd/eduwork-updater'], { cwd: join(scriptRoot, '../../dsh-desktop') })
    .catch(() => { throw new Error('Portable update helper build failed') })
  await rename(join(output, 'electron.exe'), join(output, 'EduWork-Electron.exe'))
  await setDesktopIcon({ executable: join(output, 'EduWork-Electron.exe'), shell: 'electron' })
  let defaultConfig = join(product, 'resources/desktop/eduwork.jsonc')
  if (!await isFile(defaultConfig)) defaultConfig = ''
  await installDesktopConfig({ output, defaultConfig })
  await writeJSON(join(output, 'release.json'), {
    schemaVersion: 1,
    shell: 'electron',
    version,
    dshVersion: identity.dshVersion,
    dshCommit: identity.dshCommit,
    distribution: identity.distribution,
    productName: name,
    nodeVersion,
    nodeSHA256: await sha256File(node),
    published: false,
    automaticUpdates: config.updateChannel !== 'disabled-candidate',
    pluginPolicy: 'frozen-candidate',
    assembledAt: new Date().toISOString(),
  })
  await writeText(join(output, 'README.txt'), [
    `${name} — Electron candidate ${version}`,
    '',
    `Run EduWork-Electron.exe. Local data stays under data/${identity.distribution}-electron.`,
    'Close the application before moving the entire folder. When an update feed is',
    'configured, use Settings to check/download updates and choose when to restart.',
    'To merge history from another installation, select its program root under',
    'Settings > Import history. Existing credentials and settings remain unchanged.',
  ].join('\n'))
  console.log(`Independent Electron candidate assembled: ${output}`)
  return output
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      product: { type: 'string' },
      'shell-build': { type: 'string' },
      'electron-runtime': { type: 'string' },
      output: { type: 'string' },
      version: { type: 'string' },
      node: { type: 'string' },
      'update-manifest-url': { type: 'string' },
      'update-default-policy': { type: 'string' },
    },
  })
  if (!values.product || !values['shell-build'] || !values['electron-runtime'] || !values.output || !values.version) {
    throw new Error('Use --product <dir> --shell-build <dir> --electron-runtime <dir> --output <dir> --version <x.y.z> [--node <node.exe>] [--update-manifest-url <url>] [--update-default-policy stable|development]')
  }
  await assembleWindows({
    product: values.product,
    shellBuild: values['shell-build'],
    electronRuntime: values['electron-runtime'],
    output: values.output,
    version: values.version,
    node: values.node ?? process.execPath,
    updateManifestURL: values['update-manifest-url'] ?? '',
    updateDefaultPolicy: values['update-default-policy'] ?? '',
  })
}
