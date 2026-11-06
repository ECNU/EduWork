import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

const SLOT = 'conversation.chat.text-interaction'
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useEffect() {}, useLayoutEffect() {}, useRef() {}, useState() {},
  useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
}

async function client(url, document) {
  let factory
  const window = { __ModuleLoader__: { load: entry => { factory = entry.factory } } }
  vm.runInNewContext(await readFile(url, 'utf8'), { window, document, Node: { ELEMENT_NODE: 1 } })
  return factory(name => ({
    react: { default: React, ...React }, 'react-dom': { createPortal: node => node },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    '@deepseek-ai/dsh-client-ui-primitives': {},
  })[name])
}

function selectedReply() {
  const row = { contains: () => true, getAttribute: () => 'answer' }
  const element = { nodeType: 1, closest: selector => selector === '[data-chat-node-key]' ? row : null }
  const range = {
    commonAncestorContainer: element, startContainer: element, endContainer: element,
    startOffset: 0, endOffset: 2,
    selectNodeContents() {}, setStart() {}, setEnd() {},
    toString: () => '', cloneRange: () => ({ ...range }),
    getClientRects: () => [{ right: 200, bottom: 100 }],
  }
  return { querySelector: () => ({}), getSelection: () => ({
    isCollapsed: false, rangeCount: 1, getRangeAt: () => range,
  }) }
}

function mount(plugin, core, registrant) {
  const disposers = [], dictionaries = new Map(), services = {}
  const ctx = {
    effect(fn) { const dispose = fn(); if (dispose) disposers.push(dispose) },
    provide: (name, value) => { services[name] = value },
    inject: (_dependencies, fn) => fn(ctx),
    locale: {
      register: (name, copy) => { dictionaries.set(name, copy.zh); return () => {} },
      bind: name => key => dictionaries.get(name)?.[key] ?? key,
    },
    uiConversation: { userText: { register: () => () => {} }, interactions: { register: () => () => {} } },
    inputTriggers: { registerSource: () => () => {} },
    sessions: { binding: () => ({ session: { getSnapshot: () => ({ removed: false, subagent: null }) } }) },
    slots: {
      inject: (name, fn) => { if (core.specDynamic(name)) fn() },
      register: (spec, component) => {
        const dispose = core.register({ ...spec, registrant }, component)
        disposers.push(dispose)
        return dispose
      },
    },
  }
  plugin.apply(ctx)
  return { services, t: name => ctx.locale.bind(name), dispose: () => disposers.reverse().forEach(dispose => dispose()) }
}

for (const officialFirst of [true, false]) {
  test(`combined toolbar wins the real rc.1 quote slot with official quotes loaded ${officialFirst ? 'first' : 'last'}`, async () => {
    const document = selectedReply()
    const annotation = await client(new URL('../lib/client.js', import.meta.url), document)
    const quote = await client(new URL(import.meta.resolve('@deepseek-ai/dsh-message-quotes/client')), document)
    const core = new SlotCore()
    core.register({ name: 'root', children: {
      [SLOT]: { kind: 'keyed', scope: 'session' },
      'conversation.user.text.node': { kind: 'keyed', scope: 'session' },
    } }, () => null)
    let official, extension
    if (officialFirst) official = mount(quote, core, 'official')
    extension = mount(annotation, core, 'annotation')
    if (!officialFirst) official = mount(quote, core, 'official')
    const winner = key => core.entriesOfSlot(SLOT).find(entry => entry.options.key === key)
    assert.equal(winner('quote').registrant, 'annotation')
    assert.equal(winner('quote').component, winner('eduwork-annotation').component)
    assert.equal(core.entriesOfSlot(SLOT).filter(entry => entry.options.key === 'quote').length, 1)

    const sideCalls = [], notes = [], inserted = [], events = []
    const removeSideChat = extension.services.annotationSelection.register({
      id: 'side-chat', label: () => '侧边聊天', run: async payload => { sideCalls.push(payload) },
    })
    const chat = {
      nodes: new Map([
        ['answer', { kind: 'assistant-step', data: { status: 'settled', turn: 1, finalNode: { messageId: 'm1', seq: 3 } } }],
        ['tail', { kind: 'turn-tail', data: { seq: 4, closing: { finalNode: { messageId: 'm1' } } } }],
      ]),
      locations: { getTurn: () => ['answer', 'tail'] },
    }
    const entry = winner('quote')
    const injected = entry.inject('s1')
    injected.editors.set('s1', target => { notes.push(target); return true })
    let acceptsQuote = false
    const render = () => entry.component({ ...injected, t: extension.t(entry.locale),
      useSession: select => select({ removed: false, subagent: null }),
      useConversation: select => select({ views: new Map([['chat', chat]]) }),
      readText: () => '所选原文',
      inputActions: { insertQuote: text => { inserted.push(text); return acceptsQuote } },
      clearSelection: () => events.push('clear'), dismiss: () => events.push('dismiss'),
    })
    const tree = render()
    assert.equal(tree.props.role, 'toolbar')
    const buttons = tree.children.filter(Boolean)
    assert.deepEqual(Array.from(buttons, button => button.children[0]), ['引用文本', '批注', '侧边聊天'])
    buttons[0].props.onClick()
    assert.deepEqual(events, [], 'a refused quote leaves the selection available')
    acceptsQuote = true
    buttons[0].props.onClick()
    assert.deepEqual(inserted, ['所选原文', '所选原文'])
    assert.deepEqual(events, ['clear', 'dismiss'])
    buttons[1].props.onClick()
    assert.equal(notes[0].origin.messageId, 'm1')
    buttons[2].props.onClick()
    assert.equal(sideCalls[0].sourceSessionId, 's1')
    assert.equal(sideCalls[0].atSeq, 4)
    assert.equal(sideCalls[0].quote, '所选原文')
    removeSideChat()
    assert.equal(render().children.filter(Boolean).length, 2, 'disabling side chat removes only its action')

    extension.dispose()
    assert.equal(winner('quote').registrant, 'official', 'disabling annotation restores official quoting')
    assert.equal(winner('eduwork-annotation'), undefined)
    extension = mount(annotation, core, 'annotation')
    assert.equal(winner('quote').registrant, 'annotation', 'reenabling annotation restores the combined toolbar')
    official.dispose()
    assert.equal(winner('eduwork-annotation').registrant, 'annotation', 'annotation also works without message-quotes')
    extension.dispose()
    assert.equal(core.entriesOfSlot(SLOT).length, 0)
  })
}
