import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { publisherBootstrap, preparePublisherContent } from '../publisher-bootstrap.mjs'
import { ContentUpdates } from '../content-updates.mjs'
import { digest } from '../content-update-protocol.mjs'
import { loadUserConfig } from '../user-config.mjs'
import { desktopPaths } from '../../dsh-electron/src/desktop-paths.mjs'

const version = '0.3.6-dev.20260917.1'
const save = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)) }
async function fixture(t, platform = 'win32') {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-bootstrap-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const paths = desktopPaths({ appRoot: join(root, platform === 'darwin' ? 'EduWork.app/Contents/Resources/app' : 'application/resources/app'),
    platform, appData: join(root, 'Application Support'), settings: { distribution: 'example', productVersion: version,
      configurationOwnership: 'publisher', ...(platform === 'darwin' ? { publisherConfig: '../product/resources/desktop/eduwork.jsonc' } : {}), product: '../product', node: '../runtime/node' } })
  const keys = generateKeyPairSync('ed25519')
  const source = { publisher: 'example', baseURL: 'https://updates.example.test/content', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), configuration: true, skills: false }
  const descriptor = { schemaVersion: 1, updates: { provider: 'github', repository: 'example/desktop' }, contentUpdates: source }
  const descriptorPath = join(paths.product, 'resources/desktop/publisher-bootstrap.json')
  const seedPath = join(paths.product, 'resources/desktop/eduwork.jsonc')
  await save(descriptorPath, descriptor)
  await save(seedPath, { schemaVersion: 1, product: { name: 'Example' }, organizations: [], features: { maxConcurrentRequests: 3 } })
  const options = { ownership: 'publisher', product: paths.product, distribution: 'example', version, configPath: paths.config, dataRoot: paths.updateDataRoot }
  const responses = new Map(), requests = []
  const fetchImpl = async url => { requests.push(url); return new Response(responses.get(url) ?? '', { status: responses.has(url) ? 200 : 503 }) }
  const open = async () => {
    const bootstrap = await publisherBootstrap(options)
    const manager = await new ContentUpdates({ ...options, root: paths.root, configPath: bootstrap.configPath,
      identity: { dshVersion: '0.1.5-rc.2' }, policy: 'development', fetchImpl }).init()
    // Exercise platform compatibility independently of the test host OS.
    manager.environment.platform = platform
    return { bootstrap, manager }
  }
  const release = (revision = 1, changes = {}) => {
    const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, configuration: { organizations: [{ id: 'example', title: 'Example school' }], features: { maxConcurrentRequests: 2 } } }))
    const manifest = { schemaVersion: 1, publisher: source.publisher, channel: 'development', revision,
      requires: { minClient: version, capabilities: [], platforms: ['win32', 'darwin'] }, components: { configuration: revision },
      bundle: { url: `${source.baseURL}/bundles/${revision}.json`, bytes: bytes.length, sha256: digest(bytes) }, ...changes }
    const payload = Buffer.from(JSON.stringify(manifest))
    const envelope = { schemaVersion: 1, payload: payload.toString('base64url'), signature: sign(null, payload, keys.privateKey).toString('base64url') }
    responses.set(source.baseURL + '/' + manifest.channel + '/latest.json', JSON.stringify(envelope))
    responses.set(manifest.bundle.url, bytes)
    return { manifest, envelope, bytes, offline: Buffer.from(JSON.stringify({ schemaVersion: 1, manifest: envelope, bundle: bytes.toString('base64') })) }
  }
  return { root, paths, options, descriptor, descriptorPath, seedPath, open, release, responses, requests }
}
async function snapshot(folder) {
  const entries = []
  for (const item of await readdir(folder, { withFileTypes: true })) entries.push([item.name, item.isDirectory() ? await snapshot(join(folder, item.name)) : digest(await readFile(join(folder, item.name)))])
  return entries
}

for (const platform of ['win32', 'darwin']) test(`${platform}: clean install downloads once, commits after ready and starts offline across app versions`, async t => {
  const f = await fixture(t, platform), bundleBefore = await snapshot(f.paths.product)
  f.release()
  let { bootstrap, manager } = await f.open()
  assert.equal(bootstrap.hasBaseline, false)
  const prepared = await preparePublisherContent(manager, bootstrap)
  assert.equal(prepared.configurationRevision, 1)
  assert.equal(loadUserConfig(bootstrap.configPath, { overlay: prepared.configurationPatch }).features.maxConcurrentRequests, 2)
  assert.deepEqual(manager.state.active, {})
  await manager.ready()
  const configPath = bootstrap.configPath
  f.responses.clear(); f.requests.length = 0
  f.options.version = '0.3.7'
  ;({ bootstrap, manager } = await f.open())
  assert.equal(bootstrap.configPath, configPath)
  assert.equal((await preparePublisherContent(manager, bootstrap)).configurationRevision, 1)
  assert.equal(f.requests.length, 0)
  assert.deepEqual(await snapshot(f.paths.product), bundleBefore)
  if (platform === 'darwin') assert.equal(configPath.startsWith(f.paths.root), false)
})

test('network failure leaves a retryable first-run state; signed offline import uses the same journal', async t => {
  const f = await fixture(t), { bootstrap, manager } = await f.open()
  await assert.rejects(preparePublisherContent(manager, bootstrap), { code: 'EDUWORK_BOOTSTRAP_REQUIRED' })
  assert.equal(manager.state.pending, null)
  const release = f.release()
  f.responses.clear(); f.requests.length = 0
  await manager.importOffline(release.offline)
  const next = await f.open()
  assert.equal((await preparePublisherContent(next.manager, next.bootstrap)).configurationRevision, 1)
  assert.equal(f.requests.length, 0)
  await next.manager.ready()
  await assert.rejects(next.manager.importOffline(release.offline), /修订号/)
})

test('wrong signer, corrupt bytes, wrong channel and platform incompatibility cannot initialize an installation', async t => {
  const f = await fixture(t), { bootstrap, manager } = await f.open()
  const release = f.release()
  const tampered = JSON.parse(release.offline)
  tampered.manifest.signature = Buffer.alloc(64).toString('base64url')
  await assert.rejects(manager.importOffline(Buffer.from(JSON.stringify(tampered))), /签名/)
  f.responses.set(release.manifest.bundle.url, Buffer.alloc(release.bytes.length))
  await assert.rejects(preparePublisherContent(manager, bootstrap), { code: 'EDUWORK_BOOTSTRAP_REQUIRED' })
  await assert.rejects(manager.importOffline(f.release(2, { channel: 'stable' }).offline), /身份/)
  await assert.rejects(manager.importOffline(f.release(3, { requires: { minClient: version, capabilities: [], platforms: ['linux'] } }).offline), /操作系统/)
  assert.equal(manager.state.pending, null)
  f.release(4)
  assert.equal((await preparePublisherContent(manager, bootstrap)).configurationRevision, 4)
})

test('legacy publisher config migrates locally without overwriting it or importing future versions and feed overrides', async t => {
  const f = await fixture(t), folder = dirname(f.paths.config)
  const old = join(folder, 'eduwork.0.3.6-dev.20260916.1.jsonc'), future = join(folder, 'eduwork.9.0.0.jsonc')
  await save(old, { schemaVersion: 1, organizations: [{ id: 'old-school' }], updates: { provider: 'disabled' }, desktop: { closeAction: 'exit' }, features: { visionFallback: true } })
  const before = await readFile(old, 'utf8')
  await save(future, { schemaVersion: 1, organizations: [{ id: 'future-school' }] })
  await save(f.paths.config, { schemaVersion: 1, organizations: [] })
  const { bootstrap, manager } = await f.open()
  assert.equal(bootstrap.migratedFrom, old)
  assert.equal(bootstrap.hasBaseline, true)
  await preparePublisherContent(manager, bootstrap)
  assert.equal(f.requests.length, 0)
  const effective = loadUserConfig(bootstrap.configPath)
  assert.equal(effective.organizations[0].id, 'old-school')
  assert.equal(effective.closeAction, 'exit')
  assert.equal(effective.updates.provider, 'github')
  assert.equal(effective.features.visionFallback, true)
  assert.equal(await readFile(old, 'utf8'), before)
  f.release()
  await manager.check(); await manager.download()
  const next = await f.open()
  assert.equal((await preparePublisherContent(next.manager, next.bootstrap)).configurationPatch.organizations[0].id, 'example')
  await next.manager.rollback()
  const fallback = await f.open()
  assert.deepEqual(await preparePublisherContent(fallback.manager, fallback.bootstrap), {})
})

test('failed first trial does not loop or accept the rejected signed revision', async t => {
  const f = await fixture(t), release = f.release()
  const first = await f.open(); await preparePublisherContent(first.manager, first.bootstrap)
  // No desktopReady: interrupted process must not trust its pending trial.
  const next = await f.open()
  await assert.rejects(preparePublisherContent(next.manager, next.bootstrap), { code: 'EDUWORK_BOOTSTRAP_REQUIRED' })
  await assert.rejects(next.manager.importOffline(release.offline), /未通过启动检查/)
  f.release(2)
  assert.equal((await preparePublisherContent(next.manager, next.bootstrap)).configurationRevision, 2)
})

test('generic edition never reads the publisher feed; packaged trust overrides cache changes', async t => {
  const f = await fixture(t)
  assert.equal(await publisherBootstrap({ ...f.options, ownership: 'user' }), null)
  assert.equal(f.requests.length, 0)
  const first = await f.open()
  await save(first.bootstrap.configPath, { schemaVersion: 1, organizations: [], updates: { provider: 'disabled' }, contentUpdates: { ...f.descriptor.contentUpdates, baseURL: 'https://other.example.test/content' } })
  const next = await f.open(), effective = loadUserConfig(next.bootstrap.configPath)
  assert.equal(effective.contentUpdates.baseURL, f.descriptor.contentUpdates.baseURL)
  assert.equal(effective.updates.provider, 'github')
})

test('damaged committed configuration can redownload identical signed bytes without allowing rollback', async t => {
  const f = await fixture(t)
  f.release()
  const first = await f.open(); await preparePublisherContent(first.manager, first.bootstrap); await first.manager.ready()
  const key = first.manager.state.active.configuration
  await writeFile(join(first.manager.store, key, 'bundle.json'), 'broken cache')
  const next = await f.open()
  assert.equal((await preparePublisherContent(next.manager, next.bootstrap)).configurationRevision, 1)
  await next.manager.ready()
  // Same revision number but a different signed identity is still rejected.
  const wrong = f.release(1, { components: { configuration: 2 } })
  await assert.rejects(next.manager.importOffline(wrong.offline), /修订号/)
})

test('damaged bootstrap JSON is preserved and valid signed content still starts offline', async t => {
  const f = await fixture(t)
  f.release()
  const first = await f.open()
  await preparePublisherContent(first.manager, first.bootstrap); await first.manager.ready()
  await writeFile(first.bootstrap.configPath, '{partial')
  f.responses.clear(); f.requests.length = 0
  const next = await f.open()
  assert.equal((await preparePublisherContent(next.manager, next.bootstrap)).configurationRevision, 1)
  assert.equal(f.requests.length, 0)
  const folder = dirname(first.bootstrap.configPath)
  const backup = (await readdir(folder)).find(name => name.startsWith('eduwork.jsonc.invalid-'))
  assert.ok(backup)
  assert.equal(await readFile(join(folder, backup), 'utf8'), '{partial')
})
