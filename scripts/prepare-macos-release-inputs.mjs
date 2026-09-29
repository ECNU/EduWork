// Downloads, builds and verifies the locked macOS arm64 native inputs (Node
// runtime, private Python + Office wheels, Chromium, OpenSSL, whisper.cpp), then
// installs them into the product's native resource directory. Node.js port of
// prepare-macos-release-inputs.ps1. Requires a macOS arm64 runner.
//
// The work is split so the expensive half can be cached: `prepare` builds a
// self-contained native input tree whose only input is the native lock, and
// `install` copies that tree into a product. A product change therefore does not
// rebuild OpenSSL or whisper.cpp.
//
// One speech check cannot live in `prepare`: the pinned model comes from the
// product's own transcription catalog, which only exists once a product is
// installed. `install` compares the lock against that catalog instead, keeping
// `prepare` independent of any product.
import { chmod, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  capture, copyFileTo, copyTree, download, ensureDir, fullPath, isMacOS, isMainModule,
  pathExists, readJSON, run, sha256File, writeJSON, writeText,
} from './lib/build-util.mjs'
import { cachedCompile, compileKey } from './lib/native-compile-cache.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

// The one multilingual model the speech component ships. Both the URL and the
// hash are pinned: the hash is the integrity check, the url+id are what the
// product catalog is verified against at install time.
const SPEECH_MODEL = {
  id: 'whisper-tiny-q5_1',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny-q5_1.bin',
  sha256: '818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7',
}
const speechModelLock = () => ({ ...SPEECH_MODEL })

/** Read the pinned transcription catalog out of an installed product tree. */
async function readSpeechCatalog(node, product) {
  const catalogPath = join(product, 'd/node_modules/@eduwork/dsh-artifact-services/lib/transcription-components.js')
  if (!await pathExists(catalogPath)) throw new Error(`Transcription catalog is missing: ${catalogPath}`)
  return JSON.parse(await capture(node, [
    '--input-type=module', '-e',
    'import {pathToFileURL} from "node:url";const m=await import(pathToFileURL(process.argv[1]));console.log(JSON.stringify(m.getTranscriptionComponents()))',
    catalogPath,
  ]))
}

/**
 * Build the native input tree. Reads only `config/macos-native.lock.json` and
 * the pinned runtime manifests, so its result is reusable across products.
 */
export async function prepareMacosReleaseInputs({ output } = {}) {
  if (!isMacOS || process.arch !== 'arm64') throw new Error('macOS inputs require an arm64 runner')
  const core = fullPath(join(scriptRoot, '..'))
  output = fullPath(output)
  if (await pathExists(output)) throw new Error('Use a new native input directory')
  await ensureDir(output)
  const lock = await readJSON(join(core, 'config/macos-native.lock.json'))
  const python = await readJSON(join(core, 'dsh-desktop/internal/productruntime/builtin/python-runtime-manifest.json'))
  const nodeLock = await readJSON(join(core, 'dsh-desktop/internal/productruntime/builtin/node-runtime-manifest.json'))
  if (lock.platform !== 'darwin-arm64' || lock.browser.version !== nodeLock.environment.browserAutomation.browserVersion) {
    throw new Error('macOS native lock does not match the qualified runtime')
  }
  const downloadAsset = async (asset, name, directory = output) => {
    if (!/^https:\/\//.test(asset.url ?? '') || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? '')) {
      throw new Error('Downloads require HTTPS and a pinned SHA-256')
    }
    const file = join(directory, name)
    await ensureDir(directory)
    await download(asset.url, file, { sha256: asset.sha256 })
    return file
  }
  const extract = async (archive, directory) => {
    await ensureDir(directory)
    await run('tar', ['-xf', archive, '-C', directory, '--strip-components', '1'])
  }

  await extract(await downloadAsset(nodeLock.assets['darwin-arm64'], 'node.tar.gz'), join(output, 'node'))
  const node = join(output, 'node/bin/node')

  const pythonRoot = join(output, 'python')
  await extract(await downloadAsset(python.assets['darwin-arm64'], 'python.tar.gz'), pythonRoot)
  const pythonExe = join(pythonRoot, 'bin/python3')
  const wheels = []
  for (const packageEntry of python.environment.packages) {
    const asset = packageEntry.assets['darwin-arm64'] ?? packageEntry.assets.any
    const name = decodeURIComponent(new URL(asset.url).pathname.split('/').at(-1))
    wheels.push(await downloadAsset(asset, name, join(output, 'wheels')))
  }
  await run(pythonExe, ['-I', '-B', '-m', 'ensurepip', '--upgrade'])
  await run(pythonExe, ['-I', '-B', '-m', 'pip', 'install', '--no-index', '--no-deps', '--no-compile', '--no-cache-dir', '--disable-pip-version-check', ...wheels])
  // Prevent library imports from creating __pycache__ in the signed application.
  await writeText(join(output, 'office-python'), '#!/bin/sh\nexec "$(dirname "$0")/p/bin/python3" -B "$@"')
  await chmod(join(output, 'office-python'), 0o755)

  const browserArchive = await downloadAsset(lock.browser, 'chromium.zip')
  const browserRoot = join(output, 'browser')
  await ensureDir(browserRoot)
  await run('ditto', ['-x', '-k', browserArchive, browserRoot])
  const browser = join(browserRoot, 'chrome-mac-arm64', lock.browser.executable)
  if (await sha256File(browser) !== lock.browser.executableSHA256) throw new Error('Chromium executable differs from its lock')

  await extract(await downloadAsset(lock.openssl, 'openssl.tar.gz'), join(output, 'openssl-source'))
  const openssl = join(output, 'openssl')
  const buildEnv = { MACOSX_DEPLOYMENT_TARGET: '15.0' }
  const opensslSource = join(output, 'openssl-source')
  // The compile layers are cached by source + patch + target + tool versions, so
  // an unchanged OpenSSL or whisper.cpp is not rebuilt. Each entry is re-hashed
  // against its manifest on restore.
  await cachedCompile({
    key: await compileKey({
      name: 'openssl-darwin64-arm64',
      parts: { source: lock.openssl.sha256, target: 'darwin64-arm64-cc', prefix: 'no-tests' },
      tools: { perl: ['-v'], make: ['--version'], cc: ['--version'] },
    }),
    outputs: { openssl },
    label: `openssl ${lock.openssl.version}`,
    build: async (name, destination) => {
      await run('perl', ['./Configure', 'darwin64-arm64-cc', `--prefix=${destination}`, '--libdir=lib', 'no-tests'], { cwd: opensslSource, env: buildEnv })
      await run('make', ['-j3'], { cwd: opensslSource, env: buildEnv })
      await run('make', ['install_sw'], { cwd: opensslSource, env: buildEnv })
    },
  })

  await extract(await downloadAsset(lock.whisper, 'whisper.tar.gz'), join(output, 'whisper-source'))
  await cachedCompile({
    key: await compileKey({
      name: 'whisper-cli-darwin-arm64',
      parts: { source: lock.whisper.sha256, deploymentTarget: '15.0', shared: 'OFF', metal: 'OFF', blas: 'OFF', native: 'OFF' },
      tools: { cmake: ['--version'], cc: ['--version'] },
    }),
    outputs: { 'whisper-cli': join(output, 'speech/whisper-cli') },
    label: `whisper.cpp ${lock.whisper.version}`,
    build: async (name, destination) => {
      await run('cmake', [
        '-S', join(output, 'whisper-source'), '-B', join(output, 'whisper-build'),
        '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_OSX_DEPLOYMENT_TARGET=15.0', '-DBUILD_SHARED_LIBS=OFF',
        '-DGGML_METAL=OFF', '-DGGML_BLAS=OFF', '-DGGML_NATIVE=OFF', '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_CURL=OFF',
      ], { env: buildEnv })
      await run('cmake', ['--build', join(output, 'whisper-build'), '--config', 'Release', '--target', 'whisper-cli', '--parallel', '3'], { env: buildEnv })
      await ensureDir(dirname(destination))
      await copyFileTo(join(output, 'whisper-build/bin/whisper-cli'), destination)
    },
  })
  // The model is pinned here rather than read from a product, so this tree stays
  // reusable; `install` checks the same id against the product's catalog.
  const model = speechModelLock()
  await download(model.url, join(output, 'speech/model.bin'), { sha256: model.sha256 })
  await ensureDir(join(output, 'licenses'))
  await copyFileTo(join(output, 'whisper-source/LICENSE'), join(output, 'licenses/LICENSE-whisper.cpp'))
  await copyFileTo(join(opensslSource, 'LICENSE.txt'), join(output, 'licenses/LICENSE-OpenSSL'))
  await download('https://raw.githubusercontent.com/openai/whisper/v20250625/LICENSE', join(output, 'licenses/LICENSE-whisper-model'))

  const inputs = {
    schemaVersion: 1,
    node,
    openssl,
    platform: 'darwin-arm64',
    browserVersion: lock.browser.version,
    browserExecutable: lock.browser.executable,
    browserExecutableSHA256: lock.browser.executableSHA256,
    whisperVersion: lock.whisper.version,
    speechModel: model,
    nativeLockSHA256: await sha256File(join(core, 'config/macos-native.lock.json')),
  }
  await writeJSON(join(output, 'inputs.json'), inputs)
  return inputs
}

/**
 * Install a prepared native input tree into a product and verify the pinned
 * speech component against it. The caller owns the destination paths, so a
 * re-entry replaces them instead of refusing to run.
 */
export async function installMacosReleaseInputs({ inputs, product } = {}) {
  product = fullPath(product)
  inputs = fullPath(inputs)
  const manifest = await readJSON(join(inputs, 'inputs.json'))
  // `node` is recorded as an absolute path inside the prepared tree.
  const node = manifest.node
  if (!node) throw new Error(`Native inputs record no node runtime: ${inputs}`)
  const catalog = await readSpeechCatalog(node, product)
  if (catalog.engine.version !== manifest.whisperVersion) {
    throw new Error('Whisper source differs from the shared speech protocol version')
  }
  const models = catalog.models.filter(model => model.id === manifest.speechModel.id)
  if (models.length !== 1) throw new Error('Expected one pinned multilingual transcription model')
  const model = models[0]
  if (model.url !== manifest.speechModel.url || model.sha256 !== manifest.speechModel.sha256) {
    throw new Error('The product transcription model differs from the pinned native input')
  }

  const resources = join(product, 'r')
  // The product tree is only ever appended to by one stage at a time, so
  // replacing the resource directories is a re-entry, not a conflict.
  await rm(resources, { recursive: true, force: true })
  await rm(join(product, 'desktop-resources.json'), { force: true })
  await ensureDir(resources)
  await copyTree(join(inputs, 'python'), join(resources, 'p'))
  await copyFileTo(join(inputs, 'office-python'), join(resources, 'office-python'))
  await chmod(join(resources, 'office-python'), 0o755)
  await copyTree(join(inputs, 'browser/chrome-mac-arm64'), join(resources, 'b'))
  await copyFileTo(join(inputs, 'speech/whisper-cli'), join(resources, 'a/whisper-cli'))
  await copyFileTo(join(inputs, 'speech/model.bin'), join(resources, 'a/model.bin'))
  await copyTree(join(inputs, 'licenses'), join(resources, 'licenses'))
  await writeJSON(join(product, 'desktop-resources.json'), {
    schemaVersion: 1,
    platform: 'darwin-arm64',
    environment: {
      DSH_OFFICE_PYTHON: 'r/office-python',
      DSH_MEDIA_BROWSER: `r/b/${manifest.browserExecutable}`,
      DSH_MEDIA_NODE_ENV: 'd',
    },
    browser: { version: manifest.browserVersion, executableSHA256: manifest.browserExecutableSHA256 },
    pluginConfig: {
      'eduwork-artifact-services': {
        transcription: { local: { executablePath: 'r/a/whisper-cli', modelPath: 'r/a/model.bin' } },
      },
    },
  })
  return manifest
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      product: { type: 'string' },
      input: { type: 'string' },
      output: { type: 'string' },
    },
  })
  if (values.output) {
    await prepareMacosReleaseInputs({ output: values.output })
  } else if (values.product && values.input) {
    if (!await pathExists(join(fullPath(values.product), 'assembly.json'))) throw new Error('Product tree is not prepared')
    await installMacosReleaseInputs({ inputs: values.input, product: values.product })
  } else {
    throw new Error('Use --output <new native input dir>, or --product <dir> --input <native input dir>')
  }
}
