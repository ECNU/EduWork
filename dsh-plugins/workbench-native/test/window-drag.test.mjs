import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

// The skills page drags the window through the DSH shell's attribute rules, not
// an API: a DSH release that changed them would leave the page undraggable
// without any error. Needs EDUWORK_TEST_ELECTRON and EDUWORK_TEST_RUNTIME.
const electron = process.env.EDUWORK_TEST_ELECTRON, runtime = process.env.EDUWORK_TEST_RUNTIME

test('the pinned DSH shell drags marked rows, excludes marked overlays and releases inert rows on macOS', { skip: !(electron && runtime) }, async () => {
  const userData = await mkdtemp(join(tmpdir(), 'eduwork-window-drag-'))
  try {
    const { stdout } = await promisify(execFile)(electron, [
      fileURLToPath(new URL('window-drag.electron.mjs', import.meta.url)),
      join(runtime, 'node_modules/@deepseek-ai/dsh-client-web/lib/base.css'),
      userData,
    ], { timeout: 30_000, killSignal: 'SIGKILL' })
    assert.deepEqual(JSON.parse(stdout), { row: 'drag', overlay: 'no-drag', inertRow: 'none' })
  } finally {
    await rm(userData, { recursive: true, force: true, maxRetries: 5 })
  }
})
