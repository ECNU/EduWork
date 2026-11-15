import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { loadUserConfig } from '../../dsh-host/user-config.mjs'
import { attachWindowVisibility } from '../src/window-visibility.mjs'

async function closePolicy(t, config) {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-close-policy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const configPath = join(root, 'eduwork.jsonc')
  if (config !== undefined) await writeFile(configPath, JSON.stringify(config))
  const source = readFileSync(new URL('../src/product.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('export function readInitialCloseAction()')
  const end = source.indexOf('export async function attachDesktopWindow', start)
  assert.ok(start >= 0 && end > start)
  const body = source.slice(start, end).replaceAll('export ', '')
  const policy = new Function('loadUserConfig', 'paths', `
    let user
    let initialCloseAction = 'tray'
    ${body}
    return { readInitialCloseAction, shouldExitOnClose, setUser(value) { user = value } }
  `)(loadUserConfig, { config: configPath })
  policy.readInitialCloseAction()
  return policy
}

function closeWindow(policy, { platform = 'win32', tray = true } = {}) {
  const app = new EventEmitter(), window = new EventEmitter(), calls = []
  app.quit = () => calls.push('quit')
  window.isFullScreen = () => false
  window.isDestroyed = () => false
  window.setFullScreen = () => {}
  window.hide = () => calls.push('hide')
  attachWindowVisibility({ app, window, platform, isQuitting: () => false,
    shouldExit: policy.shouldExitOnClose, hasTray: () => tray })
  window.emit('close', { preventDefault: () => calls.push('prevented') })
  return calls
}

test('an exit close policy is available before configuration preparation', async t => {
  const policy = await closePolicy(t, { schemaVersion: 1, desktop: { closeAction: 'exit' } })
  assert.equal(policy.shouldExitOnClose(), true)
  assert.deepEqual(closeWindow(policy), ['prevented', 'quit'])
})

test('tray and missing configuration keep the early close default', async t => {
  const tray = await closePolicy(t, { schemaVersion: 1, desktop: { closeAction: 'tray' } })
  assert.equal(tray.shouldExitOnClose(), false)
  assert.deepEqual(closeWindow(tray), ['prevented', 'hide'])
  const missing = await closePolicy(t)
  assert.equal(missing.shouldExitOnClose(), false)
  assert.deepEqual(closeWindow(missing), ['prevented', 'hide'])
})

test('the prepared configuration replaces the early close policy', async t => {
  const policy = await closePolicy(t, { schemaVersion: 1, desktop: { closeAction: 'exit' } })
  assert.equal(policy.shouldExitOnClose(), true)
  policy.setUser({ closeAction: 'tray' })
  assert.equal(policy.shouldExitOnClose(), false)
  assert.deepEqual(closeWindow(policy), ['prevented', 'hide'])
  policy.setUser({ closeAction: 'exit' })
  assert.equal(policy.shouldExitOnClose(), true)
})

test('Windows without a tray still quits under the tray close policy', async t => {
  const policy = await closePolicy(t, { schemaVersion: 1, desktop: { closeAction: 'tray' } })
  assert.deepEqual(closeWindow(policy, { tray: false }), ['prevented', 'quit'])
})
