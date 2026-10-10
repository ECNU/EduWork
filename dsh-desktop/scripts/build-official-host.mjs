// Builds the isolated Wails candidate executable with the locked WebView
// dependency and the CDP boundary test. Node.js port of build-official-host.ps1.
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  capture, copyFileTo, ensureDir, fullPath, isDirectory, isMainModule,
  pathExists, readJSON, run, sha256File, writeJSON,
} from '../../scripts/lib/build-util.mjs'
import { setDesktopIcon } from '../../scripts/set-desktop-icon.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

export async function buildOfficialHost({ outputExe, node = process.execPath } = {}) {
  const core = fullPath(join(scriptRoot, '../..'))
  outputExe = fullPath(outputExe)
  node = fullPath(node)
  if (/(^|[\\/])current([\\/]|$)/i.test(outputExe)) throw new Error('Candidate build cannot replace current')
  const outputDirectory = dirname(outputExe)
  if (!await isDirectory(outputDirectory)) throw new Error('Candidate output directory must exist')
  const cwd = join(core, 'dsh-desktop')
  const module = (await capture('go', ['list', '-m', '-f', '{{.Dir}}', 'github.com/wailsapp/go-webview2'], { cwd })
    .catch(() => { throw new Error('Could not resolve locked WebView dependency') })).trim()
  const buildRoot = join(core, `dist/wails-candidate-build-${randomUUID().replaceAll('-', '')}`)
  await ensureDir(dirname(buildRoot))
  await run(node, [join(scriptRoot, 'prepare-webview-candidate.mjs'), '--module', module, '--output', buildRoot], { cwd })
    .catch(() => { throw new Error('Could not prepare isolated WebView dependency') })
  const modFile = join(buildRoot, 'candidate.mod')
  await copyFileTo(join(cwd, 'go.mod'), modFile)
  await copyFileTo(join(cwd, 'go.sum'), join(buildRoot, 'candidate.sum'))
  await run('go', ['mod', 'edit', `-modfile=${modFile}`, `-replace=github.com/wailsapp/go-webview2=${join(buildRoot, 'go-webview2')}`], { cwd })
    .catch(() => { throw new Error('Could not configure isolated Go dependency') })
  await run('go', ['test', `-modfile=${modFile}`, 'github.com/wailsapp/go-webview2/pkg/edge', '-run', 'TestEduworkCDPIsExplicitAndLoopbackOnly', '-count=1'], { cwd })
    .catch(() => { throw new Error('Candidate CDP boundary test failed') })
  await run('go', ['build', `-modfile=${modFile}`, '-tags', 'production', '-ldflags', '-H windowsgui', '-o', outputExe, './cmd/eduwork-wails-candidate'], { cwd })
    .catch(() => { throw new Error('Wails candidate executable build failed') })
  await setDesktopIcon({ executable: outputExe, shell: 'wails' })
  await copyFileTo(join(buildRoot, 'webview-candidate-receipt.json'), join(outputDirectory, 'webview-candidate-receipt.json'))
  const licenseRoot = join(outputDirectory, 'resources/licenses')
  await ensureDir(licenseRoot)
  await copyFileTo(join(module, 'LICENSE'), join(licenseRoot, 'LICENSE-go-webview2'))
  const wailsModule = (await capture('go', ['list', '-m', '-f', '{{.Dir}}', 'github.com/wailsapp/wails/v2'], { cwd })).trim()
  await copyFileTo(join(wailsModule, 'LICENSE'), join(licenseRoot, 'LICENSE-Wails'))
  const candidateReceipt = join(outputDirectory, 'candidate-receipt.json')
  if (await pathExists(candidateReceipt)) {
    const receipt = await readJSON(candidateReceipt)
    if (receipt.schemaVersion !== 1 || receipt.shell !== 'wails') throw new Error('Unexpected existing candidate receipt')
    receipt.executableSha256 = await sha256File(outputExe)
    await writeJSON(candidateReceipt, receipt)
  }
  return outputExe
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'output-exe': { type: 'string' },
      node: { type: 'string' },
    },
  })
  if (!values['output-exe']) throw new Error('Use --output-exe <EduWork.exe> [--node <node.exe>]')
  await buildOfficialHost({ outputExe: values['output-exe'], node: values.node ?? process.execPath })
}
