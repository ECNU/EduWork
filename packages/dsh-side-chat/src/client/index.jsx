import React, { useSyncExternalStore } from 'react'
import { SideChatController, SIDE_CHAT_PATH, SIDE_KIND, addressOf } from './controller.js'

const h = React.createElement
const NS = 'eduworkSideChat'
const COPY = {
  zh: { open: '开启侧边聊天', title: '临时侧聊', hint: '关闭后丢弃', close: '关闭侧聊', source: '返回来源会话', onlyOne: '请先关闭当前临时侧聊，再从另一条消息开启。', failed: '侧聊操作未完成，正在重试清理。', expired: '临时侧聊已结束。', dismiss: '关闭提示' },
  en: { open: 'Open side chat', title: 'Temporary side chat', hint: 'Discarded on close', close: 'Close side chat', source: 'Return to source', onlyOne: 'Close the current temporary chat before branching from another message.', failed: 'The side-chat operation failed. Cleanup will retry.', expired: 'The temporary side chat has ended.', dismiss: 'Dismiss notice' },
}

const buttonStyle = { border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: '5px 8px', borderRadius: 6, font: 'inherit' }

function FixedChatView({ renderSlot }) { return renderSlot('conversation.session', { view: 'chat' }) }

function SideConversation({ renderFactorySlot }) {
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: { views: FixedChatView } })
}

function SideChatTab({ useResource, useTabInfo, SessionProvider, renderSlot, controller, t, openSource }) {
  const info = useTabInfo()
  const resource = useResource(info.tab.contentId)
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const chat = state.chat
  return h('section', {
    'data-eduwork-side-chat': '', 'aria-label': t('title'),
    style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  },
  h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--dsw-alias-border-l2, #ddd)', flexShrink: 0 } },
    h('strong', { style: { fontSize: 13 } }, t('title')),
    h('span', { style: { opacity: 0.65, fontSize: 12, flex: 1 } }, t('hint')),
    h('button', { type: 'button', style: buttonStyle, title: t('source'), 'aria-label': t('source'), onClick: () => chat && openSource(chat.sourceSessionId) }, '↩'),
    h('button', { type: 'button', style: buttonStyle, title: t('close'), 'aria-label': t('close'), onClick: () => { void controller.close().then(() => info.tab.actions.close()).catch(() => {}) } }, '×')),
  state.phase === 'closing' || !chat
    ? h('p', { role: 'status', style: { padding: 12 } }, t('expired'))
    : resource.value === undefined ? null
      : h(SessionProvider, { session: resource.value.reference }, renderSlot('eduwork.side.conversation', {})))
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
  }, '↗')
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
    inject: () => ({ controller, openSource: id => ctx.get('uiWorkspace').openSession(id) }),
  }, SideChatTab))
  ctx.slots.inject('eduwork.side.conversation', () => ctx.slots.register({ name: 'eduwork.side.conversation' }, SideConversation))
  for (const name of ['conversation.chat.user.actions', 'conversation.chat.assistant-actions']) {
    ctx.slots.inject(name, () => ctx.slots.register({ name, id: 'eduwork-side-chat', order: 20, locale: NS, inject: () => ({ controller, open }) }, SideAction))
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'eduwork-side-chat-notice', order: 90, locale: NS, inject: () => ({ controller }) }, Notice))
}
