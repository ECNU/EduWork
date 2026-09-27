import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import css from './panel.module.css'

export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs', 'sessions']
type PageState = { title: string; url: string; loading: boolean; back: boolean; forward: boolean; revision: number } | null
type Bridge = {
  command(request: Record<string, unknown>): Promise<any>
  subscribe(listener: (event: { owner: string; state: PageState }) => void): () => void
}
const bridge = () => (window as unknown as { eduworkBrowserPanel?: Bridge }).eduworkBrowserPanel
const zh = navigator.language.toLowerCase().startsWith('zh')
const labels = zh
  ? { browser: '浏览器', description: '查看当前会话正在浏览的网页', back: '后退', forward: '前进', reload: '刷新', stop: '停止加载', external: '在外部浏览器打开', address: '输入网址', open: '访问', empty: '在当前会话中浏览网页', hint: '输入网址开始浏览，或让 AI 打开网页后显示在这里。', failed: '网页操作失败，请重试。' }
  : { browser: 'Browser', description: 'Browse pages in this conversation', back: 'Back', forward: 'Forward', reload: 'Reload', stop: 'Stop loading', external: 'Open in external browser', address: 'Enter a web address', open: 'Go', empty: 'Browse in this conversation', hint: 'Enter a URL, or ask the assistant to open and show a page.', failed: 'Could not complete the browser action. Please retry.' }

function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    external: <path d="M11 3h6v6M17 3l-9 9M8 4H4v13h13v-4"/>,
    back: <path d="m10 4-6 6 6 6M4 10h13"/>,
    forward: <path d="m10 4 6 6-6 6M16 10H3"/>,
    reload: <><path d="M16 7a6.5 6.5 0 1 0 .2 6M16 3v4h-4"/></>,
    stop: <path d="m5 5 10 10M15 5 5 15"/>,
    globe: <><circle cx="10" cy="10" r="7.5"/><ellipse cx="10" cy="10" rx="3" ry="7.5"/><path d="M3 7h14M3 13h14"/></>,
    open: <path d="M3 10h13m-5-5 5 5-5 5"/>,
  }
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
class BrowserStore {
  pages = new Map<string, PageState>()
  listeners = new Set<() => void>()
  tabs = new Map<AbortSignal, { owner: string; close: () => void }>()
  bindTab(owner: string, signal: AbortSignal, api: Bridge) {
    if (signal.aborted || this.tabs.has(signal)) return
    const close = () => {
      this.tabs.delete(signal)
      if (![...this.tabs.values()].some(tab => tab.owner === owner)) void api.command({ action: 'close', owner }).catch(() => {})
    }
    this.tabs.set(signal, { owner, close })
    signal.addEventListener('abort', close, { once: true })
  }
  dispose() {
    for (const [signal, tab] of this.tabs) signal.removeEventListener('abort', tab.close)
    this.tabs.clear()
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  read = (owner: string) => this.pages.get(owner) ?? null
  update(owner: string, state: PageState) { this.pages.set(owner, state); for (const listener of this.listeners) listener() }
}
type PaneProps = { sessionId: string; store: BrowserStore; api: Bridge; useTabInfo(): { tab: { id: string; visible: boolean; signal: AbortSignal; actions: { close(): void } } } }
function BrowserPane({ sessionId: owner, store, api, useTabInfo }: PaneProps) {
  const { tab } = useTabInfo()
  const state = useSyncExternalStore(store.subscribe, () => store.read(owner), () => null)
  const hadPage = useRef(false)
  useEffect(() => {
    if (state) hadPage.current = true
    else if (hadPage.current) { hadPage.current = false; tab.actions.close() }
  }, [state, tab.actions])
  const host = useRef<HTMLDivElement>(null)
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const editing = useRef(false)
  const lease = useRef(crypto.randomUUID())
  const request = (action: string, args = {}) => api.command({ owner, action, ...args })
  useEffect(() => { if (!editing.current) setAddress(state?.url === 'about:blank' ? '' : state?.url ?? '') }, [state?.url])
  useEffect(() => {
    let stopped = false
    void request('state').then(value => { if (!stopped) store.update(owner, value) }).catch(() => { if (!stopped) setError(labels.failed) })
    return () => { stopped = true }
  }, [owner, api, store])
  useEffect(() => {
    // Tab records outlive pane unmounts when switching to Studio or another session.
    store.bindTab(owner, tab.signal, api)
  }, [owner, api, store, tab.signal])
  useEffect(() => {
    const el = host.current
    if (!el || !tab.visible || !state || tab.signal.aborted) return
    let frame = 0, previous = '', closed = false
    const hide = () => { void request('hide', { lease: lease.current }).catch(() => {}) }
    const update = () => {
      if (closed) return
      const modal = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"],[role="menu"],[role="listbox"]')]
        .some(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
      const rect = el.getBoundingClientRect()
      const bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      const next = modal ? 'hidden' : JSON.stringify(bounds)
      if (next !== previous) {
        previous = next
        if (modal) hide()
        else void request('bounds', { bounds, lease: lease.current }).catch(() => { if (!closed) setError(labels.failed) })
      }
      frame = requestAnimationFrame(update)
    }
    const release = () => { closed = true; cancelAnimationFrame(frame); hide() }
    tab.signal.addEventListener('abort', release, { once: true })
    update()
    return () => { tab.signal.removeEventListener('abort', release); release() }
  }, [owner, api, tab.id, tab.visible, tab.signal, Boolean(state)])
  const act = async (action: string, args = {}) => {
    try { setError(''); await request(action, args) } catch { setError(labels.failed) }
  }
  return <section className={css.panel} aria-label={labels.browser}>
    <form className={css.toolbar} onSubmit={event => {
      event.preventDefault(); editing.current = false
      const value = address.trim()
      if (value) void act(state ? 'navigate' : 'open', { url: /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : 'https://' + value })
    }}>
      <div className={css.navigation}>
        <button type="button" className={css.iconButton} title={labels.back} aria-label={labels.back} disabled={!state?.back} onClick={() => act('back')}><Icon name="back"/></button>
        <button type="button" className={css.iconButton} title={labels.forward} aria-label={labels.forward} disabled={!state?.forward} onClick={() => act('forward')}><Icon name="forward"/></button>
        <button type="button" className={css.iconButton} title={state?.loading ? labels.stop : labels.reload} aria-label={state?.loading ? labels.stop : labels.reload} disabled={!state} onClick={() => act(state?.loading ? 'stop' : 'reload')}><Icon name={state?.loading ? 'stop' : 'reload'}/></button>
      </div>
      <div className={css.address}>
        <span className={css.addressIcon}><Icon name="globe"/></span>
        <input aria-label={labels.address} placeholder={labels.address} value={address} spellCheck={false} autoComplete="off"
          onFocus={() => { editing.current = true }} onBlur={() => { editing.current = false }}
          onChange={event => setAddress(event.target.value)}/>
        <button type="submit" className={css.iconButton} title={labels.open} aria-label={labels.open} disabled={!address.trim()}><Icon name="open"/></button>
      </div>
      <button type="button" className={css.iconButton} title={labels.external} aria-label={labels.external} disabled={!state || !/^https?:/i.test(state.url)} onClick={() => act('external')}><Icon name="external"/></button>
    </form>
    <div className={css.progress} data-loading={state?.loading || undefined}/>
    {error && <div role="alert" className={css.error}>{error}</div>}
    <div ref={host} className={css.viewport}>
      {!state && <div className={css.empty}><Icon name="globe"/><strong>{labels.empty}</strong><p>{labels.hint}</p></div>}
    </div>
  </section>
}
export async function apply(ctx) {
  const api = bridge()
  if (!api) return
  try { if (!(await api.command({ action: 'capabilities' }))?.embeddedBrowser) return } catch { return }
  const store = new BrowserStore(), seen = new Map<string, number>()
  let current: string | null = null, disposed = false
  const reveal = (owner: string, state: PageState) => {
    if (disposed || owner !== current || !state?.revision || state.revision <= (seen.get(owner) ?? 0)) return
    try { ctx.sidebarRight.openTab('eduwork-browser'); seen.set(owner, state.revision) } catch { /* Seat not mounted yet: next session commit retries. */ }
  }
  const receive = ({ owner, state }: { owner: string; state: PageState }) => { store.update(owner, state); reveal(owner, state) }
  const select = () => {
    const owner = ctx.sessions.list.getSnapshot().current ?? null
    if (owner === current) { if (owner) reveal(owner, store.read(owner)); return }
    current = owner
    void api.command({ action: 'select', owner }).then(state => {
      if (!disposed && current === owner && owner) receive({ owner, state })
    }).catch(() => {})
  }
  const disposers = [
    ctx.sidebarRightTabs.register({ id: '@eduwork/client-ui-browser', kind: 'eduwork-browser', title: () => labels.browser,
      guide: [{ order: 40, title: () => labels.browser, description: () => labels.description }] }),
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: '@eduwork/client-ui-browser', inject: () => ({ store, api }),
    }, BrowserPane)),
    api.subscribe(receive),
    ctx.sessions.list.subscribe(select),
  ]
  select()
  ctx.effect(() => () => { disposed = true; store.dispose(); disposers.reverse().forEach(dispose => dispose()); void api.command({ action: 'select', owner: null }).catch(() => {}) })
}
