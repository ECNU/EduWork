// Downloads, builds and verifies the locked macOS arm64 native inputs (Node
// runtime, private Python + Office wheels, Chromium, OpenSSL, whisper.cpp) and
// writes the product's native resource manifest. Node.js port of
// prepare-macos-release-inputs.ps1. Requires a macOS arm64 runner.
import { chmod, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  capture, copyFileTo, download, ensureDir, fullPath, isMacOS, isMainModule,
  pathExists, readJSON, run, sha256File, writeJSON, writeText,
} from './lib/build-util.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

export async function prepareMacosReleaseInputs({ product, output } = {}) {
  if (!isMacOS || process.arch !== 'arm64') throw new Error('macOS inputs require an arm64 runner')
  const core = fullPath(join(scriptRoot, '..'))
  output = fullPath(output)
  product = fullPath(product)
  if (await pathExists(output) || await pathExists(join(product, 'r')) || await pathExists(join(product, 'desktop-resources.json'))) {
    throw new Error('Use new input and product resource directories')
  }
  await ensureDir(output)
  const lock = await readJSON(join(core, 'config/macos-native.lock.json'))
  const python = await readJSON(join(core, 'dsh-desktop/internal/productruntime/builtin/python-runtime-manifest.json'))
  const nodeLock = await readJSON(join(core, 'dsh-desktop/internal/productruntime/builtin/node-runtime-manifest.json'))
  if (lock.platform !== 'darwin-arm64' || lock.browser.version !== nodeLock.environment.browserAutomation.browserVersion) {
    throw new Error('macOS native lock does not match the qualified runtime')
  }
  const downloadAsset = async (asset, name) => {
    if (!/^https:\/\//.test(asset.url ?? '') || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? '')) {
      throw new Error('Downloads require HTTPS and a pinned SHA-256')
    }
    const file = join(output, name)
    await download(asset.url, file, { sha256: asset.sha256 })
    return file
  }
  const extract = async (archive, directory) => {
    await ensureDir(directory)
    await run('tar', ['-xf', archive, '-C', directory, '--strip-components', '1'])
  }
  await extract(await downloadAsset(nodeLock.assets['darwin-arm64'], 'node.tar.gz'), join(output, 'node'))
  const node = join(output, 'node/bin/node')
  const resources = join(product, 'r')
  await ensureDir(resources)
  await extract(await downloadAsset(python.assets['darwin-arm64'], 'python.tar.gz'), join(resources, 'p'))
  const pythonExe = join(resources, 'p/bin/python3')
  const wheels = []
  for (const packageEntry of python.environment.packages) {
    const asset = packageEntry.assets['darwin-arm64'] ?? packageEntry.assets.any
    const name = decodeURIComponent(new URL(asset.url).pathname.split('/').at(-1))
    wheels.push(await downloadAsset(asset, name))
  }
  await run(pythonExe, ['-I', '-B', '-m', 'ensurepip', '--upgrade'])
  await run(pythonExe, ['-I', '-B', '-m', 'pip', 'install', '--no-index', '--no-deps', '--no-compile', '--no-cache-dir', '--disable-pip-version-check', ...wheels])
  // Prevent library imports from creating __pycache__ in the signed application.
  await writeText(join(resources, 'office-python'), '#!/bin/sh\nexec "$(dirname "$0")/p/bin/python3" -B "$@"')
  await chmod(join(resources, 'office-python'), 0o755)

  const browserArchive = await downloadAsset(lock.browser, 'chromium.zip')
  await ensureDir(join(output, 'browser'))
  await run('ditto', ['-x', '-k', browserArchive, join(output, 'browser')])
  await rename(join(output, 'browser/chrome-mac-arm64'), join(resources, 'b'))
  const browser = join(resources, `b/${lock.browser.executable}`)
  if (await sha256File(browser) !== lock.browser.executableSHA256) throw new Error('Chromium executable differs from its lock')

  await extract(await downloadAsset(lock.openssl, 'openssl.tar.gz'), join(output, 'openssl-source'))
  const openssl = join(output, 'openssl')
  const buildEnv = { MACOSX_DEPLOYMENT_TARGET: '15.0' }
  const opensslSource = join(output, 'openssl-source')
  await run('perl', ['./Configure', 'darwin64-arm64-cc', `--prefix=${openssl}`, '--libdir=lib', 'no-tests'], { cwd: opensslSource, env: buildEnv })
  await run('make', ['-j3'], { cwd: opensslSource, env: buildEnv })
  await run('make', ['install_sw'], { cwd: opensslSource, env: buildEnv })

  const catalogPath = join(product, 'd/node_modules/@eduwork/dsh-artifact-services/lib/transcription-components.js')
  const catalog = JSON.parse(await capture(node, [
    '--input-type=module', '-e',
    'import {pathToFileURL} from "node:url";const m=await import(pathToFileURL(process.argv[1]));console.log(JSON.stringify(m.getTranscriptionComponents()))',
    catalogPath,
  ]))
  if (catalog.engine.version !== lock.whisper.version) throw new Error('Whisper source differs from the shared speech protocol version')
  const models = catalog.models.filter(model => model.id === 'whisper-tiny-q5_1')
  if (models.length !== 1) throw new Error('Expected one pinned multilingual transcription model')
  await extract(await downloadAsset(lock.whisper, 'whisper.tar.gz'), join(output, 'whisper-source'))
  await run('cmake', [
    '-S', join(output, 'whisper-source'), '-B', join(output, 'whisper-build'),
    '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_OSX_DEPLOYMENT_TARGET=15.0', '-DBUILD_SHARED_LIBS=OFF',
    '-DGGML_METAL=OFF', '-DGGML_BLAS=OFF', '-DGGML_NATIVE=OFF', '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_CURL=OFF',
  ], { env: buildEnv })
  await run('cmake', ['--build', join(output, 'whisper-build'), '--config', 'Release', '--target', 'whisper-cli', '--parallel', '3'], { env: buildEnv })
  await ensureDir(join(resources, 'a'))
  await copyFileTo(join(output, 'whisper-build/bin/whisper-cli'), join(resources, 'a/whisper-cli'))
  await copyFileTo(await downloadAsset(models[0], 'model.bin'), join(resources, 'a/model.bin'))
  await ensureDir(join(resources, 'licenses'))
  await copyFileTo(join(output, 'whisper-source/LICENSE'), join(resources, 'licenses/LICENSE-whisper.cpp'))
  await copyFileTo(join(opensslSource, 'LICENSE.txt'), join(resources, 'licenses/LICENSE-OpenSSL'))
  await download('https://raw.githubusercontent.com/openai/whisper/v20250625/LICENSE', join(resources, 'licenses/LICENSE-whisper-model'))
  await writeJSON(join(product, 'desktop-resources.json'), {
    schemaVersion: 1,
    platform: 'darwin-arm64',
    environment: {
      DSH_OFFICE_PYTHON: 'r/office-python',
      DSH_MEDIA_BROWSER: `r/b/${lock.browser.executable}`,
      DSH_MEDIA_NODE_ENV: 'd',
    },
    browser: { version: lock.browser.version, executableSHA256: lock.browser.executableSHA256 },
    pluginConfig: {
      'eduwork-artifact-services': {
        transcription: { local: { executablePath: 'r/a/whisper-cli', modelPath: 'r/a/model.bin' } },
      },
    },
  })
  const inputs = {
    schemaVersion: 1,
    node,
    openssl,
    platform: 'darwin-arm64',
    nativeLockSHA256: await sha256File(join(core, 'config/macos-native.lock.json')),
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
  await prepareMacosReleaseInputs({ product: values.product, output: values.output })
}
