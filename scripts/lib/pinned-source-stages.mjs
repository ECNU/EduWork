// The release candidate recipe from config/desktop-build.json, expressed as
// stages so both platforms consume the same qualified product and shell.
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { prepareElectron } from '../../dsh-electron/scripts/prepare-electron.mjs'
import { desktopBuildPlan } from '../desktop-build-plan.mjs'
import { capture, ensureDir, readJSON, run, runBundledCli, runNode, sha256File, writeText } from './build-util.mjs'
import { stage } from './stage-runner.mjs'

export function pinnedSourceStages({ coreRoot, editionRoot, version, upstreamSource = '', verifySnapshot = true }) {
  const plan = () => desktopBuildPlan({ core: coreRoot, edition: editionRoot, version, includeLegacyValidation: false })
  const stages = [
    stage({
      name: 'source-audit',
      description: 'Verify the public source and institution pin',
      outputs: ['source-audit'],
      inputs: async () => ({
        core: await sha256File(join(coreRoot, 'source-receipt.json')),
        edition: coreRoot === editionRoot ? '' : await sha256File(join(editionRoot, 'core.lock.json')),
        verifySnapshot,
      }),
      run: async workspace => {
        const output = workspace.resolvePath('source-audit')
        await ensureDir(output)
        const args = [join(coreRoot, 'scripts/audit-eduwork-distribution.mjs'), '--root', coreRoot]
        if (verifySnapshot) args.push('--verify-receipt')
        const report = await capture(process.execPath, args)
        await writeText(join(output, 'core.json'), report)
        await runNode(join(coreRoot, 'scripts/check-source-docs.mjs'), [coreRoot])
        if (coreRoot !== editionRoot) {
          await runNode(join(coreRoot, 'scripts/check-source-docs.mjs'), [editionRoot])
          const lock = await readJSON(join(editionRoot, 'core.lock.json'))
          const source = await readJSON(join(coreRoot, 'source-receipt.json'))
          const commit = await capture('git', ['-C', coreRoot, 'rev-parse', 'HEAD'])
          if (lock.commit !== commit || lock.sourceFileSetSHA256 !== source.fileSetSHA256) {
            throw new Error('Institution/core snapshot mismatch')
          }
        }
      },
    }),
    stage({
      name: 'upstream',
      description: 'Fetch the pinned DSH source',
      requires: ['source-audit'],
      outputs: ['upstream'],
      inputs: async () => ({ recipe: await sha256File(join(coreRoot, 'config/desktop-build.json')),
        lock: await sha256File((await plan()).sourceLock), upstreamSource }),
      run: async workspace => {
        const selected = await plan()
        const output = workspace.resolvePath('upstream')
        if (upstreamSource) {
          const actual = (await run('git', ['-C', upstreamSource, 'rev-parse', 'HEAD'], { capture: true })).stdout.trim()
          if (actual !== selected.upstreamCommit) throw new Error('Provided DSH checkout differs from the pinned source commit')
          await run('git', ['clone', '--no-checkout', upstreamSource, output])
          await run('git', ['-C', output, 'checkout', '--detach', actual])
        } else {
          await run('git', ['init', output])
          await run('git', ['-C', output, 'remote', 'add', 'origin', selected.upstreamRepository])
          await run('git', ['-C', output, 'fetch', '--depth=1', 'origin', selected.upstreamCommit])
          await run('git', ['-C', output, 'checkout', '--detach', 'FETCH_HEAD'])
        }
      },
    }),
    stage({
      name: 'runtime',
      description: 'Install the candidate DSH npm Runtime',
      requires: ['source-audit'],
      outputs: ['runtime'],
      inputs: async () => ({ lock: await sha256File((await plan()).sourceLock) }),
      run: async workspace => {
        const selected = await plan()
        await runNode(join(coreRoot, 'dsh-desktop/scripts/prepare-dsh-runtime.mjs'), [
          '--source', 'npm', '--lock', selected.sourceLock, '--output', workspace.resolvePath('runtime'),
        ])
      },
    }),
    stage({
      name: 'source-dependencies',
      description: 'Install pinned source build dependencies',
      requires: ['source-audit'],
      outputs: ['dependencies'],
      inputs: async () => ({ lock: await sha256File(join((await plan()).candidate, 'source-probe/package-lock.json')) }),
      run: async workspace => {
        const selected = await plan()
        const output = workspace.resolvePath('dependencies')
        await ensureDir(output)
        for (const file of ['package.json', 'package-lock.json']) {
          await copyFile(join(selected.candidate, 'source-probe', file), join(output, file))
        }
        await runBundledCli('npm', ['ci', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: output })
      },
    }),
    stage({
      name: 'host-adapter',
      description: 'Adapt the pinned native Host',
      requires: ['upstream'],
      outputs: ['host'],
      run: async workspace => {
        await runNode(join(coreRoot, 'dsh-host/prepare-native.mjs'), [
          '--upstream', workspace.resolvePath('upstream'), '--output', workspace.resolvePath('host'),
        ])
      },
    }),
    stage({
      name: 'source-clients',
      description: 'Rebuild the candidate plugin clients',
      requires: ['source-audit', 'runtime', 'source-dependencies'],
      outputs: ['source'],
      run: async workspace => {
        await mkdir(workspace.resolvePath('source-report'))
        await runNode(join(coreRoot, 'scripts/build-pinned-dsh-plugin-clients.mjs'), [
          '--runtime', workspace.resolvePath('runtime'), '--dependencies', workspace.resolvePath('dependencies'),
          '--output', workspace.resolvePath('source'), '--report', workspace.resolvePath('source-report/client-build.json'),
          '--version', version,
        ])
      },
      clean: ['source-report'],
    }),
    stage({
      name: 'product',
      description: 'Assemble the pinned source product and edition',
      requires: ['source-audit', 'runtime', 'source-dependencies', 'source-clients', 'host-adapter'],
      mutableOutputs: ['product'],
      run: async workspace => {
        const selected = await plan()
        const product = workspace.resolvePath('product')
        await runNode(join(coreRoot, 'scripts/assemble-pinned-dsh-source-product.mjs'), [
          '--runtime', workspace.resolvePath('runtime'), '--source', workspace.resolvePath('source'),
          '--dependencies', workspace.resolvePath('dependencies'), '--host', workspace.resolvePath('host'),
          '--output', product,
        ])
        const args = ['--product', product, '--version', version, '--runtime-lock', selected.sourceLock]
        if (coreRoot !== editionRoot) args.push('--edition', editionRoot)
        if (selected.publisherDescriptors) args.push('--publisher-descriptors', selected.publisherDescriptors)
        if (selected.automaticUpdates) args.push('--channel', 'stable')
        await runNode(join(coreRoot, 'scripts/prepare-pinned-dsh-product.mjs'), args)
        await runNode(join(coreRoot, 'scripts/verify-product-release-identity.mjs'), [product, version])
      },
    }),
    stage({
      name: 'electron-tools',
      description: 'Install the candidate Electron tooling',
      requires: ['source-audit'],
      outputs: ['desktop-tools'],
      inputs: async () => ({ lock: await sha256File(join((await plan()).candidate, 'desktop-probe/package-lock.json')) }),
      run: async workspace => {
        const selected = await plan()
        const output = workspace.resolvePath('desktop-tools/apps/desktop')
        await ensureDir(output)
        for (const file of ['package.json', 'package-lock.json']) {
          await copyFile(join(selected.candidate, 'desktop-probe', file), join(output, file))
        }
        await runBundledCli('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: output })
      },
    }),
    stage({
      name: 'electron',
      description: 'Verify the candidate Electron runtime',
      requires: ['electron-tools'],
      outputs: ['electron'],
      run: async workspace => {
        await prepareElectron({ upstream: workspace.resolvePath('desktop-tools'), output: workspace.resolvePath('electron') })
      },
    }),
    stage({
      name: 'shell',
      description: 'Build the pinned DSH Electron shell',
      requires: ['upstream', 'runtime', 'host-adapter', 'electron-tools'],
      outputs: ['shell'],
      run: async workspace => {
        await runNode(join(coreRoot, 'dsh-electron/scripts/build-shell.mjs'), [
          '--pinned-dsh-source', '--upstream', workspace.resolvePath('upstream'),
          '--runtime', workspace.resolvePath('runtime'), '--host', workspace.resolvePath('host'),
          '--output', workspace.resolvePath('shell'),
        ])
      },
    }),
  ]
  return stages
}
