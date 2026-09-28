// The build stages every EduWork desktop platform shares: Web assembly, the
// desktop Host adapter, the product tree, the Electron runtime and shell, and
// the Host install into the product. Nothing here branches on the platform; a
// platform catalog adds its own inputs, assembly, acceptance and publish stages.
//
// Two rules in this file are load-bearing:
//   * `product` is created by exactly one stage. Stages that write into it
//     declare the paths they appended, never the tree.
//   * Every stage that reads `product` runs before every stage that changes it,
//     which the runner enforces through `dependsOn` edges.
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { copyFileTo, isDirectory, readJSON, runNode } from './build-util.mjs'
import { resolveEduworkUpstream } from './upstream.mjs'
import { stage } from './stage-runner.mjs'
import { ciEduworkWeb } from '../ci-eduwork-web.mjs'
import { prepareDesktopProduct } from '../prepare-desktop-product.mjs'
import { prepareElectron } from '../../dsh-electron/scripts/prepare-electron.mjs'

/**
 * Stages shared by every desktop platform. `web`, `electron` and a platform's
 * own native-input stage have no dependency on each other and are what makes a
 * parallel run worth anything.
 */
export function sharedDesktopStages({
  coreRoot, editionRoot, distributionConfig, version, verifySnapshot, runtimeSource, upstreamSource = '',
}) {
  // The locked upstream is a function of the Web assembly's recorded commit, so
  // every consumer resolves it the same way instead of carrying its own copy.
  const upstreamOf = async (workspace) => {
    const identity = await readJSON(workspace.resolvePath('web/assembly/assembly.json'))
    return { identity, upstream: await resolveEduworkUpstream(identity.dshCommit, upstreamSource) }
  }
  return [
    stage({
      name: 'web',
      description: 'Web assembly and source audit',
      outputs: ['web', 'web/assembly'],
      inputs: () => ({ version, distributionConfig, verifySnapshot, runtimeSource, coreRoot, editionRoot }),
      run: async (workspace) => {
        await ciEduworkWeb({
          coreRoot,
          editionRoot,
          distributionConfig,
          version,
          output: workspace.resolvePath('web'),
          verifySnapshot,
          runtimeSource,
          buildOnly: true,
        })
      },
    }),
    // The Host adapter is prepared from the locked upstream recorded in the Web
    // assembly, so it cannot start until that identity exists.
    stage({
      name: 'host-adapter',
      description: 'Desktop Host adapter build',
      requires: ['web'],
      outputs: ['host'],
      run: async (workspace) => {
        const { upstream } = await upstreamOf(workspace)
        await runNode(join(coreRoot, 'dsh-host/prepare.mjs'), ['--upstream', upstream, '--output', workspace.resolvePath('host')])
      },
    }),
    stage({
      name: 'product',
      description: 'Shared desktop product tree',
      requires: ['web', 'host-adapter'],
      outputs: ['product/assembly.json'],
      mutableOutputs: ['product'],
      run: async (workspace) => {
        await prepareDesktopProduct({
          webAssembly: workspace.resolvePath('web/assembly'),
          hostAdapter: workspace.resolvePath('host'),
          output: workspace.resolvePath('product'),
          version,
        })
      },
    }),
    stage({
      name: 'electron',
      description: 'Electron runtime download',
      requires: ['web'],
      outputs: ['electron'],
      run: async (workspace) => {
        const { upstream } = await upstreamOf(workspace)
        await prepareElectron({ upstream, output: workspace.resolvePath('electron') })
      },
    }),
    stage({
      name: 'shell',
      description: 'Electron shell build',
      requires: ['web', 'host-adapter'],
      outputs: ['shell'],
      run: async (workspace) => {
        const { upstream } = await upstreamOf(workspace)
        await runNode(join(coreRoot, 'dsh-electron/scripts/build-shell.mjs'), [
          '--upstream', upstream,
          '--host', workspace.resolvePath('host'),
          '--output', workspace.resolvePath('shell'),
        ])
      },
    }),
    // Writes into the product tree, so it must run after every reader of it and
    // may only be ordered against them by an unhashed edge.
    stage({
      name: 'install-host',
      description: 'Install the Host adapter into the product',
      dependsOn: ['product', 'host-adapter'],
      outputs: ['product/d/node_modules/@deepseek-ai/dsh-desktop-host'],
      run: async (workspace) => {
        await runNode(join(coreRoot, 'dsh-host/install-product-host.mjs'), [
          '--product', workspace.resolvePath('product'),
          '--adapter', workspace.resolvePath('host'),
        ])
      },
    }),
  ]
}

/** Copy the public Web evidence into the release evidence directory. */
export async function copyPublicWebEvidence(workspace, destination) {
  const source = workspace.resolvePath('web/evidence/public')
  if (!await isDirectory(source)) return
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isFile()) await copyFileTo(join(source, entry.name), join(destination, entry.name))
  }
}
