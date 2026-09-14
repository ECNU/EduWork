import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('..', import.meta.url))
const helper = join(root, 'scripts/with-eduwork-upstream-lock.ps1')
const prepare = join(root, 'scripts/prepare-eduwork-web-runtime.ps1')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) {
  const deadline = Date.now() + 20000
  while (!check()) { assert.ok(Date.now() < deadline, 'fixture process did not reach the expected state'); await pause(50) }
}
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'eduwork-lock-'))
  const children = []
  t.after(async () => {
    for (const child of children) { if (child.process.exitCode === null) child.process.kill(); await child.done }
    rmSync(directory, { recursive: true, force: true })
  })
  const put = (path, value) => { const target = join(directory, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value); return target }
  function run(script, args = []) {
    const process = spawn('pwsh', ['-NoLogo', '-NoProfile', '-File', script, ...args], { windowsHide: true })
    const child = { process, output: '' }
    process.stdout.on('data', data => { child.output += data })
    process.stderr.on('data', data => { child.output += data })
    child.done = new Promise((resolve, reject) => { process.on('error', reject); process.on('close', code => resolve(code)) })
    children.push(child)
    return child
  }
  const worker = put('worker.ps1', `param([string]$Helper,[string]$Upstream,[string]$Entered,[string]$Gate='')
$ErrorActionPreference='Stop'
. $Helper
Invoke-WithEduworkUpstreamLock -Upstream $Upstream -Action {
  Set-Content -LiteralPath $Entered -Value 'entered'
  if($Gate){while(-not (Test-Path -LiteralPath $Gate)){Start-Sleep -Milliseconds 50}}
}
`)
  const start = (upstream, entered, gate = '') => run(worker, ['-Helper', helper, '-Upstream', upstream, '-Entered', entered, '-Gate', gate])
  return { directory, put, run, start }
}

test('independent processes serialize equivalent source paths but allow distinct source trees', async t => {
  const f = fixture(t), source = join(f.directory, 'source')
  const firstEntered = join(f.directory, 'first'), secondEntered = join(f.directory, 'second'), gate = join(f.directory, 'gate')
  const first = f.start(source, firstEntered, gate)
  await until(() => existsSync(firstEntered))
  let equivalent = resolve(source) + '/./'
  if (process.platform === 'win32') equivalent = equivalent.toUpperCase()
  const second = f.start(equivalent, secondEntered)
  await until(() => second.output.includes('Waiting for shared source build lock'))
  assert.equal(existsSync(secondEntered), false)
  const independent = f.start(join(f.directory, 'other'), join(f.directory, 'third'))
  assert.equal(await independent.done, 0, independent.output)
  assert.equal(existsSync(secondEntered), false)
  writeFileSync(gate, 'release')
  assert.equal(await first.done, 0, first.output)
  assert.equal(await second.done, 0, second.output)
  assert.ok(existsSync(secondEntered))
})

test('a killed owner does not strand waiting builds', async t => {
  const f = fixture(t), source = join(f.directory, 'source')
  const firstEntered = join(f.directory, 'first'), nextEntered = join(f.directory, 'next')
  const first = f.start(source, firstEntered, join(f.directory, 'never-released'))
  await until(() => existsSync(firstEntered))
  const next = f.start(source, nextEntered)
  await until(() => next.output.includes('Waiting for shared source build lock'))
  first.process.kill()
  await first.done
  assert.equal(await next.done, 0, next.output)
  assert.ok(existsSync(nextEntered))
})

test('exceptions release the lock and preserve action results', async t => {
  const f = fixture(t), script = f.put('exception.ps1', `param([string]$Helper,[string]$Upstream)
$ErrorActionPreference='Stop'
. $Helper
try { Invoke-WithEduworkUpstreamLock -Upstream $Upstream -Action { throw 'expected fixture error' } } catch { if($_.Exception.Message -ne 'expected fixture error'){throw} }
Invoke-WithEduworkUpstreamLock -Upstream $Upstream -Action { Write-Output 'action result' }
`)
  const worker = f.run(script, ['-Helper', helper, '-Upstream', join(f.directory, 'source')])
  assert.equal(await worker.done, 0, worker.output)
  assert.match(worker.output, /action result/)
  const next = f.start(join(f.directory, 'source'), join(f.directory, 'next'))
  assert.equal(await next.done, 0, next.output)
})

test('concurrent prepare entry points recheck the completed runtime inside the source lock', async t => {
  const f = fixture(t), core = join(f.directory, 'core'), output = join(f.directory, 'runtime'), upstream = join(f.directory, 'upstream')
  const lock = { packageVersion: '0.1.5-alpha.1', commit: 'a'.repeat(40), runtime: { source: { installLockSHA256: 'b'.repeat(64) } } }
  f.put('core/third_party/dsh/development-v0.1.5-rc.1/LOCK.json', JSON.stringify(lock))
  f.put('core/dsh-desktop/scripts/sync-dsh-upstream.ps1', `param($Upstream,$LockPath,[switch]$SkipBuild)\nAdd-Content -LiteralPath ($Upstream+'.sync') -Value 'sync'\n`)
  f.put('core/dsh-desktop/scripts/prepare-dsh-runtime.mjs', `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2), get = key => args[args.indexOf(key)+1];
const lock = JSON.parse(readFileSync(get('--lock'),'utf8'));
mkdirSync(get('--output'));
await new Promise(resolve => setTimeout(resolve, 600));
writeFileSync(join(get('--output'),'.chatecnu-dsh-runtime.json'), JSON.stringify({ source: 'source-release-pack', dshVersion: lock.packageVersion, dshCommit: lock.commit, sourceInstallLockSHA256: lock.runtime.source.installLockSHA256 }));
`)
  const args = ['-CoreRoot', core, '-Output', output, '-Upstream', upstream, '-Source', 'source']
  const first = f.run(prepare, args), second = f.run(prepare, args)
  assert.equal(await first.done, 0, first.output)
  assert.equal(await second.done, 0, second.output)
  assert.equal(readFileSync(upstream + '.sync', 'utf8').trim(), 'sync')
  assert.match(first.output + second.output, /Locked Runtime already prepared/)
})
