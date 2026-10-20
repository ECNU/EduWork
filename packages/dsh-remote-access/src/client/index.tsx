/**
 * The settings page on the Host's own screen: the switch and the relay
 * settings, the pairing QR code, confirmation of waiting devices and the list
 * of paired devices. Remote devices never see this page; the gate refuses its
 * methods to them.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { encode } from 'uqr'
import type { PanelStatus } from '../plugin.ts'
import TYPERT from '../typert.ts'
import { dictionaries, NS, type Key } from './locale.ts'

export const inject = ['slots', 'locale', 'remote', 'configForms']

/** The Loader entry inserted by cordis.patch.yml. */
const ENTRY = 'eduwork-remote-access'

/** What the page edits directly; the access key is redacted from it. */
interface Settings { enabled: boolean; relay: string; hostName: string }

interface ConfigForm {
  getSnapshot(): { status: 'loading' | 'ready' | 'unavailable'; value: Settings | undefined; writable: boolean }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
}

type RemoteResult = Promise<{ ok: true; value: PanelStatus } | { ok: false; error?: { code?: string; message?: string } }>
interface Service {
  status(): Promise<PanelStatus>
  createInvite(): Promise<PanelStatus>
  cancelInvite(): Promise<PanelStatus>
  decide(key: string, approved: boolean): Promise<PanelStatus>
  revoke(key: string): Promise<PanelStatus>
}

type Translate = (key: Key, values?: Record<string, string>) => string

interface Surface {
  locale: { register(ns: string, dictionaries: object): () => void; bind(ns: string): (key: string) => string }
  remote: { $mount(remote: object): Promise<() => Promise<void>>; remoteDevices: Record<keyof Service, (...args: unknown[]) => RemoteResult> }
  configForms: { get(entry: string): ConfigForm }
  slots: { inject(name: string, register: () => () => void): void; register(entry: object, component: (props: Props) => ReactNode): () => void }
  effect(execute: () => () => void, label?: string): void
  inject(deps: string[], callback: (surface: Surface) => void): void
}

interface Props { scope: ConfigForm; service: Service; t: Translate }

const POLL_MS = 1000

const primary = 'var(--dsw-alias-label-primary, #221b18)'
const secondary = 'var(--dsw-alias-label-secondary, #746762)'
const border = 'var(--dsw-alias-border-l2, #e7dfda)'
const layer = 'var(--dsw-alias-bg-layer-1, #fffdfb)'
const accent = 'var(--chatecnu-logo-accent, var(--dsw-alias-state-business-primary, #9f2636))'
const danger = 'var(--dsw-alias-state-error-primary, #a82332)'
const note: CSSProperties = { margin: '4px 0 0', color: secondary, fontSize: 12, lineHeight: 1.6 }
const section: CSSProperties = { padding: '14px 0', borderBottom: `1px solid ${border}` }
const heading: CSSProperties = { margin: '0 0 10px', fontSize: 14, fontWeight: 600 }
const button: CSSProperties = { border: `1px solid ${border}`, borderRadius: 8, padding: '6px 12px', background: layer, color: primary, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }
const strong: CSSProperties = { ...button, borderColor: accent, background: accent, color: '#fff' }
const input: CSSProperties = { width: '100%', maxWidth: 360, boxSizing: 'border-box', border: `1px solid ${border}`, borderRadius: 8, padding: '6px 10px', background: layer, color: primary, fontSize: 13 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }

async function unwrap(result: RemoteResult): Promise<PanelStatus> {
  const settled = await result
  if (settled.ok) return settled.value
  throw new Error(settled.error?.message || settled.error?.code || 'remote access unavailable')
}

const time = (iso: string | number, t: Translate): string =>
  new Date(iso).toLocaleString(t('locale'), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function RemoteAccessSettings({ scope, service, t }: Props) {
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const snapshot = useSyncExternalStore(subscribe, () => scope.getSnapshot())
  const [status, setStatus] = useState<PanelStatus>()
  const [error, setError] = useState('')
  const settings = snapshot.value
  const locked = snapshot.status !== 'ready' || !snapshot.writable

  useEffect(() => {
    let live = true
    const refresh = (): void => void service.status().then(next => live && setStatus(next), (cause: Error) => live && setError(cause.message))
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [service])

  const act = (action: () => Promise<PanelStatus>): void => {
    setError('')
    action().then(setStatus, (cause: Error) => setError(cause.message))
  }
  const save = (field: string, value: unknown): void => {
    setError('')
    scope.set(field, value).then(accepted => accepted || setError(t('saveFailed')), () => setError(t('saveFailed')))
  }

  const header = (
    <div>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 650 }}>{t('title')}</h3>
      <p style={note}>{t('intro')}</p>
    </div>
  )
  if (settings === undefined || status === undefined) {
    return <div style={{ color: primary }}>{header}<p role={error ? 'alert' : 'status'} style={note}>{error || t('loading')}</p></div>
  }
  return (
    <div data-eduwork-remote-access style={{ color: primary }}>
      {header}
      <section style={section}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" role="switch" style={{ accentColor: accent }} checked={settings.enabled} disabled={locked}
            onChange={event => save('enabled', event.currentTarget.checked)} />
          {t('enabled')}
        </label>
        <p role="status" style={note}>{summary(settings, status, t)}</p>
      </section>
      <section style={{ ...section, display: 'grid', gap: 12 }}>
        <TextSetting label={t('relay')} hint={t('relayHint')} value={settings.relay} disabled={locked} type="url"
          onSave={value => save('relay', value)} />
        <TextSetting label={t('accessKey')} hint={`${t('accessKeyHint')} ${status.accessKeySet ? t('accessKeySet') : t('accessKeyMissing')}`}
          value="" disabled={locked} type="password" onSave={value => value !== '' && save('accessKey', value)} />
        <TextSetting label={t('hostName')} hint={t('hostNameHint')} value={settings.hostName} disabled={locked}
          onSave={value => save('hostName', value)} />
      </section>
      {status.state === 'on' && <Pairing status={status} t={t} act={act} service={service} />}
      {status.state === 'on' && <Devices status={status} t={t} act={act} service={service} />}
      {error && <p role="alert" style={{ ...note, color: danger }}>{error}</p>}
    </div>
  )
}

function summary(settings: Settings, status: PanelStatus, t: Translate): string {
  if (status.state === 'failed') return t('failed', { message: status.message })
  if (status.state === 'off') return settings.enabled ? t('unconfigured') : ''
  const { link } = status
  if (link.state === 'online') return t('linkOnline')
  if (link.state === 'offline') return t('linkOffline', { reason: link.reason })
  if (link.state === 'refused') return t('linkRefused', { reason: link.reason })
  if (link.state === 'replaced') return t('linkReplaced')
  return t('linkConnecting')
}

/** A text field saved when it loses focus or on Enter; a password field clears once saved. */
function TextSetting({ label, hint, value, disabled, type = 'text', onSave }: {
  label: string; hint: string; value: string; disabled: boolean; type?: 'text' | 'url' | 'password'; onSave(value: string): void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = (): void => {
    const next = draft.trim()
    if (next !== value) onSave(next)
    if (type === 'password') setDraft('')
  }
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
      {label}
      <input style={input} type={type} value={draft} disabled={disabled} autoComplete={type === 'password' ? 'new-password' : 'off'}
        onChange={event => setDraft(event.currentTarget.value)} onBlur={commit}
        onKeyDown={event => event.key === 'Enter' && commit()} />
      <span style={{ ...note, margin: 0 }}>{hint}</span>
    </label>
  )
}

type Running = Extract<PanelStatus, { state: 'on' }>
interface SectionProps { status: Running; t: Translate; act(action: () => Promise<PanelStatus>): void; service: Service }

function Pairing({ status, t, act, service }: SectionProps) {
  const [copied, setCopied] = useState(false)
  const { invite } = status
  useEffect(() => setCopied(false), [invite?.link])
  return (
    <section style={section}>
      {invite === undefined
        ? (
          <button type="button" style={strong} disabled={status.link.state !== 'online'} onClick={() => act(() => service.createInvite())}>
            {t('addDevice')}
          </button>
        )
        : (
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <QrCode text={invite.link} label={t('qr')} />
            <div style={{ flex: 1, minWidth: 220, display: 'grid', gap: 8 }}>
              <p style={{ ...note, margin: 0 }}>{t('inviteHint', { time: time(invite.expiresAt, t) })}</p>
              <code style={{ fontSize: 11, wordBreak: 'break-all', color: secondary }}>{invite.link}</code>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={button} onClick={() => void navigator.clipboard.writeText(invite.link).then(() => setCopied(true))}>
                  {copied ? t('copied') : t('copy')}
                </button>
                <button type="button" style={button} onClick={() => act(() => service.cancelInvite())}>{t('cancelInvite')}</button>
              </div>
            </div>
          </div>
        )}
      {status.pending.map(device => (
        <div key={device.key} role="alert" style={{ marginTop: 12, padding: 12, border: `1px solid ${accent}`, borderRadius: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t('pending', { name: device.name || t('unnamed') })}</div>
          <p style={note}>{t('pendingHint')}</p>
          <div style={{ ...row, marginTop: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 650, letterSpacing: 4, fontVariantNumeric: 'tabular-nums' }}>
              {`${device.code.slice(0, 3)} ${device.code.slice(3)}`}
            </span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={button} onClick={() => act(() => service.decide(device.key, false))}>{t('decline')}</button>
              <button type="button" style={strong} onClick={() => act(() => service.decide(device.key, true))}>{t('approve')}</button>
            </span>
          </div>
        </div>
      ))}
    </section>
  )
}

function Devices({ status, t, act, service }: SectionProps) {
  return (
    <section style={section}>
      <h4 style={heading}>{t('devices')}</h4>
      {status.devices.length === 0 && <p style={note}>{t('noDevices')}</p>}
      {status.devices.map(device => (
        <div key={device.key} style={{ ...row, padding: '8px 0' }}>
          <div>
            <div style={{ fontSize: 14 }}>
              {device.name || t('unnamed')}
              {device.connections > 0 && <span style={{ marginLeft: 8, color: accent, fontSize: 12 }}>{t('deviceOnline')}</span>}
            </div>
            <div style={{ ...note, margin: 0 }}>
              {t('pairedAt', { time: time(device.pairedAt, t) })}
              {device.lastSeen !== undefined && ` · ${t('lastSeen', { time: time(device.lastSeen, t) })}`}
            </div>
          </div>
          <button type="button" style={{ ...button, color: danger }} onClick={() => act(() => service.revoke(device.key))}>{t('remove')}</button>
        </div>
      ))}
    </section>
  )
}

function QrCode({ text, label }: { text: string; label: string }) {
  const { size, data } = useMemo(() => encode(text, { ecc: 'M', border: 2 }), [text])
  const path = useMemo(() => data.flatMap((line, y) => line.flatMap((dark, x) => dark ? [`M${x} ${y}h1v1h-1z`] : [])).join(''), [data])
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={192} height={192} shapeRendering="crispEdges" role="img" aria-label={label}>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}

export async function apply(ctx: Surface): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount({ package: TYPERT.package, descriptors: TYPERT.invocations })
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'remote-access: dictionaries')
  ctx.inject(['remote.remoteDevices'], surface => {
    const bound = surface.locale.bind(NS)
    const t: Translate = (key, values = {}) => bound(key).replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '')
    const remote = surface.remote.remoteDevices
    const service: Service = {
      status: () => unwrap(remote.status()),
      createInvite: () => unwrap(remote.createInvite()),
      cancelInvite: () => unwrap(remote.cancelInvite()),
      decide: (key, approved) => unwrap(remote.decide(key, approved)),
      revoke: key => unwrap(remote.revoke(key)),
    }
    const scope = surface.configForms.get(ENTRY)
    surface.slots.inject('settings.section', () => surface.slots.register({
      name: 'settings.section', id: 'remote-access', order: 16, label: () => t('nav'), locale: NS, inject: () => ({ scope, service, t }),
    }, RemoteAccessSettings))
  })
  return unmount
}
