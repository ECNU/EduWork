import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { once } from 'node:events'
import { bindRedactedLog } from '../redacted-log.mjs'

test('split launch credentials never escape and oversized lines stay bounded', async () => {
  const stream = new PassThrough(), logs = []
  bindRedactedLog(stream, line => logs.push(line), 96)
  for (const part of ['launch /?to', 'ken=first', '-second', '&view=home\n', 'x'.repeat(100), 'token-tail\n', 'ready']) stream.write(part)
  stream.end(); await once(stream, 'end')
  assert.deepEqual(logs, ['launch /?token=[redacted]&view=home\n', '[oversized Host log omitted]\n', 'ready\n'])
})
