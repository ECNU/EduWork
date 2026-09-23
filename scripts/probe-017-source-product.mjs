// Whole assembled candidate, without source resolution hooks or user data.
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { prepareProductProfile } from '../dsh-host/product-profile.mjs'
import { startNativeBridge } from '../dsh-electron/src/native-vault.mjs'

const { values } = parseArgs({ options: Object.fromEntries(['product', 'host', 'output'].map(key => [key, { type: 'string' }])) })
if (!values.product || !values.host || !values.output) throw new Error('Use --product --host --output (new synthetic directory)')
const product = resolve(values.product), hostRoot = resolve(values.host), output = resolve(values.output)
assert.equal(JSON.parse(await readFile(join(product, 'assembly.json'), 'utf8')).pluginMode, 'source-qualification')
await mkdir(output)
const home = join(output, 'home'), config = join(output, 'eduwork.jsonc')
await writeFile(config, '{"schemaVersion":1,"product":{"name":"Synthetic desktop"}}\n')
const secrets = new Map()
// Only the credential storage implementation is synthetic. Exercise the actual
// authenticated native bridge, stdin bootstrap and installed credential plugin.
const vault = { async flush() {}, async operation(operation, ref, value) {
  if (operation === 'set') secrets.set(ref, value)
  if (operation === 'unset') secrets.delete(ref)
  return { configured: secrets.has(ref), writable: true, source: 'synthetic-memory',
    ...(operation === 'resolve' && secrets.has(ref) ? { value: secrets.get(ref) } : {}) }
} }
const bridge = await startNativeBridge({ vault, openExternal() { throw new Error('Unexpected external navigation in synthetic probe') } })
const { DesktopHostProcess } = await import(pathToFileURL(join(hostRoot, 'host-process.mjs')).href)
const { authenticateWebHost } = await import(pathToFileURL(join(hostRoot, 'web-document.mjs')).href)
let host
const logs = []
const report = { success: false, scope: 'assembled source product; synthetic credentials; no source import hooks', boots: [], rpc: [] }
try {
  for (const round of [1, 2]) {
    const prepared = await prepareProductProfile({ product, home, shell: 'electron', userConfig: config })
    host = new DesktopHostProcess(process.execPath, join(product, 'd'), prepared.profile, undefined,
      { ...process.env, ...prepared.environment }, undefined, undefined, undefined, undefined,
      { bootstrap: bridge.bootstrap, onLog: line => logs.push(line) })
    const ready = await host.start(), origin = new URL(ready.url).origin
    const cookie = await authenticateWebHost(ready.url)
    const rpc = async (method, args = {}) => {
      const rpcId = randomUUID()
      const response = await fetch(origin + '/api/' + method, { method: 'POST',
        headers: { cookie, origin, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }) })
      assert.equal(response.status, 200, method)
      const body = await response.json()
      assert.equal(body.type, 'server-response'); assert.equal(body.rpcId, rpcId)
      assert.equal(body.result?.ok, true, method + ': ' + JSON.stringify(body.result?.error))
      return body.result.value
    }
    for (const method of ['oidcAccounts/configuration', 'knowledgeStudio/listCapabilities', 'localMemories/stats', 'productComponents/list', 'skillManager/list']) {
      await rpc(method)
      if (round === 1) report.rpc.push(method)
    }
    assert.equal((await fetch(origin)).status, 401)
    assert.equal((await fetch(origin, { headers: { cookie } })).status, 200)
    const plugins = await rpc('pluginManager/listPlugins')
    const failed = plugins.filter(row => row.enabled && row.fiberPhase === 'failed')
    assert.equal(failed.length, 0, JSON.stringify(failed))
    assert.ok(plugins.some(row => row.patchId === 'chatecnu-brand' && row.enabled))
    report.boots.push({ round, plugins: plugins.length, authenticated: true })
    await host.stop(); host = undefined
  }
  assert.ok(secrets.size > 0, 'Installed connection did not exercise the native credential bridge')
  assert.ok(!logs.join('').includes(bridge.bootstrap.nativeBridge.token))
  report.success = true
} finally {
  await host?.stop()
  await bridge.close()
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  // The report contains no secrets; raw startup logs remain local to the probe.
  await writeFile(join(output, 'host.log'), logs.join(''))
}
console.log(JSON.stringify(report, null, 2))
