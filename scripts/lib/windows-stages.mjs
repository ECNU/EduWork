// Windows x64 stages: the locked native inputs, the Electron candidate
// assembly, the portable ZIP, packaged launch acceptance and the publish
// directory, including the Go legacy launcher and the update manifest.
//
// The ZIP is created inside the `desktop` stage and only copied by `publish`.
// That keeps the one-owner rule intact: acceptance consumes an artifact instead
// of producing one that a later stage's rerun would clean away, and the packer's
// "ZIP must be a new file" guard still holds because a rerun of `desktop` clears
// the whole directory first.
//
// The development package and packaged launch have passed on Windows x64.
// The public extractor path still needs a clean-checkout release acceptance.
import { createWriteStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { basename, join } from 'node:path'
import {
  copyFileTo, copyTree, ensureDir, isFile, isWindows, pathExists, readJSON, run,
  runNode, sha256File, sleep, statEntry, writeJSON, writeText,
} from './build-util.mjs'
import { stage } from './stage-runner.mjs'
import { copyPublicWebEvidence } from './shared-desktop-stages.mjs'
import { assembleDesktopCandidate } from '../assemble-desktop-candidate.mjs'
import { packWindowsRelease } from '../pack-windows-release.mjs'
import { prepareWindowsReleaseInputs, installWindowsReleaseInputs } from '../prepare-windows-release-inputs.mjs'
import { prepareWindowsPortableExtractor } from '../portable-extractor.mjs'

const DEVELOPMENT_VERSION = /^\d+\.\d+\.\d+-dev\.\d{8}\.[1-9]\d*$/

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

/**
 * Windows x64 stages. Everything run-varying comes from `workspace.parameters`,
 * which the orchestrator fixed for the whole workspace, so a re-entry cannot
 * disagree with the run that recorded the checkpoint.
 */
export function windowsStages({ coreRoot, receiptBase }) {
  return [
    stage({
      name: 'native-inputs',
      description: 'Windows x64 native inputs',
      outputs: ['inputs'],
      // The inputs are a function of the pinned runtime manifests and the
      // reviewed source catalog, never of the product, so a product change does
      // not re-download Python, Node, Chromium or the ASR engine.
      inputs: async (workspace) => ({
        node: await sha256File(join(coreRoot, 'dsh-desktop/internal/productruntime/builtin/node-runtime-manifest.json')),
        python: await sha256File(join(coreRoot, 'dsh-desktop/internal/productruntime/builtin/python-runtime-manifest.json')),
        catalog: await sha256File(join(coreRoot, 'packages/dsh-knowledge-studio/packages/artifact-services/lib/transcription-components.js')),
        platform: workspace.platform,
      }),
      run: async (workspace) => {
        await prepareWindowsReleaseInputs({ output: workspace.resolvePath('inputs') })
      },
    }),
    // The Windows resource recipe writes `r` and `desktop-resources.json` into
    // the product, so it is split the way the macOS inputs are and ordered after
    // every reader of the product tree.
    stage({
      name: 'native-install',
      description: 'Install native inputs into the product',
      requires: ['product', 'native-inputs'],
      outputs: ['product/desktop-resources.json'],
      mutableOutputs: ['product/r'],
      run: async (workspace) => {
        await installWindowsReleaseInputs({
          inputs: workspace.resolvePath('inputs'),
          product: workspace.resolvePath('product'),
        })
      },
    }),
    stage({
      name: 'desktop',
      description: 'Desktop candidate assembly and portable ZIP',
      requires: ['shell', 'electron', 'install-host', 'native-install'],
      outputs: ['desktop'],
      inputs: (workspace) => ({
        version: workspace.parameters.version,
        development: workspace.parameters.development,
        forUpdate: workspace.parameters.forUpdate,
        edition: workspace.parameters.edition,
      }),
      run: async (workspace) => {
        const { version, development, edition } = workspace.parameters
        const developmentVersion = DEVELOPMENT_VERSION.test(version)
        const inputs = await readJSON(workspace.resolvePath('inputs/inputs.json'))
        const candidateRoot = workspace.resolvePath('desktop')
        await assembleDesktopCandidate({
          shell: 'electron',
          product: workspace.resolvePath('product'),
          hostAdapter: workspace.resolvePath('host'),
          electronShellBuild: workspace.resolvePath('shell'),
          electronRuntime: workspace.resolvePath('electron/runtime'),
          node: inputs.node,
          outputRoot: candidateRoot,
          version,
        })
        const candidate = join(candidateRoot, 'electron-candidate')
        await annotateCandidate({
          candidate, coreRoot, name: edition, version, development, developmentVersion,
        })
        const asset = `${edition}-${version}-windows-x64-electron.zip`
        await writeJSON(join(candidateRoot, 'package.json'), await packWindowsRelease({
          candidate,
          output: join(candidateRoot, asset),
          development: developmentVersion,
          forUpdate: workspace.parameters.forUpdate,
        }))
      },
    }),
    stage({
      name: 'accept',
      description: 'Packaged launch acceptance',
      requires: ['desktop'],
      // `gui` holds the checks as well as the smoke evidence, so publish can read
      // them when this stage was satisfied and skipped.
      outputs: ['gui'],
      mutableOutputs: ['unpacked', 'evidence-public'],
      run: async (workspace) => {
        await acceptWindows({ workspace, coreRoot })
      },
    }),
    stage({
      name: 'publish',
      description: 'Release ZIP, receipt and update manifest',
      requires: ['accept'],
      outputs: ['publish'],
      run: async (workspace) => {
        await publishWindows({ workspace, coreRoot, receiptBase })
      },
    }),
  ]
}

/**
 * Add the product metadata the portable package needs: the plugin policy, the
 * release kind and the user-facing README that ships in the ZIP, plus the Go
 * legacy launcher the update contract requires.
 */
async function annotateCandidate({ candidate, coreRoot, name, version, development, developmentVersion }) {
  const metadataPath = join(candidate, 'release.json')
  const metadata = await readJSON(metadataPath)
  metadata.pluginPolicy = 'npm-exact-locks'
  metadata.releaseKind = developmentVersion ? 'portable-development' : 'portable-public-test'
  await writeJSON(metadataPath, metadata)

  const releaseLabel = developmentVersion ? '开发版 / Development' : '公测版 / Public beta'
  await writeText(join(candidate, 'README.txt'), [
    `${name} ${version} — Windows x64 Electron ${releaseLabel}`,
    '',
    '解压整个目录后运行 EduWork-Electron.exe。公版可在模型设置中填写自己的 API Key；企业服务见 config/eduwork.jsonc 和 config/examples。',
    '数据保存在本目录 data 下。移动整个目录前请退出程序。首次使用原生组件不需要另外安装 Node/Python/Office。',
    '此包支持全新安装与现有 Windows 更新器安装。公版默认从 GitHub 获取更新，设置中可选择公测或开发渠道；机构可通过 config/eduwork.jsonc 配置自己的更新源。自动更新保留 data 和 config；不要手工覆盖工作目录。仓库未公开或没有已发布版本时，不会提供在线更新。',
    '',
    'Extract the complete folder and run EduWork-Electron.exe. Configure a model API key or consult config/eduwork.jsonc and config/examples for enterprise services.',
    'Keep the data and config folders; close the app before moving the whole directory. This ZIP supports new installations and the Windows updater. The public edition uses GitHub with public-beta/development channel selection; institutions can configure another source. Private repositories and draft releases are unavailable to the anonymous updater.',
  ].join('\n'))

  // The legacy shortcut launcher is a transition artifact; a missing build is a
  // release blocker, not something to skip quietly.
  await run('go', ['build', '-trimpath', '-ldflags', '-s -w -H windowsgui', '-o', join(candidate, 'ChatECNU-Work.exe'), './cmd/eduwork-launch'], { cwd: join(coreRoot, 'dsh-desktop') })
    .catch(() => { throw new Error('Legacy shortcut launcher build failed') })
  await copyFileTo(join(candidate, 'ChatECNU-Work.exe'), join(candidate, 'EduWork.exe'))

  if (development) {
    metadata.releaseKind = 'portable-development'
    await writeJSON(metadataPath, metadata)
    await writeText(join(candidate, 'README.txt'), [
      `${name} ${version} — Windows x64 Electron 开发版`,
      '',
      '解压后运行 EduWork-Electron.exe。配置见 config/eduwork.jsonc 和 config/examples。',
      '此包由 GitHub CI 构建，包含 Go 过渡版到 Electron 的更新契约；开发包不创建 GitHub Release。',
      '由维护者完成实包升级验收后配置开发更新清单，不能投放到 0.2 旧入口。',
    ].join('\n'))
  }
}

/**
 * Unpack the shipped ZIP and launch it. Testing the extracted archive, rather
 * than the directory it came from, also exercises relocation of the private
 * Python environment and every native path.
 */
async function acceptWindows({ workspace, coreRoot }) {
  if (!isWindows) throw new Error('Windows acceptance requires a Windows runner')
  const { edition, development } = workspace.parameters
  const packed = await readJSON(workspace.resolvePath('desktop/package.json'))
  const archive = packed.output
  const gui = workspace.resolvePath('gui')
  const evidence = workspace.resolvePath('evidence-public')
  const unpacked = workspace.resolvePath('unpacked')
  await ensureDir(gui)
  await ensureDir(evidence)
  await ensureDir(unpacked)

  const desktop = join(unpacked, edition)
  let portableExtractor
  if (development) {
    await run('tar.exe', ['-xf', archive, '-C', unpacked])
  } else {
    const extractorBuild = join(gui, 'portable-extractor')
    const extractorPublish = join(gui, 'extractor-publish')
    await ensureDir(extractorPublish)
    portableExtractor = await prepareWindowsPortableExtractor({
      archive, expectedSHA256: packed.sha256, outputDirectory: extractorBuild,
      target: desktop, publishDirectory: extractorPublish,
    })
  }
  await runNode(join(coreRoot, 'scripts/verify-windows-release.mjs'), [desktop, '--for-update'])
  await run(join(desktop, 'resources/runtime/node.exe'), [
    join(coreRoot, 'scripts/check-desktop-runtimes.mjs'), desktop, join(evidence, 'native-runtimes.json'),
  ]).catch(() => { throw new Error('Packaged native runtime smoke check failed') })

  const frozenProduct = join(desktop, 'resources/product')
  await copyTree(join(desktop, 'config'), join(gui, 'config'))
  const config = join(gui, 'config/eduwork.jsonc')
  const text = await readFile(config, 'utf8')
  if (!/"closeAction"\s*:\s*"tray"/.test(text)) throw new Error('Expected shipped close-to-tray default')
  await writeText(config, text.replace(/"closeAction"\s*:\s*"tray"/, '"closeAction": "exit"'), { trailingNewline: false })
  if (await pathExists(join(frozenProduct, 'resources/desktop/publisher-bootstrap.json'))) {
    // Exercise the offline migration path with an isolated synthetic profile.
    // CI never needs institution credentials or a live configuration server.
    // First-run download/signature/rollback behavior has synthetic Node tests.
    await writeJSON(config, {
      schemaVersion: 1,
      desktop: { closeAction: 'exit' },
      organizations: [{
        schemaVersion: 'dsh-oidc/v1alpha1',
        id: 'ci-example',
        displayName: 'CI example',
        oidc: { issuer: 'https://identity.example.test', clientId: 'synthetic-ci-client', scopes: ['openid', 'profile'] },
      }],
    })
  }

  const port = await freeLoopbackPort()
  const stdoutLog = createWriteStream(join(gui, 'app.stdout.log'))
  const stderrLog = createWriteStream(join(gui, 'app.stderr.log'))
  const appProcess = spawn(join(desktop, 'EduWork-Electron.exe'), [
    `--remote-debugging-port=${port}`, `--remote-debugging-address=127.0.0.1`,
  ], {
    env: {
      ...process.env,
      EDUWORK_DESKTOP_TEST_DATA_ROOT: join(gui, 'data'),
      EDUWORK_CONFIG_FILE: config,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  appProcess.stdout.pipe(stdoutLog)
  appProcess.stderr.pipe(stderrLog)
  let exited = false
  const exitPromise = new Promise(done => appProcess.once('exit', () => { exited = true; done() }))
  try {
    const deadline = Date.now() + 3 * 60000
    let ready = false
    while (Date.now() < deadline) {
      if (exited) {
        const stderrText = await readFile(join(gui, 'app.stderr.log'), 'utf8').catch(() => '')
        console.error(stderrText.split('\n').slice(-60).join('\n'))
        throw new Error('Packaged desktop exited before ready')
      }
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
    if (!ready) throw new Error('Packaged desktop failed to start within acceptance limit')
    await runNode(join(coreRoot, 'dsh-electron/tests/desktop-smoke.mjs'), [
      '--shell', 'electron', '--product', frozenProduct, '--cdp', `http://127.0.0.1:${port}`,
      '--data-root', join(gui, 'data'), '--evidence', gui, '--launch-only',
    ])
  } finally {
    if (!exited) {
      await runNode(join(coreRoot, 'scripts/close-release-test-desktop.mjs'), [frozenProduct, `http://127.0.0.1:${port}`])
      const stopped = await Promise.race([exitPromise.then(() => true), sleep(15000).then(() => false)])
      if (!stopped) throw new Error(`Test desktop did not stop: ${appProcess.pid}`)
    }
    stdoutLog.end()
    stderrLog.end()
  }
  if (/EBADF|request pipe is unavailable/.test(await readFile(join(gui, 'app.stderr.log'), 'utf8'))) {
    throw new Error('Desktop teardown reported a pipe failure')
  }
  if (!(await readJSON(join(gui, 'result.json'))).passed) throw new Error('Desktop GUI acceptance failed')

  const checks = {
    desktopLaunch: 'passed',
    archiveManifest: 'passed',
    nativeRuntimes: 'passed',
    ...(portableExtractor ? { portableExtractor: 'passed' } : {}),
    asset: { name: basename(archive), bytes: (await statEntry(archive)).size, sha256: await sha256File(archive) },
    ...(portableExtractor ? { portableExtractorAssets: portableExtractor } : {}),
  }
  await writeJSON(join(gui, 'acceptance-checks.json'), checks)
  return checks
}

/** Copy the shipped ZIP, write the receipt and generate the update manifest. */
async function publishWindows({ workspace, coreRoot, receiptBase }) {
  const { name, development, releaseNotesFile, editionRoot } = workspace.parameters
  const publish = workspace.resolvePath('publish')
  const publicEvidence = workspace.resolvePath('evidence-public')
  const gui = workspace.resolvePath('gui')
  const packed = await readJSON(workspace.resolvePath('desktop/package.json'))
  const identity = await readJSON(workspace.resolvePath('web/assembly/assembly.json'))
  const inputs = await readJSON(workspace.resolvePath('inputs/inputs.json'))
  const checks = await readJSON(join(gui, 'acceptance-checks.json'))
  await ensureDir(publish)
  await copyFileTo(packed.output, join(publish, basename(packed.output)))
  if (await isFile(`${packed.output}.sha256`)) {
    await copyFileTo(`${packed.output}.sha256`, join(publish, `${basename(packed.output)}.sha256`))
  }
  if (!development) {
    const extractorPublish = join(gui, 'extractor-publish')
    for (const name of [checks.portableExtractorAssets.asset.name, `${checks.portableExtractorAssets.asset.name}.sha256`, checks.portableExtractorAssets.receipt.name]) {
      await copyFileTo(join(extractorPublish, name), join(publish, name))
    }
  }

  const receipt = {
    ...receiptBase,
    distribution: identity.distribution,
    dshVersion: identity.dshVersion,
    dshCommit: identity.dshCommit,
    managedPackages: identity.managedPackages,
    nativeInputs: {
      vcRedist: inputs.vcRedist,
      asrSHA256: inputs.asrSHA256,
      modelSHA256: inputs.modelSHA256,
      browserVersion: inputs.browserVersion,
      browserURL: inputs.browserURL,
      browserArchiveSHA256: inputs.browserArchiveSHA256,
    },
    checks: { sourceAndDependencies: 'passed', ...checks, asset: undefined, portableExtractorAssets: undefined },
    asset: checks.asset,
    ...(!development ? { portableExtractor: checks.portableExtractorAssets } : {}),
    passed: true,
  }
  delete receipt.checks.asset
  delete receipt.checks.portableExtractorAssets
  await writeJSON(join(publish, 'release-receipt.json'), receipt)
  if (!development) {
    await copyFileTo(join(editionRoot, releaseNotesFile), join(publish, 'RELEASE-NOTES.md'))
    await runNode(join(coreRoot, 'scripts/github-update-manifest.mjs'), [join(publish, 'release-receipt.json'), `ecnu/${name}`])
      .catch(() => { throw new Error('GitHub update manifest generation failed') })
  }

  // Preserve the Web runner's redacted failure report as well. Raw test homes,
  // credentials and process logs remain on the disposable runner. The run
  // receipt itself is written by the orchestrator, which also has to record a
  // failed run, so it is not duplicated here.
  await copyPublicWebEvidence(workspace, publicEvidence)
  const guiReport = join(gui, 'result.json')
  if (await isFile(guiReport)) await copyFileTo(guiReport, join(publicEvidence, 'desktop-ui-result.json'))
  for (const filename of ['failed-desktop.png', 'failed-desktop-ui.json']) {
    const diagnostic = join(gui, filename)
    if (await isFile(diagnostic)) await copyFileTo(diagnostic, join(publicEvidence, filename))
  }
  return receipt
}
