import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { readBootstrap, validateBootstrap } from '../lib/bootstrap.js'

const TOKEN = 'A'.repeat(43)

test('valid bootstrap is frozen and loopback-only', () => {
  const value = validateBootstrap({
    schemaVersion: 1,
    instanceCredential: TOKEN,
    nativeBridge: { baseURL: 'http://127.0.0.1:1234', token: TOKEN },
  })
  assert.equal(value.nativeBridge.baseURL, 'http://127.0.0.1:1234')
  assert.equal(Object.isFrozen(value.nativeBridge), true)
  assert.throws(() => validateBootstrap({
    schemaVersion: 1,
    instanceCredential: TOKEN,
    nativeBridge: { baseURL: 'https://example.com', token: TOKEN },
  }), /loopback|invalid/u)
})

test('bootstrap is read once from stdin JSON', async () => {
  const stream = new PassThrough()
  const result = readBootstrap(stream, 500)
  stream.end(`${JSON.stringify({ schemaVersion: 1, instanceCredential: TOKEN, nativeBridge: { baseURL: 'http://127.0.0.1:2345', token: TOKEN } })}\n`)
  assert.equal((await result).nativeBridge.token, TOKEN)
})

test('a busy cold start reads already supplied pipe data before declaring a timeout', async () => {
  const moduleURL = new URL('../lib/bootstrap.js', import.meta.url).href
  const script = `import { readBootstrap } from ${JSON.stringify(moduleURL)};
    const bootstrap = readBootstrap(process.stdin, 30);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    await bootstrap;
    console.log('received');`
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  let stdout = '', stderr = ''
  child.stdout.on('data', bytes => { stdout += bytes })
  child.stderr.on('data', bytes => { stderr += bytes })
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolve(code))
  })
  child.stdin.end(JSON.stringify({ schemaVersion: 1, instanceCredential: TOKEN,
    nativeBridge: { baseURL: 'http://127.0.0.1:2345', token: TOKEN } }) + '\n')
  assert.equal(await exited, 0, stderr)
  assert.equal(stdout.trim(), 'received')
})

test('a missing bootstrap still times out and releases stream listeners', async () => {
  const stream = new PassThrough()
  const keepAlive = setInterval(() => {}, 100)
  try {
    await assert.rejects(readBootstrap(stream, 15), /was not supplied/)
    assert.equal(stream.listenerCount('data'), 0)
    assert.equal(stream.listenerCount('end'), 0)
    assert.equal(stream.listenerCount('error'), 0)
  } finally { clearInterval(keepAlive); stream.destroy() }
})
