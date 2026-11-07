import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import test from 'node:test'
import { INSTALLED_STARTUP_ARGUMENT, installedStartupId, superviseInstalledStartup } from '../src/installed-startup-check.mjs'

const moduleURL = new URL('../src/installed-startup-check.mjs', import.meta.url).href
function candidate(argument, body) {
  return spawn(process.execPath, ['--input-type=module', '-e', body, '--', argument], { stdio: 'ignore' })
}

test('the installed candidate receives confirmation only after reporting readiness', async () => {
  let exited
  const result = await superviseInstalledStartup({
    start: argument => {
      const child = candidate(argument, `
        import assert from 'node:assert/strict'
        import { connectInstalledStartup, installedStartupId } from ${JSON.stringify(moduleURL)}
        const connection = connectInstalledStartup(installedStartupId(process.argv.slice(1)), () => process.exit(4))
        assert.equal(await connection.ready(), true)
        assert.equal(connection.pending, false)
      `)
      exited = once(child, 'exit')
      return child
    },
    waitForStop: () => assert.fail('the installer must keep the ready app running'),
    timeout: 5000,
  })
  assert.deepEqual(result, { ready: true })
  assert.deepEqual(await exited, [0, null])
})

test('a candidate exit before readiness allows recovery only after the process check', async () => {
  let child, checked = false
  const result = await superviseInstalledStartup({
    start: argument => (child = candidate(argument, 'process.exit(17)')),
    waitForStop: () => { assert.equal(child.exitCode, 17); checked = true },
    timeout: 5000,
  })
  assert.equal(checked, true)
  assert.equal(result.ready, false)
  assert.match(result.failure, /17/u)
})

test('a candidate that reports readiness but exits before acknowledging cannot commit', async () => {
  const result = await superviseInstalledStartup({
    start: argument => candidate(argument, `
      import { createConnection } from 'node:net'
      import { tmpdir } from 'node:os'
      import { join } from 'node:path'
      import { installedStartupId } from ${JSON.stringify(moduleURL)}
      const id = installedStartupId(process.argv.slice(1))
      const socket = createConnection(process.platform === 'win32'
        ? ${JSON.stringify('\\\\.\\pipe\\eduwork-update-')} + id : join(tmpdir(), 'ew-update-' + id + '.sock'))
      socket.on('connect', () => socket.write('R', () => process.exit(17)))
    `),
    waitForStop: () => {},
    timeout: 5000,
  })
  assert.equal(result.ready, false)
})

test('startup timeout tells a connected candidate to quit before the installer checks its processes', async () => {
  let child
  const result = await superviseInstalledStartup({
    start: argument => (child = candidate(argument, `
      import { connectInstalledStartup, installedStartupId } from ${JSON.stringify(moduleURL)}
      connectInstalledStartup(installedStartupId(process.argv.slice(1)), () => process.exit(18))
    `)),
    waitForStop: () => assert.equal(child.exitCode, 18),
    timeout: 1500,
  })
  assert.equal(result.ready, false)
  assert.match(result.failure, /超时/u)
})

test('a candidate that remains alive after timeout blocks directory recovery', async t => {
  let child
  t.after(() => child?.kill())
  await assert.rejects(superviseInstalledStartup({
    start: argument => (child = candidate(argument, 'setInterval(() => {}, 1000)')),
    waitForStop: () => assert.fail('a process snapshot cannot replace waiting for the candidate exit'),
    timeout: 400,
    stopTimeout: 200,
  }), /仍在运行/u)
})

test('only one valid installer startup token is accepted', () => {
  const argument = INSTALLED_STARTUP_ARGUMENT + '11111111-1111-1111-1111-111111111111'
  assert.equal(installedStartupId(['--updated']), undefined)
  assert.equal(installedStartupId(['--updated', argument]), '11111111-1111-1111-1111-111111111111')
  assert.throws(() => installedStartupId([INSTALLED_STARTUP_ARGUMENT + 'other-pipe']), /无效/u)
  assert.throws(() => installedStartupId([argument, argument]), /无效/u)
})
