import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const MARK = 'data-eduwork-auto-approval-icon'

// Just the DOM the client part uses: elements with attributes and children, selectors of one tag or attribute with at
// most one descendant step, and a MutationObserver run by hand.
class Element {
  constructor(tag, attributes = {}, ...children) {
    this.tagName = tag
    this.attributes = new Map(Object.entries(attributes))
    this.children = []
    this.parentElement = null
    this.style = {}
    for (const child of children) typeof child === 'string' ? this.text = child : this.append(child)
  }
  get textContent() { return (this.text ?? '') + this.children.map(child => child.textContent).join('') }
  set textContent(text) { this.text = text }
  // Only the plugin's icons are set as HTML, an svg each.
  get innerHTML() { return this.html }
  set innerHTML(html) { this.html = html; this.children = []; this.append(h('svg')) }
  get firstElementChild() { return this.children[0] ?? null }
  get previousElementSibling() { return this.parentElement.children[this.parentElement.children.indexOf(this) - 1] ?? null }
  hasAttribute(name) { return this.attributes.has(name) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  setAttribute(name, value) { this.attributes.set(name, value) }
  append(child) { child.parentElement = this; this.children.push(child) }
  before(node) { node.parentElement = this.parentElement; this.parentElement.children.splice(this.parentElement.children.indexOf(this), 0, node) }
  remove() { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null }
  cloneNode() { return new Element(this.tagName, Object.fromEntries(this.attributes)) }
  *descendants() { for (const child of this.children) { yield child; yield* child.descendants() } }
  querySelectorAll(selector) {
    const matches = (element, simple) => {
      const [, name, value] = simple.match(/^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/) ?? []
      return name ? element.hasAttribute(name) && (value === undefined || element.getAttribute(name) === value) : element.tagName === simple
    }
    const [outer, inner] = selector.split(' ')
    const found = [...this.descendants()].filter(element => matches(element, outer))
    return inner === undefined ? found : found.flatMap(element => [...element.descendants()].filter(child => matches(child, inner)))
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
}
const h = (tag, attributes, ...children) => new Element(tag, attributes, ...children)
const icon = () => h('span', { class: 'itemIcon', 'aria-hidden': 'true' }, h('svg'))

// The composer's permission control showing `current` (with DSH's icon when it has one) and, when open, its menu: each
// built-in preset with DSH's icon, the plugin's preset without one, the current one with a check mark.
function page({ current = '自动审批', menu = true, icons = true } = {}) {
  const builtIn = ['仅可查看', '工作区内修改', '完全权限']
  const body = h('body', {},
    h('div', { 'data-slot': 'conversation.input.permission' },
      h('button', {}, ...builtIn.includes(current) ? [icon()] : [], h('span', {}, current), h('span', { 'aria-hidden': 'true' }, h('svg')))))
  if (menu) {
    body.append(h('div', { role: 'menu' }, ...['仅可查看', '工作区内修改', '自动审批', '完全权限'].map(label =>
      h('button', { role: 'menuitem' }, ...icons && builtIn.includes(label) ? [icon()] : [], h('span', {}, label), ...label === current ? [h('svg')] : []))))
  }
  return body
}
const control = body => body.querySelector('[data-slot="conversation.input.permission"] button')
const item = (body, label) => body.querySelectorAll('[role=menuitem]').find(element => element.textContent === label)
const added = body => body.querySelectorAll(`[${MARK}]`)

// Values made inside the client part's context have its own prototypes, so they are copied before being compared.
async function mount(body, catalogs) {
  const observers = []
  const document = Object.assign(h('#document', {}, body), { body, createElement: tag => h(tag) })
  class MutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe(target, options) { this.target = target; this.options = options }
    disconnect() { this.target = undefined }
  }
  let factory
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'),
    { window: { __ModuleLoader__: { load: entry => { factory = entry.factory } } }, document, MutationObserver })
  const plugin = factory(() => assert.fail('the client part requires nothing'))
  const listeners = new Map(), disposers = []
  const scope = {
    remote: {
      permissionPresets: { catalog: () => (catalogs.shift() ?? assert.fail('no catalog read expected'))() },
      $on: (event, listener) => { listeners.set(event, listener); return () => listeners.delete(event) },
    },
    connection: { generation: { subscribe: listener => { listeners.set('generation', listener); return () => listeners.delete('generation') } } },
    effect: effect => disposers.push(effect()),
  }
  plugin.apply({ inject: (names, callback) => { assert.deepEqual([...names], ['connection', 'remote', 'remote.permissionPresets']); callback(scope) } })
  await settle()
  const [observer] = observers
  assert.equal(observer.target, body)
  assert.deepEqual({ ...observer.options }, { childList: true, subtree: true, characterData: true })
  return {
    // DSH changed the page.
    changed: () => observer.target && observer.callback([]),
    emit: async event => { listeners.get(event)(); await settle() },
    dispose: () => disposers.forEach(dispose => dispose()),
    observer, listeners,
  }
}
const settle = () => new Promise(resolve => setImmediate(resolve))
// Catalog reads, in turn: each a function, so that a rejection is made only when read. The options are those of the
// page's menu, in its order.
const options = (...options) => () => Promise.resolve({ ok: true, value: { options, defaultOptions: [], defaultPreset: 'workspace-write' } })
const catalog = (name = '自动审批') => options({ value: 'read-only', name: 'Read only' }, { value: 'workspace-write', name: 'Workspace write' },
  { value: 'auto-approval', name }, { value: 'danger-full-access', name: 'Full access' })

test('the preset gets an icon in the menu, in the slot of the built-in ones, and on the control', async () => {
  const body = page()
  await mount(body, [catalog()])
  const [onControl, inMenu] = added(body)
  assert.equal(control(body).firstElementChild, onControl)
  assert.equal(onControl.tagName, 'span')
  assert.equal(onControl.style.cssText, 'flex:none;display:inline-flex')
  assert.match(onControl.innerHTML, /^<svg width="14" height="14" viewBox="0 0 16 16"/)
  assert.equal(item(body, '自动审批').firstElementChild, inMenu)
  assert.deepEqual(Object.fromEntries(inMenu.attributes), { class: 'itemIcon', 'aria-hidden': 'true', [MARK]: '' })
  assert.match(inMenu.innerHTML, /^<svg width="16" height="16" viewBox="0 0 16 16"/)
  assert.equal(onControl.getAttribute('aria-hidden'), 'true')
  for (const label of ['仅可查看', '工作区内修改', '完全权限']) assert.equal(item(body, label).children.length, 2)
})

test('no icon where DSH draws none for any preset or one of its own for this', async () => {
  const body = page({ icons: false })
  const { changed } = await mount(body, [catalog()])
  assert.deepEqual(added(body), [control(body).firstElementChild])
  // A later DSH draws icons for every preset, this one too: the added one goes.
  control(body).children[1].before(icon())
  for (const element of body.querySelectorAll('[role=menuitem]')) element.children[0].before(icon())
  changed()
  assert.deepEqual(added(body), [])
  assert.equal(control(body).children.length, 3)
  // DSH's icon, the label and the check mark.
  assert.equal(item(body, '自动审批').children.length, 3)

  // A menu whose built-in icons are gone keeps none of its own either.
  const other = page()
  const { changed: redrawn } = await mount(other, [catalog()])
  for (const element of other.querySelectorAll('[role=menuitem]')) if (element.textContent !== '自动审批') element.children[0].remove()
  redrawn()
  assert.deepEqual(added(other), [control(other).firstElementChild])
})

test('no icon in another menu with an item of that name, nor with another preset of that name', async () => {
  const body = page({ current: '工作区内修改', menu: false })
  body.append(h('div', { role: 'menu' }, h('button', { role: 'menuitem' }, icon(), h('span', {}, '打开文件')),
    h('button', { role: 'menuitem' }, h('span', {}, '自动审批'))))
  // As many items as the permission menu, the name in another place.
  body.append(h('div', { role: 'menu' }, ...['打开文件', '自动审批', '重命名', '删除'].map((label, n) =>
    h('button', { role: 'menuitem' }, ...n ? [] : [icon()], h('span', {}, label)))))
  await mount(body, [catalog()])
  assert.deepEqual(added(body), [])

  const twins = page()
  await mount(twins, [options({ value: 'read-only', name: 'Read only' }, { value: 'workspace-write', name: '自动审批' },
    { value: 'auto-approval', name: '自动审批' }, { value: 'danger-full-access', name: 'Full access' })])
  assert.deepEqual(added(twins), [])
})

test('the icon follows the control to another preset and back, and stays put while nothing changes', async () => {
  const body = page({ menu: false })
  const { changed } = await mount(body, [catalog()])
  const button = control(body), [first] = added(body)
  changed()
  assert.deepEqual(added(body), [first])
  // React puts DSH's icon before the label and changes its text: the added one would make two.
  const label = button.children[1]
  label.before(icon())
  label.textContent = '完全权限'
  changed()
  assert.deepEqual(added(body), [])
  assert.equal(button.children[0].getAttribute('class'), 'itemIcon')
  button.children[0].remove()
  label.textContent = '自动审批'
  changed()
  assert.deepEqual(added(body), [button.children[0]])
})

test('the name comes from the catalog, read again when it or the connection changes, the latest read winning', async () => {
  const body = page()
  let resolve
  const pending = new Promise(done => { resolve = done })
  const { emit, listeners } = await mount(body, [
    () => Promise.resolve({ ok: false, error: { code: 'unavailable', message: '' } }), () => Promise.reject(Error('offline')),
    catalog('审批'), () => pending, catalog(),
  ])
  assert.deepEqual(added(body), [])
  await emit('permission-presets/catalog-changed')
  assert.deepEqual(added(body), [])
  // A rename: the label DSH shows changes with it.
  for (const element of [control(body).children[0], item(body, '自动审批').children[0]]) element.textContent = '审批'
  await emit('generation')
  assert.equal(added(body).length, 2)
  // A read overtaken by a later one does not count.
  listeners.get('permission-presets/catalog-changed')()
  for (const element of [control(body).children[1], item(body, '审批').children[1]]) element.textContent = '自动审批'
  await emit('generation')
  assert.equal(added(body).length, 2)
  resolve({ ok: true, value: { options: [{ value: 'auto-approval', name: '审批' }] } })
  await settle()
  assert.deepEqual(added(body).map(element => element.parentElement.children[1].textContent), ['自动审批', '自动审批'])
})

test('a catalog without the preset adds nothing, and disposing takes the icons away for good', async () => {
  const none = page()
  await mount(none, [options({ value: 'workspace-write', name: '自动审批' })])
  assert.deepEqual(added(none), [])

  const body = page()
  let resolve
  const pending = new Promise(done => { resolve = done })
  const { dispose, observer, listeners } = await mount(body, [catalog(), () => pending])
  listeners.get('permission-presets/catalog-changed')()
  dispose()
  assert.deepEqual(added(body), [])
  assert.equal(observer.target, undefined)
  assert.equal(listeners.size, 0)
  resolve(await catalog()())
  await settle()
  assert.deepEqual(added(body), [])
})
