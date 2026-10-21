import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { brotliCompressSync } from 'node:zlib'
import { assertPinnedNodeVersion, assertPreparedNode, pinnedNodeVersion } from '../scripts/lib/node-runtime-contract.mjs'
import { assembleWindows } from '../dsh-electron/scripts/assemble-windows.mjs'
import { releaseIdentity } from '../dsh-host/release-policy.mjs'
import { macosStages } from '../scripts/lib/macos-stages.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifestPath = 'dsh-desktop/internal/productruntime/builtin/node-runtime-manifest.json'
const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'))

test('active downloads, source contract and CI use the same Node security release', async () => {
  const manifest = await json(manifestPath)
  assert.equal(manifest.nodeVersion, '24.22.1')
  assert.equal(manifest.runtimeId, `node-${manifest.nodeVersion}`)
  const recipe = await json('config/desktop-build.json')
  const lock = await json(recipe.sourceLock)
  assert.equal(lock.node.version, manifest.nodeVersion)
  assert.equal(lock.node.windowsX64URL, manifest.assets['windows-amd64'].url)
  assert.equal(lock.node.windowsX64SHA256, manifest.assets['windows-amd64'].sha256)
  for (const asset of Object.values(manifest.assets)) {
    const url = new URL(asset.url)
    assert.equal(url.origin, 'https://nodejs.org')
    assert.ok(url.pathname.startsWith(`/dist/v${manifest.nodeVersion}/node-v${manifest.nodeVersion}-`))
    assert.ok(url.pathname.split('/').at(-1).startsWith(asset.archiveRoot))
    assert.match(asset.sha256, /^[a-f0-9]{64}$/)
  }
  let jobs = 0
  for (const path of await readdir(join(root, '.github/workflows'))) {
    const text = await readFile(join(root, '.github/workflows', path), 'utf8')
    for (const match of text.matchAll(/node-version:\s*['"]([^'"]+)['"]/g)) {
      jobs++
      assert.equal(match[1], manifest.nodeVersion, `${path} uses a different build Node`)
    }
  }
  assert.ok(jobs > 0)
})

test('matching old receipts cannot authorize a vulnerable packaged Node', () => {
  assertPinnedNodeVersion(pinnedNodeVersion)
  assertPreparedNode(pinnedNodeVersion, pinnedNodeVersion)
  assert.throws(() => assertPreparedNode('v24.18.0', 'v24.18.0'), /must use pinned/)
  assert.throws(() => assertPreparedNode(pinnedNodeVersion, 'v24.18.0'), /rebuild the Host/)
  assert.throws(() => assertPinnedNodeVersion('v26.12.1'), /must use pinned/)
})

test('Windows assembler refuses a stale Host receipt before creating a package', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'eduwork-node-contract-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const product = join(temporary, 'product'), shell = join(temporary, 'shell'), electron = join(temporary, 'electron'), output = join(temporary, 'output')
  const save = async (path, value) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, value) }
  const version = '0.4.6-dev.20261021.1', dshVersion = '0.2.1-rc.2', dshCommit = 'a'.repeat(40)
  await save(join(product, 'assembly.json'), JSON.stringify({ version, dshVersion, dshCommit }))
  const { badge } = releaseIdentity(version, dshVersion)
  await save(join(product, 'd/node_modules/@chatecnu-work/dsh-client-ui-conversation-brand/lib/client.js'),
    JSON.stringify({ 'hero.preview': badge.zh }) + '\n' + JSON.stringify({ 'hero.preview': badge.en }))
  await save(join(shell, 'source-receipt.json'), JSON.stringify({ dshCommit, host: { nodeVersion: 'v24.18.0' } }))
  await save(join(electron, 'electron.exe'), 'synthetic file; must never be run or copied')
  await assert.rejects(assembleWindows({ product, shellBuild: shell, electronRuntime: electron, output, version }), /rebuild the Host|must use pinned/)
  await assert.rejects(access(output), { code: 'ENOENT' })
})

test('macOS native-input checkpoints change when only the Node pin changes', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'eduwork-node-cache-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const save = async (path, text) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text) }
  await save(join(temporary, 'config/macos-native.lock.json'), '{}')
  const lock = join(temporary, manifestPath)
  await save(lock, '{"nodeVersion":"24.18.0"}')
  const stage = macosStages({ coreRoot: temporary, version: '0.4.6' }).find(stage => stage.name === 'native-inputs')
  const before = await stage.definition.inputs({})
  await save(lock, '{"nodeVersion":"24.22.1"}')
  assert.notDeepEqual(await stage.definition.inputs({}), before)
})

test('pinned Node fetch decodes valid Brotli responses and rejects invalid compressed input', async t => {
  assertPinnedNodeVersion()
  const server = createServer((request, response) => {
    response.setHeader('Content-Encoding', 'br')
    response.end(request.url === '/invalid' ? Buffer.from('not a Brotli stream') : brotliCompressSync('synthetic fetched content'))
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  const origin = `http://127.0.0.1:${server.address().port}`
  assert.equal(await (await fetch(origin)).text(), 'synthetic fetched content')
  await assert.rejects((await fetch(`${origin}/invalid`)).text())
  assert.equal(await (await fetch(origin)).text(), 'synthetic fetched content')
})

test('official DSH web-fetch provider reads Brotli using the upgraded Node', { skip: !process.env.EDUWORK_TEST_RUNTIME }, async t => {
  assertPinnedNodeVersion()
  const require = createRequire(join(process.env.EDUWORK_TEST_RUNTIME, 'package.json'))
  const { HttpFetchProvider } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-web-fetch-http')))
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    response.setHeader('Content-Encoding', 'br')
    response.end(request.url === '/invalid' ? Buffer.from('invalid compressed text') : brotliCompressSync('synthetic DSH page'))
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  // The official resolver injection is a test seam: pin only this synthetic
  // hostname to our loopback fixture; production public-address policy is unchanged.
  const provider = new HttpFetchProvider({ maxResponseBytes: 10000, maxBodyChars: 10000, timeoutMs: 5000, maxRedirects: 1, userAgent: 'eduwork-synthetic-test' },
    async hostname => { assert.equal(hostname, 'eduwork-node.test'); return [{ address: '127.0.0.1', family: 4 }] })
  const origin = `http://eduwork-node.test:${server.address().port}`
  const fetched = await provider.fetch({ url: origin })
  assert.equal(fetched.statusCode, 200)
  assert.equal(fetched.body.content, 'synthetic DSH page')
  await assert.rejects(provider.fetch({ url: `${origin}/invalid` }))
  assert.equal((await provider.fetch({ url: origin })).body.content, 'synthetic DSH page')
})
