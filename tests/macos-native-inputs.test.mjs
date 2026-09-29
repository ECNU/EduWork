// The macOS native inputs are prepared once and installed into a product. These
// tests run against synthetic trees: they cover the split contract and the
// speech-catalog agreement, not the downloads and compilers themselves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installMacosReleaseInputs } from '../scripts/prepare-macos-release-inputs.mjs'

const MODEL = {
  id: 'whisper-tiny-q5_1',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny-q5_1.bin',
  sha256: '818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7',
}

/**
 * A node executable that answers the transcription-catalog probe. The install
 * step runs it, so the test must not depend on a real Node build.
 */
async function fakeNode(root, catalog) {
  const path = join(root, 'node')
  await mkdir(path, { recursive: true })
  const executable = join(path, 'bin/node')
  await mkdir(join(path, 'bin'), { recursive: true })
  await writeFile(executable, `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify(catalog)}\nJSON\n`, { mode: 0o755 })
  return executable
}

async function syntheticInputs(root, catalog, { manifestModel = MODEL } = {}) {
  const inputs = join(root, 'inputs')
  await mkdir(join(inputs, 'python/bin'), { recursive: true })
  await writeFile(join(inputs, 'python/bin/python3'), '#!/bin/sh\n')
  await writeFile(join(inputs, 'office-python'), '#!/bin/sh\n')
  await mkdir(join(inputs, 'browser/chrome-mac-arm64'), { recursive: true })
  await writeFile(join(inputs, 'browser/chrome-mac-arm64/Chromium'), 'binary')
  await mkdir(join(inputs, 'speech'), { recursive: true })
  await writeFile(join(inputs, 'speech/whisper-cli'), 'binary')
  await writeFile(join(inputs, 'speech/model.bin'), 'model')
  await mkdir(join(inputs, 'licenses'), { recursive: true })
  await writeFile(join(inputs, 'licenses/LICENSE-OpenSSL'), 'license')
  const node = await fakeNode(join(root, 'runtime'), catalog)
  await writeFile(join(inputs, 'inputs.json'), `${JSON.stringify({
    schemaVersion: 1,
    node,
    openssl: join(root, 'runtime/openssl'),
    platform: 'darwin-arm64',
    browserVersion: '152.0.7977.8',
    browserExecutable: 'Chromium',
    browserExecutableSHA256: 'a'.repeat(64),
    whisperVersion: '1.8.3',
    speechModel: manifestModel,
    nativeLockSHA256: 'b'.repeat(64),
  }, null, 2)}\n`)
  return inputs
}

async function syntheticProduct(root, catalog) {
  const product = join(root, 'product')
  const lib = join(product, 'd/node_modules/@eduwork/dsh-artifact-services/lib')
  await mkdir(lib, { recursive: true })
  await writeFile(join(product, 'assembly.json'), '{}')
  // The probe module is only ever passed to the fake node, which ignores it.
  await writeFile(join(lib, 'transcription-components.js'), 'export const getTranscriptionComponents = () => ({})\n')
  return product
}

const catalogWith = overrides => ({
  engine: { id: 'whisper-cpp', version: overrides.engineVersion },
  models: overrides.models ?? [MODEL],
})

test('install copies the prepared native tree and writes the resource manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-native-install-'))
  try {
    const catalog = catalogWith({ engineVersion: '1.8.3' })
    const inputs = await syntheticInputs(root, catalog)
    const product = await syntheticProduct(root, catalog)

    await installMacosReleaseInputs({ inputs, product })

    assert.equal(await readFile(join(product, 'r/a/model.bin'), 'utf8'), 'model')
    assert.equal(await readFile(join(product, 'r/a/whisper-cli'), 'utf8'), 'binary')
    assert.equal(await readFile(join(product, 'r/b/Chromium'), 'utf8'), 'binary')
    assert.equal(await readFile(join(product, 'r/licenses/LICENSE-OpenSSL'), 'utf8'), 'license')
    const manifest = JSON.parse(await readFile(join(product, 'desktop-resources.json'), 'utf8'))
    assert.equal(manifest.platform, 'darwin-arm64')
    assert.equal(manifest.environment.DSH_MEDIA_BROWSER, 'r/b/Chromium')
    assert.equal(manifest.pluginConfig['eduwork-artifact-services'].transcription.local.modelPath, 'r/a/model.bin')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('install is a re-entry: a second run replaces the resources instead of failing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-native-reentry-'))
  try {
    const catalog = catalogWith({ engineVersion: '1.8.3' })
    const inputs = await syntheticInputs(root, catalog)
    const product = await syntheticProduct(root, catalog)

    await installMacosReleaseInputs({ inputs, product })
    await writeFile(join(product, 'r/a/stale-file'), 'from an earlier product')
    await installMacosReleaseInputs({ inputs, product })

    await assert.rejects(() => readFile(join(product, 'r/a/stale-file')), /ENOENT/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('install refuses a product whose whisper version differs from the lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-native-version-'))
  try {
    const inputs = await syntheticInputs(root, catalogWith({ engineVersion: '1.7.0' }))
    const product = await syntheticProduct(root, catalogWith({ engineVersion: '1.7.0' }))
    await assert.rejects(
      () => installMacosReleaseInputs({ inputs, product }),
      /Whisper source differs from the shared speech protocol version/,
    )
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('install refuses inputs whose pinned model differs from the product catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-native-model-'))
  try {
    // The catalog the product ships is pinned; the prepared input tree claims a
    // different hash for the same model id, which must not be installed.
    const pinned = catalogWith({ engineVersion: '1.8.3' })
    const inputs = await syntheticInputs(root, pinned, { manifestModel: { ...MODEL, sha256: 'c'.repeat(64) } })
    const product = await syntheticProduct(root, pinned)
    await assert.rejects(
      () => installMacosReleaseInputs({ inputs, product }),
      /product transcription model differs from the pinned native input/,
    )
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('install fails loudly when the product has no transcription catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-native-catalog-'))
  try {
    const catalog = catalogWith({ engineVersion: '1.8.3' })
    const inputs = await syntheticInputs(root, catalog)
    const product = join(root, 'empty-product')
    await mkdir(product, { recursive: true })
    await assert.rejects(
      () => installMacosReleaseInputs({ inputs, product }),
      /Transcription catalog is missing/,
    )
  } finally { await rm(root, { recursive: true, force: true }) }
})
