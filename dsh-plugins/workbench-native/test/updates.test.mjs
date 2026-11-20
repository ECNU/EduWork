import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'

const source = stripTypeScriptTypes(readFileSync(new URL('../src/updates.ts', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const loadUpdates = new Function('React', 'useEffect', 'useSyncExternalStore', 'createPortal', 'window', 'document',
  `${source}\nreturn { createUpdateController, UpdatePanel, UpdateFooter }`)

function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const found = find(child, predicate)
    if (found) return found
  }
}

const unsupportedMessage = '当前安装包未配置软件更新'
for (const [canToggle, userEnabled, contentEnabled, description] of [
  [false, true, true, unsupportedMessage],
  [false, false, true, unsupportedMessage],
  [true, true, true, '启动时在后台检查，发现新版本后提示。'],
  [true, false, true, '软件更新已关闭，配置与 Skills 更新不受影响。'],
  [true, false, false, '软件更新已关闭。'],
]) {
  test(`software update description with canToggle=${canToggle}, userEnabled=${userEnabled}, contentEnabled=${contentEnabled}`, () => {
    const React = { createElement: (type, props, ...children) => ({ type, props, children }) }
    const { UpdatePanel } = loadUpdates(React, undefined, (_, snapshot) => snapshot())
    const enabled = canToggle && userEnabled
    const status = {
      shell: 'electron',
      message: canToggle ? undefined : unsupportedMessage,
      update: { enabled, canToggle, userEnabled, state: enabled ? 'idle' : 'disabled' },
      contentUpdate: { enabled: contentEnabled },
    }
    const panel = UpdatePanel({ controller: { getSnapshot: () => ({ status }) } })
    assert.ok(find(panel, node => node.children?.includes(description)))
    if (!canToggle) {
      const misleading = /^(启动时在后台检查|软件更新已关闭)/
      assert.equal(find(panel, node => node.children?.some(child => typeof child === 'string' && misleading.test(child))), undefined)
    }
  })
}

for (const outcome of ['ready', 'error']) {
  test(`the installed verification panel stays busy until ${outcome}`, async t => {
    const timeouts = t.mock.timers
    timeouts.enable({ apis: ['setTimeout'] })
    const window = new EventTarget(), document = { body: {} }
    const React = { createElement: (type, props, ...children) => ({ type, props, children }) }
    const { createUpdateController, UpdatePanel, UpdateFooter } = loadUpdates(React,
      effect => { const clear = effect(); if (clear) t.after(clear) }, (_, snapshot) => snapshot(), node => node, window, document)
    let state = 'verifying'
    const actions = []
    const controller = createUpdateController(async action => {
      actions.push(action)
      return { shell: 'electron', update: { state, enabled: true, canToggle: true, policy: 'stable', latestVersion: '1.1.0',
        downloadedBytes: 100, totalBytes: 100, ...(state === 'error' && { error: '校验失败' }) } }
    })
    t.after(() => controller.dispose())
    await nextTurn()
    controller.open()
    const panel = UpdatePanel({ controller })
    assert.ok(find(panel, node => node.children?.includes('正在校验安装包…')))
    const progress = find(panel, node => node.props?.['aria-label'] === '安装包校验进度')
    assert.ok(progress)
    assert.equal(progress.props['aria-valuenow'], undefined)
    assert.equal(find(panel, node => node.props?.type === 'checkbox').props.disabled, true)
    const channel = find(panel, node => node.props?.role === 'radio' && node.children.includes('开发版'))
    assert.equal(channel.props['aria-disabled'], true)
    await channel.props.onClick()
    assert.deepEqual(actions, ['status'])
    const footer = UpdateFooter({ controller })
    const close = find(footer, node => node.props?.['aria-label'] === '关闭更新面板')
    assert.equal(close.props.disabled, true)
    close.props.onClick()
    const escape = Object.assign(new Event('keydown'), { key: 'Escape' })
    window.dispatchEvent(escape)
    assert.equal(controller.getSnapshot().open, true)
    state = outcome
    timeouts.tick(350)
    await nextTurn()
    const next = UpdatePanel({ controller })
    assert.equal(find(next, node => node.props?.role === 'progressbar'), undefined)
    assert.ok(find(next, node => node.children?.includes(outcome === 'ready' ? '版本 1.1.0 已下载并校验。' : '校验失败')))
    assert.equal(find(next, node => node.props?.type === 'checkbox').props.disabled, outcome === 'ready')
    window.dispatchEvent(escape)
    assert.equal(controller.getSnapshot().open, false)
  })
}

test('unreadable verification status allows dismissal and recovers without unlocking update actions', async t => {
  const timeouts = t.mock.timers
  timeouts.enable({ apis: ['setTimeout'] })
  const window = new EventTarget(), document = { body: {} }
  const React = { createElement: (type, props, ...children) => ({ type, props, children }) }
  const { createUpdateController, UpdatePanel, UpdateFooter } = loadUpdates(React,
    effect => { const clear = effect(); if (clear) t.after(clear) }, (_, snapshot) => snapshot(), node => node, window, document)
  let reachable = true, state = 'verifying'
  const actions = []
  const controller = createUpdateController(async action => {
    actions.push(action)
    if (!reachable) throw Error('后台连接已断开')
    return { shell: 'electron', update: { state, enabled: true, canToggle: true, latestVersion: '1.1.0' } }
  })
  t.after(() => controller.dispose())
  await nextTurn()
  controller.open()
  reachable = false
  timeouts.tick(350)
  await nextTurn()
  timeouts.tick(350)
  await nextTurn()
  assert.equal(actions.length, 2, 'stale verification must not keep polling every 350 ms')
  timeouts.tick(2150)
  await nextTurn()
  assert.equal(actions.length, 3)

  const panel = UpdatePanel({ controller })
  assert.ok(find(panel, node => node.props?.role === 'alert' && node.children.includes('无法读取更新状态：后台连接已断开')))
  assert.equal(find(panel, node => node.props?.role === 'progressbar'), undefined)
  assert.equal(find(panel, node => node.props?.type === 'checkbox').props.disabled, true)
  const channel = find(panel, node => node.props?.role === 'radio' && node.children.includes('开发版'))
  assert.equal(channel.props['aria-disabled'], true)
  await channel.props.onClick()
  assert.equal(find(panel, node => node.children?.includes('立即重启更新')), undefined)

  const footer = UpdateFooter({ controller })
  const close = find(footer, node => node.props?.['aria-label'] === '关闭更新面板')
  assert.equal(close.props.disabled, false)
  close.props.onClick()
  assert.equal(controller.getSnapshot().open, false)
  controller.open()
  window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
  assert.equal(controller.getSnapshot().open, false)
  controller.open()
  const backdrop = find(footer, node => node.props?.onMouseDown)
  backdrop.props.onMouseDown({ target: backdrop, currentTarget: backdrop })
  assert.equal(controller.getSnapshot().open, false)
  assert.deepEqual(actions, ['status', 'status', 'status'])

  reachable = true
  await find(panel, node => node.children?.includes('重试读取状态')).props.onClick()
  assert.equal(actions.at(-1), 'status')
  assert.equal(find(UpdatePanel({ controller }), node => node.props?.role === 'alert'), undefined)
  controller.open()
  controller.close()
  assert.equal(controller.getSnapshot().open, true, 'reconnection restores the verified lock')
  state = 'ready'
  timeouts.tick(2500)
  await nextTurn()
  assert.ok(find(UpdatePanel({ controller }), node => node.children?.includes('立即重启更新')))
})

test('a hung status read stays bounded and retry reuses it until success', async t => {
  const timeouts = t.mock.timers
  timeouts.enable({ apis: ['setTimeout'] })
  const window = new EventTarget(), document = { body: {} }
  const React = { createElement: (type, props, ...children) => ({ type, props, children }) }
  const { createUpdateController, UpdatePanel, UpdateFooter } = loadUpdates(React,
    effect => { const clear = effect(); if (clear) t.after(clear) }, (_, snapshot) => snapshot(), node => node, window, document)
  let finishFirstStatus, statusCalls = 0
  const controller = createUpdateController(async action => {
    if (action === 'status') {
      const call = statusCalls++
      if (call === 0) return new Promise(resolve => { finishFirstStatus = resolve })
      return { shell: 'electron', update: { state: call === 1 ? 'verifying' : 'ready', enabled: true, canToggle: true, latestVersion: '1.1.0' } }
    }
    if (action === 'check-updates') return { shell: 'electron', update: { state: 'verifying', enabled: true, canToggle: true } }
    throw Error(`unexpected action: ${action}`)
  })
  t.after(() => controller.dispose())
  await nextTurn()
  controller.open()
  await nextTurn()

  for (let elapsed = 0; elapsed < 120_000; elapsed += 2_500) {
    timeouts.tick(2_500)
    await nextTurn()
  }
  const failed = UpdatePanel({ controller })
  assert.match(controller.getSnapshot().statusError, /超时/)
  assert.ok(find(failed, node => node.props?.role === 'alert' && /超时/.test(node.children[0])))
  assert.ok(find(failed, node => node.children?.includes('重试读取状态')))
  assert.equal(find(UpdateFooter({ controller }), node => node.props?.['aria-label'] === '关闭更新面板').props.disabled, false)
  assert.equal(controller.getSnapshot().open, true)
  assert.equal(statusCalls, 1)

  const retry = find(failed, node => node.children?.includes('重试读取状态')).props.onClick()
  assert.equal(statusCalls, 1, 'retry must reuse the pending request')

  finishFirstStatus({ shell: 'electron', update: { state: 'verifying', enabled: true } })
  await retry
  assert.equal(controller.getSnapshot().statusError, '')
  assert.equal(controller.getSnapshot().status?.update?.state, 'verifying')

  timeouts.tick(2_500)
  await nextTurn()
  assert.equal(statusCalls, 2)
  assert.equal(controller.getSnapshot().status?.update?.state, 'verifying')
  timeouts.tick(350)
  await nextTurn()
  assert.equal(statusCalls, 3, 'polling resumes at the active-update interval')
  assert.equal(controller.getSnapshot().statusError, '')
  assert.equal(controller.getSnapshot().status?.update?.state, 'ready')
})

test('a timed-out status request rejection permits a later poll to recover', async t => {
  const timeouts = t.mock.timers
  timeouts.enable({ apis: ['setTimeout'] })
  const window = new EventTarget(), document = { body: {} }
  const React = { createElement: (type, props, ...children) => ({ type, props, children }) }
  const { createUpdateController, UpdatePanel } = loadUpdates(React,
    effect => { const clear = effect(); if (clear) t.after(clear) }, (_, snapshot) => snapshot(), node => node, window, document)
  let rejectFirstStatus, statusCalls = 0
  const controller = createUpdateController(async action => {
    if (action === 'status' && statusCalls++ === 0) return new Promise((_, reject) => { rejectFirstStatus = reject })
    if (action === 'check-updates') return { shell: 'electron', update: { state: 'verifying', enabled: true, canToggle: true } }
    return { shell: 'electron', update: { state: 'ready', enabled: true, canToggle: true, latestVersion: '1.1.0' } }
  })
  t.after(() => controller.dispose())
  await nextTurn()
  controller.open()
  timeouts.tick(10_000)
  await nextTurn()
  assert.equal(statusCalls, 1)
  rejectFirstStatus(Error('后台连接已断开'))
  await nextTurn()
  assert.match(controller.getSnapshot().statusError, /后台连接已断开/)

  timeouts.tick(2_500)
  await nextTurn()
  assert.equal(statusCalls, 2)
  assert.equal(controller.getSnapshot().statusError, '')
  assert.equal(controller.getSnapshot().status?.update?.state, 'ready')
  assert.equal(find(UpdatePanel({ controller }), node => node.props?.role === 'alert'), undefined)
})

test('dispose clears every timeout waiting on the shared status request', async t => {
  const timeouts = t.mock.timers
  timeouts.enable({ apis: ['setTimeout'] })
  const window = new EventTarget(), document = { body: {} }
  const React = { createElement: (type, props, ...children) => ({ type, props, children }) }
  const { createUpdateController } = loadUpdates(React, undefined, undefined, undefined, window, document)
  let finishStatus
  const controller = createUpdateController(() => new Promise(resolve => { finishStatus = resolve }))
  t.after(() => controller.dispose())
  let notifications = 0
  controller.subscribe(() => notifications++)
  await nextTurn()
  for (let retry = 0; retry < 4; retry++) void controller.retry()
  await nextTurn()

  timeouts.tick(10_000)
  await nextTurn()
  const timedOutNotifications = notifications
  assert.equal(timedOutNotifications, 5)

  controller.dispose()
  controller.dispose()
  timeouts.tick(10_000)
  await nextTurn()
  assert.equal(notifications, timedOutNotifications)
  finishStatus({ shell: 'electron', update: { state: 'idle' } })
  await nextTurn()
})

test('dispose prevents pending status timeout notifications', async t => {
  const timeouts = t.mock.timers
  timeouts.enable({ apis: ['setTimeout'] })
  const window = new EventTarget(), document = { body: {} }
  const React = { createElement: (type, props, ...children) => ({ type, props, children }) }
  const { createUpdateController } = loadUpdates(React, undefined, undefined, undefined, window, document)
  let finishStatus
  const controller = createUpdateController(() => new Promise(resolve => { finishStatus = resolve }))
  let notifications = 0
  controller.subscribe(() => notifications++)
  await nextTurn()

  controller.dispose()
  timeouts.tick(10_000)
  await nextTurn()
  assert.equal(notifications, 0)
  finishStatus({ shell: 'electron', update: { state: 'idle' } })
  await nextTurn()
})

for (const outcome of ['success', 'failure']) {
  test(`run clears working before the pending status refresh ${outcome === 'success' ? 'succeeds' : 'fails'}`, async t => {
    const timeouts = t.mock.timers
    timeouts.enable({ apis: ['setTimeout'] })
    const window = new EventTarget(), document = { body: {} }
    const React = { createElement: (type, props, ...children) => ({ type, props, children }) }
    const { createUpdateController } = loadUpdates(React, undefined, undefined, undefined, window, document)
    let finishStatus
    const controller = createUpdateController(async action => {
      if (action === 'status') return new Promise((resolve, reject) => { finishStatus = outcome === 'success' ? resolve : reject })
      return { phase: 'checking', update: { state: 'checking', enabled: true } }
    })
    t.after(() => controller.dispose())
    await nextTurn()
    const run = controller.run('check-updates')
    await nextTurn()
    assert.equal(controller.getSnapshot().working, 'checking')

    timeouts.tick(450)
    await nextTurn()
    assert.equal(controller.getSnapshot().working, '')
    await run

    if (outcome === 'success') {
      finishStatus({ shell: 'electron', update: { state: 'ready', enabled: true } })
      await nextTurn()
      await nextTurn()
      assert.equal(controller.getSnapshot().status?.update?.state, 'ready')
      assert.equal(controller.getSnapshot().statusError, '')
    } else {
      finishStatus(Error('后台连接已断开'))
      await nextTurn()
      await nextTurn()
      assert.match(controller.getSnapshot().statusError, /后台连接已断开/)
    }
  })
}
