/**
 * The loader page. At the relay's base URL it lists the computers this browser
 * is paired with and pairs a new one from an invite link. At `h/<hostId>/` it
 * keeps that computer connected, shows its DSH interface in an iframe and
 * carries the iframe's traffic: RPCs and streams for the preamble, everything
 * else for the Service Worker. The relay names its base URL in the page's
 * `<base>`, so relative URLs here resolve below it.
 */
import { parsePairingLink, type PairingLink } from '../protocol/auth.ts'
import { ChannelClosed } from '../protocol/channel.ts'
import { Close } from '../protocol/close-codes.ts'
import { appPath, hostPath, parseHostPath, type BridgeRequest, type BridgeResponse, type FetchMessage, type RemoteTunnel } from './bridge.ts'
import { HostLink, pair, Refused, type HostLinkState } from './connection.ts'
import { forgetHost, pairedHost, pairedHosts, rememberHost, type PairedHost } from './hosts.ts'
import { fill, text } from './text.ts'

type Child = Node | string | false | undefined
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props)
  element.append(...children.filter(child => child !== false && child !== undefined))
  return element
}

const base = new URL(document.baseURI)
const main = document.querySelector('main')!
const show = (...children: Child[]): void => main.replaceChildren(h('div', { className: 'card' }, ...children))
const note = (content: string): HTMLParagraphElement => h('p', { className: 'note', textContent: content })

function failure(error: unknown): string {
  if (error instanceof Refused) return text.refused[error.reason]
  if (error instanceof ChannelClosed && error.code === Close.hostOffline) return text.hostOffline
  console.warn(error)
  return text.connectFailed
}

// ---- the base URL: paired computers and pairing ----

async function home(): Promise<void> {
  const link = parsePairingLink(location.hash)
  if (link !== undefined) {
    const href = location.href
    history.replaceState(null, '', base)
    return showPairing(link, href)
  }
  const hosts = await pairedHosts()
  if (hosts.length === 1 && !new URLSearchParams(location.search).has('list')) return location.replace(hostPath(hosts[0]!.hostId))
  const paste = h('input', { type: 'url', placeholder: text.pastePlaceholder, autocomplete: 'off' })
  const error = note('')
  const go = (): void => {
    const url = parseUrl(paste.value.trim())
    const pasted = url === undefined ? undefined : parsePairingLink(url.hash)
    if (url === undefined || pasted === undefined) return void (error.textContent = text.badLink)
    // A link to another relay opens there.
    if (url.origin + url.pathname !== base.href) return location.assign(url)
    showPairing(pasted, url.href)
  }
  show(
    h('h1', { textContent: text.hosts }),
    hosts.length === 0 ? note(text.noHosts) : h('ul', {}, ...hosts.map(host => h('li', {},
      h('span', { textContent: host.name }),
      h('a', { className: 'button primary', href: hostPath(host.hostId), textContent: text.open }),
      h('button', { textContent: text.forget, onclick: () => void forgetHost(host.hostId).then(home) }),
    ))),
    h('label', {}, text.pasteLabel, paste),
    h('button', { className: 'primary', textContent: text.pasteGo, onclick: go }),
    error,
  )
}

/** `URL.parse` is missing from Safari before 18. */
function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

const isIos = (): boolean => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
const standalone = (): boolean => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

function deviceName(): string {
  const agent = navigator.userAgent
  const device = /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) || isIos() ? 'iPad' : /Android/.test(agent) ? 'Android'
    : /Mac OS X/.test(agent) ? 'Mac' : /Windows/.test(agent) ? 'Windows' : /Linux/.test(agent) ? 'Linux' : ''
  const browser = /EdgA?\/|EdgiOS/.test(agent) ? 'Edge' : /Firefox|FxiOS/.test(agent) ? 'Firefox' : /Chrome|CriOS/.test(agent) ? 'Chrome' : /Safari/.test(agent) ? 'Safari' : ''
  return [device, browser].filter(Boolean).join(' ') || 'Browser'
}

function showPairing(link: PairingLink, href: string): void {
  // On iOS the Home Screen app keeps its own storage, so a pairing made in Safari would not carry over to it.
  if (isIos() && !standalone()) {
    const copy = h('button', { className: 'primary', textContent: text.copyLink })
    copy.onclick = () => void navigator.clipboard.writeText(href).then(() => (copy.textContent = text.copied))
    return show(
      h('h1', { textContent: text.pairTitle }), note(text.iosInstall), copy,
      h('button', { textContent: text.pairHere, onclick: () => showPairingForm(link) }),
    )
  }
  showPairingForm(link)
}

function showPairingForm(link: PairingLink): void {
  const name = h('input', { value: deviceName(), maxLength: 64 })
  const start = async (): Promise<void> => {
    try {
      const host = await pair(link, name.value.trim() || deviceName(), code => show(
        h('h1', { textContent: text.confirmTitle }),
        h('p', { className: 'code', textContent: `${code.slice(0, 3)} ${code.slice(3)}` }),
        note(text.confirmHint),
      ))
      await rememberHost(host)
      show(note(text.paired))
      location.replace(hostPath(host.hostId))
    } catch (error) {
      show(note(failure(error)), h('a', { className: 'button', href: '?list', textContent: text.back }))
    }
  }
  show(
    h('h1', { textContent: text.pairTitle }),
    h('label', {}, text.deviceName, name),
    note(text.deviceNameHint),
    note(text.pairOwn),
    h('button', { className: 'primary', textContent: text.pairGo, onclick: () => void start() }),
  )
}

// ---- `h/<hostId>/`: one connected computer ----

async function openHost(hostId: string): Promise<void> {
  const host = await pairedHost(hostId)
  if (host === undefined) return location.replace('?list')
  if (!('serviceWorker' in navigator)) return show(note(text.noServiceWorker))
  document.title = host.name
  const updating = navigator.serviceWorker.controller !== null
  // Scoped to this relay's computers, so the worker leaves other pages of a shared domain alone.
  const registration = await navigator.serviceWorker.register('sw.js', { scope: 'h/' })
  await activated(registration)
  // A worker replacing the one this page started with may speak a newer bridge; let the user reload when it suits them.
  if (updating) navigator.serviceWorker.addEventListener('controllerchange', () => banner(text.update, text.reload, () => location.reload()), { once: true })

  const link = new HostLink(host, state => status(host, link, state))
  installBridge(link)
  link.start()
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && link.check())
  addEventListener('online', () => link.check())
}

/** Wait for this page's own worker to activate; `serviceWorker.ready` may still name an older one. */
async function activated(registration: ServiceWorkerRegistration): Promise<void> {
  const worker = registration.installing ?? registration.waiting ?? registration.active
  if (worker === null || worker.state === 'activated') return
  await new Promise<void>(resolve => worker.addEventListener('statechange', () => worker.state === 'activated' && resolve()))
}

function installBridge(link: HostLink): void {
  const fetchVia = async (request: BridgeRequest, signal?: AbortSignal | null): Promise<BridgeResponse> => {
    const tunnel = link.tunnel
    if (tunnel === undefined) return { error: 'not connected to the computer' }
    try {
      const response = await tunnel.fetch({
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers),
        ...request.body !== undefined && { body: new Uint8Array(request.body) },
      }, signal ?? undefined)
      return { status: response.status, headers: [...response.headers], body: await response.arrayBuffer() }
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      return { error: String(error) }
    }
  }
  const remoteTunnel: RemoteTunnel = {
    fetch: fetchVia,
    async *openStream(endpoint, payload, signal, uplink) {
      const tunnel = link.tunnel
      if (tunnel === undefined) throw new Error('not connected to the computer')
      yield* tunnel.openStream(endpoint, payload, signal, uplink)
    },
  }
  Object.assign(window, { remoteTunnel })
  navigator.serviceWorker.addEventListener('message', ({ data, ports }: MessageEvent<FetchMessage>) => {
    if (data?.kind !== 'fetch') return
    void fetchVia(data.request).then(reply => ports[0]!.postMessage(reply, 'body' in reply ? [reply.body] : []))
  })
  navigator.serviceWorker.startMessages()
}

const bar = h('div', { id: 'bar', hidden: true })
document.body.append(bar)
let ticker: ReturnType<typeof setInterval> | undefined

function status(host: PairedHost, link: HostLink, state: HostLinkState): void {
  clearInterval(ticker)
  bar.hidden = state.state === 'connected'
  if (state.state === 'connecting') bar.replaceChildren(fill(text.connecting, { name: host.name }))
  if (state.state === 'waiting') {
    const tick = (): void => bar.replaceChildren(
      fill(state.offline ? text.waitingOffline : text.waitingLost, { name: host.name, seconds: Math.max(0, Math.ceil((state.retryAt - Date.now()) / 1000)) }),
      h('button', { textContent: text.retry, onclick: () => link.check() }),
    )
    tick()
    ticker = setInterval(tick, 1000)
  }
  if (state.state === 'connected' && document.querySelector('iframe') === null) {
    main.replaceChildren(h('iframe', { src: appPath(host.hostId), title: state.host }))
  }
  if (state.state === 'unpaired') {
    bar.hidden = true
    void forgetHost(host.hostId)
    show(note(text.refused[state.reason]), h('a', { className: 'button', href: '?list', textContent: text.back }))
  }
}

function banner(message: string, action: string, onAction: () => void): void {
  document.body.append(h('div', { id: 'banner' }, message, h('button', { textContent: action, onclick: onAction })))
}

const target = parseHostPath(location.pathname.slice(base.pathname.length))
void (target !== undefined && target.rest === '' ? openHost(target.hostId) : home()).catch(error => show(note(failure(error))))
