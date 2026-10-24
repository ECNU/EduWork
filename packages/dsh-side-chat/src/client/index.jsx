import React, { useEffect, useRef, useSyncExternalStore } from 'react'
import { SideChatController, SIDE_CHAT_PATH, SIDE_KIND, addressOf } from './controller.js'
import { alignComposerDocks } from './composer-alignment.js'

const h = React.createElement
const NS = 'eduworkSideChat'
const COPY = {
  zh: { open: '开启侧边聊天', title: '侧边聊天', emptyHint: '侧边聊天是临时聊天，关闭后会消失', ask: '在侧边聊天提问', onlyOne: '请先关闭当前侧边聊天，再从另一会话开启。', failed: '侧聊操作未完成，请稍后重试。', expired: '临时侧聊已结束。', dismiss: '关闭提示' },
  en: { open: 'Open side chat', title: 'Side chat', emptyHint: 'Side chats are temporary and disappear when closed.', ask: 'Ask in side chat', onlyOne: 'Close the current side chat before starting one from another conversation.', failed: 'The side-chat operation failed. Try again shortly.', expired: 'The temporary side chat has ended.', dismiss: 'Dismiss notice' },
}

const buttonStyle = { border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: '5px 8px', borderRadius: 6, font: 'inherit' }

const SideCopy = React.createContext(key => COPY.en[key])
function SideViews({ renderSlot, useSession }) {
  const empty = useSession(session => session.blank)
  const t = React.useContext(SideCopy)
  if (!empty) return renderSlot('conversation.session', { view: 'chat' })
  return h('div', { 'data-side-chat-empty': '', style: { flex: '1 0 180px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', boxSizing: 'border-box' } },
    h('div', { style: { maxWidth: 340, textAlign: 'center', color: 'var(--dsw-alias-label-secondary, #777)' } },
      h('svg', { width: 32, height: 32, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M20 11.5a8.5 8.5 0 1 0-4 7.2l5 1.3-1.3-5a8.5 8.5 0 0 0 .3-3.5ZM12 7v8M8 11h8' })),
      h('h2', { style: { margin: '14px 0 8px', fontSize: 18, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #222)' } }, t('title')),
      h('p', { style: { margin: 0, fontSize: 13, lineHeight: 1.65 } }, t('emptyHint'))))
}

function SideConversation({ renderFactorySlot, t }) {
  return h(SideCopy.Provider, { value: t },
    renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: { views: SideViews } }))
}

function SideChatTab({ useResource, useTabInfo, SessionProvider, renderSlot, controller, t }) {
  const info = useTabInfo()
  const resource = useResource(info.tab.contentId)
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const chat = state.chat
  const root = useRef(null)
  useEffect(() => chat && root.current ? alignComposerDocks(root.current, chat.sourceSessionId) : undefined,
    [chat?.sessionId, chat?.sourceSessionId])
  return h('section', {
    ref: root,
    'data-eduwork-side-chat': '', 'aria-label': t('title'),
    style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  },
  h('style', null, '[data-eduwork-side-chat] [data-conversation-content]{flex:1;min-height:0;width:100%}[data-eduwork-side-chat] [data-composer-seat]{margin-top:auto}'),
  state.phase === 'closing' || !chat
    ? null
    : resource.value === undefined ? null
      : h(SessionProvider, { session: resource.value.reference }, renderSlot('eduwork.side.conversation', {})))
}

function SideDraftDelivery({ sessionId, controller, sessions, conversation, inputActions, useInput, t }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const inputState = useInput(value => value)
  useEffect(() => {
    const pending = state.references.find(item => item.sessionId === sessionId)
    if (!pending || state.phase !== 'open' || inputState.phase !== 'plain' || inputState.claim
      || !controller.getSnapshot().references.some(item => item.id === pending.id)) return
    const actx = sessions.scope(sessionId)
    if (!actx) return
    const caret = inputActions.captureInsertion()
    const accepted = actx.bail(actx, 'slash/input-insert-reference', {
      reference: pending.reference, span: { start: caret.end, end: caret.end, draftRev: caret.draftRev },
    }) === true
    const input = conversation.input.for(actx)
    if (accepted) { controller.consumeReference(pending.id); input.focus() }
    else input.notify('error', t('failed'))
  }, [state, inputState.phase, inputState.claim, inputState.draftRev, sessionId, controller, sessions, conversation, inputActions, t])
  return null
}

function SideAction({ sessionId, seq, messageId, useConversation, controller, open, t }) {
  const boundary = useConversation(snapshot => {
    if (Number.isSafeInteger(seq)) return seq
    for (const node of snapshot?.views.get('chat')?.nodes.values() ?? []) {
      if (node.kind === 'turn-tail' && node.data.closing?.finalNode.messageId === messageId) return node.data.seq
    }
    return undefined
  })
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  if (sessionId.startsWith('side-') || !Number.isSafeInteger(boundary)) return null
  return h('button', {
    type: 'button', style: buttonStyle, title: t('open'), 'aria-label': t('open'),
    disabled: state.phase === 'opening' || state.phase === 'closing',
    onClick: () => { void open(sessionId, boundary) },
  }, h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M13 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6M13 4v16M4 7h5M4 12h5M4 17h5' })))
}

function Notice({ controller, t }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  if (!state.error) return null
  return h('div', { role: 'alert', style: { pointerEvents: 'auto', position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', padding: 12, borderRadius: 8, background: 'var(--dsw-alias-surface-l2, white)', boxShadow: '0 4px 24px #0003', maxWidth: '80vw', zIndex: 200 } },
    t(state.error), h('button', { style: buttonStyle, type: 'button', 'aria-label': t('dismiss'), onClick: () => controller.update({ error: undefined }) }, '×'))
}

export const inject = ['slots', 'sessions', 'locale', 'resources', 'sidebarRight', 'sidebarRightTabs']

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, COPY), 'side-chat: dictionaries')
  const t = ctx.locale.bind(NS)
  const controller = new SideChatController({
    owner: () => crypto.randomUUID().replaceAll('-', ''),
    request: async input => {
      const response = await fetch(SIDE_CHAT_PATH.slice(1), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), cache: 'no-store' })
      if (!response.ok) { const error = new Error('failed'); error.status = response.status; throw error }
      return response.json()
    },
  })
  const open = async (sessionId, atSeq) => {
    try {
      const chat = await controller.open(sessionId, atSeq)
      if (ctx.sidebarRight.mounted.getSnapshot() === sessionId) ctx.sidebarRight.openResource(addressOf(chat.sessionId))
    } catch (error) { controller.update({ error: error.message === 'onlyOne' ? 'onlyOne' : 'failed' }) }
  }
  ctx.inject(['annotationSelection'], scope => {
    scope.effect(() => scope.annotationSelection.register({
      id: 'eduwork-side-chat', icon: 'side-chat', label: () => t('ask'),
      available: sessionId => !sessionId.startsWith('side-'),
      async run({ sourceSessionId, atSeq, reference }) {
        const current = controller.snapshot
        const chat = current.phase === 'open' && current.chat?.sourceSessionId === sourceSessionId
          ? current.chat : await controller.open(sourceSessionId, atSeq)
        if (scope.sidebarRight.mounted.getSnapshot() !== sourceSessionId) throw new Error('expired')
        scope.sidebarRight.openResource(addressOf(chat.sessionId))
        controller.queueReference(chat.sessionId, reference)
      },
    }), 'side-chat: selected-text action')
  })
  ctx.effect(() => {
    const timer = setInterval(() => { void controller.heartbeat().catch(() => {}) }, 10_000)
    const closeOnPageExit = () => {
      const chat = controller.snapshot.chat
      if (!chat) return
      const body = JSON.stringify({ action: 'close', owner: chat.owner, sessionId: chat.sessionId })
      // Electron's secure dsh-app scheme supports fetch, but not sendBeacon.
      try { if (navigator.sendBeacon(SIDE_CHAT_PATH.slice(1), new Blob([body], { type: 'text/plain' }))) return } catch {}
      void fetch(SIDE_CHAT_PATH.slice(1), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true }).catch(() => {})
    }
    window.addEventListener('pagehide', closeOnPageExit)
    return async () => { clearInterval(timer); window.removeEventListener('pagehide', closeOnPageExit); await controller.close() }
  }, 'side-chat: window lease')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: '@eduwork/dsh-side-chat', kind: SIDE_KIND, keepMounted: true,
    patterns: ['dsh-resource://sidechat/**'], title: () => t('title'),
  }), 'side-chat: native Sidebar type')
  ctx.effect(() => ctx.sidebarRight.registerCloseHandler(SIDE_KIND, (_sessionId, tab) => {
    const chat = controller.snapshot.chat
    if (chat && tab.contentId === addressOf(chat.sessionId)) void controller.close().catch(() => {})
  }), 'side-chat: explicit tab close')
  ctx.effect(() => ctx.resources.register({
    protocol: 'sidechat',
    async *open(address, { signal }) {
      const chat = controller.snapshot.chat
      if (!chat?.sessionId || address !== addressOf(chat.sessionId)) throw new Error(t('expired'))
      const reference = ctx.sessions.retainAgentScope(chat.sessionId)
      try {
        yield { ok: true, value: { reference } }
        if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
      } finally { reference.release() }
    },
  }), 'side-chat: owned chat resource')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: '@eduwork/dsh-side-chat', locale: NS,
    children: { 'eduwork.side.conversation': { kind: 'single', scope: 'session' } },
    inject: () => ({ controller }),
  }, SideChatTab))
  ctx.slots.inject('eduwork.side.conversation', () => ctx.slots.register({ name: 'eduwork.side.conversation', locale: NS }, SideConversation))
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay', id: 'eduwork-side-chat-reference', order: 20, locale: NS,
    inject: sessionId => ({ sessionId, controller, sessions: ctx.sessions, conversation: ctx.get('conversation') }),
  }, SideDraftDelivery))
  for (const name of ['conversation.chat.user.actions', 'conversation.chat.assistant-actions']) {
    ctx.slots.inject(name, () => ctx.slots.register({ name, id: 'eduwork-side-chat', order: 20, locale: NS, inject: () => ({ controller, open }) }, SideAction))
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'eduwork-side-chat-notice', order: 90, locale: NS, inject: () => ({ controller }) }, Notice))
}
