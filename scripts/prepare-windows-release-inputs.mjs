// Downloads and verifies the locked Windows x64 native inputs (private Python,
// Office wheels, Node runtime, Chromium, CPU ASR engine, VS redistributables)
// and prepares the product's native resources. Node.js port of
// prepare-windows-release-inputs.ps1. Requires a Windows runner.
import { readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  capture, copyFileTo, download, ensureDir, fullPath, isMainModule, isWindows,
  pathExists, readJSON, run, sha256File, writeJSON, writeText,
} from './lib/build-util.mjs'
import { prepareDesktopResources } from './prepare-desktop-resources.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

async function findFiles(root, name) {
  const wanted = name.toLowerCase()
  const found = []
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && entry.name.toLowerCase() === wanted) found.push(path)
    }
  }
  await walk(root)
  return found
}

async function downloadAsset(asset, directory) {
  if (!/^https:\/\//.test(asset.url ?? '') || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? '')) {
    throw new Error('Downloads require HTTPS and a pinned SHA-256')
  }
  const file = join(directory, decodeURIComponent(new URL(asset.url).pathname.split('/').at(-1)))
  console.log(`Downloading ${basename(file)}`)
  await download(asset.url, file, { sha256: asset.sha256 })
  return file
}

async function extract(archive, directory) {
  await ensureDir(directory)
  await run('tar.exe', ['-xf', archive, '-C', directory])
}

// GitHub's Windows runner contains licensed Visual Studio redistribution files.
// Authenticode verification has no Node API, so the check runs through the
// Windows-bundled PowerShell (not PowerShell 7).
async function verifyMicrosoftSignature(file) {
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const probe = '$s=Get-AuthenticodeSignature -LiteralPath $args[0];' +
    '@{status=[string]$s.Status;subject=[string]$s.SignerCertificate.Subject;fileVersion=(Get-Item -LiteralPath $args[0]).VersionInfo.FileVersion}|ConvertTo-Json -Compress'
  const result = JSON.parse(await capture(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', probe, file]))
  if (result.status !== 'Valid' || !/Microsoft Corporation/.test(result.subject)) {
    throw new Error(`Unverified Microsoft DLL: ${basename(file)}`)
  }
  return result.fileVersion
}

export async function prepareWindowsReleaseInputs({ product, output } = {}) {
  if (!isWindows) throw new Error('Windows x64 inputs require a Windows runner')
  const core = fullPath(join(scriptRoot, '..'))
  output = fullPath(output)
  if (await pathExists(output)) throw new Error('Use a new input directory')
  await ensureDir(output)
  const python = await readJSON(join(core, 'dsh-desktop/internal/productruntime/builtin/python-runtime-manifest.json'))
  const nodeLock = await readJSON(join(core, 'dsh-desktop/internal/productruntime/builtin/node-runtime-manifest.json'))
  const downloads = join(output, 'downloads')
  const pythonArchive = await downloadAsset(python.assets['windows-amd64'], downloads)
  const wheelRoot = join(output, 'wheels')
  for (const packageEntry of python.environment.packages) {
    await downloadAsset(packageEntry.assets['windows-amd64'] ?? packageEntry.assets.any, wheelRoot)
  }
  const nodeAsset = nodeLock.assets['windows-amd64']
  const nodeArchive = await downloadAsset(nodeAsset, downloads)
  await extract(nodeArchive, join(output, 'node'))
  const node = join(output, `node/${nodeAsset.archiveRoot}/node.exe`)
  // Browser resources have an independent qualified version. The npm Runtime's
  // newer Playwright must not silently select a different Chromium revision.
  const browserVersion = nodeLock.environment.browserAutomation.browserVersion
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(browserVersion)) throw new Error('Invalid locked Chromium version')
  const browserURL = `https://cdn.playwright.dev/builds/cft/${browserVersion}/win64/chrome-win64.zip`
  const browserExecutable = nodeLock.environment.browserAutomation.executables['windows-amd64']
  const browserAsset = browserExecutable.archive
  if (browserAsset.url !== browserURL) throw new Error('Browser archive URL differs from the qualified version')
  const browserArchive = await downloadAsset(browserAsset, downloads)
  const browserArchiveSHA256 = await sha256File(browserArchive)
  await extract(browserArchive, join(output, 'browsers'))
  const chromes = await findFiles(join(output, 'browsers'), 'chrome.exe')
  if (chromes.length !== 1) throw new Error('Expected one downloaded Chromium executable')
  if (await sha256File(chromes[0]) !== browserExecutable.sha256) throw new Error('Chromium executable differs from the pinned resource')
  const catalogPath = join(fullPath(product), 'd/node_modules/@eduwork/dsh-artifact-services/lib/transcription-components.js')
  const catalog = JSON.parse(await capture(node, [
    '--input-type=module', '-e',
    'import {pathToFileURL} from "node:url"; const m=await import(pathToFileURL(process.argv[1])); console.log(JSON.stringify(m.getTranscriptionComponents()))',
    catalogPath,
  ]))
  const asrAssets = catalog.engine.binaries.filter(binary => binary.platform === 'win32' && binary.arch === 'x64')
  const models = catalog.models.filter(model => model.id === 'whisper-tiny-q5_1')
  if (asrAssets.length !== 1 || models.length !== 1) throw new Error('Expected one pinned CPU ASR engine and multilingual tiny model')
  const asrArchive = await downloadAsset(asrAssets[0], downloads)
  const asrModel = await downloadAsset(models[0], downloads)
  await extract(asrArchive, join(output, 'whisper'))
  const asr = await findFiles(join(output, 'whisper'), 'whisper-cli.exe')
  if (asr.length !== 1) throw new Error('Expected one whisper-cli executable')
  // Read only the Visual Studio Redist directory, never the build machine's
  // System32 DLLs.
  const vswhere = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio/Installer/vswhere.exe')
  const vs = (await capture(vswhere, ['-latest', '-products', '*', '-property', 'installationPath'])).trim()
  if (!vs) throw new Error('Visual Studio redistributable source is unavailable')
  const redistRoot = join(vs, 'VC/Redist/MSVC')
  const versions = (await readdir(redistRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => {
      const left = a.split('.').map(Number)
      const right = b.split('.').map(Number)
      return (right[0] - left[0]) || (right[1] - left[1]) || (right[2] - left[2])
    })
  if (!versions.length) throw new Error('No versioned Visual Studio redistributables')
  const vcVersion = versions[0]
  const vcRoot = join(redistRoot, vcVersion, 'x64')
  const vcOutput = join(output, 'vc-redist')
  await ensureDir(vcOutput)
  const vcFiles = {}
  for (const name of ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll']) {
    const candidates = await findFiles(vcRoot, name)
    if (candidates.length !== 1) throw new Error(`Expected one x64 VS redistributable: ${name}`)
    const fileVersion = await verifyMicrosoftSignature(candidates[0])
    await copyFileTo(candidates[0], join(vcOutput, name))
    vcFiles[name] = { version: fileVersion, sha256: await sha256File(candidates[0]) }
  }
  await prepareDesktopResources({
    outputRoot: product,
    pythonArchive,
    pythonWheelRoot: wheelRoot,
    browserSource: dirname(chromes[0]),
    asrSource: dirname(asr[0]),
    asrModel,
    vcRedistSource: vcOutput,
  })
  const notices = join(fullPath(product), 'r/licenses')
  await ensureDir(notices)
  // Licenses are taken from the engine's immutable version and model revision.
  await download(`https://raw.githubusercontent.com/ggml-org/whisper.cpp/v${catalog.engine.version}/LICENSE`, join(notices, 'LICENSE-whisper.cpp'))
  await download('https://raw.githubusercontent.com/openai/whisper/v20250625/LICENSE', join(notices, 'LICENSE-whisper-model'))
  await writeText(join(notices, 'NATIVE-COMPONENTS.txt'), [
    'Python: python-build-standalone; license files retained inside r/p.',
    'Office wheels: dist-info licenses retained inside r/v/Lib/site-packages.',
    'Chromium: complete official Playwright Chromium payload retained in r/b.',
    `Whisper.cpp ${catalog.engine.version} and Whisper tiny q5_1: MIT, licenses in this directory.`,
    `Microsoft Visual C++ redistributable DLLs: Visual Studio ${vcVersion}, x64 Redist directory, Microsoft Authenticode verified.`,
    'Redistribution list: https://learn.microsoft.com/visualstudio/releases/2022/redistribution',
    'Redistribution terms: https://visualstudio.microsoft.com/license-terms/vs2022-cruntime/',
  ].join('\n'))
  const inputs = {
    schemaVersion: 1,
    node,
    vcRedist: vcFiles,
    browserVersion,
    browserURL,
    browserArchiveSHA256,
    asrSHA256: asrAssets[0].sha256,
    modelSHA256: models[0].sha256,
  }
  await writeJSON(join(output, 'inputs.json'), inputs)
  return inputs
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      product: { type: 'string' },
      output: { type: 'string' },
    },
  })
  if (!values.product || !values.output) throw new Error('Use --product <dir> --output <dir>')
  await prepareWindowsReleaseInputs({ product: values.product, output: values.output })
}
