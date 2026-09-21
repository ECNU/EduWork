import { readConfiguration } from '../configuration-file.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { publisherBootstrap, preparePublisherContent, readPublisherBootstrap } from '../publisher-bootstrap.mjs'
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
  const release = (revision = 1, changes = {}, configuration = { organizations: [{ id: 'example', title: 'Example school' }], features: { maxConcurrentRequests: 2 } }) => {
    const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, configuration }))
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

test('platform descriptors isolate update sources and invalid overrides never fall back', async t => {
  const f = await fixture(t)
  const mac = { ...f.descriptor, contentUpdates: { ...f.descriptor.contentUpdates, baseURL: 'https://updates.example.test/macos' } }
  const override = join(dirname(f.descriptorPath), 'publisher-bootstrap.darwin.json')
  await save(override, mac)
  const win = await readPublisherBootstrap({ ...f.options, platform: 'win32' })
  const darwin = await readPublisherBootstrap({ ...f.options, platform: 'darwin' })
  assert.equal(win.contentUpdates.baseURL, f.descriptor.contentUpdates.baseURL)
  assert.equal(darwin.contentUpdates.baseURL, mac.contentUpdates.baseURL)
  assert.equal(await readPublisherBootstrap({ ...f.options, ownership: 'user', platform: 'darwin' }), null)
  await save(override, { ...mac, organizations: [{ id: 'forbidden' }] })
  await assert.rejects(readPublisherBootstrap({ ...f.options, platform: 'darwin' }), /只能包含更新渠道/)
  await assert.rejects(readPublisherBootstrap({ ...f.options, platform: '../outside' }), /不支持/)
})

for (const platform of ['win32', 'darwin']) test(`${platform}: clean install downloads once, commits after ready and starts offline across app versions`, async t => {
  const f = await fixture(t, platform), bundleBefore = await snapshot(f.paths.product)
  f.release()
  let { bootstrap, manager } = await f.open()
  assert.equal(bootstrap.hasBaseline, false)
  const prepared = await preparePublisherContent(manager, bootstrap)
  assert.equal(prepared.configurationRevision, 1)
  assert.equal(prepared.configurationPatch,undefined)
  assert.equal(loadUserConfig(bootstrap.configPath).features.maxConcurrentRequests, 2)
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
  await save(old, { schemaVersion: 1, organizations: [{ id: 'example' }], updates: { provider: 'disabled' }, desktop: { closeAction: 'exit' }, features: { visionFallback: true } })
  const before = await readFile(old, 'utf8')
  await save(future, { schemaVersion: 1, organizations: [{ id: 'future-school' }] })
  await save(f.paths.config, { schemaVersion: 1, organizations: [] })
  const { bootstrap, manager } = await f.open()
  assert.equal(bootstrap.migratedFrom, old)
  assert.equal(bootstrap.hasBaseline, true)
  await preparePublisherContent(manager, bootstrap)
  assert.equal(f.requests.length, 0)
  const effective = loadUserConfig(bootstrap.configPath)
  assert.equal(effective.organizations[0].id, 'example')
  assert.equal(effective.closeAction, 'exit')
  assert.equal(effective.updates.provider, 'github')
  assert.equal(effective.features.visionFallback, true)
  assert.equal(await readFile(old, 'utf8'), before)
  f.release()
  await manager.check(); await manager.download()
  const next = await f.open()
  await preparePublisherContent(next.manager, next.bootstrap)
  assert.equal(loadUserConfig(next.bootstrap.configPath).organizations[0].id, 'example')
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

test('generic edition never reads the publisher feed; local source and update preferences override bootstrap defaults', async t => {
  const f = await fixture(t)
  assert.equal(await publisherBootstrap({ ...f.options, ownership: 'user' }), null)
  assert.equal(f.requests.length, 0)
  const first = await f.open()
  await save(first.bootstrap.configPath, { schemaVersion: 1, organizations: [], updates: { provider: 'disabled' }, contentUpdates: { ...f.descriptor.contentUpdates, baseURL: 'https://other.example.test/content' } })
  const next = await f.open(), effective = loadUserConfig(next.bootstrap.configPath)
  assert.equal(effective.contentUpdates.baseURL, 'https://other.example.test/content')
  assert.equal(effective.updates.provider, 'disabled')
})

test('damaged download cache does not change the local config and can be repaired without allowing rollback', async t => {
  const f = await fixture(t)
  f.release()
  const first = await f.open(); await preparePublisherContent(first.manager, first.bootstrap); await first.manager.ready()
  const key = first.manager.state.active.configuration
  await writeFile(join(first.manager.store, key, 'bundle.json'), 'broken cache')
  const next = await f.open()
  assert.equal((await preparePublisherContent(next.manager, next.bootstrap)).configurationRevision, 1)
  assert.equal(loadUserConfig(next.bootstrap.configPath).organizations[0].id, 'example')
  await next.manager.check({repair:true});await next.manager.download()
  assert.equal(next.manager.snapshot().state,'ready')
  await next.manager.prepare()
  await next.manager.ready()
  // Same revision number but a different signed identity is still rejected.
  const wrong = f.release(1, { components: { configuration: 2 } })
  await assert.rejects(next.manager.importOffline(wrong.offline), /修订号/)
})

test('a syntax error in the editable config is reported without overwriting it or creating more backups', async t => {
  const f = await fixture(t)
  f.release()
  const first = await f.open()
  await preparePublisherContent(first.manager, first.bootstrap); await first.manager.ready()
  await writeFile(first.bootstrap.configPath, '{partial')
  f.responses.clear(); f.requests.length = 0
  const backupBefore=await readFile(first.manager.configurationFile.backup,'utf8')
  await assert.rejects(f.open(),/JSONC 格式错误/)
  assert.equal(f.requests.length, 0)
  assert.equal(await readFile(first.bootstrap.configPath, 'utf8'), '{partial')
  assert.equal(await readFile(first.manager.configurationFile.backup,'utf8'),backupBefore)
  assert.deepEqual((await readdir(dirname(first.manager.configurationFile.backup))).filter(name=>name.endsWith('.jsonc')),['eduwork.previous.jsonc'])
})

test('upgrade from the old layered layout materializes the signed effective config once and retires only unchanged obsolete files after ready',async t=>{
  const f=await fixture(t),item=f.release(),source=f.descriptor.contentUpdates
  const scope=digest(JSON.stringify(['example',source.publisher,source.baseURL,source.publicKey]))
  const oldCache=join(f.paths.updateDataRoot,'publisher-bootstrap',scope,'eduwork.jsonc')
  const baseline={schemaVersion:1,organizations:[{id:'old-school'}],features:{maxConcurrentRequests:8},updates:f.descriptor.updates,contentUpdates:source}
  await save(oldCache,baseline)
  const folder=dirname(f.paths.config),old=join(folder,'eduwork.0.3.6-dev.20260916.1.jsonc')
  await save(old,baseline)
  const stale={schemaVersion:1,organizations:[{id:'stale-root'}]};await save(f.paths.config,stale)
  const key=`1-${item.manifest.bundle.sha256}`,directory=join(f.paths.updateDataRoot,'content-updates',scope,key)
  await save(join(directory,'manifest.json'),item.envelope)
  await writeFile(join(directory,'bundle.json'),item.bytes)
  await save(join(f.paths.updateDataRoot,'content-updates',scope,'state.json'),{schemaVersion:1,active:{configuration:key},pending:null,trial:null,rejected:[],highest:1})
  const sentinel=join(f.paths.updateDataRoot,'personal-history.json');await save(sentinel,{untouched:true})
  const {bootstrap,manager}=await f.open()
  assert.equal(bootstrap.configPath,f.paths.config)
  assert.equal(loadUserConfig(f.paths.config).organizations[0].id,'example')
  assert.equal(loadUserConfig(f.paths.config).features.maxConcurrentRequests,2)
  assert.deepEqual(JSON.parse(await readFile(manager.configurationFile.backup,'utf8')),stale)
  await preparePublisherContent(manager,bootstrap)
  assert.ok(await readFile(old))
  await manager.ready()
  await assert.rejects(readFile(old),{code:'ENOENT'})
  await assert.rejects(readFile(oldCache),{code:'ENOENT'})
  assert.deepEqual(JSON.parse(await readFile(sentinel,'utf8')),{untouched:true})
  const local=(await readConfiguration(f.paths.config)).value
  local.organizations=[{id:'uat-school'}];local.contentUpdates.configuration=false
  await save(f.paths.config,local)
  const next=await f.open();await preparePublisherContent(next.manager,next.bootstrap)
  assert.equal(loadUserConfig(f.paths.config).organizations[0].id,'uat-school')
  assert.deepEqual((await readdir(folder)).filter(name=>name.endsWith('.jsonc')),['eduwork.jsonc'])
})

const plain = value => JSON.parse(JSON.stringify(value))
const retired = 'https://updates.example.test/legacy'
const oldProfile = { id: 'example', oidc: { issuer: 'https://school.example.test', clientId: 'synthetic-public-client' }, keyBinding: { type: 'legacy' }, provider: { id: 'school', baseURL: 'https://school.example.test/api/v1' } }
const newProfile = { id: 'example', auth: { discoveryUrl: 'https://school.example.test/.well-known/openid-configuration', clientId: 'synthetic-public-client' }, provider: { id: 'school', modelSource: 'discovery' } }
async function migrationFixture(t, layout = 'root') {
  const f = await fixture(t)
  f.descriptor.migrateFrom = [retired]
  await save(f.descriptorPath, f.descriptor)
  const oldSource = { ...f.descriptor.contentUpdates, baseURL: retired }
  const oldValue = { schemaVersion: 1, organizations: [oldProfile, { id: 'personal', label: 'Keep me' }], contentUpdates: oldSource, desktop: { closeAction: 'exit' } }
  let oldPath = f.paths.config
  if (layout === 'cache') {
    const scope = digest(JSON.stringify(['example', oldSource.publisher, oldSource.baseURL, oldSource.publicKey]))
    oldPath = join(f.paths.updateDataRoot, 'publisher-bootstrap', scope, 'eduwork.jsonc')
    await save(f.paths.config, { schemaVersion: 1, organizations: [] })
  } else if (layout === 'version') {
    oldPath = join(dirname(f.paths.config), 'eduwork.0.3.5.jsonc')
    delete oldValue.contentUpdates
  }
  await save(oldPath, oldValue)
  return { ...f, oldValue, oldPath, oldSource }
}
for (const layout of ['root', 'cache', 'version']) test(`declared feed migration (${layout}) requires new signed configuration before Host starts and retains extra profiles`, async t => {
  const f = await migrationFixture(t, layout)
  f.release(1, {}, { organizations: [newProfile] })
  const first = await f.open()
  assert.equal(first.bootstrap.requiresConfiguration, true)
  assert.equal(first.manager.source.baseURL, f.descriptor.contentUpdates.baseURL)
  await preparePublisherContent(first.manager, first.bootstrap)
  const value = loadUserConfig(f.paths.config)
  assert.deepEqual(plain(value.organizations), [newProfile, { id: 'personal', label: 'Keep me' }])
  assert.equal(value.closeAction, 'exit')
  assert.equal(first.manager.state.active.configuration, undefined)
  await first.manager.ready()
  f.responses.clear(); f.requests.length = 0
  const next = await f.open()
  assert.equal(next.bootstrap.requiresConfiguration, false)
  await preparePublisherContent(next.manager, next.bootstrap)
  assert.equal(f.requests.length, 0)
  assert.deepEqual(loadUserConfig(f.paths.config).organizations, value.organizations)
})

test('failed migration download remains retryable; an uncommitted trial restores old fields and only a new revision can retry', async t => {
  const f = await migrationFixture(t), first = await f.open()
  await assert.rejects(preparePublisherContent(first.manager, first.bootstrap), { code: 'EDUWORK_BOOTSTRAP_REQUIRED' })
  assert.deepEqual(plain(loadUserConfig(f.paths.config).organizations[0]), oldProfile)
  f.release(1, {}, { organizations: [newProfile] })
  const retry = await f.open()
  assert.equal(retry.bootstrap.requiresConfiguration, true)
  await preparePublisherContent(retry.manager, retry.bootstrap)
  const interrupted = await f.open()
  assert.deepEqual(plain(loadUserConfig(f.paths.config).organizations[0]), oldProfile)
  await assert.rejects(preparePublisherContent(interrupted.manager, interrupted.bootstrap), { code: 'EDUWORK_BOOTSTRAP_REQUIRED' })
  f.release(2, {}, { organizations: [newProfile] })
  await preparePublisherContent(interrupted.manager, interrupted.bootstrap)
  await interrupted.manager.ready()
  assert.deepEqual(plain(loadUserConfig(f.paths.config).organizations[0]), newProfile)
  assert.deepEqual((await readdir(dirname(interrupted.manager.configurationFile.backup))).filter(name => name.endsWith('.jsonc')), ['eduwork.previous.jsonc'])
})

test('a previously initialized single config migrates only the explicitly retired source and preserves local edits', async t => {
  const f = await fixture(t), oldSource = { ...f.descriptor.contentUpdates }
  f.release(1, {}, { organizations: [oldProfile], features: { maxConcurrentRequests: 2 } })
  const original = await f.open()
  await preparePublisherContent(original.manager, original.bootstrap); await original.manager.ready()
  const local = (await readConfiguration(f.paths.config)).value
  local.organizations.push({ id: 'personal' }); local.features.maxConcurrentRequests = 9
  await save(f.paths.config, local)
  f.descriptor.contentUpdates.baseURL = 'https://updates.example.test/v2'
  f.descriptor.migrateFrom = [oldSource.baseURL]
  await save(f.descriptorPath, f.descriptor)
  f.release(1, {}, { organizations: [newProfile], features: { maxConcurrentRequests: 3 } })
  const next = await f.open()
  assert.equal(next.bootstrap.requiresConfiguration, true)
  await preparePublisherContent(next.manager, next.bootstrap); await next.manager.ready()
  assert.deepEqual(plain(loadUserConfig(f.paths.config).organizations), [newProfile, { id: 'personal' }])
  assert.equal(loadUserConfig(f.paths.config).features.maxConcurrentRequests, 9)
})

for (const kind of ['custom-source', 'different-key', 'disabled', 'explicit-config']) test(`publisher migration respects ${kind}`, async t => {
  const f = await migrationFixture(t)
  if (kind === 'custom-source') f.oldValue.contentUpdates.baseURL = 'https://uat.example.test/content'
  if (kind === 'different-key') f.oldValue.contentUpdates.publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' })
  if (kind === 'disabled') f.oldValue.contentUpdates.configuration = false
  if (kind === 'explicit-config') f.options.migrateLegacy = false
  await save(f.paths.config, f.oldValue)
  const first = await f.open()
  assert.equal(first.bootstrap.requiresConfiguration, false)
  await preparePublisherContent(first.manager, first.bootstrap)
  assert.equal(f.requests.length, 0)
  assert.deepEqual(plain(loadUserConfig(f.paths.config).organizations), f.oldValue.organizations)
  assert.equal(first.manager.source.baseURL, f.oldValue.contentUpdates.baseURL)
})

test('a retired cache is verified with its original source and signed defaults before migration', async t => {
  const f = await migrationFixture(t, 'cache'), target = f.descriptor.contentUpdates.baseURL
  f.descriptor.contentUpdates.baseURL = retired
  const old = f.release(4, {}, { organizations: [oldProfile], features: { maxConcurrentRequests: 7 } })
  f.descriptor.contentUpdates.baseURL = target
  const scope = digest(JSON.stringify(['example', f.oldSource.publisher, retired, f.oldSource.publicKey]))
  const key = `4-${old.manifest.bundle.sha256}`, store = join(f.paths.updateDataRoot, 'content-updates', scope)
  await save(join(store, key, 'manifest.json'), old.envelope)
  await writeFile(join(store, key, 'bundle.json'), old.bytes)
  await save(join(store, 'state.json'), { schemaVersion: 1, active: { configuration: key }, pending: null, trial: null, rejected: [], highest: 4 })
  f.release(1, {}, { organizations: [newProfile], features: { maxConcurrentRequests: 3 } })
  const first = await f.open()
  assert.equal(loadUserConfig(f.paths.config).features.maxConcurrentRequests, 7)
  assert.equal(first.bootstrap.requiresConfiguration, true)
  await preparePublisherContent(first.manager, first.bootstrap); await first.manager.ready()
  assert.deepEqual(plain(loadUserConfig(f.paths.config).organizations[0]), newProfile)
  assert.equal(loadUserConfig(f.paths.config).features.maxConcurrentRequests, 3)
  assert.equal(first.manager.snapshot().configurationRevision, 1, 'revision is scoped to the explicitly changed source')
  await assert.rejects(readFile(f.oldPath), { code: 'ENOENT' })
})

test('migration descriptors reject non-HTTPS, query and credential URLs', async t => {
  const f = await fixture(t)
  for (const bad of ['http://updates.example.test', 'https://updates.example.test/?x=1', 'https://user:secret@updates.example.test', '../outside']) {
    await save(f.descriptorPath, { ...f.descriptor, migrateFrom: [bad] })
    await assert.rejects(readPublisherBootstrap(f.options), /migrateFrom/)
  }
})
