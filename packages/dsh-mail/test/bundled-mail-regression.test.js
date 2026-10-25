import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

test('shipped parser handles the DoS regressions and ordinary read/send traffic', async () => {
  const files = (await readdir(new URL('../lib/', import.meta.url))).filter(name => /^mail-client-.*\.js$/.test(name))
  assert.equal(files.length, 1, 'Expected the actual lazily loaded protocol bundle')
  // A separate process is essential: a synchronous parser loop also blocks
  // AbortSignal/timers in its own process. Bound the regression test externally.
  const { stdout } = await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL('../scripts/fixtures/mail-protocol-regression.mjs', import.meta.url)),
    fileURLToPath(new URL('../lib/' + files[0], import.meta.url)),
  ], { timeout: 15_000, maxBuffer: 1024 * 1024 })
  const result = JSON.parse(stdout)
  assert.equal(result.received.length, 4)
  assert.equal(result.smtp, 'passed')
  assert.equal(result.readOnly, true)
})
