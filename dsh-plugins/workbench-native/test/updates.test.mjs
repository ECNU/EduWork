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
