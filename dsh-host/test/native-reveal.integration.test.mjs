import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { prepare } from '../prepare.mjs'
import { prepareProductProfile } from '../product-profile.mjs'
import { startNativeBridge } from '../../dsh-electron/src/native-vault.mjs'

// Opt-in native acceptance. It opens and closes only a synthetic temporary
// folder; ordinary source CI does not require an interactive Windows desktop.
test('official session RPC reveals and selects a Unicode file through the desktop adapter', {
  skip: process.platform !== 'win32' || !process.env.EDUWORK_TEST_PRODUCT || !process.env.DSH_HOST_SOURCE,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-native-reveal-'))
  const product = resolve(process.env.EDUWORK_TEST_PRODUCT)
  const run = promisify(execFile)
  let host, bridge
  const saved = new Map()
  t.after(async () => {
    await host?.stop()
    await bridge?.close()
    for (const [key, value] of saved) if (value === undefined) delete process.env[key]; else process.env[key] = value
    await rm(root, { recursive: true, force: true })
  })
  await prepare({ upstream: resolve(process.env.DSH_HOST_SOURCE), output: join(root, 'host') })
  const { DesktopHostProcess } = await import(pathToFileURL(join(root, 'host/host-process.mjs')))
  await symlink(join(product, 'd/node_modules'), join(root, 'node_modules'), 'junction')
  await cp(resolve(import.meta.dirname, '../../dsh-plugins/artifact-preview-native/lib'), join(root, 'native'), { recursive: true })
  await writeFile(join(root, 'native/package.json'), '{"type":"module"}')
  const userConfig = join(root, 'config.jsonc')
  await writeFile(userConfig, '{"schemaVersion":1,"organizations":[]}')
  const prepared = await prepareProductProfile({ product, home: join(root, 'home'), shell: 'electron', userConfig })
  // Use this checkout's small native adapter with a previously qualified CI
  // runtime. No files in the original desktop package are modified.
  const patchFile = join(prepared.profile, 'cordis.patch.yml')
  const patch = JSON.parse(await readFile(patchFile, 'utf8'))
  assert.ok(!patch.some(row => row.id === 'session-controller' && row.disabled))
  const controller = patch.flatMap(row => row.insert ?? []).find(row => row.id === 'eduwork-native-reveal')
  assert.ok(controller)
  controller.name = pathToFileURL(join(root, 'native/session-controller.js')).href
  await writeFile(patchFile, JSON.stringify(patch))
  for (const [key, value] of Object.entries(prepared.environment)) { saved.set(key, process.env[key]); process.env[key] = value }
  bridge = await startNativeBridge({ vault: { operation: async () => ({ configured: false, writable: true }), flush: async () => {} }, openExternal: async () => {} })
  host = new DesktopHostProcess(process.execPath, prepared.profile, undefined, { bootstrap: bridge.bootstrap, allowLinkedProfile: true })
  assert.equal((await host.start()).protocolVersion, 3)
  const index = await host.fetch(new Request('http://localhost/'))
  assert.equal(index.status, 200)
  assert.ok((await index.text()).includes('@deepseek-ai/dsh-api-session-controller'), 'official client contribution must remain in the boot graph')
  const folder = join(root, '报告 2026,09'), target = join(folder, '回复邮件 & 100% #1.md')
  await mkdir(folder)
  await writeFile(target, 'Synthetic file-manager acceptance fixture')
  const response = await host.fetch(new Request('http://localhost/api/session/openWorkspacePath', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'native-reveal', method: 'session/openWorkspacePath', payload: { args: { request: { path: target, action: 'reveal' } } } }),
  }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).result.value.opened, true)
  // A successful RPC/process exit alone did not catch the original regression.
  // Inspect Explorer's actual selected file, then close only this test folder.
  const literal = value => "'" + value.replaceAll("'", "''") + "'"
  const script = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
    $app=New-Object -ComObject Shell.Application
    $folder=${literal(folder)}; $windows=@()
    for($i=0;$i-lt30;$i++) {
      $windows=@($app.Windows()|Where-Object {try{$_.Document.Folder.Self.Path -eq $folder}catch{$false}})
      if($windows.Count){break}; Start-Sleep -Milliseconds 100
    }
    try { ConvertTo-Json -InputObject @($windows|ForEach-Object {@($_.Document.SelectedItems())|ForEach-Object Path}) -Compress }
    finally {foreach($window in $windows){$window.Quit()}}`
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true })
  assert.deepEqual(JSON.parse(stdout.trim()), [target])
})
