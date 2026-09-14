import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { adaptHostEntry, adaptHostProcess } from '../prepare.mjs'
import { Decoder, encodeFrame, CHUNK_BYTES } from '../wire.mjs'

test('outer frames retain binary bytes and fragmented headers without base64', () => {
  const bytes = Buffer.from([0, 255, 13, 10, 1])
  const frame = encodeFrame(2, 99, bytes)
  const decoder = new Decoder(), result = []
  for (const byte of frame) result.push(...decoder.push(Buffer.from([byte])))
  decoder.finish()
  assert.equal(result.length, 1)
  assert.deepEqual(result[0], { type: 2, streamId: 99, payload: bytes })
  assert.throws(() => encodeFrame(2, 1, Buffer.alloc(CHUNK_BYTES + 1)), /invalid/)
  const partial = new Decoder(); partial.push(frame.subarray(0, 8))
  assert.throws(() => partial.finish(), /truncated/)
})

test('adaptation fails closed if locked upstream targets move', () => {
  assert.throws(() => adaptHostEntry('changed source'), /target changed/)
  assert.throws(() => adaptHostProcess('changed source'), /target changed/)
})

test('shared Host changes preserve product roots and carry bootstrap only on stdin', { skip: !process.env.DSH_HOST_SOURCE }, async () => {
  const processSource = await readFile(join(process.env.DSH_HOST_SOURCE, 'apps/desktop/src/host-process.ts'), 'utf8')
  const entrySource = await readFile(join(process.env.DSH_HOST_SOURCE, 'apps/desktop-host/src/index.ts'), 'utf8')
  const adapted = adaptHostProcess(processSource)
  assert.match(adapted, /child\.stdin\?\.end\(bootstrap\)/)
  assert.match(adapted, /child\.stdout\?\.pipe\(process\.stderr\)/)
  assert.match(adapted, /windowsHide: true/)
  assert.match(adaptHostEntry(entrySource), /roots: Array\.isArray/)
  assert.doesNotMatch(adaptHostEntry(entrySource), /closeSync/)
  assert.match(adaptHostEntry(entrySource), /requestPipe\.destroy\(\)/)
  assert.match(adaptHostEntry(entrySource), /responsePipe\.destroy\(\)/)
  const argv = adapted.slice(adapted.indexOf('spawn(this.node'), adapted.indexOf('cwd:'))
  assert.doesNotMatch(argv, /bootstrap/)
})
