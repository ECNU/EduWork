// Exercises the packaged executable and its real child processes, with isolated
// data. No forced termination is used to turn a failed graceful exit into a pass.
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { parseArgs, promisify } from 'node:util'
const { values } = parseArgs({ options: Object.fromEntries(['executable', 'evidence', 'port', 'mode'].map(name => [name, { type: 'string' }])) })
for (const name of ['executable', 'evidence', 'port', 'mode']) assert.ok(values[name])
assert.ok(['loading', 'ready'].includes(values.mode))
const port = Number(values.port); assert.ok(Number.isInteger(port) && port > 1024 && port < 65536)
const executable = resolve(values.executable), evidence = resolve(values.evidence)
assert.doesNotMatch(executable, /[\\/]current[\\/]/iu)
await mkdir(evidence, { recursive: true })
const environment = { ...process.env, EDUWORK_DESKTOP_TEST_DATA_ROOT: join(evidence, 'data') }
delete environment.EDUWORK_DESKTOP_PRIVATE_CONFIG
const started = Date.now()
const child = spawn(executable, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port], { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
child.stdout.pipe(createWriteStream(join(evidence, 'stdout.log')))
child.stderr.pipe(createWriteStream(join(evidence, 'stderr.log')))
let exited, childError
child.once('exit', (code, signal) => { exited = { code, signal, elapsedMs: Date.now() - started } })
child.once('error', error => { childError = error.message })
const run = promisify(execFile)
const processes = async () => {
  const { stdout } = await run('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate | ConvertTo-Json -Compress'], { windowsHide: true })
  return JSON.parse(stdout)
}
const descendants = (all, root) => {
  const ids = new Set([root]); let changed
  do { changed = false; for (const row of all) if (ids.has(row.ParentProcessId) && !ids.has(row.ProcessId)) { ids.add(row.ProcessId); changed = true } } while (changed)
  return all.filter(row => ids.has(row.ProcessId))
}
const origin = 'http://127.0.0.1:' + port
const result = { passed: false, mode: values.mode, pid: child.pid }
try {
  let targets, reached = false
  for (let i = 0; i < 400; i++) {
    assert.equal(childError, undefined)
    assert.equal(exited, undefined, 'Application stays alive until the tested close')
    targets = await fetch(origin + '/json/list').then(response => response.json()).catch(() => [])
    reached = targets.some(target => values.mode === 'loading' ? target.url.startsWith('data:text/html') : target.url.startsWith('dsh-app://app/'))
    if (reached) break
    await new Promise(done => setTimeout(done, 50))
  }
  assert.ok(reached, 'Observed the requested real window stage')
  result.stageObservedMs = Date.now() - started
  result.before = descendants(await processes(), child.pid)
  const version = await (await fetch(origin + '/json/version')).json()
  const ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    let opened = false
    ws.onopen = () => { opened = true; ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })) }
    ws.onclose = resolve
    ws.onerror = () => { if (opened) resolve(); else reject(new Error('CDP did not open')) }
  })
  for (let i = 0; i < 400 && !exited; i++) await new Promise(done => setTimeout(done, 50))
  assert.ok(exited, 'Graceful close completed')
  assert.equal(exited.code, 0)
  const after = await processes()
  result.survivors = after.filter(row => result.before.some(before => before.ProcessId === row.ProcessId && before.CreationDate === row.CreationDate))
  assert.deepEqual(result.survivors, [])
  result.passed = true
} catch (error) { result.error = error.message; process.exitCode = 1 }
finally {
  result.exit = exited
  await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ passed: result.passed, mode: values.mode, evidence }))
}
