/**
 * Run with the verified raw Electron executable (not `node --test`):
 * electron.exe oidc-native-vault.electron.mjs --product <frozen-product>
 *   --adapter <prepared-host/host-process.mjs> --node <node.exe> --evidence <directory>
 * This uses real Electron safeStorage and the selected desktop Host transport.
 * Only navigation to the synthetic localhost IdP is performed by an HTTP fixture,
 * rather than opening the user's system browser. No existing desktop home is used.
 */
import { app, safeStorage } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { generateKeyPairSync, randomBytes, randomUUID, createHash, sign } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, copyFile, symlink, rm } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, sep, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EncryptedVault, startNativeBridge } from '../src/native-vault.mjs'
import { prepareProductProfile } from '../../dsh-host/product-profile.mjs'
import { workbenchAction } from '../../dsh-host/workbench-support.mjs'

const args = process.argv.slice(2)
const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, index) => [args[index * 2], args[index * 2 + 1]]))
for (const key of ['--product', '--adapter', '--node', '--evidence']) assert.equal(typeof options[key], 'string', `Missing ${key}`)
const sourceProduct = resolve(options['--product'])
const evidence = resolve(options['--evidence'])
await mkdir(evidence, { recursive: true })
const root = await mkdtemp(join(evidence, 'run-'))
const own = path => { const rel = relative(root, path); assert.ok(rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)); return path }
const userData = own(join(root, 'browser'))
await mkdir(userData, { recursive: true })
app.setName('EduWork OIDC isolated acceptance')
app.setPath('userData', userData)
app.setPath('sessionData', userData)
// No developer/user credentials or globally configured models are inherited.
for (const key of Object.keys(process.env)) if (!['Path', 'PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'].includes(key)) delete process.env[key]
Object.assign(process.env, { USERPROFILE: userData, HOME: userData, DSH_TELEMETRY_DISABLED: '1' })
const checks = []
const cleanups = []
const summaries = { schemaVersion: 1, test: 'electron-oidc-real-native-vault', actualElectronSafeStorage: true,
  externalBrowserUI: 'not-exercised; localhost authorization navigation uses an HTTP fixture',
  existingDesktopProcessesTouched: false, checks }
const finish = async () => {
  const cleanupFailures = []
  for (const cleanup of cleanups.reverse()) try { await cleanup() } catch { cleanupFailures.push('isolated-resource-cleanup') }
  summaries.cleanupFailures = cleanupFailures
  summaries.passed = !summaries.failure && cleanupFailures.length === 0
  await writeFile(join(root, 'result.json'), JSON.stringify(summaries, null, 2) + '\n')
  console.log(JSON.stringify({ passed: summaries.passed, checks: checks.length, evidence: join(root, 'result.json') }))
  app.exit(summaries.passed ? 0 : 1)
}
const check = async (name, fn) => { await fn(); checks.push({ name, passed: true }); console.log('PASS ' + name) }
const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url')

async function idpFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'electron-fixture', use: 'sig', alg: 'RS256' }
  const codes = new Map()
  const secrets = new Set(['<SYNTHETIC_PERSONAL_KEY>'])
  const counts = { authorization: 0, code: 0, refresh: 0, revoked: 0, unauthorized: 0, quota: 0 }
  let origin, currentAccess, currentRefresh, rejectAccess = false
  function issueToken(nonce, initial) {
    currentAccess = '<SYNTHETIC_ACCESS_' + randomBytes(12).toString('hex') + '>'
    currentRefresh = '<SYNTHETIC_REFRESH_' + randomBytes(12).toString('hex') + '>'
    secrets.add(currentAccess); secrets.add(currentRefresh)
    const result = { scope: 'openid profile offline_access llm:models:read llm:invoke', token_type: 'Bearer', access_token: currentAccess, refresh_token: currentRefresh, expires_in: initial ? 1 : 3600 }
    if (initial) {
      const header = encoded({ alg: 'RS256', kid: 'electron-fixture' })
      const payload = encoded({ iss: origin, aud: 'electron-fixture', sub: 'synthetic-user', nonce,
        iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })
      result.id_token = header + '.' + payload + '.' + sign('RSA-SHA256', Buffer.from(header + '.' + payload), privateKey).toString('base64url')
    }
    return result
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin)
    const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = new URLSearchParams(Buffer.concat(chunks).toString())
    if (url.pathname === '/.well-known/openid-configuration') return json({ issuer: origin,
      authorization_endpoint: origin + '/authorize', token_endpoint: origin + '/token', userinfo_endpoint: origin + '/userinfo',
      jwks_uri: origin + '/jwks', revocation_endpoint: origin + '/revoke', code_challenge_methods_supported: ['S256'],
      response_types_supported: ['code'], grant_types_supported: ['authorization_code','refresh_token'],
      token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true, id_token_signing_alg_values_supported: ['RS256'], subject_types_supported: ['public'],
      scopes_supported: ['openid','profile','offline_access','llm:models:read','llm:invoke'],
      oidc_llm: { version: '0.1', resource: origin, api_base: origin + '/v1',
        identity_modes_supported: ['oauth','oidc'], client_registration_methods_supported: ['static'] } })
    if (url.pathname === '/authorize') {
      counts.authorization++
      if (url.searchParams.get('code_challenge_method') !== 'S256') return json({ error: 'invalid_request' }, 400)
      const code = randomBytes(24).toString('base64url')
      codes.set(code, Object.fromEntries(url.searchParams)); secrets.add(code)
      const callback = new URL(url.searchParams.get('redirect_uri'))
      if (callback.hostname !== '127.0.0.1' || callback.protocol !== 'http:' || callback.pathname !== '/oauth/callback') return json({ error: 'invalid_request' }, 400)
      callback.searchParams.set('code', code); callback.searchParams.set('state', url.searchParams.get('state')); callback.searchParams.set('iss', origin)
      res.writeHead(302, { location: callback.toString() }); res.end(); return
    }
    if (url.pathname === '/token') {
      if (body.get('grant_type') === 'refresh_token') {
        if (body.get('refresh_token') !== currentRefresh) return json({ error: 'invalid_grant' }, 400)
        counts.refresh++; return json(issueToken(undefined, false))
      }
      const authorization = codes.get(body.get('code')); codes.delete(body.get('code'))
      if (!authorization || authorization.redirect_uri !== body.get('redirect_uri') || body.get('client_id') !== 'electron-fixture'
        || authorization.code_challenge !== createHash('sha256').update(body.get('code_verifier') || '').digest('base64url')) return json({ error: 'invalid_grant' }, 400)
      counts.code++; return json(issueToken(authorization.nonce, true))
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk] })
    if (url.pathname === '/userinfo') {
      if (req.headers.authorization !== 'Bearer ' + currentAccess) return json({ error: 'invalid_token' }, 401)
      return json({ sub: 'synthetic-user', name: 'Synthetic user' })
    }
    if (url.pathname === '/revoke') { counts.revoked++; return json({}) }
    if (url.pathname.startsWith('/v1/')) {
      if (rejectAccess || req.headers.authorization !== 'Bearer ' + currentAccess) { rejectAccess = false; counts.unauthorized++; return json({ error: 'invalid_token' }, 401) }
      if (url.pathname === '/v1/models') return json({ data: [{ id: 'synthetic-model' }] })
      if (url.pathname === '/v1/quota') { counts.quota++; return json({ provider_id: 'synthetic-ai', unit: 'credits', windows: [{ type: 'fixed', limit: 100, used: 1, remaining: 99 }] }) }
    }
    return json({ error: 'not_found' }, 404)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = 'http://127.0.0.1:' + server.address().port
  cleanups.push(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  return { origin, counts, secrets, rejectOnce: () => { rejectAccess = true },
    profile: { schemaVersion: 'dsh-oidc/v1alpha1', id: 'electron-fixture', displayName: 'Synthetic organization', allowInsecureDevelopment: true,
      auth: { discoveryUrl: origin + '/.well-known/openid-configuration', expectedIssuer: origin, experimentalOidcLlm: true, clientId: 'electron-fixture', identityMode: 'oidc' },
      provider: { id: 'synthetic-ai', adapter: 'openai-compatible', modelSource: 'discovery' } } }
}

let currentStep = 'startup'
async function main() {
try {
  await app.whenReady()
  assert.ok(safeStorage.isEncryptionAvailable())
  if (process.platform === 'linux') assert.notEqual(safeStorage.getSelectedStorageBackend?.(), 'basic_text')
  summaries.electron = process.versions.electron
  summaries.platform = process.platform
  const sourceIdentity = JSON.parse(await readFile(join(sourceProduct, 'assembly.json'), 'utf8'))
  const native = sourceIdentity.dshVersion === '0.1.7-alpha.2'
  summaries.dshVersion = sourceIdentity.dshVersion
  summaries.oidcVersion = JSON.parse(await readFile(join(sourceProduct, 'd/node_modules/@eduwork/dsh-oidc/package.json'), 'utf8')).version
  // Use the actual frozen product. A metadata wrapper with external module
  // junctions correctly fails the desktop's product-containment guard.
  // Only test homes and credentials are created; no package bytes are modified.
  const product = sourceProduct
  const idp = await idpFixture()
  const profileFile = own(join(root, 'synthetic-profile.json'))
  await writeFile(profileFile, JSON.stringify(idp.profile))
  cleanups.push(() => rm(profileFile, { force: true }))
  const { DesktopHostProcess } = await import(pathToFileURL(resolve(options['--adapter'])))
  const authenticateWebHost = native
    ? (await import(pathToFileURL(join(dirname(resolve(options['--adapter'])), 'web-document.mjs')))).authenticateWebHost
    : undefined
  let opened = 0
  const external = async url => {
    const target = new URL(url)
    assert.equal(target.origin, idp.origin)
    assert.equal(target.pathname, '/authorize')
    opened++
    const authorization = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
    assert.equal(authorization.status, 302)
    const callback = await fetch(authorization.headers.get('location'), { signal: AbortSignal.timeout(10000) })
    assert.equal(callback.status, 200)
  }
  const instances = []
  const createInstance = async label => {
    const directory = own(join(root, label))
    await mkdir(directory, { recursive: true })
    const vaultPath = own(join(directory, 'credentials.encrypted'))
    const vault = new EncryptedVault(vaultPath, safeStorage)
    const config = own(join(directory, 'eduwork.jsonc'))
    await writeFile(config, JSON.stringify({ schemaVersion: 1, product: { name: 'EduWork' }, organizations: [] }))
    const bridge = await startNativeBridge({ vault, openExternal: external,
      workbench: action => workbenchAction({ action, config, version: sourceIdentity.version, shell: 'electron' }) })
    cleanups.push(async () => { await bridge.close(); await rm(vaultPath, { force: true }); await rm(vaultPath + '.pending', { force: true }) })
    const prepared = await prepareProductProfile({ product, home: join(directory, 'home'), shell: 'electron', enterpriseProfile: profileFile })
    let host, origin, cookie
    const start = async () => {
      const started = performance.now()
      Object.assign(process.env, prepared.environment)
      host = native
        ? new DesktopHostProcess(resolve(options['--node']), join(product, 'd'), prepared.profile, undefined,
          { ...process.env, ...prepared.environment }, undefined, undefined, undefined, undefined, { bootstrap: bridge.bootstrap })
        : new DesktopHostProcess(resolve(options['--node']), prepared.profile, undefined, { bootstrap: bridge.bootstrap, allowLinkedProfile: true })
      const ready = await Promise.race([host.start(), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Host readiness timed out')), 45000); timer.unref() })])
      if (native) {
        origin = new URL(ready.url).origin
        assert.equal(new URL(origin).hostname, '127.0.0.1')
        cookie = await authenticateWebHost(ready.url)
        assert.ok(cookie)
      } else {
        assert.equal(ready.protocolVersion, 3)
        assert.equal(ready.dshVersion, sourceIdentity.dshVersion, 'Host must match the tested product Runtime')
      }
      ;(summaries.hostStarts ??= []).push({ label, elapsedMs: Math.round(performance.now() - started) })
    }
    const stop = async () => {
      const child = host?.child
      await host?.stop()
      if (child) {
        assert.equal(child.exitCode, 0, 'Official Host must exit cleanly after pipe shutdown')
        ;(summaries.hostExits ??= []).push({ label, exitCode: child.exitCode })
      }
    }
    const rpc = async (method, args = {}) => {
      const request = new Request((native ? origin : 'dsh-app://app') + '/api/' + method, { method: 'POST',
        headers: { 'content-type': 'application/json', ...(native ? { origin, cookie } : {}) },
        body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args } }), signal: AbortSignal.timeout(30000) })
      const response = await (native ? fetch(request) : host.fetch(request))
      const value = await response.json()
      assert.equal(response.status, 200, method + ' transport status')
      assert.equal(value.result?.ok, true, method + ' RPC failed')
      return value.result.value
    }
    cleanups.push(stop)
    await start()
    const instance = { rpc, vault, vaultPath, bridge, async restart() { await stop(); await start() } }
    instances.push(instance)
    return instance
  }
  currentStep = 'real-host-start'
  const first = await createInstance('account-a')
  await check('native-workbench-through-official-Host', async () => {
    const status = await first.rpc('workbench/desktop', { action: 'status' })
    assert.equal(status.shell, 'electron')
    assert.equal(status.phase, 'ready')
    assert.equal((await first.rpc('workbench/desktop', { action: 'check-updates' })).phase, 'unconfigured')
    const diagnostic = await first.rpc('workbench/desktop', { action: 'diagnostics' })
    assert.equal(JSON.parse(diagnostic.report).shell, 'electron')
    assert.match(diagnostic.filename, /\.zip$/)
    assert.equal(Buffer.from(diagnostic.archive, 'base64').readUInt32LE(), 0x04034b50)
    assert.ok((await first.rpc('workbench/catalog')).skills.some(row => row.name === 'artifact-documents'))
    const inventory = await first.rpc('productComponents/list')
    assert.equal(inventory.release.productVersion, sourceIdentity.version)
    assert.equal(inventory.release.distributionMode, 'desktop-release')
    for (const id of ['python', 'office-suite', 'video-production', 'local-asr']) assert.equal(inventory.components.find(row => row.id === id)?.status, 'ready', id)
    assert.equal((await first.rpc('activityInsights/snapshot', { request: '{}' })).profile.displayName, null)
  })
  await check('real-electron-safeStorage-and-official-Host-start', async () => {
    assert.equal((await first.rpc('oidcAccounts/status', { profileID: idp.profile.id })).state, 'signed_out')
    await first.rpc('credentials/set', { ref: 'EDUWORK_TEST_PERSONAL_KEY', value: '<SYNTHETIC_PERSONAL_KEY>' })
  })
  currentStep = 'login'
  await check('desktop-PKCE-login-and-proactive-refresh', async () => {
    const begin = await first.rpc('oidcAccounts/begin', { profileID: idp.profile.id })
    assert.equal(begin.mode, 'external')
    assert.equal(Object.hasOwn(begin, 'authorizationURL'), false)
    const result = await first.rpc('oidcAccounts/loginStatus', { loginID: begin.loginID })
    assert.equal(result.state, 'completed')
    assert.equal(result.status.state, 'connected')
    assert.equal(result.status.credentialReady, true)
    assert.equal((await first.rpc('activityInsights/snapshot', { request: '{}' })).profile.displayName, 'Synthetic user')
    assert.equal(idp.counts.code, 1)
    assert.equal(idp.counts.refresh, 1)
    const resources = await first.rpc('oidcAccounts/resources', { profileID: idp.profile.id })
    assert.equal(resources.models[0].id, 'synthetic-model')
    assert.equal(Object.hasOwn(resources, 'quota'), false, 'Public native OIDC does not expose ECNU quota')
    assert.equal(idp.counts.quota, 0, 'Even when a server advertises quota, public OIDC does not request it')
    for (const secret of idp.secrets) assert.equal(JSON.stringify({ begin, result, resources }).includes(secret), false)
  })
  currentStep = 'at-rest'
  await check('OS-encryption-at-rest-and-safe-RPC-describe', async () => {
    const bytes = await readFile(first.vaultPath)
    assert.ok(bytes.length > 100)
    for (const secret of idp.secrets) assert.equal(bytes.includes(Buffer.from(secret)), false)
    assert.equal(bytes.includes(Buffer.from('DSH_OIDC_ELECTRON_FIXTURE_SESSION')), false)
    assert.equal((await new EncryptedVault(first.vaultPath, safeStorage).operation('resolve', 'EDUWORK_TEST_PERSONAL_KEY')).value, '<SYNTHETIC_PERSONAL_KEY>')
    const description = await first.rpc('credentials/describe', { refs: ['EDUWORK_TEST_PERSONAL_KEY'] })
    assert.equal(JSON.stringify(description).includes('<SYNTHETIC_PERSONAL_KEY>'), false)
  })
  currentStep = 'refresh-401'
  await check('rotating-refresh-retries-authorized-401-once', async () => {
    idp.rejectOnce()
    assert.equal((await first.rpc('oidcAccounts/reconcile', { profileID: idp.profile.id, options: {} })).state, 'connected')
    assert.equal(idp.counts.unauthorized, 1)
    assert.equal(idp.counts.refresh, 2)
  })
  currentStep = 'restart'
  await check('Host-restart-recovers-OS-encrypted-session', async () => {
    await first.restart()
    assert.equal((await first.rpc('oidcAccounts/status', { profileID: idp.profile.id })).state, 'connected')
    assert.equal(idp.counts.code, 1)
  })
  currentStep = 'isolation'
  const second = await createInstance('account-b')
  await check('fresh-home-and-native-bridge-authorization-isolation', async () => {
    assert.equal((await second.rpc('oidcAccounts/status', { profileID: idp.profile.id })).state, 'signed_out')
    assert.equal((await second.vault.operation('describe', 'EDUWORK_TEST_PERSONAL_KEY')).configured, false)
    const { baseURL } = second.bridge.bootstrap.nativeBridge
    for (const headers of [{ authorization: 'Bearer ' + first.bridge.bootstrap.nativeBridge.token },
      { authorization: 'Bearer ' + second.bridge.bootstrap.nativeBridge.token, origin: 'https://renderer.invalid' }]) {
      const response = await fetch(baseURL + '/v1/credentials/resolve', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'EDUWORK_TEST_PERSONAL_KEY' }) })
      assert.equal(response.status, 403)
    }
  })
  currentStep = 'logout'
  await check('logout-revokes-organization-and-preserves-personal-key', async () => {
    assert.equal((await first.rpc('oidcAccounts/logout', { profileID: idp.profile.id })).state, 'signed_out')
    assert.equal((await first.vault.operation('describe', 'DSH_OIDC_ELECTRON_FIXTURE_SESSION')).configured, false)
    assert.equal((await first.vault.operation('describe', 'SYNTHETIC_AI_API_KEY')).configured, false)
    assert.equal((await first.vault.operation('resolve', 'EDUWORK_TEST_PERSONAL_KEY')).value, '<SYNTHETIC_PERSONAL_KEY>')
    assert.equal(idp.counts.revoked, 1)
    assert.equal((await first.rpc('activityInsights/snapshot', { request: '{}' })).profile.displayName, null)
    await first.rpc('credentials/unset', { ref: 'EDUWORK_TEST_PERSONAL_KEY' })
  })
  summaries.protocolCounters = idp.counts
  summaries.controlledLocalAuthorizationNavigations = opened
} catch (error) {
  // Assertions/response envelopes may contain secrets: keep only a safe stage label.
  summaries.failure = { stage: currentStep, kind: error?.name || 'Error',
    ...(currentStep === 'real-host-start' ? { message: String(error?.message || '').replace(/(?:Bearer\s+|(?:token|api_key|access_token)[=:]\s*)[^\s,}"']+/gi, '[redacted]').slice(0, 3000) } : {}) }
  console.error('FAILED ' + currentStep + ' (' + (error?.name || 'Error') + ')')
} finally { await finish() }
}
// Electron emits ready after evaluating its ESM entry; do not await readiness at module scope.
void main()
