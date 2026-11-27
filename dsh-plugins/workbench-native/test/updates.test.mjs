import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'

const source = ['portable-migration-upgrade.ts', 'updates.ts'].map(file =>
  stripTypeScriptTypes(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'))
    .replace(/^import .*\n/gm, '').replace(/^export /gm, '')).join('\n')
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
    assert.equal(find(panel, node => node.props?.migration), undefined)
    if (!canToggle) {
      const misleading = /^(启动时在后台检查|软件更新已关闭)/
      assert.equal(find(panel, node => node.children?.some(child => typeof child === 'string' && misleading.test(child))), undefined)
    }
  })
}

test('dismissing the portable prompt leaves the verified migration in settings', () => {
  const actions = []
  const React = { createElement: (type, props, ...children) => typeof type === 'function'
    ? type({ ...props, children }) : { type, props, children } }
  const { UpdatePanel, UpdateFooter } = loadUpdates(React, () => {}, (_, snapshot) => snapshot())
  const migration = { version: '0.4.15', dismissed: false }
  const status = { shell: 'electron', update: { enabled: true, state: 'idle' }, portableMigration: migration }
  const controller = { getSnapshot: () => ({ status }), run: action => { actions.push(action); migration.dismissed = true } }
  const prompt = node => node.props?.['data-chatecnu-update-prompt'] === 'portable-migration'
  assert.ok(find(UpdateFooter({ controller }), prompt))
  find(UpdatePanel({ controller }), node => node.type === 'button' && node.children.includes('稍后')).props.onClick()
  assert.equal(find(UpdateFooter({ controller }), prompt), undefined)
  const start = find(UpdatePanel({ controller }), node => node.type === 'button' && node.children.includes('升级并迁移'))
  assert.equal(start.props.disabled, false)
  start.props.onClick()
  assert.deepEqual(actions, ['dismiss-portable-migration', 'start-portable-migration'])
  delete status.portableMigration
  assert.equal(find(UpdateFooter({ controller }), prompt), undefined)
  assert.equal(find(UpdatePanel({ controller }), node => node.props?.['data-eduwork-portable-migration']), undefined)
})

test('migration progress polls in 350 ms, updates the dismissed footer, and cancels only the download', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const React = { createElement: (type, props, ...children) => typeof type === 'function'
    ? type({ ...props, children }) : { type, props, children } }
  const { createUpdateController, UpdatePanel, UpdateFooter } = loadUpdates(React, () => {}, (_, snapshot) => snapshot(), undefined, new EventTarget())
  let migration = { version: '0.4.15', bytes: 2048, dismissed: true, busy: true, stage: 'downloading', downloadedBytes: 512, totalBytes: 2048, cancellable: true }
  const actions = []
  const controller = createUpdateController(async action => {
    actions.push(action)
    if (action === 'cancel-portable-migration') migration = { ...migration, busy: false, cancellable: false }
    return { shell: 'electron', update: { enabled: true, state: 'idle' }, portableMigration: migration }
  })
  t.after(() => controller.dispose())
  await nextTurn()
  const progress = () => find(UpdatePanel({ controller }), node => node.props?.['aria-label'] === '迁移安装包下载进度')
  const cancel = () => find(UpdatePanel({ controller }), node => node.type === 'button' && node.children.includes('取消下载'))
  const footer = () => find(UpdateFooter({ controller }), node => node.props?.['data-chatecnu-update-prompt'] === 'portable-migration')
  assert.equal(progress().props.role, 'progressbar')
  assert.equal(progress().props['aria-valuenow'], 25)
  assert.ok(find(UpdatePanel({ controller }), node => node.children?.includes('1 KB / 2 KB · 25%')))
  assert.deepEqual(footer().children, ['迁移下载 25%'])
  migration = { ...migration, stage: 'verifying', downloadedBytes: 2048, cancellable: false }
  t.mock.timers.tick(349)
  await nextTurn()
  assert.deepEqual(actions, ['status'])
  t.mock.timers.tick(1)
  await nextTurn()
  assert.equal(progress().props['aria-valuenow'], undefined)
  assert.equal(cancel(), undefined)
  assert.deepEqual(footer().children, ['正在校验…'])
  assert.ok(find(UpdatePanel({ controller }), node => node.type === 'style' && node.children[0].includes('@keyframes eduwork-update-progress')))
  migration = { ...migration, stage: 'stopping' }
  t.mock.timers.tick(350)
  await nextTurn()
  assert.deepEqual(footer().children, ['准备安装…'])
  assert.ok(find(UpdatePanel({ controller }), node => node.children?.includes('正在关闭当前客户端并启动安装程序…')))
  migration = { ...migration, stage: 'downloading', cancellable: true }
  t.mock.timers.tick(350)
  await nextTurn()
  await cancel().props.onClick()
  assert.equal(actions.filter(action => action === 'cancel-portable-migration').length, 1)
  assert.equal(progress(), undefined)
  assert.equal(footer(), undefined)
})

test('ordinary portable download stays primary unless migration is offered', () => {
  const React = { createElement: (type, props, ...children) => typeof type === 'function'
    ? type({ ...props, children }) : { type, props, children } }
  const { UpdatePanel } = loadUpdates(React, undefined, (_, snapshot) => snapshot())
  const status = { shell: 'electron', update: { enabled: true, state: 'available', latestVersion: '0.4.15' } }
  const controller = { getSnapshot: () => ({ status }) }
  const button = text => find(UpdatePanel({ controller }), node => node.type === 'button' && node.children.includes(text))
  const ordinary = button('下载更新')
  assert.equal(button('升级并迁移'), undefined)
  assert.equal(ordinary.props.disabled, undefined)
  status.portableMigration = { version: '0.4.15', dismissed: false }
  assert.equal(button('升级并迁移').props.style, ordinary.props.style)
  assert.equal(button('下载更新').props.style, button('稍后').props.style)
  assert.ok(find(UpdatePanel({ controller }), node => node.children?.some(child => typeof child === 'string' && child.endsWith('无需先更新便携版，可直接升级并迁移。'))))
})

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

test('a timed-out status request rejection is ignored after a newer snapshot and polling recovers', async t => {
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
  const { status, statusError } = controller.getSnapshot()
  assert.equal(status.update.state, 'verifying')
  assert.match(statusError, /超时/)
  rejectFirstStatus(Error('后台连接已断开'))
  await nextTurn()
  assert.equal(controller.getSnapshot().status, status)
  assert.equal(controller.getSnapshot().statusError, statusError)

  timeouts.tick(2_500)
  await nextTurn()
  assert.equal(statusCalls, 2)
  assert.equal(controller.getSnapshot().statusError, '')
  assert.equal(controller.getSnapshot().status?.update?.state, 'ready')
  assert.equal(find(UpdatePanel({ controller }), node => node.props?.role === 'alert'), undefined)
})

test('a timed-out status request can report a failure when no newer snapshot was published', async t => {
  const timeouts = t.mock.timers
  timeouts.enable({ apis: ['setTimeout'] })
  const { createUpdateController } = loadUpdates({}, undefined, undefined, undefined, new EventTarget())
  let rejectStatus
  const controller = createUpdateController(() => new Promise((_, reject) => { rejectStatus = reject }))
  t.after(() => controller.dispose())
  await nextTurn()
  timeouts.tick(10_000)
  await nextTurn()
  assert.match(controller.getSnapshot().statusError, /超时/)

  rejectStatus(Error('后台连接已断开'))
  await nextTurn()
  assert.equal(controller.getSnapshot().statusError, '无法读取更新状态：后台连接已断开')
})

test('a late status rejection cannot hide a ready update', async t => {
  const timeouts = t.mock.timers
  timeouts.enable({ apis: ['setTimeout', 'Date'] })
  const React = { createElement: (type, props, ...children) => ({ type, props, children }) }
  const { createUpdateController, UpdatePanel } = loadUpdates(React, undefined, (_, snapshot) => snapshot(), undefined, new EventTarget())
  let rejectStatus
  const controller = createUpdateController(async action => {
    if (action === 'status') return new Promise((_, reject) => { rejectStatus = reject })
    return { shell: 'electron', update: { state: 'ready', enabled: true, latestVersion: '1.1.0' } }
  })
  t.after(() => controller.dispose())
  const run = controller.run('check-updates')
  await nextTurn()
  timeouts.tick(450)
  await run
  assert.ok(find(UpdatePanel({ controller }), node => node.children?.includes('立即重启更新')))

  rejectStatus(Error('后台连接已断开'))
  await nextTurn()
  assert.equal(controller.getSnapshot().statusError, '')
  assert.ok(find(UpdatePanel({ controller }), node => node.children?.includes('立即重启更新')))
})

test('dispose settles all five retries waiting on a hung status request', async t => {
  const timeouts = t.mock.timers
  timeouts.enable({ apis: ['setTimeout'] })
  const { createUpdateController } = loadUpdates({}, undefined, undefined, undefined, new EventTarget())
  let statusCalls = 0, notifications = 0, settled = 0
  const controller = createUpdateController(() => {
    statusCalls++
    return new Promise(() => {})
  })
  t.after(() => controller.dispose())
  controller.subscribe(() => notifications++)
  for (let retry = 0; retry < 5; retry++) void controller.retry().then(() => settled++)
  await nextTurn()
  assert.equal(statusCalls, 1)
  assert.equal(notifications, 0)
  assert.equal(settled, 0)

  controller.dispose()
  await nextTurn()
  assert.equal(settled, 5, 'dispose must settle all retries before the clock advances')
  timeouts.tick(10_000)
  await nextTurn()
  assert.equal(notifications, 0)
  assert.equal(statusCalls, 1)
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

test('dispose does not clear timeouts from completed status reads again', async t => {
  const timeouts = t.mock.timers
  timeouts.enable({ apis: ['setTimeout'] })
  const clear = t.mock.method(globalThis, 'clearTimeout')
  const { createUpdateController } = loadUpdates({}, undefined, undefined, undefined, new EventTarget())
  const controller = createUpdateController(async () => ({ update: { state: 'idle' } }))
  await nextTurn()
  for (let poll = 0; poll < 2; poll++) {
    timeouts.tick(2500)
    await nextTurn()
  }

  const completedTimeouts = new Set(clear.mock.calls.map(call => call.arguments[0]))
  clear.mock.resetCalls()
  controller.dispose()
  const repeatedClears = clear.mock.calls.filter(call => completedTimeouts.has(call.arguments[0]))
  assert.equal(repeatedClears.length, 0)
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
    let finishStatus, statusCalls = 0
    const controller = createUpdateController(async action => {
      if (action === 'status') {
        if (statusCalls++ === 0) return { shell: 'electron', update: { state: 'idle', enabled: true } }
        return new Promise((resolve, reject) => { finishStatus = outcome === 'success' ? resolve : reject })
      }
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
    assert.equal(statusCalls, 2)

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

for (const actionFinishes of ['before dispose', 'after dispose']) {
  test(`dispose leaves no busy timer when an action completes ${actionFinishes}`, async t => {
    const timeouts = t.mock.timers
    timeouts.enable({ apis: ['setTimeout', 'Date'] })
    const scheduleTimeout = globalThis.setTimeout
    let callbacks = 0
    const schedule = t.mock.method(globalThis, 'setTimeout', (callback, delay) =>
      scheduleTimeout(() => { callbacks++; callback() }, delay))
    const { createUpdateController } = loadUpdates({}, undefined, undefined, undefined, new EventTarget())
    let finishAction, notifications = 0, settled = false
    const controller = createUpdateController(async action => {
      if (action === 'status') return { update: { state: 'idle' } }
      return new Promise(resolve => { finishAction = () => resolve({ update: { state: 'ready' } }) })
    })
    t.after(() => controller.dispose())
    await nextTurn()
    controller.subscribe(() => notifications++)
    void controller.run('check-updates').then(() => { settled = true })
    if (actionFinishes === 'before dispose') {
      finishAction()
      await nextTurn()
      assert.equal(schedule.mock.calls.at(-1).arguments[1], 450)
    }
    assert.equal(settled, false)
    const scheduled = schedule.mock.callCount(), published = notifications

    controller.dispose()
    if (actionFinishes === 'after dispose') finishAction()
    await nextTurn()
    assert.equal(schedule.mock.callCount(), scheduled)
    assert.equal(settled, true, 'dispose must end the busy wait before the clock advances')
    timeouts.tick(450)
    await nextTurn()
    assert.equal(callbacks, 0)
    assert.equal(notifications, published)
  })
}

test('every desktop action gate accepts the same actions as the native bridge', () => {
  const actions = file => {
    const list = readFileSync(new URL(file, import.meta.url), 'utf8').match(/\[('status',[^\]]*)\]/)?.[1]
    assert.ok(list, file)
    return [...list.matchAll(/'([a-z-]+)'/g)].map(match => match[1]).sort()
  }
  const bridge = actions('../../../dsh-electron/src/native-vault.mjs')
  for (const action of ['start-portable-migration', 'dismiss-portable-migration', 'cancel-portable-migration']) assert.ok(bridge.includes(action), action)
  for (const gate of ['../lib/typert-schemas.js', '../lib/index.js', '../../desktop-services/lib/index.js']) {
    assert.deepEqual(actions(gate), bridge, gate)
  }
})
