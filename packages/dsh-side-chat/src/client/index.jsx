import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Toast, Tooltip, IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { SideChatRegistry, SIDE_CHAT_PATH, SIDE_KIND, addressOf } from './controller.js'
import { alignComposerDocks } from './composer-alignment.js'

const h = React.createElement
const NS = 'eduworkSideChat'
// Remote reconnection may remount plugins without closing the window. Keep
// ownership in this window's memory, never in browser persistence.
const WINDOW_CONTROLLER = Symbol.for('@eduwork/dsh-side-chat/window-controllers')
const EMPTY_STATE = { phase: 'idle', references: [] }
const COPY = {
  zh: { open: '开启侧边聊天', title: '侧边聊天', emptyHint: '侧边聊天是临时聊天，关闭后会消失', ask: '在侧边聊天提问', onlyOne: '已有侧聊。请先关闭，再从这里开启。', failed: '操作失败，请重试。', dismiss: '关闭' },
  en: { open: 'Open side chat', title: 'Side chat', emptyHint: 'Side chats are temporary and disappear when closed.', ask: 'Ask in side chat', onlyOne: 'A side chat is already open. Close it to start one here.', failed: 'Something went wrong. Try again.', dismiss: 'Dismiss' },
}

const actionFallback = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 'calc(28px + var(--dsh-content-font-delta, 0px))', height: 'calc(28px + var(--dsh-content-font-delta, 0px))',
  border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)',
  cursor: 'pointer', padding: 6, borderRadius: 'var(--dsw-radius-sm)',
}

function SideChatIcon({ size = 16 }) {
  return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: 'M8.5 1.5h5a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-5M8.5 1.5v13M1.5 3.5h4M1.5 8h4M1.5 12.5h4' }))
}

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
  useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const state = controller.findAddress(info.tab.contentId)?.snapshot ?? EMPTY_STATE
  const chat = state.chat
  const root = useRef(null)
  useEffect(() => chat && root.current ? alignComposerDocks(root.current, chat.sourceSessionId) : undefined,
    [chat?.sessionId, chat?.sourceSessionId])
  return h('section', {
    ref: root,
    'data-eduwork-side-chat': '', 'data-side-source': chat?.sourceSessionId, 'data-side-session': chat?.sessionId, 'aria-label': t('title'),
    style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  },
  h('style', null, '[data-eduwork-side-chat] [data-conversation-content]{flex:1;min-height:0;width:100%}[data-eduwork-side-chat] [data-composer-seat]{margin-top:auto}[data-eduwork-side-chat] button:is([aria-label="在新对话中分支"],[aria-label="Branch into a new conversation"]){display:none}'),
  state.phase === 'closing' || !chat
    ? null
    : resource.value === undefined ? null
      : h(SessionProvider, { session: resource.value.reference }, renderSlot('eduwork.side.conversation', {})))
}

function SideDraftDelivery({ sessionId, controller, sessions, conversation, sidebarRight, inputActions, useInput, t }) {
  useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const owner = controller.findSession(sessionId)
  const state = owner?.snapshot ?? EMPTY_STATE
  const activeSource = useSyncExternalStore(sidebarRight.mounted.subscribe, sidebarRight.mounted.getSnapshot)
  const inputState = useInput(value => value)
  useEffect(() => {
    const pending = state.references.find(item => item.sessionId === sessionId)
    if (!pending || activeSource !== state.chat?.sourceSessionId || state.phase !== 'open' || inputState.phase !== 'plain' || inputState.claim
      || !owner.getSnapshot().references.some(item => item.id === pending.id)) return
    // InputBar's parent mount effect restores focus after this child effect.
    // Insert on the next frame so that restoration cannot overwrite the
    // native insertion's trailing caret on the first open.
    const frame = requestAnimationFrame(() => {
      const live = owner.getSnapshot()
      if (live.phase !== 'open' || live.chat?.sessionId !== sessionId || sidebarRight.mounted.getSnapshot() !== live.chat.sourceSessionId
        || !live.references.some(item => item.id === pending.id)) return
      const actx = sessions.scope(sessionId)
      if (!actx) return
      const input = conversation.input.for(actx)
      const current = input.state.getSnapshot()
      if (current.phase !== 'plain' || current.claim) return
      // Restore Lexical's saved selection before editing. A DOM focus after
      // insertion can overwrite the new trailing caret when this existing
      // composer lost focus to a selection in the source conversation.
      input.focus()
      const caret = inputActions.captureInsertion()
      const accepted = actx.bail(actx, 'slash/input-insert-reference', {
        reference: pending.reference, span: { start: caret.end, end: caret.end, draftRev: caret.draftRev },
      }) === true
      if (accepted) owner.consumeReference(pending.id)
      else input.notify('error', t('failed'))
    })
    return () => cancelAnimationFrame(frame)
  }, [state, activeSource, inputState.phase, inputState.claim, inputState.draftRev, sessionId, owner, sessions, conversation, sidebarRight, inputActions, t])
  return null
}

function SideAction({ sessionId, seq, messageId, useConversation, controller, open, t }) {
  const button = useRef(null)
  const [actionClass, setActionClass] = useState(undefined)
  useLayoutEffect(() => {
    // The native slot does not export its action CSS. Reuse the adjacent
    // button's live class instead of pinning a generated class name. This
    // also tracks native user/assistant icon sizes and content-font scaling.
    const native = button.current?.closest('[data-clock]')?.querySelector('button:not([data-eduwork-side-action])')
    setActionClass(native?.className || undefined)
  }, [sessionId])
  const boundary = useConversation(snapshot => {
    if (Number.isSafeInteger(seq)) return seq
    for (const node of snapshot?.views.get('chat')?.nodes.values() ?? []) {
      if (node.kind === 'turn-tail' && node.data.closing?.finalNode.messageId === messageId) return node.data.seq
    }
    return undefined
  })
  useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const state = controller.findSource(sessionId)?.snapshot ?? EMPTY_STATE
  if (sessionId.startsWith('side-') || !Number.isSafeInteger(boundary)) return null
  const disabled = state.phase === 'opening' || state.phase === 'closing'
  return h(Tooltip, { label: t('open'), side: 'bottom' }, h('button', {
    ref: button, type: 'button', className: actionClass, style: actionClass ? undefined : actionFallback,
    'data-eduwork-side-action': '', 'data-unavailable': disabled || undefined, 'aria-label': t('open'),
    disabled,
    onClick: () => { void open(sessionId, boundary) },
  }, h(SideChatIcon)))
}

function Notice({ controller, sidebarRight, t }) {
  useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const source = useSyncExternalStore(sidebarRight.mounted.subscribe, sidebarRight.mounted.getSnapshot)
  const owner = controller.findSource(source)
  const state = owner?.snapshot ?? EMPTY_STATE
  if (!state.error) return null
  const dismiss = () => owner.update({ error: undefined })
  return h(Toast, {
    key: `${source}:${state.noticeSequence}`,
    text: t(state.error), icon: h(IconWarningOutlineRegular),
    // Two seconds to read, then the native one-second fade: three total.
    holdMs: 2000, onDone: dismiss,
    actions: [{ label: t('dismiss'), onClick: dismiss }],
  })
}

export const inject = ['slots', 'sessions', 'locale', 'resources', 'sidebarRight', 'sidebarRightTabs']

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, COPY), 'side-chat: dictionaries')
  const t = ctx.locale.bind(NS)
  const controller = globalThis[WINDOW_CONTROLLER] ??= new SideChatRegistry({
    owner: () => crypto.randomUUID().replaceAll('-', ''),
    request: async input => {
      const response = await fetch(SIDE_CHAT_PATH.slice(1), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), cache: 'no-store' })
      if (!response.ok) { const error = new Error('failed'); error.status = response.status; throw error }
      return response.json()
    },
  })
  const open = async (sessionId, atSeq) => {
    const owner = controller.forSource(sessionId)
    try {
      const chat = await owner.open(sessionId, atSeq)
      if (ctx.sidebarRight.mounted.getSnapshot() === sessionId) ctx.sidebarRight.openResource(addressOf(chat.sessionId))
    } catch (error) { owner.update({ error: error.message === 'onlyOne' ? 'onlyOne' : 'failed' }) }
  }
  ctx.inject(['annotationSelection'], scope => {
    scope.effect(() => scope.annotationSelection.register({
      id: 'eduwork-side-chat', icon: 'side-chat', label: () => t('ask'),
      renderIcon: () => h(SideChatIcon),
      available: sessionId => !sessionId.startsWith('side-'),
      async run({ sourceSessionId, atSeq, reference }) {
        const owner = controller.forSource(sourceSessionId)
        const current = owner.snapshot
        const chat = current.phase === 'open' && current.chat?.sourceSessionId === sourceSessionId
          ? current.chat : await owner.open(sourceSessionId, atSeq)
        if (scope.sidebarRight.mounted.getSnapshot() !== sourceSessionId) throw new Error('expired')
        scope.sidebarRight.openResource(addressOf(chat.sessionId))
        owner.queueReference(chat.sessionId, reference)
      },
    }), 'side-chat: selected-text action')
  })
  ctx.effect(() => {
    const timer = setInterval(() => { void controller.retryCleanup().catch(() => {}) }, 10_000)
    const closeOnPageExit = () => {
      for (const owner of controller.all()) {
        const chat = owner.snapshot.chat
        if (!chat) continue
        const body = JSON.stringify({ action: 'close', owner: chat.owner, sessionId: chat.sessionId })
        // Electron's secure dsh-app scheme supports fetch, but not sendBeacon.
        try { if (navigator.sendBeacon(SIDE_CHAT_PATH.slice(1), new Blob([body], { type: 'text/plain' }))) continue } catch {}
        void fetch(SIDE_CHAT_PATH.slice(1), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true }).catch(() => {})
      }
    }
    window.addEventListener('pagehide', closeOnPageExit)
    // Disposing a plugin scope is also part of connection recovery. Only the
    // tab close, real page exit or Host shutdown owns session destruction.
    return () => { clearInterval(timer); window.removeEventListener('pagehide', closeOnPageExit) }
  }, 'side-chat: window ownership')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: '@eduwork/dsh-side-chat', kind: SIDE_KIND, keepMounted: true,
    patterns: ['dsh-resource://sidechat/**'], title: () => t('title'),
  }), 'side-chat: native Sidebar type')
  ctx.effect(() => ctx.sidebarRight.registerCloseHandler(SIDE_KIND, (_sessionId, tab) => {
    const owner = controller.findAddress(tab.contentId)
    if (owner) void owner.close().catch(() => {})
  }), 'side-chat: explicit tab close')
  ctx.effect(() => ctx.resources.register({
    protocol: 'sidechat',
    async *open(address, { signal }) {
      const chat = controller.findAddress(address)?.snapshot.chat
      if (!chat?.sessionId || address !== addressOf(chat.sessionId)) throw new Error(t('failed'))
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
    inject: sessionId => ({ sessionId, controller, sessions: ctx.sessions, conversation: ctx.get('conversation'), sidebarRight: ctx.sidebarRight }),
  }, SideDraftDelivery))
  for (const name of ['conversation.chat.user.actions', 'conversation.chat.assistant-actions']) {
    ctx.slots.inject(name, () => ctx.slots.register({ name, id: 'eduwork-side-chat', order: 20, locale: NS, inject: () => ({ controller, open }) }, SideAction))
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'eduwork-side-chat-notice', order: 90, locale: NS, inject: () => ({ controller, sidebarRight: ctx.sidebarRight }) }, Notice))
}
