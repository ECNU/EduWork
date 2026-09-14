import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { revealInFileManager } from '../lib/reveal.js'

test('Windows reveal waits for Explorer handoff and accepts its delegated exit code 1', async () => {
  const child = new EventEmitter()
  let call
  const started = revealInFileManager('C:\\work\\report.pdf', undefined, {
    platform: 'win32',
    execFile: () => { throw new Error('execFile must not be used on Windows') },
    spawn(command, args, options) {
      call = { command, args, options }
      return child
    },
  })
  let resolved = false
  started.then(() => { resolved = true })
  child.emit('spawn')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(resolved, false, 'RPC cancellation must not interrupt an unfinished Explorer handoff')
  child.emit('exit', 1)
  await started
  assert.equal(call.command, 'explorer.exe')
  assert.deepEqual(call.args, ['/select,"C:\\work\\report.pdf"'])
  assert.equal(call.options.stdio, 'ignore')
  assert.equal(call.options.windowsHide, false)
  assert.equal(call.options.windowsVerbatimArguments, true)
})

test('Windows reveal preserves Unicode, spaces, commas and literal shell characters', async () => {
  const target = 'C:\\reports\\报告 2026,09\\draft & 100% #1.md'
  let args
  await revealInFileManager(target, undefined, { platform: 'win32', spawn(command, argv) {
    args = argv
    const child = new EventEmitter()
    queueMicrotask(() => child.emit('exit', 1))
    return child
  } })
  assert.deepEqual(args, [`/select,"${target}"`])
  const runtime = { platform: 'win32', spawn() { throw new Error('must not spawn') } }
  for (const invalid of ['relative.txt', 'C:\\file".txt', 'C:\\file\0.txt']) {
    assert.throws(() => revealInFileManager(invalid, undefined, runtime), /absolute Windows file path/)
  }
  assert.throws(() => revealInFileManager(target, AbortSignal.abort(new Error('cancelled')), runtime), /cancelled/)
})

test('Windows reveal reports an Explorer launch failure', async () => {
  const child = new EventEmitter()
  const started = revealInFileManager('C:\\work\\report.pdf', undefined, {
    platform: 'win32', execFile() {},
    spawn() {
      queueMicrotask(() => child.emit('error', new Error('not found')))
      return child
    },
  })
  await assert.rejects(started, /not found/)
})
