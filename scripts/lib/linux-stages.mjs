// Linux x64 AppImage stages. Linux is deliberately an artifact-only route;
// it does not participate in the Windows/macOS publication gate yet.
import { join } from 'node:path'
import { readJSON } from './build-util.mjs'
import { stage } from './stage-runner.mjs'
import { assembleLinux } from '../../dsh-electron/scripts/assemble-linux.mjs'
import { packageLinuxAppImage } from '../package-linux-appimage.mjs'
import { prepareLinuxReleaseInputs } from '../prepare-linux-release-inputs.mjs'
import { sha256File, writeJSON } from './build-util.mjs'

export function linuxStages({ coreRoot, receiptBase }) {
  return [
    stage({
      name: 'native-inputs', description: 'Linux x64 Node runtime', outputs: ['inputs'],
      inputs: async () => ({ node: await sha256File(join(coreRoot, 'dsh-desktop/internal/productruntime/builtin/node-runtime-manifest.json')) }),
      run: async workspace => { await prepareLinuxReleaseInputs({ output: workspace.resolvePath('inputs') }) },
    }),
    stage({
      name: 'desktop', description: 'Linux Electron candidate and AppImage',
      requires: ['shell', 'electron', 'product', 'native-inputs'], outputs: ['desktop'],
      run: async workspace => {
        const inputs = await readJSON(workspace.resolvePath('inputs/inputs.json'))
        const candidate = workspace.resolvePath('desktop/candidate')
        await assembleLinux({ product: workspace.resolvePath('product'), shellBuild: workspace.resolvePath('shell'), electronRuntime: workspace.resolvePath('electron/runtime'), output: candidate, version: workspace.parameters.version, node: inputs.node })
        const packaged = await packageLinuxAppImage({ candidate, output: workspace.resolvePath(`desktop/${workspace.parameters.edition}-${workspace.parameters.version}-linux-x86_64.AppImage`), cacheRoot: workspace.parameters.cacheRoot })
        await writeJSON(workspace.resolvePath('desktop/package.json'), packaged)
      },
    }),
    stage({
      name: 'publish', description: 'Linux AppImage receipt', requires: ['desktop'], outputs: ['publish'],
      run: async workspace => {
        const packaged = await readJSON(workspace.resolvePath('desktop/package.json'))
        const release = await readJSON(workspace.resolvePath('desktop/candidate/release.json'))
        const publish = workspace.resolvePath('publish')
        const { copyFile } = await import('node:fs/promises')
        await import('./build-util.mjs').then(({ ensureDir }) => ensureDir(publish))
        await copyFile(packaged.output, join(publish, packaged.output.split(/[\\/]/).at(-1)))
        await copyFile(`${packaged.output}.sha256`, join(publish, packaged.output.split(/[\\/]/).at(-1) + '.sha256'))
        await writeJSON(join(publish, 'release-receipt.json'), { ...receiptBase, passed: true, checks: { appimage: 'passed' }, asset: { name: packaged.output.split(/[\\/]/).at(-1), bytes: packaged.bytes, sha256: packaged.sha256 }, automaticUpdates: false, softwareAutoUpdate: false, platform: 'linux-x86_64', productName: release.productName })
      },
    }),
  ]
}
