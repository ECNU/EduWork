// Run inside disposable, signed v1/v2 app fixtures with a trusted local appcast.
// The real updater sends quit events; only the task guard's answer is controlled.
import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import { app } from 'electron'
import { DesktopExit } from '../src/desktop-exit.mjs'

export async function verifyQuitRetry({ software, version, evidence }) {
  const record = (event, details = {}) => appendFileSync(evidence, JSON.stringify({event, version, ...details}) + '\n')
  if (version === '2') { record('updated-and-relaunched'); return }
  assert.equal(version, '1', 'Use the disposable version-1 fixture')
  let attempts = 0, requested = false, retried = false, cancelledAt = 0
  const exit = new DesktopExit({
    confirm: async () => {
      const accepted = ++attempts > 1
      record('native-quit-guard', {accepted})
      if (!accepted) cancelledAt = Date.now()
      return accepted
    },
    close: async () => record('cleanup'),
    relaunch: () => app.relaunch(), quit: () => app.quit(),
    failed: error => { throw error },
  })
  app.on('before-quit', event => {
    if (exit.complete) return
    event.preventDefault()
    void exit.request()
  })
  await software.action('disable-automatic-download')
  await software.action('download-update')
  const deadline = Date.now() + 90000
  let reading = false
  const timer = setInterval(async () => {
    if (reading) return
    reading = true
    try {
      const {update} = await software.action('status')
      assert.notEqual(update.state, 'error', update.error)
      assert.ok(Date.now() < deadline, 'Native quit/retry timed out')
      if (update.state === 'ready' && !requested) {
        requested = true
        record('install-requested')
        await software.action('install-update')
      } else if (cancelledAt && Date.now() - cancelledAt > 1000 && !retried) {
        assert.equal(update.state, 'ready', 'Cancellation must leave installation retryable')
        assert.equal(update.installOnQuit, true)
        record('cancelled-but-retryable', {update})
        retried = true
        await software.action('install-update')
      }
    } catch (error) {
      clearInterval(timer)
      record('failed', {error: error.stack})
      app.exit(1)
    } finally { reading = false }
  }, 100)
}
