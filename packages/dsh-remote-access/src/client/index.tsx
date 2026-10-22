/**
 * The settings page on the Host's own screen: the switch and the relay
 * settings, the pairing QR code, confirmation of waiting devices and the list
 * of paired devices. Remote devices never see this page; the gate refuses its
 * methods to them, and they get DSH fitted to a phone instead (phone.tsx).
 */
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { encode } from 'uqr'
import type { PanelStatus } from '../plugin.ts'
import { Close } from '../protocol/close-codes.ts'
import TYPERT, { ACCESS_KEY_REF } from '../typert.ts'
import { dictionaries, NS, type Key } from './locale.ts'
import { inject as phoneInject, phone, REMOTE, type PhoneSurface } from './phone.tsx'

export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']

/** The Loader entry inserted by cordis.patch.yml. */
const ENTRY = 'eduwork-remote-access'

/** The plugin's settings; the access key is a DSH credential instead. */
interface Settings { enabled: boolean; relay: string; hostName: string }

interface ConfigForm {
  getSnapshot(): { status: 'loading' | 'ready' | 'unavailable'; value: Settings | undefined; writable: boolean }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
}

type RemoteResult<T = PanelStatus> = Promise<{ ok: true; value: T } | { ok: false; error?: { code?: string; message?: string } }>
interface Service {
  status(): Promise<PanelStatus>
  createInvite(): Promise<PanelStatus>
  cancelInvite(): Promise<PanelStatus>
  decide(key: string, approved: boolean): Promise<PanelStatus>
  revoke(key: string): Promise<PanelStatus>
}

/** What DSH tells about a credential, never its value. */
interface CredentialInfo { configured: boolean; writable: boolean }
interface Credentials {
  describe(refs: string[]): RemoteResult<Record<string, CredentialInfo>>
  set(ref: string, value: string): RemoteResult<void>
}

type Translate = (key: Key, values?: Record<string, string>) => string

interface Surface {
  locale: { register(ns: string, dictionaries: object): () => void; bind(ns: string): (key: string) => string }
  remote: {
    $mount(remote: object): Promise<() => Promise<void>>
    remoteDevices: Record<keyof Service, (...args: unknown[]) => RemoteResult>
    credentials: Credentials
  }
  configForms: { get(entry: string): ConfigForm }
  slots: { inject(name: string, register: () => () => void): void; register(entry: object, component: (props: Props) => ReactNode): () => void }
  effect(execute: () => () => void, label?: string): void
  inject<S = Surface>(deps: string[], callback: (surface: S) => void): void
}

interface Props { scope: ConfigForm; service: Service; credentials: Credentials; t: Translate }

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

async function unwrap<T>(result: RemoteResult<T>): Promise<T> {
  const settled = await result
  if (settled.ok) return settled.value
  throw new Error(settled.error?.message || settled.error?.code || 'remote access unavailable')
}

const time = (iso: string | number, t: Translate): string =>
  new Date(iso).toLocaleString(t('locale'), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function RemoteAccessSettings({ scope, service, credentials, t }: Props) {
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const snapshot = useSyncExternalStore(subscribe, () => scope.getSnapshot())
  const [status, setStatus] = useState<PanelStatus>()
  const [accessKey, setAccessKey] = useState<CredentialInfo>()
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

  const describeKey = useCallback(async (): Promise<void> => {
    const described = await unwrap(credentials.describe([ACCESS_KEY_REF]))
    setAccessKey(described[ACCESS_KEY_REF])
  }, [credentials])
  useEffect(() => void describeKey().catch((cause: Error) => setError(cause.message)), [describeKey])

  const act = (action: () => Promise<PanelStatus>): void => {
    setError('')
    action().then(setStatus, (cause: Error) => setError(cause.message))
  }
  const save = (field: string, value: unknown): void => {
    setError('')
    scope.set(field, value).then(accepted => accepted || setError(t('saveFailed')), () => setError(t('saveFailed')))
  }
  const saveAccessKey = (value: string): void => {
    setError('')
    unwrap(credentials.set(ACCESS_KEY_REF, value)).then(describeKey).catch(() => setError(t('saveFailed')))
  }

  const header = (
    <div>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 650 }}>{t('title')}</h3>
      <p style={note}>{t('intro')}</p>
    </div>
  )
  if (settings === undefined || status === undefined || accessKey === undefined) {
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
        {status.organization === undefined
          ? (
            <>
              <TextSetting label={t('relay')} hint={t('relayHint')} value={settings.relay} disabled={locked} type="url"
                onSave={value => save('relay', value)} />
              <TextSetting label={t('accessKey')} hint={t(accessKey.configured ? 'accessKeySet' : 'accessKeyHint')}
                value="" disabled={!accessKey.writable} type="password" onSave={value => value !== '' && saveAccessKey(value)} />
            </>
          )
          : <p style={{ ...note, margin: 0 }}>{t('organization', { organization: status.organization.name, relay: status.organization.relay })}</p>}
        <TextSetting label={t('hostName')} hint={t('hostNameHint')} value={settings.hostName} disabled={locked}
          onSave={value => save('hostName', value)} />
      </section>
      {status.state === 'on' && <Pairing status={status} t={t} act={act} service={service} />}
      {status.state === 'on' && <Devices status={status} t={t} act={act} service={service} />}
      {error && <p role="alert" style={{ ...note, color: danger }}>{error}</p>}
    </div>
  )
}

/** What the user can act on; the Host logs the details. */
function summary(settings: Settings, status: PanelStatus, t: Translate): string {
  if (status.state === 'failed') return t('failed')
  if (status.state === 'off') return settings.enabled ? t('unconfigured') : ''
  if (status.state === 'sign-in') return t('signIn', { organization: status.organization!.name })
  const { link } = status
  if (link.state === 'online') return t('linkOnline')
  if (link.state === 'offline') return t('linkOffline')
  if (link.state === 'refused') return t(link.code === Close.upgradeRequired ? 'linkUpgrade' : status.organization === undefined ? 'linkRefused' : 'linkRefusedMember')
  if (link.state === 'replaced') return t('linkReplaced')
  if (link.state === 'lapsed') return t('linkLapsed', { organization: status.organization!.name })
  return t('linkConnecting')
}

/** A text field saved when it loses focus or on Enter; a password field clears once saved. */
function TextSetting({ label, hint, value, disabled, type = 'text', onSave }: {
  label: string; hint: string; value: string; disabled: boolean; type?: 'text' | 'url' | 'password'; onSave(value: string): void
}) {
  const [draft, setDraft] = useState(value)
  const hintId = useId()
  useEffect(() => setDraft(value), [value])
  const commit = (): void => {
    const next = draft.trim()
    if (next !== value) onSave(next)
    if (type === 'password') setDraft('')
  }
  return (
    <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
      <label style={{ display: 'grid', gap: 4 }}>
        {label}
        <input style={input} type={type} value={draft} disabled={disabled} autoComplete={type === 'password' ? 'new-password' : 'off'}
          aria-describedby={hintId} onChange={event => setDraft(event.currentTarget.value)} onBlur={commit}
          onKeyDown={event => event.key === 'Enter' && commit()} />
      </label>
      <span id={hintId} style={{ ...note, margin: 0 }}>{hint}</span>
    </div>
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

export async function apply(ctx: Surface): Promise<(() => Promise<void>) | undefined> {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'remote-access: dictionaries')
  const bound = ctx.locale.bind(NS)
  const t: Translate = (key, values = {}) => bound(key).replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '')
  // A remote device gets DSH fitted to a phone instead of this page, whose methods the gate refuses it.
  if (document.documentElement.hasAttribute(REMOTE)) {
    ctx.inject<PhoneSurface>(phoneInject, surface => phone(surface, t))
    return
  }
  const unmount = await ctx.remote.$mount({ package: TYPERT.package, descriptors: TYPERT.invocations })
  ctx.inject(['remote.remoteDevices'], surface => {
    const remote = surface.remote.remoteDevices
    const service: Service = {
      status: () => unwrap(remote.status()),
      createInvite: () => unwrap(remote.createInvite()),
      cancelInvite: () => unwrap(remote.cancelInvite()),
      decide: (key, approved) => unwrap(remote.decide(key, approved)),
      revoke: key => unwrap(remote.revoke(key)),
    }
    const scope = surface.configForms.get(ENTRY)
    const credentials = surface.remote.credentials
    surface.slots.inject('settings.section', () => surface.slots.register({
      name: 'settings.section', id: 'remote-access', order: 16, label: () => t('nav'), locale: NS, inject: () => ({ scope, service, credentials, t }),
    }, RemoteAccessSettings))
  })
  return unmount
}
