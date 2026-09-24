// Whole assembled candidate, without source resolution hooks or user data.
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { prepareProductProfile } from '../dsh-host/product-profile.mjs'
import { startNativeBridge } from '../dsh-electron/src/native-vault.mjs'
import { TaskNotifications } from '../dsh-electron/src/task-notifications.mjs'

const { values } = parseArgs({ options: Object.fromEntries(['product', 'host', 'output'].map(key => [key, { type: 'string' }])) })
if (!values.product || !values.host || !values.output) throw new Error('Use --product --host --output (new synthetic directory)')
const product = resolve(values.product), hostRoot = resolve(values.host), output = resolve(values.output)
assert.equal(JSON.parse(await readFile(join(product, 'assembly.json'), 'utf8')).pluginMode, 'source-qualification')
await mkdir(output)
const home = join(output, 'home'), config = join(output, 'eduwork.jsonc')
await writeFile(config, '{"schemaVersion":1,"product":{"name":"Synthetic desktop"},"desktop":{"notifications":{"preview":true}}}\n')
await mkdir(home)
await writeFile(join(home, 'settings.yaml'), '{"eduwork-notifications":{"preview":false,"completed":false}}\n')
const workspace = join(output, '中文 workspace')
await mkdir(workspace)
await writeFile(join(workspace, 'history.md'), '# Persistent preview')
await writeFile(join(output, 'outside.md'), 'Not authorized by the session workspace')
const secrets = new Map()
// Only the credential storage implementation is synthetic. Exercise the actual
// authenticated native bridge, stdin bootstrap and installed credential plugin.
const vault = { async flush() {}, async operation(operation, ref, value) {
  if (operation === 'set') secrets.set(ref, value)
  if (operation === 'unset') secrets.delete(ref)
  return { configured: secrets.has(ref), writable: true, source: 'synthetic-memory',
    ...(operation === 'resolve' && secrets.has(ref) ? { value: secrets.get(ref) } : {}) }
} }
const notifications = new TaskNotifications({ foreground: () => false, show() {}, publish() {}, dismiss() {}, changed() {} })
const bridge = await startNativeBridge({ vault, attention: body => notifications.handle(body), openExternal() { throw new Error('Unexpected external navigation in synthetic probe') } })
const { DesktopHostProcess } = await import(pathToFileURL(join(hostRoot, 'host-process.mjs')).href)
const { authenticateWebHost } = await import(pathToFileURL(join(hostRoot, 'web-document.mjs')).href)
let host
const logs = []
const report = { success: false, scope: 'assembled source product; synthetic credentials; no source import hooks', boots: [], rpc: [] }
let memoryId, previewSessionId
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
    const notificationSettings = (await rpc('settings/describe')).namespaces.find(row => row.ns === 'eduwork-notifications')
    assert.ok(notificationSettings, 'Native notification settings did not activate')
    assert.equal(notificationSettings.value.preview, round === 2)
    assert.equal(notificationSettings.value.completed, false)
    assert.equal((await rpc('workbench/notificationView', { view: { sessionId: '' } })).desktop, true)
    if (round === 1) {
      await assert.rejects(rpc('settings/update', { ns: 'eduwork-notifications', patch: { preview: 'invalid' } }))
      await rpc('settings/update', { ns: 'eduwork-notifications', patch: { preview: true } })
    }
    for (let attempt = 0; notifications.preferences?.preview !== true && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 25))
    assert.equal(notifications.preferences?.preview, true, 'Native settings changes must reach the shell without a restart')
    report.notifications = ['legacy-preference-migration', 'native-validation', 'authenticated-bridge', 'live-update', ...(round === 2 ? ['restart-persistence'] : [])]
    // Exercise actual SQLite persistence and native RPC serialization, not just
    // service registration. Only this probe's new synthetic home is modified.
    const memoryRequest = request => ({ request: JSON.stringify(request) })
    if (round === 1) {
      previewSessionId = (await rpc('session/create', { request: { cwd: workspace } })).sessionId
      assert.equal((await rpc('artifactPreview/read', { sessionId: previewSessionId, relativePath: 'history.md' })).data, '# Persistent preview')
      const imported = await rpc('localMemories/importData', { document: JSON.stringify({ records: [
        { content: 'Synthetic qualification preference: use the lavender notebook.', kind: 'preference', scope: 'user' },
      ] }) })
      assert.equal(imported.imported, 1)
      const listed = await rpc('localMemories/listRecords', memoryRequest({ query: 'lavender' }))
      assert.equal(listed.total, 1)
      memoryId = listed.items[0].id
      const edited = await rpc('localMemories/updateRecord', memoryRequest({ id: memoryId, content: 'Synthetic qualification preference: use the amber notebook.' }))
      assert.equal(edited.updated, true)
      await rpc('localMemories/setRecordPinned', memoryRequest({ id: memoryId, pinned: true }))
      const removed = await rpc('localMemories/deleteRecord', memoryRequest({ id: memoryId, mode: 'forget' }))
      assert.equal(removed.deleted, true)
      assert.equal(removed.suppressionCreated, true)
      assert.equal((await rpc('localMemories/undoDelete', { token: removed.undoToken })).restored, true)
    } else {
      // Browsing a persisted session must not require prompting an Agent first.
      const preview = await rpc('artifactPreview/read', { sessionId: previewSessionId, relativePath: 'history.md' })
      assert.equal(preview.data, '# Persistent preview')
      assert.equal(await (await fetch(origin + preview.downloadUrl, { headers: { cookie } })).text(), preview.data)
      await assert.rejects(rpc('artifactPreview/read', { sessionId: previewSessionId, relativePath: '../outside.md' }), /inside the current workspace/)
      await assert.rejects(rpc('artifactPreview/read', { sessionId: 'unknown-synthetic-session', relativePath: 'history.md' }), /workspace is unavailable/)
      report.preview = ['live-session', 'cold-session-after-restart', 'download-bytes', 'workspace-escape-rejected', 'unknown-session-rejected']
      const saved = await rpc('localMemories/listRecords', memoryRequest({ query: 'amber' }))
      assert.equal(saved.total, 1)
      assert.equal(saved.items[0].id, memoryId)
      assert.ok(saved.items[0].userPinnedAt)
      const exported = JSON.parse(await rpc('localMemories/exportData'))
      assert.equal(exported.records[0].content, saved.items[0].content)
      const removed = await rpc('localMemories/deleteRecord', memoryRequest({ id: memoryId, mode: 'forget' }))
      assert.equal(removed.deleted, true)
      const stats = await rpc('localMemories/stats')
      assert.equal(stats.total, 0)
      assert.equal(stats.suppressed, 1)
      report.memory = ['import', 'search', 'edit', 'pin', 'forget', 'undo', 'restart-persistence', 'export']
    }
    assert.equal((await fetch(origin)).status, 401)
    assert.equal((await fetch(origin, { headers: { cookie } })).status, 200)
    const plugins = await rpc('pluginManager/listPlugins')
    const failed = plugins.filter(row => row.enabled && row.fiberPhase === 'failed')
    assert.equal(failed.length, 0, JSON.stringify(failed))
    assert.ok(plugins.some(row => row.patchId === 'chatecnu-brand' && row.enabled))
    for (const id of ['literature', 'literature-dblp', 'literature-arxiv', 'tool-literature']) {
      assert.ok(plugins.some(row => row.patchId === id && row.enabled && row.fiberPhase === 'active'), `Literature plugin not active: ${id}`)
    }
    report.boots.push({ round, plugins: plugins.length, authenticated: true })
    await host.stop(); host = undefined
  }
  assert.ok(secrets.size > 0, 'Installed connection did not exercise the native credential bridge')
  assert.ok(!logs.join('').includes(bridge.bootstrap.nativeBridge.token))
  assert.ok(!logs.join('').includes('is incompatible with dsh'), 'Candidate composition contains incompatible plugin declarations')
  report.success = true
} finally {
  await host?.stop()
  await bridge.close()
  notifications.close()
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  // The report contains no secrets; raw startup logs remain local to the probe.
  await writeFile(join(output, 'host.log'), logs.join(''))
}
console.log(JSON.stringify(report, null, 2))
