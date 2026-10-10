// Assembles the independent Wails candidate from the frozen desktop product
// and the prepared official Host adapter. Node.js port of
// assemble-official-host.ps1.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  capture, copyFileTo, copyTree, ensureDir, fullPath, isFile, isInside,
  isMainModule, pathExists, readJSON, runNode, sha256File, writeJSON,
} from '../../scripts/lib/build-util.mjs'
import { installDesktopConfig } from '../../scripts/install-desktop-config.mjs'
import { buildOfficialHost } from './build-official-host.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

// robocopy /E /XJ /XF *.map *.pdb *.pyc default_app.asar /XD __pycache__
const payloadFilters = {
  skipLinks: true,
  excludeFile: name => /\.(?:map|pdb|pyc)$/i.test(name) || name.toLowerCase() === 'default_app.asar',
  excludeDir: name => name === '__pycache__',
}

export async function assembleOfficialHost({ product, hostAdapter, output, version = '', node = process.execPath } = {}) {
  const core = fullPath(join(scriptRoot, '../..'))
  product = fullPath(product)
  hostAdapter = fullPath(hostAdapter)
  output = fullPath(output)
  node = fullPath(node)
  if (/(^|[\\/])current([\\/]|$)/i.test(output)) throw new Error('Wails candidates cannot replace current')
  if (isInside(product, output) || isInside(output, product)) throw new Error('Product and output directories must be separate')
  if (await pathExists(output)) throw new Error('Use a new Wails candidate directory; existing candidates and data are never replaced')
  const identity = await readJSON(join(product, 'assembly.json'))
  const hostReceipt = await readJSON(join(hostAdapter, 'receipt.json'))
  if (identity.dshCommit !== hostReceipt.upstreamCommit || identity.dshVersion !== '0.1.5-rc.2' || identity.dshVersion !== hostReceipt.upstreamVersion) {
    throw new Error('Candidate product and Host do not match the qualified baseline')
  }
  if (!/^[a-z0-9-]+$/.test(identity.distribution ?? '')) throw new Error('Invalid distribution identity')
  if (!version) version = identity.version
  await runNode(join(core, 'scripts/verify-product-release-identity.mjs'), [product, version])
    .catch(() => { throw new Error('Product release identity verification failed') })
  const nodeVersion = (await capture(node, ['--version'])).trim()
  if (nodeVersion !== 'v24.18.0' || hostReceipt.nodeVersion !== nodeVersion) throw new Error('Candidate Node must match the prepared Host Node 24.18.0')
  const nodeLicense = join(dirname(node), 'LICENSE')
  if (!await isFile(nodeLicense)) throw new Error('Node LICENSE must accompany the supplied Node runtime')

  await ensureDir(output)
  const resources = join(output, 'resources')
  await copyTree(product, join(resources, 'product'), payloadFilters)
  const hostOutput = join(resources, 'host')
  await ensureDir(hostOutput)
  for (const file of ['host-process.mjs', 'host-protocol.mjs', 'receipt.json', 'LICENSE-DeepSeek']) {
    await copyFileTo(join(hostAdapter, file), join(hostOutput, file))
  }
  for (const file of [
    'bridge.mjs', 'wire.mjs', 'product-profile.mjs', 'configuration-plugin-options.mjs',
    'product-presets.mjs', 'product-profile-cli.mjs', 'native-resources.mjs', 'user-config.mjs',
    'enterprise-model-updates.mjs', 'desktop-updates.mjs', 'release-policy.mjs',
    'workbench-support.mjs', 'diagnostics.mjs', 'wails-migration.mjs',
  ]) {
    await copyFileTo(join(core, `dsh-host/${file}`), join(hostOutput, file))
  }
  await copyFileTo(join(core, 'dsh-plugins/media-openai/lib/config.js'), join(hostOutput, 'media-config.mjs'))
  await copyFileTo(join(core, 'dsh-electron/src/legacy-migration.mjs'), join(hostOutput, 'legacy-migration.mjs'))
  await copyTree(join(core, 'dsh-host/vendor'), join(hostOutput, 'vendor'), payloadFilters)
  let defaultConfig = join(product, 'resources/desktop/eduwork.jsonc')
  if (!await isFile(defaultConfig)) defaultConfig = ''
  await installDesktopConfig({ output, defaultConfig })
  const runtime = join(resources, 'runtime')
  await ensureDir(runtime)
  await copyFileTo(node, join(runtime, 'node.exe'))
  await copyFileTo(nodeLicense, join(runtime, 'LICENSE-Node'))
  await copyFileTo(join(core, 'LICENSE'), join(output, 'LICENSE-EduWork'))
  await buildOfficialHost({ outputExe: join(output, 'EduWork.exe'), node })
  await writeJSON(join(output, 'eduwork.desktop.json'), {
    schemaVersion: 1,
    shell: 'wails',
    version,
    productVersion: identity.version,
    appId: `org.eduwork.${identity.distribution}.wails.candidate`,
    distribution: identity.distribution,
    productName: identity.brand.product.name,
    product: 'resources/product',
    node: 'resources/runtime/node.exe',
    host: 'resources/host',
  })
  await writeJSON(join(output, 'candidate-receipt.json'), {
    schemaVersion: 1,
    shell: 'wails',
    version,
    shellVersion: version,
    productVersion: identity.version,
    dshVersion: identity.dshVersion,
    transport: 'official-desktop-host-v3-via-node-stdio',
    nodeSha256: await sha256File(node),
    executableSha256: await sha256File(join(output, 'EduWork.exe')),
    host: hostReceipt,
  })
  console.log(`Independent Wails candidate prepared: ${output}`)
  return output
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      product: { type: 'string' },
      'host-adapter': { type: 'string' },
      output: { type: 'string' },
      version: { type: 'string' },
      node: { type: 'string' },
    },
  })
  if (!values.product || !values['host-adapter'] || !values.output) {
    throw new Error('Use --product <dir> --host-adapter <dir> --output <dir> [--version <x.y.z>] [--node <node.exe>]')
  }
  await assembleOfficialHost({
    product: values.product,
    hostAdapter: values['host-adapter'],
    output: values.output,
    version: values.version ?? '',
    node: values.node ?? process.execPath,
  })
}
