// End-to-end macOS arm64 Electron development-candidate pipeline: Web CI
// (build-only), Host, desktop product, native inputs, Electron.app assembly,
// packaged launch acceptance and the release receipt. Node.js port of
// ci-eduwork-macos-release.ps1. Requires a macOS arm64 runner.
import { createWriteStream } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  capture, copyFileTo, ensureDir, fullPath, isDirectory, isFile, isMacOS,
  isMainModule, pathExists, readJSON, run, runNode, sha256File, sleep,
  writeJSON,
} from './lib/build-util.mjs'
import { resolveEduworkUpstream } from './lib/upstream.mjs'
import { ciEduworkWeb } from './ci-eduwork-web.mjs'
import { prepareDesktopProduct } from './prepare-desktop-product.mjs'
import { prepareMacosReleaseInputs } from './prepare-macos-release-inputs.mjs'
import { prepareElectron } from '../dsh-electron/scripts/prepare-electron.mjs'
import { assembleMacos } from '../dsh-electron/scripts/assemble-macos.mjs'

function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

export async function ciEduworkMacosRelease({
  coreRoot,
  editionRoot,
  distributionConfig,
  version,
  releaseNotesFile = '',
  development = false,
  macUpdateConfig = '',
  releaseNotesApproved = false,
  verifyPublisherBootstrap = false,
  verifySnapshot = true,
  runtimeSource = '',
  output,
} = {}) {
  if (!isMacOS || process.arch !== 'arm64') throw new Error('Use a macOS arm64 runner')
  if (!/^\d+\.\d+\.\d+-dev\.\d{8}\.[1-9]\d*$/.test(version ?? '')) throw new Error('macOS currently supports development candidates only')
  if (!development && (!releaseNotesApproved || !/^docs\/releases\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(releaseNotesFile ?? ''))) {
    throw new Error('A reviewed release notes file and approval are required')
  }
  coreRoot = fullPath(coreRoot)
  editionRoot = fullPath(editionRoot)
  output = fullPath(output)
  if (await pathExists(output)) throw new Error('Release build requires a new workspace')
  const notes = development ? '' : join(editionRoot, releaseNotesFile)
  if (notes && !(await readFile(notes, 'utf8')).trim()) throw new Error('Release notes are empty')
  const name = coreRoot === editionRoot ? 'EduWork' : 'EduWork-ECNU'
  const publicEvidence = join(output, 'evidence-public')
  const publish = join(output, 'publish')
  await ensureDir(publicEvidence)
  await ensureDir(publish)
  const result = {
    schemaVersion: 1,
    kind: 'eduwork-macos-release',
    version,
    edition: name,
    platform: 'macos-arm64',
    shell: 'electron',
    validationProfile: 'ci-build-and-launch-v1',
    passed: false,
    checks: {},
    developerIDSigned: false,
    notarized: false,
    softwareAutoUpdate: false,
    sourceSnapshotVerified: verifySnapshot,
  }
  if (notes) result.releaseNotes = { approved: true, file: releaseNotesFile, sha256: await sha256File(notes) }
  try {
    result.coreCommit = (await capture('git', ['-C', coreRoot, 'rev-parse', 'HEAD'])).trim()
    result.editionCommit = (await capture('git', ['-C', editionRoot, 'rev-parse', 'HEAD'])).trim()
    await ciEduworkWeb({
      coreRoot,
      editionRoot,
      distributionConfig,
      version,
      output: join(output, 'web'),
      verifySnapshot,
      runtimeSource,
      buildOnly: true,
    })
    result.checks.sourceAndDependencies = 'passed'
    const web = join(output, 'web/assembly')
    const identity = await readJSON(join(web, 'assembly.json'))
    const upstream = await resolveEduworkUpstream(identity.dshCommit)
    const hostAdapter = join(output, 'host')
    const shellBuild = join(output, 'shell')
    const product = join(output, 'product')
    await runNode(join(coreRoot, 'dsh-host/prepare.mjs'), ['--upstream', upstream, '--output', hostAdapter])
    await prepareDesktopProduct({ webAssembly: web, hostAdapter, output: product, version })
    await runNode(join(coreRoot, 'dsh-host/install-product-host.mjs'), ['--product', product, '--adapter', hostAdapter])
    await prepareMacosReleaseInputs({ product, output: join(output, 'inputs') })
    const inputs = await readJSON(join(output, 'inputs/inputs.json'))
    await prepareElectron({ upstream, output: join(output, 'electron') })
    await runNode(join(coreRoot, 'dsh-electron/scripts/build-shell.mjs'), ['--upstream', upstream, '--host', hostAdapter, '--output', shellBuild])
    const macOptions = {}
    if (!macUpdateConfig) macUpdateConfig = join(product, 'resources/desktop/mac-updates.json')
    if (await pathExists(macUpdateConfig)) {
      const sparkleInput = join(output, 'sparkle')
      await runNode(join(coreRoot, 'scripts/macos-update-feed.mjs'), ['prepare', macUpdateConfig, sparkleInput])
      const sparkle = await readJSON(join(sparkleInput, 'inputs.json'))
      macOptions.sparkleFramework = sparkle.framework
      macOptions.sparkleFeedURL = sparkle.feeds.stable
      macOptions.sparkleDevelopmentFeedURL = sparkle.feeds.development
      macOptions.sparklePublicEDKey = sparkle.publicEDKey
    }
    await assembleMacos({
      product,
      shellBuild,
      electronRuntime: join(output, 'electron/runtime'),
      output: join(output, 'desktop'),
      version,
      node: inputs.node,
      openssl: inputs.openssl,
      ...macOptions,
    })
    const pack = await readJSON(join(output, 'desktop/release-receipt.json'))
    result.softwareAutoUpdate = pack.sparkleEnabled
    result.bundleVersion = pack.bundleVersion
    result.asset = pack.asset
    result.minimumSystemVersion = pack.minimumSystemVersion
    result.nativeLockSHA256 = inputs.nativeLockSHA256
    const archive = join(output, `desktop/${pack.asset.name}`)
    const unpacked = join(output, 'unpacked')
    await ensureDir(unpacked)
    await run('ditto', ['-x', '-k', archive, unpacked])
    const app = join(unpacked, `${name}.app`)
    await run('codesign', ['--verify', '--deep', '--strict', app])
    result.checks.archiveManifest = 'passed'
    const frozen = join(app, 'Contents/Resources/product')
    await run(join(app, 'Contents/Resources/runtime/node'), [join(coreRoot, 'scripts/check-desktop-runtimes.mjs'), app, join(publicEvidence, 'native-runtimes.json')])
    result.checks.nativeRuntimes = 'passed'
    const gui = join(output, 'gui')
    await ensureDir(gui)
    const config = join(gui, 'eduwork.jsonc')
    // The public edition must create its own config from the actual ZIP.
    // An existing synthetic config would hide a broken first-launch template.
    if (name !== 'EduWork') {
      await writeJSON(config, {
        schemaVersion: 1,
        desktop: { closeAction: 'exit' },
        organizations: [{
          schemaVersion: 'dsh-oidc/v1alpha1',
          id: 'ci-example',
          displayName: 'CI example',
          auth: {
            discoveryUrl: 'https://identity.example.test/.well-known/openid-configuration',
            expectedIssuer: 'https://identity.example.test',
            experimentalOidcLlm: true,
            clientId: 'synthetic-ci-client',
            identityMode: 'oidc',
          },
        }],
      })
    }
    const port = await freeLoopbackPort()
    const bootstrapEnabled = await pathExists(join(frozen, 'resources/desktop/publisher-bootstrap.json'))
    if (verifyPublisherBootstrap && !bootstrapEnabled) throw new Error('Publisher acceptance requires a bootstrap-enabled edition')
    // Optional maintainer acceptance uses the packaged public feed and a fresh
    // profile, without school credentials or changing any archive bytes. Keep
    // downloaded configuration out of public evidence and the release payload.
    const environment = { ...process.env, EDUWORK_DESKTOP_TEST_DATA_ROOT: join(gui, 'data') }
    if (verifyPublisherBootstrap) delete environment.EDUWORK_CONFIG_FILE
    else environment.EDUWORK_CONFIG_FILE = config
    // Write directly to files: a descendant retaining a pipe must not prevent
    // the test harness from reporting the original startup failure.
    console.log('Starting isolated macOS desktop acceptance')
    const stdoutLog = createWriteStream(join(gui, 'stdout.log'))
    const stderrLog = createWriteStream(join(gui, 'stderr.log'))
    const appProcess = spawn(join(app, 'Contents/MacOS/Electron'), [
      `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--use-mock-keychain',
    ], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    appProcess.stdout.pipe(stdoutLog)
    appProcess.stderr.pipe(stderrLog)
    let exited = false
    const exitPromise = new Promise(done => appProcess.once('exit', () => { exited = true; done() }))
    let launchFailure = null
    try {
      try {
        const deadline = Date.now() + 3 * 60000
        let ready = false
        while (Date.now() < deadline) {
          if (exited) throw new Error('macOS desktop exited before ready')
          try {
            const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })
            if (response.ok) {
              const targets = await response.json()
              if (targets.some(target => String(target.url ?? '').startsWith('dsh-app://app/'))) {
                ready = true
                break
              }
            }
          } catch {
            // Not listening yet.
          }
          await sleep(500)
        }
        if (!ready) throw new Error('macOS desktop failed to start within acceptance limit')
        await runNode(join(coreRoot, 'dsh-electron/tests/desktop-smoke.mjs'), [
          '--shell', 'electron', '--product', frozen, '--cdp', `http://127.0.0.1:${port}`,
          '--data-root', join(gui, 'data'), '--evidence', gui, '--launch-only',
        ])
      } catch (error) {
        launchFailure = error
        if (!verifyPublisherBootstrap) {
          await runNode(join(coreRoot, 'scripts/inspect-release-test-desktop.mjs'), [frozen, `http://127.0.0.1:${port}`])
            .catch(() => console.warn('Startup diagnostic connection was unavailable.'))
          const stderrText = await readFile(join(gui, 'stderr.log'), 'utf8').catch(() => '')
          console.error(stderrText.split('\n').slice(-40).join('\n'))
        }
        throw launchFailure
      } finally {
        if (!exited) {
          try {
            await runNode(join(coreRoot, 'scripts/close-release-test-desktop.mjs'), [frozen, `http://127.0.0.1:${port}`])
            const stopped = await Promise.race([exitPromise.then(() => true), sleep(15000).then(() => false)])
            if (!stopped) throw new Error('macOS test desktop did not stop')
          } catch (error) {
            if (!exited) {
              appProcess.kill('SIGKILL')
              await Promise.race([exitPromise, sleep(5000)])
            }
            if (!launchFailure) throw error
            console.warn('Test desktop cleanup also failed; preserving the original launch error.')
          }
        }
      }
    } finally {
      stdoutLog.end()
      stderrLog.end()
    }
    if (!(await readJSON(join(gui, 'result.json'))).passed) throw new Error('macOS desktop smoke failed')
    await copyFileTo(join(gui, 'result.json'), join(publicEvidence, 'desktop-ui-result.json'))
    result.checks.desktopLaunch = 'passed'
    if (name === 'EduWork') {
      if (!await isFile(config) || !await isFile(join(gui, 'examples/organization.jsonc'))) {
        throw new Error('First launch did not create the user configuration and examples')
      }
      result.checks.userConfigurationFirstLaunch = 'passed'
    }
    if (verifyPublisherBootstrap) {
      const started = await readJSON(join(gui, 'data/logs/desktop-start.json'))
      if (started.configurationRevision < 1 || started.skillsRevision < 1) throw new Error('First launch did not activate signed publisher content')
      result.checks.publisherFirstLaunch = 'passed'
      result.content = { configurationRevision: started.configurationRevision, skillsRevision: started.skillsRevision }
    }
    await run('codesign', ['--verify', '--deep', '--strict', app])
    result.checks.readOnlyApplication = 'passed'
    await copyFileTo(archive, join(publish, basename(archive)))
    await copyFileTo(`${archive}.sha256`, join(publish, `${basename(archive)}.sha256`))
    if (notes) await copyFileTo(notes, join(publish, 'RELEASE-NOTES.md'))
    result.passed = true
    await writeJSON(join(publish, 'release-receipt.json'), result)
  } catch (error) {
    result.error = error.message
    throw error
  } finally {
    await writeJSON(join(publicEvidence, 'desktop-release-result.json'), result)
    const webEvidence = join(output, 'web/evidence/public')
    if (await isDirectory(webEvidence)) {
      for (const entry of await readdir(webEvidence, { withFileTypes: true })) {
        if (entry.isFile()) await copyFileTo(join(webEvidence, entry.name), join(publicEvidence, entry.name))
      }
    }
  }
  return result
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'core-root': { type: 'string' },
      'edition-root': { type: 'string' },
      'distribution-config': { type: 'string' },
      version: { type: 'string' },
      'release-notes-file': { type: 'string' },
      development: { type: 'boolean' },
      'mac-update-config': { type: 'string' },
      'release-notes-approved': { type: 'boolean' },
      'verify-publisher-bootstrap': { type: 'boolean' },
      'no-verify-snapshot': { type: 'boolean' },
      'runtime-source': { type: 'string' },
      output: { type: 'string' },
    },
  })
  if (!values['core-root'] || !values['edition-root'] || !values['distribution-config'] || !values.version || !values.output) {
    throw new Error('Use --core-root --edition-root --distribution-config --version --output [--development] [--mac-update-config <json>] [--release-notes-file <docs/releases/*.md>] [--release-notes-approved] [--verify-publisher-bootstrap] [--no-verify-snapshot] [--runtime-source <dir>]')
  }
  await ciEduworkMacosRelease({
    coreRoot: values['core-root'],
    editionRoot: values['edition-root'],
    distributionConfig: values['distribution-config'],
    version: values.version,
    releaseNotesFile: values['release-notes-file'] ?? '',
    development: Boolean(values.development),
    macUpdateConfig: values['mac-update-config'] ?? '',
    releaseNotesApproved: Boolean(values['release-notes-approved']),
    verifyPublisherBootstrap: Boolean(values['verify-publisher-bootstrap']),
    verifySnapshot: !values['no-verify-snapshot'],
    runtimeSource: values['runtime-source'] ?? '',
    output: values.output,
  })
}
