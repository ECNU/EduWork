// Opt-in migration probe. Uses a verified npm Runtime and a new, synthetic home.
// This does not qualify EduWork plugins, an installed user's data, or a desktop build.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { validateNpmRuntimeLock } from '../dsh-desktop/scripts/prepare-dsh-runtime.mjs'

const repository = fileURLToPath(new URL('../', import.meta.url))
const { values } = parseArgs({ options: { runtime: { type: 'string' }, output: { type: 'string' } } })
if (!values.runtime || !values.output) throw new Error('Use --runtime <prepared candidate> --output <new synthetic directory>')
const runtime = resolve(values.runtime), output = resolve(values.output)
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const contractRoot = join(repository, 'third_party/dsh/candidate-v0.1.7-alpha.2')
const lock = await json(join(contractRoot, 'LOCK.json'))
const manifest = await json(join(contractRoot, 'npm-runtime/package.json'))
const packageLockBytes = await readFile(join(contractRoot, 'npm-runtime/package-lock.json'))
validateNpmRuntimeLock({ manifest, lock, packageLockBytes, packageLock: JSON.parse(packageLockBytes) })
const receipt = await json(join(runtime, '.chatecnu-dsh-runtime.json'))
assert.equal(receipt.source, 'npm-lock')
assert.equal(receipt.dshVersion, lock.packageVersion)
assert.equal(receipt.dshCommit, lock.commit)
assert.equal(receipt.platform, process.platform)
assert.equal(receipt.arch, process.arch)
assert.equal(receipt.packageLockSHA256, lock.runtime.npm.packageLockSHA256)
assert.equal(hash(await readFile(join(runtime, '.chatecnu-dsh-npm-install-lock.json'))), receipt.packageLockSHA256)
const require = createRequire(join(runtime, 'package.json'))
const load = async name => {
  const packageName = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]
  const installed = await json(join(runtime, 'node_modules', packageName, 'package.json'))
  assert.equal(installed.version, manifest.dependencies[packageName], `Unexpected probe dependency: ${packageName}`)
  return import(pathToFileURL(require.resolve(name)).href)
}
// Refuse existing directories, including an existing user's home. Keep evidence after the run.
await mkdir(output)
const home = join(output, 'home'), profileDir = join(home, 'profiles', 'upgrade-probe')
await mkdir(profileDir, { recursive: true })
process.chdir(output)
process.env.DSH_HOME = home
process.env.DSH_TELEMETRY_DISABLED = '1'
const report = {
  version: lock.packageVersion, commit: lock.commit, startedAt: new Date().toISOString(),
  scope: 'upstream Web and synthetic V3 migration', productAcceptance: 'not-tested', success: false,
}
const save = () => writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
let application
try {
  const { loadProfileDirectory } = await load('@deepseek-ai/dsh-app-boot')
  const { createLaunchEnvironmentSnapshot } = await load('@deepseek-ai/dsh-launch-environment')
  const { runProfile } = await load('@deepseek-ai/dsh/profile-boot')
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'eduwork-upgrade-probe', version: '0.0.0', private: true, type: 'module',
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }))
  await writeFile(join(profileDir, 'cordis.patch.yml'), JSON.stringify([
    { id: 'session-log-deepseek', disabled: true }, { id: 'deepseek-account', disabled: true },
    { id: 'account-controller', disabled: true }, { id: 'ui-settings-account', disabled: true },
    { id: 'plugin-package-inventory-deepseek', disabled: true },
  ]))
  const installAnchor = join(runtime, 'node_modules/@deepseek-ai/dsh/package.json')
  const profile = loadProfileDirectory('eduwork-upgrade-probe', profileDir, installAnchor)
  const environment = createLaunchEnvironmentSnapshot([{ source: 'process', values: Object.fromEntries(Object.entries({
    DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', PATH: process.env.PATH ?? process.env.Path,
    SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP,
  }).filter(([, value]) => value !== undefined)) }])
  application = await runProfile({ environment, profile: 'upgrade-probe', resolvedProfile: { profile, installAnchor },
    patchFiles: [], args: ['--no-open', '--host', '127.0.0.1', '--port', '0'] })
  const ctx = application.ctx
  report.services = Object.fromEntries(['settings', 'agentPresets', 'pluginManager', 'officeToPdf', 'workspaceFiles',
    'configEditor', 'connection', 'webServer', 'llm'].map(key => [key, !!ctx.get(key)]))
  assert.ok(Object.values(report.services).every(Boolean), 'A required upstream service failed to activate')
  report.settingsMethods = Object.fromEntries(['register', 'get', 'installSection', 'configure', 'describe', 'update', 'mutate']
    .map(key => [key, typeof ctx.settings[key]]))
  report.presets = await ctx.agentPresets.list()
  assert.ok(report.presets.length > 0 && report.presets.every(preset => !preset.broken))
  const origin = `http://127.0.0.1:${ctx.webServer.port}`
  const bootstrap = await fetch(ctx.connection.authenticatedUrl(origin), { redirect: 'manual' })
  const cookie = bootstrap.headers.get('set-cookie')?.split(';', 1)[0]
  await bootstrap.body?.cancel()
  assert.equal(bootstrap.status, 303)
  assert.ok(cookie)
  const unauthenticated = await fetch(origin)
  await unauthenticated.body?.cancel()
  assert.equal(unauthenticated.status, 401)
  const page = await fetch(origin, { headers: { cookie } })
  assert.equal(page.status, 200)
  assert.match(await page.text(), /<html/u)
  // Do not persist the bootstrap URL or authentication cookie in the report.
  report.http = { bootstrap: 303, unauthenticated: 401, authenticated: 200 }
  await ctx.fiber.dispose()
  application = undefined
  await save()

  const { Context } = await load('@deepseek-ai/cordis')
  const { SessionId } = await load('@deepseek-ai/dsh-session')
  const { default: Persistence } = await load('@deepseek-ai/dsh-session-persistence-jsonl')
  report.sessions = []
  for (const corrupt of [false, true]) {
    const name = corrupt ? 'corrupt-log-refusal' : 'v3-extension-preservation'
    const root = join(output, name), directory = join(root, '_no-cwd', 'synthetic')
    await mkdir(directory, { recursive: true })
    const path = join(directory, 'session.v3.jsonl')
    const extension = { artifactId: 'synthetic-quiz', path: 'lesson.html', payload: { source: 'synthetic' } }
    const events = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { id: 'prompt', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Synthetic upgrade fixture' }] }, surfaceOp: 'append' },
      { type: 'eduwork/synthetic-artifact', ignorable: true, data: extension },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ].map((event, seq) => ({ ...event, seq, time: seq + 1 }))
    if (corrupt) events[3].seq = 8
    const original = [{ type: 'session', version: 3, id: 'synthetic', createdAt: 1, isSeeded: false, delegationDepth: 0 }, ...events]
      .map(event => JSON.stringify(event) + '\n').join('')
    await writeFile(path, original)
    const ctx = new Context()
    try {
      await ctx.plugin(Persistence, { root, compression: 'none' })
      if (corrupt) {
        for (const access of ['read', 'write']) await assert.rejects(ctx.sessionPersistence.open(SessionId('synthetic'), access))
        assert.ok(!(await readdir(directory)).includes('session.v4.jsonl'))
      } else {
        const reader = await ctx.sessionPersistence.open(SessionId('synthetic'), 'read')
        let prepared
        try {
          assert.equal(reader.header.version, 4)
          prepared = (await reader.read()).events
        } finally { await reader.close() }
        assert.equal(await readFile(path, 'utf8'), original)
        assert.ok(!(await readdir(directory)).includes('session.v4.jsonl'), 'Read-only open must not publish V4')
        const retained = prepared.find(event => event.data?.artifactId === extension.artifactId)
        assert.deepEqual(retained?.data, extension)
        assert.equal(retained.type, 'plugin:eduwork/synthetic-artifact')
        const writer = await ctx.sessionPersistence.open(SessionId('synthetic'), 'write')
        try { assert.deepEqual((await writer.read()).events, prepared) } finally { await writer.close() }
        assert.ok((await readdir(directory)).includes('session.v4.jsonl'))
        const reopened = await ctx.sessionPersistence.open(SessionId('synthetic'), 'read')
        try { assert.deepEqual((await reopened.read()).events, prepared) } finally { await reopened.close() }
      }
      assert.equal(await readFile(path, 'utf8'), original, 'Never rewrite the historical generation')
      report.sessions.push({ name, success: true, historicalBytesUnchanged: true, successorPublished: !corrupt })
    } finally { await ctx.fiber.dispose() }
  }
  report.success = true
} catch (error) {
  report.error = { name: error.name, message: error.message }
  process.exitCode = 1
} finally {
  try { if (application) await application.ctx.fiber.dispose() }
  catch (error) {
    report.success = false
    report.shutdownError = { name: error.name, message: error.message }
    process.exitCode = 1
  }
  report.completedAt = new Date().toISOString()
  await save()
  console.log(`DSH migration probe ${report.success ? 'passed' : 'failed'}; product acceptance not tested. Report: ${join(output, 'report.json')}`)
}
