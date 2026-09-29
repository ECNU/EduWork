// macOS arm64 stages: the locked native inputs, Electron.app assembly, packaged
// launch acceptance and the publish directory. The shared spine lives in
// shared-desktop-stages.mjs; this file only adds what is macOS-specific, so the
// release orchestrator itself has no platform branch.
import { createWriteStream } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { basename, join } from 'node:path'
import {
  copyFileTo, ensureDir, isFile, pathExists, readJSON, run, runNode, sha256File,
  sleep, writeJSON,
} from './build-util.mjs'
import { stage } from './stage-runner.mjs'
import { assembleMacos } from '../../dsh-electron/scripts/assemble-macos.mjs'
import { prepareMacosReleaseInputs, installMacosReleaseInputs } from '../prepare-macos-release-inputs.mjs'

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

export function macosStages({
  coreRoot, name, version, development, releaseNotesFile, verifyPublisherBootstrap, receiptBase,
}) {
  return [
    // Native inputs depend only on the lock file, never on the product, so a
    // product change does not rebuild OpenSSL or whisper.cpp.
    stage({
      name: 'native-inputs',
      description: 'macOS arm64 native inputs',
      outputs: ['inputs'],
      inputs: async (workspace) => ({
        lock: await sha256File(join(coreRoot, 'config/macos-native.lock.json')),
        node: version,
      }),
      run: async (workspace) => {
        await prepareMacosReleaseInputs({ output: workspace.resolvePath('inputs') })
      },
    }),
    stage({
      name: 'native-install',
      description: 'Install native inputs into the product',
      requires: ['product', 'native-inputs'],
      outputs: ['product/desktop-resources.json'],
      mutableOutputs: ['product/r'],
      run: async (workspace) => {
        await installMacosReleaseInputs({
          inputs: workspace.resolvePath('inputs'),
          product: workspace.resolvePath('product'),
        })
      },
    }),
    stage({
      name: 'sparkle',
      description: 'Sparkle update framework',
      requires: ['product', 'native-install'],
      outputs: ['sparkle'],
      run: async (workspace) => {
        const macUpdateConfig = workspace.parameters.macUpdateConfig
          || workspace.resolvePath('product/resources/desktop/mac-updates.json')
        if (!await pathExists(macUpdateConfig)) {
          // No update configuration in this edition: an empty stage result keeps
          // the assembly stage's dependency edge honest.
          await ensureDir(workspace.resolvePath('sparkle'))
          await writeJSON(workspace.resolvePath('sparkle/inputs.json'), { enabled: false })
          return
        }
        await runNode(join(coreRoot, 'scripts/macos-update-feed.mjs'), ['prepare', macUpdateConfig, workspace.resolvePath('sparkle')])
      },
    }),
    stage({
      name: 'desktop',
      description: 'Electron.app assembly',
      requires: ['shell', 'electron', 'install-host', 'native-install', 'sparkle'],
      outputs: ['desktop'],
      inputs: () => ({ version, development }),
      run: async (workspace) => {
        const inputs = await readJSON(workspace.resolvePath('inputs/inputs.json'))
        const sparkle = await readJSON(workspace.resolvePath('sparkle/inputs.json'))
        const macOptions = sparkle.enabled === false ? {} : {
          sparkleFramework: sparkle.framework,
          sparkleFeedURL: sparkle.feeds.stable,
          sparkleDevelopmentFeedURL: sparkle.feeds.development,
          sparklePublicEDKey: sparkle.publicEDKey,
        }
        await assembleMacos({
          product: workspace.resolvePath('product'),
          shellBuild: workspace.resolvePath('shell'),
          electronRuntime: workspace.resolvePath('electron/runtime'),
          output: workspace.resolvePath('desktop'),
          version,
          node: inputs.node,
          openssl: inputs.openssl,
          ...macOptions,
        })
      },
    }),
    stage({
      name: 'accept',
      description: 'Packaged launch acceptance',
      requires: ['desktop'],
      outputs: ['gui'],
      mutableOutputs: ['unpacked', 'evidence-public'],
      run: async (workspace) => {
        // Checks are persisted in the stage's own output so a later publish run
        // can read them even when this stage was satisfied and skipped.
        const checks = await acceptMacos({ workspace, coreRoot, name, verifyPublisherBootstrap })
        await writeJSON(workspace.resolvePath('gui/acceptance-checks.json'), checks)
      },
    }),
    stage({
      name: 'publish',
      description: 'Release ZIP and receipt',
      requires: ['accept'],
      outputs: ['publish'],
      run: async (workspace) => {
        const desktop = workspace.resolvePath('desktop')
        const receipt = await readJSON(join(desktop, 'release-receipt.json'))
        const publish = workspace.resolvePath('publish')
        await ensureDir(publish)
        const archive = join(desktop, receipt.asset.name)
        await copyFileTo(archive, join(publish, basename(archive)))
        await copyFileTo(`${archive}.sha256`, join(publish, `${basename(archive)}.sha256`))
        if (!development && releaseNotesFile) {
          await copyFileTo(join(workspace.parameters.editionRoot, releaseNotesFile), join(publish, 'RELEASE-NOTES.md'))
        }
        // The run receipt describes the whole pipeline, so it is only complete
        // here. Writing it inside the stage keeps the recorded publish directory
        // identical to the one on disk, which a re-run verifies. Run-varying
        // facts (job count, reuse) stay in the evidence result, not here.
        const inputs = await readJSON(workspace.resolvePath('inputs/inputs.json'))
        const checks = await readJSON(workspace.resolvePath('gui/acceptance-checks.json'))
        const final = {
          ...receiptBase,
          checks: { sourceAndDependencies: 'passed', ...checks },
          softwareAutoUpdate: receipt.sparkleEnabled,
          bundleVersion: receipt.bundleVersion,
          asset: receipt.asset,
          minimumSystemVersion: receipt.minimumSystemVersion,
          nativeLockSHA256: inputs.nativeLockSHA256,
          passed: true,
        }
        await writeJSON(join(publish, 'release-receipt.json'), final)
      },
    }),
  ]
}

async function acceptMacos({ workspace, coreRoot, name, verifyPublisherBootstrap }) {
  const desktop = workspace.resolvePath('desktop')
  const pack = await readJSON(join(desktop, 'release-receipt.json'))
  const archive = join(desktop, pack.asset.name)
  const evidence = workspace.resolvePath('evidence-public')
  const unpacked = workspace.resolvePath('unpacked')
  await ensureDir(evidence)
  // The ZIP is unpacked afresh on every run: acceptance must test the artifact
  // the user receives, not a directory a previous run left behind.
  await rm(unpacked, { recursive: true, force: true })
  await ensureDir(unpacked)
  await run('ditto', ['-x', '-k', archive, unpacked])
  const app = join(unpacked, `${name}.app`)
  await run('codesign', ['--verify', '--deep', '--strict', app])
  const frozen = join(app, 'Contents/Resources/product')
  await run(join(app, 'Contents/Resources/runtime/node'), [
    join(coreRoot, 'scripts/check-desktop-runtimes.mjs'), app, join(evidence, 'native-runtimes.json'),
  ])
  const gui = workspace.resolvePath('gui')
  await ensureDir(gui)
  const config = join(gui, 'eduwork.jsonc')
  // The public edition must create its own config from the actual ZIP. An
  // existing synthetic config would hide a broken first-launch template.
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
  const bootstrapEnabled = await pathExists(join(frozen, 'resources/desktop/publisher-bootstrap.json'))
  if (verifyPublisherBootstrap && !bootstrapEnabled) throw new Error('Publisher acceptance requires a bootstrap-enabled edition')
  const environment = { ...process.env, EDUWORK_DESKTOP_TEST_DATA_ROOT: join(gui, 'data') }
  if (verifyPublisherBootstrap) delete environment.EDUWORK_CONFIG_FILE
  else environment.EDUWORK_CONFIG_FILE = config
  const port = await freeLoopbackPort()
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
  await copyFileTo(join(gui, 'result.json'), join(evidence, 'desktop-ui-result.json'))
  const checks = { archiveManifest: 'passed', nativeRuntimes: 'passed', desktopLaunch: 'passed' }
  if (name === 'EduWork') {
    if (!await isFile(config) || !await isFile(join(gui, 'examples/organization.jsonc'))) {
      throw new Error('First launch did not create the user configuration and examples')
    }
    checks.userConfigurationFirstLaunch = 'passed'
  }
  if (verifyPublisherBootstrap) {
    const started = await readJSON(join(gui, 'data/logs/desktop-start.json'))
    if (started.configurationRevision < 1 || started.skillsRevision < 1) throw new Error('First launch did not activate signed publisher content')
    checks.publisherFirstLaunch = 'passed'
  }
  // The application directory must still verify after the run: acceptance proves
  // the shipped bytes are unchanged, not merely that a signed copy once existed.
  await run('codesign', ['--verify', '--deep', '--strict', app])
  checks.readOnlyApplication = 'passed'
  return checks
}
