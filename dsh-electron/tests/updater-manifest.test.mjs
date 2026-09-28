import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const script = join(repo, 'dsh-electron/scripts/set-updater-manifest.ps1')
const run = (command, args, options={}) => spawnSync(command, args, {encoding:'utf8', windowsHide:true, ...options})
const success = result => assert.equal(result.status, 0, result.error?.message ?? result.stdout+'\n'+result.stderr)

test('compiled updater requires an embedded asInvoker manifest and remains executable after embedding', {skip:process.platform!=='win32'}, t => {
  const root = mkdtempSync(join(tmpdir(), 'eduwork-updater-manifest-'))
  t.after(() => {
    if (!resolve(root).startsWith(resolve(tmpdir())+sep+'eduwork-updater-manifest-')) throw Error('Unsafe test cleanup path')
    rmSync(root, {recursive:true, force:true})
  })
  const executable = join(root, 'EduWork-Updater.exe')
  success(run('go', ['build', '-buildvcs=false', '-trimpath', '-ldflags', '-s -w -H windowsgui', '-o', executable, './cmd/eduwork-updater'], {
    cwd:join(repo, 'dsh-desktop'), env:{...process.env, GOOS:'windows', GOARCH:'amd64'},
  }))
  const verify = file => run('pwsh', ['-NoProfile', '-File', script, '-Executable', file, '-VerifyOnly'])
  const original = readFileSync(executable)
  assert.notEqual(verify(executable).status, 0, 'An unmanifested Go executable must fail validation')
  assert.deepEqual(readFileSync(executable), original, 'Validation must never rewrite the binary')
  // A sidecar is not enough: the released executable must carry its own policy.
  writeFileSync(executable+'.manifest', readFileSync(join(repo, 'dsh-electron/scripts/updater.manifest')))
  assert.notEqual(verify(executable).status, 0, 'External manifest must not substitute for an embedded resource')

  success(run('pwsh', ['-NoProfile', '-File', script, '-Executable', executable]))
  const embedded = readFileSync(executable)
  success(verify(executable))
  assert.deepEqual(readFileSync(executable), embedded)
  const launch = run(executable, ['--help'])
  assert.equal(launch.error, undefined)
  assert.equal(launch.status, 1)
  assert.match(launch.stderr, /unsupported mode/, 'The real helper must reach argument handling; this is not a full update test')

  // Change the actual PE resource without changing its length, not the source
  // XML. Verification must reject binaries whose embedded policy was changed.
  for (const [name, from, to] of [
    ['administrator', 'level="asInvoker" uiAccess="false"', 'level="requireAdministrator"'],
    ['ui-access', 'uiAccess="false"', 'uiAccess="true"'],
    ['wrong-case', 'asInvoker', 'ASINVOKER'],
  ]) {
    const bytes = Buffer.from(embedded), index = bytes.indexOf(from)
    assert.ok(index>=0, 'Expected embedded manifest bytes')
    bytes.write(to.padEnd(Buffer.byteLength(from)), index, 'utf8')
    const changed = join(root, name+'.exe')
    writeFileSync(changed, bytes)
    const result = verify(changed)
    assert.notEqual(result.status, 0, name+' must fail validation')
    assert.match(result.stdout+result.stderr, /must explicitly request asInvoker/)
    assert.deepEqual(readFileSync(changed), bytes, 'Rejection must not silently repair the package')
  }
})
