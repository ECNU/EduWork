// End-to-end Windows x64 Electron release pipeline: Web CI (build-only), Host,
// desktop product, native inputs, Electron assembly, immutable ZIP, packaged
// launch acceptance and the release receipt. Node.js port of
// ci-eduwork-windows-release.ps1. Requires a Windows runner.
import { createWriteStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  capture, copyFileTo, copyTree, ensureDir, fullPath, isDirectory, isFile,
  isMainModule, isWindows, pathExists, readJSON, run, runNode, sha256File,
  sleep, statEntry, writeJSON, writeText,
} from './lib/build-util.mjs'
import { resolveEduworkUpstream } from './lib/upstream.mjs'
import { ciEduworkWeb } from './ci-eduwork-web.mjs'
import { prepareDesktopProduct } from './prepare-desktop-product.mjs'
import { prepareWindowsReleaseInputs } from './prepare-windows-release-inputs.mjs'
import { prepareElectron } from '../dsh-electron/scripts/prepare-electron.mjs'
import { assembleDesktopCandidate } from './assemble-desktop-candidate.mjs'
import { packWindowsRelease } from './pack-windows-release.mjs'

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

async function copyDirectoryFiles(source, destination) {
  if (!await isDirectory(source)) return
  await ensureDir(destination)
  const { readdir } = await import('node:fs/promises')
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isFile()) await copyFileTo(join(source, entry.name), join(destination, entry.name))
  }
}

export async function ciEduworkWindowsRelease({
  coreRoot,
  editionRoot,
  distributionConfig,
  version,
  releaseNotesFile = '',
  releaseNotesApproved = false,
  development = false,
  verifySnapshot = true,
  runtimeSource = '',
  output,
} = {}) {
  if (!isWindows) throw new Error('The Windows release pipeline requires a Windows runner')
  coreRoot = fullPath(coreRoot)
  editionRoot = fullPath(editionRoot)
  const isDevelopmentVersion = /^\d+\.\d+\.\d+-dev\.\d{8}\.[1-9]\d*$/.test(version ?? '')
  let notesPath = ''
  if (development) {
    if (!isDevelopmentVersion) throw new Error('Development artifacts require X.Y.Z-dev.YYYYMMDD.N')
    if (releaseNotesFile || releaseNotesApproved) throw new Error('Development artifacts do not publish Release notes.')
  } else {
    if (!/^\d+\.\d+\.\d+$/.test(version ?? '') && !isDevelopmentVersion) throw new Error('GitHub Releases require X.Y.Z or X.Y.Z-dev.YYYYMMDD.N')
    if (!releaseNotesApproved) throw new Error('Release notes must be discussed and approved before publication.')
    if (!/^docs\/releases\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(releaseNotesFile ?? '')) {
      throw new Error('Use a reviewed Markdown file under docs/releases in the edition repository.')
    }
    notesPath = join(editionRoot, releaseNotesFile)
    if (!await isFile(notesPath) || !(await readFile(notesPath, 'utf8')).trim()) throw new Error('Approved release notes are missing or empty.')
  }
  output = fullPath(output)
  if (await pathExists(output)) throw new Error('Release build requires a new workspace')
  await ensureDir(output)
  const name = coreRoot === editionRoot ? 'EduWork' : 'EduWork-ECNU'
  const receipt = {
    schemaVersion: 1,
    kind: 'eduwork-windows-release',
    version,
    edition: name,
    shell: 'electron',
    platform: 'windows-x64',
    validationProfile: 'ci-build-and-launch-v1',
    passed: false,
    checks: {},
    sourceSnapshotVerified: verifySnapshot,
  }
  if (development) {
    receipt.kind = 'eduwork-windows-development'
    receipt.publication = 'artifact-only'
  } else {
    receipt.releaseNotes = { approved: true, file: releaseNotesFile, sha256: await sha256File(notesPath) }
  }
  const evidence = join(output, 'evidence')
  const publicEvidence = join(output, 'evidence-public')
  await ensureDir(evidence)
  await ensureDir(publicEvidence)
  try {
    receipt.coreCommit = (await capture('git', ['-C', coreRoot, 'rev-parse', 'HEAD'])).trim()
    receipt.editionCommit = (await capture('git', ['-C', editionRoot, 'rev-parse', 'HEAD'])).trim()
    const source = await readJSON(join(coreRoot, 'source-receipt.json'))
    receipt.sourceVersion = source.version
    if (!development && source.version !== version) throw new Error('Core source receipt version differs from the requested Release')
    if (coreRoot !== editionRoot) {
      const lock = await readJSON(join(editionRoot, 'core.lock.json'))
      if (lock.version !== source.version) throw new Error('Institution/core source versions must agree')
    }
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
    receipt.checks.sourceAndDependencies = 'passed'
    await copyDirectoryFiles(join(output, 'web/evidence/public'), publicEvidence)
    const web = join(output, 'web/assembly')
    const identity = await readJSON(join(web, 'assembly.json'))
    receipt.distribution = identity.distribution
    receipt.dshVersion = identity.dshVersion
    receipt.dshCommit = identity.dshCommit
    receipt.managedPackages = identity.managedPackages
    const upstream = await resolveEduworkUpstream(identity.dshCommit)
    const hostAdapter = join(output, 'host')
    const shellBuild = join(output, 'shell')
    const electronCache = join(output, 'electron')
    const product = join(output, 'product')
    await runNode(join(coreRoot, 'dsh-host/prepare.mjs'), ['--upstream', upstream, '--output', hostAdapter])
    await prepareDesktopProduct({ webAssembly: web, hostAdapter, output: product, version })
    await prepareWindowsReleaseInputs({ product, output: join(output, 'inputs') })
    const inputs = await readJSON(join(output, 'inputs/inputs.json'))
    receipt.nativeInputs = {
      vcRedist: inputs.vcRedist,
      asrSHA256: inputs.asrSHA256,
      modelSHA256: inputs.modelSHA256,
      browserVersion: inputs.browserVersion,
      browserURL: inputs.browserURL,
      browserArchiveSHA256: inputs.browserArchiveSHA256,
    }
    await prepareElectron({ upstream, output: electronCache })
    await runNode(join(coreRoot, 'dsh-electron/scripts/build-shell.mjs'), ['--upstream', upstream, '--host', hostAdapter, '--output', shellBuild])
    await assembleDesktopCandidate({
      shell: 'electron',
      product,
      hostAdapter,
      electronShellBuild: shellBuild,
      electronRuntime: join(electronCache, 'runtime'),
      node: inputs.node,
      outputRoot: join(output, 'desktop'),
      version,
    })
    const candidate = join(output, 'desktop/electron-candidate')
    const metadataPath = join(candidate, 'release.json')
    const metadata = await readJSON(metadataPath)
    metadata.pluginPolicy = 'npm-exact-locks'
    metadata.releaseKind = isDevelopmentVersion ? 'portable-development' : 'portable-public-test'
    await writeJSON(metadataPath, metadata)
    const releaseLabel = isDevelopmentVersion ? '开发版 / Development' : '公测版 / Public beta'
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
    const publish = join(output, 'publish')
    const asset = `${name}-${version}-windows-x64-electron.zip`
    const archive = join(publish, asset)
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
    await packWindowsRelease({ candidate, output: archive, development: isDevelopmentVersion, forUpdate: true })
    // Test the extracted ZIP, not the input directory. This also exercises
    // relocation of the private Python environment and all native paths.
    const extracted = join(output, 'unpacked')
    await ensureDir(extracted)
    await run('tar.exe', ['-xf', archive, '-C', extracted])
    const desktop = join(extracted, name)
    await runNode(join(coreRoot, 'scripts/verify-windows-release.mjs'), [desktop, '--for-update'])
    await run(join(desktop, 'resources/runtime/node.exe'), [join(coreRoot, 'scripts/check-desktop-runtimes.mjs'), desktop, join(publicEvidence, 'native-runtimes.json')])
      .catch(() => { throw new Error('Packaged native runtime smoke check failed') })
    receipt.checks.nativeRuntimes = 'passed'
    const frozenProduct = join(desktop, 'resources/product')
    const gui = join(evidence, 'gui')
    await ensureDir(gui)
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
      `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
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
    receipt.checks.desktopLaunch = 'passed'
    receipt.checks.archiveManifest = 'passed'
    receipt.asset = { name: asset, bytes: (await statEntry(archive)).size, sha256: await sha256File(archive) }
    receipt.passed = true
    await writeJSON(join(publish, 'release-receipt.json'), receipt)
    if (!development) {
      await copyFileTo(notesPath, join(publish, 'RELEASE-NOTES.md'))
      await runNode(join(coreRoot, 'scripts/github-update-manifest.mjs'), [join(publish, 'release-receipt.json'), `ecnu/${name}`])
        .catch(() => { throw new Error('GitHub update manifest generation failed') })
    }
  } catch (error) {
    receipt.error = error.message
    console.error(error.stack)
    throw error
  } finally {
    // Preserve the Web runner's redacted failure report too. Raw test homes,
    // credentials and process logs remain on the disposable runner.
    await copyDirectoryFiles(join(output, 'web/evidence/public'), publicEvidence)
    const guiReport = join(evidence, 'gui/result.json')
    if (await isFile(guiReport)) await copyFileTo(guiReport, join(publicEvidence, 'desktop-ui-result.json'))
    for (const filename of ['failed-desktop.png', 'failed-desktop-ui.json']) {
      const diagnostic = join(evidence, `gui/${filename}`)
      if (await isFile(diagnostic)) await copyFileTo(diagnostic, join(publicEvidence, filename))
    }
    await writeJSON(join(publicEvidence, 'desktop-release-result.json'), receipt)
  }
  return receipt
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'core-root': { type: 'string' },
      'edition-root': { type: 'string' },
      'distribution-config': { type: 'string' },
      version: { type: 'string' },
      'release-notes-file': { type: 'string' },
      'release-notes-approved': { type: 'boolean' },
      development: { type: 'boolean' },
      'no-verify-snapshot': { type: 'boolean' },
      'runtime-source': { type: 'string' },
      output: { type: 'string' },
    },
  })
  if (!values['core-root'] || !values['edition-root'] || !values['distribution-config'] || !values.version || !values.output) {
    throw new Error('Use --core-root --edition-root --distribution-config --version --output [--release-notes-file <docs/releases/*.md>] [--release-notes-approved] [--development] [--no-verify-snapshot] [--runtime-source <dir>]')
  }
  await ciEduworkWindowsRelease({
    coreRoot: values['core-root'],
    editionRoot: values['edition-root'],
    distributionConfig: values['distribution-config'],
    version: values.version,
    releaseNotesFile: values['release-notes-file'] ?? '',
    releaseNotesApproved: Boolean(values['release-notes-approved']),
    development: Boolean(values.development),
    verifySnapshot: !values['no-verify-snapshot'],
    runtimeSource: values['runtime-source'] ?? '',
    output: values.output,
  })
}
