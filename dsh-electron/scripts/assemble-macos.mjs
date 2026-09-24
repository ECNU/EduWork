// Assembles the unsigned macOS arm64 Electron candidate: Electron.app payload,
// frozen product, native relocations, optional Sparkle updater, ad-hoc signed
// ZIP. Node.js port of assemble-macos.ps1. Requires macOS arm64.
import { chmod, mkdir, mkdtemp, rename, rm, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  capture, copyFileTo, ensureDir, fullPath, isFile, isMacOS, isMainModule,
  pathExists, readJSON, run, sha256File, statEntry, writeJSON, writeText,
} from '../../scripts/lib/build-util.mjs'
import { relocateMacosCompositor } from './relocate-macos-compositor.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

const ditto = (source, destination) => run('ditto', ['--noextattr', '--noqtn', '--noacl', source, destination])
const rsync = (source, destination) => run('rsync', ['-a', `${source}/`, `${destination}/`])
const plutilReplace = async (plist, key, value, type = '-string') => {
  await run('plutil', ['-replace', key, type, value, plist])
    .catch(() => { throw new Error(`Info.plist update failed: ${key}`) })
}

function assertFixedHttps(url, message) {
  let parsed
  try { parsed = new URL(url) } catch { throw new Error(message) }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || parsed.search) throw new Error(message)
}

export async function assembleMacos({
  product,
  shellBuild,
  electronRuntime,
  output,
  version,
  node,
  openssl,
  externalPublisherConfig = '',
  updateDefaultPolicy = '',
  bundleVersion = '',
  sparkleFramework = '',
  sparkleFeedURL = '',
  sparkleDevelopmentFeedURL = '',
  sparklePublicEDKey = '',
} = {}) {
  if (!isMacOS) throw new Error('The macOS Electron candidate must be assembled on macOS')
  if (process.arch !== 'arm64') throw new Error('This first macOS packaging flow supports arm64 only')
  product = fullPath(product)
  shellBuild = fullPath(shellBuild)
  electronRuntime = fullPath(electronRuntime)
  output = fullPath(output)
  node = fullPath(node)
  openssl = fullPath(openssl)
  if (await pathExists(output)) throw new Error('macOS output must be a new directory')
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version ?? '')) throw new Error('An explicit product version is required')
  if (!updateDefaultPolicy) updateDefaultPolicy = /-dev\./.test(version) ? 'development' : 'stable'
  if (!['stable', 'development'].includes(updateDefaultPolicy)) throw new Error('Update policy must be stable or development')
  if (externalPublisherConfig && !isAbsolute(externalPublisherConfig)) throw new Error('External publisher configuration path must be absolute')
  const sparkleEnabled = Boolean(sparkleFramework || sparkleFeedURL || sparklePublicEDKey)
  if (sparkleEnabled) {
    if (!(sparkleFramework && sparkleFeedURL && sparklePublicEDKey)) throw new Error('Sparkle requires framework, HTTPS appcast URL and EdDSA public key together')
    if (!isAbsolute(sparkleFramework)) throw new Error('Sparkle framework path must be absolute')
    sparkleFramework = fullPath(sparkleFramework)
    if (!await isFile(join(sparkleFramework, 'Headers/Sparkle.h'))) throw new Error('Sparkle framework headers are missing')
    assertFixedHttps(sparkleFeedURL, 'Sparkle appcast must be a fixed HTTPS URL without credentials, query or fragment')
    // Buffer.from(base64) is lenient, so require canonical base64 explicitly.
    const keyBytes = Buffer.from(sparklePublicEDKey, 'base64')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sparklePublicEDKey) || keyBytes.toString('base64') !== sparklePublicEDKey) {
      throw new Error('Sparkle EdDSA public key must be base64')
    }
    if (keyBytes.length !== 32) throw new Error('Sparkle EdDSA public key must decode to 32 bytes')
  }
  const expectedBundleVersion = (await capture(process.execPath, [join(scriptRoot, '../../scripts/macos-update-feed.mjs'), 'version', version])
    .catch(() => { throw new Error('Unsupported macOS update version') })).trim()
  if (bundleVersion && bundleVersion !== expectedBundleVersion) throw new Error('BundleVersion must match the shared release version encoding')
  if (sparkleDevelopmentFeedURL) {
    if (!sparkleEnabled) throw new Error('Development appcast requires a fixed HTTPS URL and the Sparkle trust key')
    assertFixedHttps(sparkleDevelopmentFeedURL, 'Development appcast requires a fixed HTTPS URL and the Sparkle trust key')
  }
  const identity = await readJSON(join(product, 'assembly.json'))
  await run(node, [join(scriptRoot, '../../scripts/verify-product-release-identity.mjs'), product, version])
    .catch(() => { throw new Error('Product release identity verification failed') })
  const receipt = await readJSON(join(shellBuild, 'source-receipt.json'))
  if (identity.dshCommit !== receipt.dshCommit || identity.dshVersion !== receipt.dshVersion) throw new Error('Electron and product DSH versions differ')
  if ((await capture(node, ['--version'])).trim() !== receipt.host.nodeVersion) throw new Error('Node and qualified Host runtime versions differ')
  const electronApp = join(electronRuntime, 'Electron.app')
  if (!await isFile(join(electronApp, 'Contents/MacOS/Electron'))) throw new Error('ElectronRuntime must contain Electron.app')
  const electronVersion = (await capture('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', join(electronApp, 'Contents/Info.plist')])
    .catch(() => { throw new Error('Electron.app version is invalid') })).trim()
  if (!/^\d+\.\d+\.\d+$/.test(electronVersion)) throw new Error('Electron.app version is invalid')
  const nodeRoot = dirname(dirname(node))
  const nodeLicense = join(nodeRoot, 'LICENSE')
  if (!await isFile(nodeLicense)) throw new Error('Use the extracted official Node distribution, including LICENSE')

  const editionName = identity.distribution === 'eduwork' ? 'EduWork' : 'EduWork-ECNU'
  const appName = `${editionName}.app`
  const app = join(output, appName)
  await mkdir(output)
  await ditto(electronApp, app).catch(() => { throw new Error('Electron.app copy failed') })
  const resources = join(app, 'Contents/Resources')
  const appPayload = join(resources, 'app')
  await mkdir(appPayload)
  for (const folder of ['lib', 'renderer', 'third-party']) {
    await mkdir(join(appPayload, folder))
    await rsync(join(shellBuild, folder), join(appPayload, folder))
      .catch(() => { throw new Error(`Shell payload copy failed: ${folder}`) })
  }
  await copyFileTo(join(shellBuild, 'LICENSE-DeepSeek'), join(appPayload, 'LICENSE-DeepSeek'))
  await copyFileTo(join(shellBuild, 'source-receipt.json'), join(appPayload, 'source-receipt.json'))
  const brand = join(resources, 'brand')
  await mkdir(brand)
  for (const asset of ['icon-32.png', 'icon-256.png', 'icon.icns']) {
    await copyFileTo(join(scriptRoot, `../../assets/eduwork/${asset}`), join(brand, asset))
  }
  await mkdir(join(resources, 'product'))
  await rsync(product, join(resources, 'product')).catch(() => { throw new Error('Product copy failed') })
  await relocateMacosCompositor({
    packageRoot: join(resources, 'product/d/node_modules/@remotion/compositor-darwin-arm64'),
    receipt: join(resources, 'compositor-relocation.json'),
  })
  const ladybugPackage = join(resources, 'product/d/node_modules/@ladybugdb/core-darwin-arm64')
  const ladybugNative = join(ladybugPackage, 'lbugjs.node')
  const sslSource = join(openssl, 'lib/libssl.3.dylib')
  const cryptoSource = join(openssl, 'lib/libcrypto.3.dylib')
  for (const required of [ladybugNative, sslSource, cryptoSource]) {
    if (!await isFile(required)) throw new Error(`Missing LadybugDB macOS dependency: ${required}`)
  }
  const sslTarget = join(ladybugPackage, 'libssl.3.dylib')
  const cryptoTarget = join(ladybugPackage, 'libcrypto.3.dylib')
  await copyFileTo(sslSource, sslTarget)
  await copyFileTo(cryptoSource, cryptoTarget)
  const patchedNative = `${ladybugNative}.patched`
  await run('vtool', ['-set-build-version', 'macos', '15.0', '15.5', '-replace', '-output', patchedNative, ladybugNative])
    .catch(() => { throw new Error('LadybugDB minimum macOS version patch failed') })
  await rename(patchedNative, ladybugNative)
  await run('install_name_tool', ['-change', '@rpath/libssl.3.dylib', '@loader_path/libssl.3.dylib', ladybugNative])
    .catch(() => { throw new Error('LadybugDB libssl install-name patch failed') })
  await run('install_name_tool', ['-change', '@rpath/libcrypto.3.dylib', '@loader_path/libcrypto.3.dylib', ladybugNative])
    .catch(() => { throw new Error('LadybugDB libcrypto install-name patch failed') })
  const cryptoInstallName = (await capture('otool', ['-D', cryptoTarget])).split('\n').at(-1).trim()
  await run('install_name_tool', ['-id', '@loader_path/libcrypto.3.dylib', cryptoTarget])
    .catch(() => { throw new Error('Bundled libcrypto install-name patch failed') })
  await run('install_name_tool', ['-id', '@loader_path/libssl.3.dylib', '-change', cryptoInstallName, '@loader_path/libcrypto.3.dylib', sslTarget])
    .catch(() => { throw new Error('Bundled libssl install-name patch failed') })
  for (const nativeFile of [cryptoTarget, sslTarget, ladybugNative]) {
    await run('codesign', ['--force', '--sign', '-', '--timestamp=none', nativeFile])
      .catch(() => { throw new Error(`Native dependency ad-hoc signing failed: ${nativeFile}`) })
  }
  const ladybugSmoke = "const {Database,Connection}=require(process.argv[1]);const db=new Database(':memory:');db.initSync();const connection=new Connection(db);const result=connection.querySync('RETURN 1 AS n');if(result.getAllSync()[0].n!==1)throw new Error('LadybugDB query mismatch');connection.closeSync();db.closeSync();console.log('LADYBUG_QUERY_OK')"
  await run(node, ['-e', ladybugSmoke, ladybugPackage])
    .catch(() => { throw new Error('Bundled LadybugDB native smoke test failed') })
  await mkdir(join(resources, 'runtime'))
  await copyFileTo(node, join(resources, 'runtime/node'))
  await copyFileTo(nodeLicense, join(resources, 'runtime/LICENSE-Node'))
  await chmod(join(resources, 'runtime/node'), 0o755)

  let ownership = 'user'
  const policyPath = join(product, 'resources/desktop/configuration-policy.json')
  if (await pathExists(policyPath)) {
    const policy = await readJSON(policyPath)
    if (policy.schemaVersion !== 1 || !['user', 'publisher'].includes(policy.ownership)) throw new Error('Invalid desktop configuration ownership policy')
    ownership = policy.ownership
  }
  if (ownership === 'user') {
    for (const relative of ['eduwork.jsonc', 'examples/organization.jsonc', 'examples/updates.jsonc']) {
      if (!await isFile(join(resources, `product/resources/desktop/${relative}`))) {
        throw new Error(`Missing first-launch user configuration resource: ${relative}`)
      }
    }
  }
  const desktop = {
    schemaVersion: 1,
    shell: 'electron',
    appId: `org.eduwork.${identity.distribution}.electron`,
    distribution: identity.distribution,
    productName: identity.brand.product.name,
    productVersion: version,
    product: '../product',
    node: '../runtime/node',
    configurationOwnership: ownership,
    updateChannel: 'disabled-candidate',
    updates: { defaultPolicy: updateDefaultPolicy },
  }
  if (sparkleEnabled) {
    desktop.macSparkle = { enabled: true, feeds: { stable: sparkleFeedURL } }
    if (sparkleDevelopmentFeedURL) desktop.macSparkle.feeds.development = sparkleDevelopmentFeedURL
    if (updateDefaultPolicy === 'development' && !sparkleDevelopmentFeedURL) throw new Error('Development builds require a development appcast')
  }
  const bootstrap = JSON.parse(await capture(node, [join(scriptRoot, '../../scripts/check-publisher-bootstrap.mjs'), product, ownership])
    .catch(() => { throw new Error('Publisher bootstrap validation failed') }))
  if (externalPublisherConfig) {
    if (ownership !== 'publisher') throw new Error('External publisher configuration requires publisher ownership')
    const bundledPublisherConfig = join(resources, 'product/resources/desktop/eduwork.jsonc')
    if (await pathExists(bundledPublisherConfig)) await unlink(bundledPublisherConfig)
    desktop.publisherConfig = externalPublisherConfig
  }
  await writeJSON(join(appPayload, 'eduwork.desktop.json'), desktop)
  await writeJSON(join(appPayload, 'package.json'), {
    name: 'eduwork-desktop-electron',
    version: identity.dshVersion,
    private: true,
    type: 'module',
    main: 'lib/main.js',
    description: 'EduWork official DSH Electron integration',
    license: 'MIT',
  })

  const plist = join(app, 'Contents/Info.plist')
  const marketingVersion = version.split('-')[0]
  const effectiveBundleVersion = expectedBundleVersion
  for (const [key, value] of [
    ['CFBundleExecutable', 'Electron'],
    ['CFBundleName', editionName],
    ['CFBundleDisplayName', identity.brand.product.name],
    ['CFBundleIdentifier', desktop.appId],
    ['CFBundleShortVersionString', marketingVersion],
    ['CFBundleVersion', effectiveBundleVersion],
    ['CFBundleIconFile', 'brand/icon.icns'],
    ['LSMinimumSystemVersion', '15.0'],
  ]) {
    await plutilReplace(plist, key, value)
  }
  if (sparkleEnabled) {
    await copyFileTo(join(scriptRoot, '../LICENSE-Sparkle'), join(resources, 'LICENSE-Sparkle'))
    const frameworkTarget = join(app, 'Contents/Frameworks/Sparkle.framework')
    await ditto(sparkleFramework, frameworkTarget).catch(() => { throw new Error('Sparkle framework copy failed') })
    const headers = join(nodeRoot, 'include/node')
    if (!await isFile(join(headers, 'node_api.h'))) throw new Error('Official Node distribution must include N-API headers')
    const native = join(appPayload, 'native')
    await mkdir(native)
    await run('clang++', [
      '-std=c++17', '-fobjc-arc', '-dynamiclib', '-undefined', 'dynamic_lookup',
      '-I', headers, '-F', join(app, 'Contents/Frameworks'),
      '-framework', 'Sparkle', '-framework', 'AppKit',
      '-Wl,-rpath,@loader_path/../../../Frameworks',
      join(scriptRoot, '../native/sparkle-addon.mm'),
      '-o', join(native, 'sparkle.node'),
    ]).catch(() => { throw new Error('Sparkle native bridge compilation failed') })
    await plutilReplace(plist, 'SUFeedURL', updateDefaultPolicy === 'development' ? sparkleDevelopmentFeedURL : sparkleFeedURL)
    await plutilReplace(plist, 'SUPublicEDKey', sparklePublicEDKey)
    await run('plutil', ['-replace', 'SUEnableAutomaticChecks', '-bool', 'NO', plist])
      .catch(() => { throw new Error('Sparkle Info.plist setup failed') })
  }
  // Finder and FileProvider can attach resource forks and extended attributes to
  // an app copied through Desktop/Finder. They invalidate the code signature and
  // make Sparkle reject the replacement during relaunch, so keep the archive
  // deterministic and explicitly remove those attributes before signing.
  await run('xattr', ['-cr', app]).catch(() => { throw new Error('macOS app metadata cleanup failed') })
  const release = {
    schemaVersion: 1,
    shell: 'electron',
    version,
    dshVersion: identity.dshVersion,
    dshCommit: identity.dshCommit,
    distribution: identity.distribution,
    productName: identity.brand.product.name,
    platform: 'darwin-arm64',
    electronVersion,
    nodeVersion: receipt.host.nodeVersion,
    minimumSystemVersion: '15.0',
    ladybugNativePatched: true,
    bundledOpenSSL: '3.5.8',
    configurationMode: bootstrap.enabled ? 'downloaded-publisher'
      : externalPublisherConfig ? 'external-publisher'
      : ownership === 'publisher' ? 'bundled-publisher' : 'user',
    developerIDSigned: false,
    adHocSigned: true,
    notarized: false,
    sparkleEnabled,
    bundleVersion: effectiveBundleVersion,
    published: false,
    assembledAt: new Date().toISOString(),
  }
  await writeJSON(join(resources, 'release.json'), release)
  // Seal the immutable Skill baseline into the app before signing. Mutable content
  // updates live in Application Support and never rewrite the signed bundle.
  await run(node, [join(scriptRoot, '../../scripts/write-bundled-skills-manifest.mjs'), '--root', app, '--product', join(resources, 'product'), '--output', join(resources, 'bundled-skills.json')])
    .catch(() => { throw new Error('Bundled Skills integrity manifest failed') })
  const archiveQualifier = externalPublisherConfig ? '-external-config' : ''
  const archive = join(output, `${editionName}-${version}-macos-arm64-electron${archiveQualifier}.zip`)
  const signingRoot = await mkdtemp(join(tmpdir(), 'eduwork-macos-'))
  const signingApp = join(signingRoot, appName)
  const temporaryArchive = join(signingRoot, basename(archive))
  await mkdir(signingApp, { recursive: true })
  try {
    await rsync(app, signingApp).catch(() => { throw new Error('Signing-stage copy failed') })
    await run('xattr', ['-cr', signingApp]).catch(() => { throw new Error('Signing-stage metadata cleanup failed') })
    await run('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', signingApp])
      .catch(() => { throw new Error('Local ad-hoc signing failed') })
    await run('codesign', ['--verify', '--deep', '--strict', signingApp])
      .catch(() => { throw new Error('Local ad-hoc signature verification failed') })
    await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appName, temporaryArchive], { cwd: signingRoot })
      .catch(() => { throw new Error('macOS ZIP creation failed') })
    await copyFileTo(temporaryArchive, archive)
  } finally {
    await rm(signingRoot, { recursive: true, force: true }).catch(() => {})
  }
  const sha = await sha256File(archive)
  await writeText(`${archive}.sha256`, `${sha}  ${basename(archive)}`)
  release.asset = { name: basename(archive), bytes: (await statEntry(archive)).size, sha256: sha }
  await writeJSON(join(output, 'release-receipt.json'), release)
  console.log(`Unsigned macOS arm64 candidate ready: ${app}`)
  console.log(`ZIP: ${archive}`)
  return { app, archive, release }
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
      openssl: { type: 'string' },
      'external-publisher-config': { type: 'string' },
      'update-default-policy': { type: 'string' },
      'bundle-version': { type: 'string' },
      'sparkle-framework': { type: 'string' },
      'sparkle-feed-url': { type: 'string' },
      'sparkle-development-feed-url': { type: 'string' },
      'sparkle-public-ed-key': { type: 'string' },
    },
  })
  for (const name of ['product', 'shell-build', 'electron-runtime', 'output', 'version', 'node', 'openssl']) {
    if (!values[name]) throw new Error('Use --product --shell-build --electron-runtime --output --version --node --openssl [Sparkle/publisher options]')
  }
  await assembleMacos({
    product: values.product,
    shellBuild: values['shell-build'],
    electronRuntime: values['electron-runtime'],
    output: values.output,
    version: values.version,
    node: values.node,
    openssl: values.openssl,
    externalPublisherConfig: values['external-publisher-config'] ?? '',
    updateDefaultPolicy: values['update-default-policy'] ?? '',
    bundleVersion: values['bundle-version'] ?? '',
    sparkleFramework: values['sparkle-framework'] ?? '',
    sparkleFeedURL: values['sparkle-feed-url'] ?? '',
    sparkleDevelopmentFeedURL: values['sparkle-development-feed-url'] ?? '',
    sparklePublicEDKey: values['sparkle-public-ed-key'] ?? '',
  })
}
