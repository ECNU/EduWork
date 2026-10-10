import { LOCALE_NS, dictionaries } from './locale.js'
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

declare const __EDUWORK_PINNED_DSH__: boolean
const nativeSettings = typeof __EDUWORK_PINNED_DSH__ !== 'undefined' && __EDUWORK_PINNED_DSH__
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', nativeSettings ? 'configForms' : 'settingsScope']

const NS = 'dsh-mail-assistant'
const PASSWORD_REF = 'DSH_MAIL_ASSISTANT_PASSWORD'


const defaults = {
  readEnabled: false, sendEnabled: false, email: '', username: '', fromName: '', inboxFolder: 'INBOX',
  imapHost: '', imapPort: 993, imapTls: 'implicit', smtpHost: '', smtpPort: 465, smtpTls: 'implicit',
  maxBodyChars: 20000, maxMessageBytes: 26214400, maxAttachmentBytes: 20971520,
}

const presets: Record<string, Partial<typeof defaults>> = {
  gmail: { imapHost: 'imap.gmail.com', imapPort: 993, imapTls: 'implicit', smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpTls: 'implicit' },
  outlook: { imapHost: 'outlook.office365.com', imapPort: 993, imapTls: 'implicit', smtpHost: 'smtp.office365.com', smtpPort: 587, smtpTls: 'starttls' },
  qq: { imapHost: 'imap.qq.com', imapPort: 993, imapTls: 'implicit', smtpHost: 'smtp.qq.com', smtpPort: 465, smtpTls: 'implicit' },
  '163': { imapHost: 'imap.163.com', imapPort: 993, imapTls: 'implicit', smtpHost: 'smtp.163.com', smtpPort: 465, smtpTls: 'implicit' },
  icloud: { imapHost: 'imap.mail.me.com', imapPort: 993, imapTls: 'implicit', smtpHost: 'smtp.mail.me.com', smtpPort: 587, smtpTls: 'starttls' },
}

async function unwrap<T>(operation: Promise<any>): Promise<T> {
  const result = await operation
  if (result?.ok === true) return result.value as T
  throw new Error(result?.error?.message || result?.error?.code || 'Remote operation failed')
}

function inputNumber(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

function detectPreset(value: typeof defaults): string {
  for (const [key, candidate] of Object.entries(presets)) {
    if (Object.entries(candidate).every(([field, expected]) => value[field as keyof typeof value] === expected)) return key
  }
  return 'custom'
}

function MailSettings({ t, service }: any) {
  const [draft, setDraft] = useState<any>(null)
  const [passwordConfigured, setPasswordConfigured] = useState(false)
  const [credentialWritable, setCredentialWritable] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [preset, setPreset] = useState('custom')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const subscribe = useMemo(() => service.scope.subscribe.bind(service.scope), [service.scope])
  const getSnapshot = useMemo<() => any>(() => service.scope.getSnapshot.bind(service.scope), [service.scope])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const load = async () => {
    setError(''); setNotice('')
    const credentials = await unwrap<any>(service.credentials.describe([PASSWORD_REF]))
    setPasswordConfigured(credentials[PASSWORD_REF]?.configured === true)
    setCredentialWritable(credentials[PASSWORD_REF]?.writable === true)
    setPassword('')
  }

  useEffect(() => { load().catch(cause => setError(cause?.message || String(cause))) }, [])
  useEffect(() => {
    if (snapshot.status !== 'ready') return
    const next = { ...defaults, ...(snapshot.value ?? {}) }
    setDraft(next)
    setPreset(detectPreset(next))
  }, [snapshot])

  const set = (key: string, value: unknown) => setDraft((current: any) => ({ ...current, [key]: value }))
  const applyPreset = (key: string) => {
    setPreset(key)
    if (presets[key]) setDraft((current: any) => ({ ...current, ...presets[key] }))
  }
  const save = async () => {
    setBusy(true); setError(''); setNotice('')
    let passwordStored = false
    try {
      if (password !== '') {
        await unwrap(service.credentials.set(PASSWORD_REF, password))
        passwordStored = true
        setPasswordConfigured(true)
        setPassword('')
      }
      const ops = Object.entries(draft).map(([field, value]) => ({ op: 'set', path: [field], value }))
      await service.scope.mutate(ops, snapshot.revision)
      setNotice(t('saved'))
    } catch (cause: any) {
      setError(passwordStored ? t('credentialPartial') : (cause?.message || `${t('error')}`))
    } finally { setBusy(false) }
  }
  const clearPassword = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      await unwrap(service.credentials.unset(PASSWORD_REF))
      setPasswordConfigured(false); setPassword(''); setNotice(t('saved'))
    } catch (cause: any) { setError(cause?.message || String(cause)) }
    finally { setBusy(false) }
  }

  const colors = useMemo(() => ({
    border: 'var(--dsw-alias-border-l2, #e5d4cc)', bg: 'var(--dsw-alias-bg-layer-1, #fff)',
    secondary: 'var(--dsw-alias-label-secondary, #6c625f)', primary: 'var(--dsw-alias-label-primary, #241a18)',
    accent: 'var(--dsw-alias-brand-primary, #9d2f3f)', soft: 'var(--dsw-alias-bg-layer-2, #f8f3f1)',
  }), [])
  const styles: Record<string, React.CSSProperties> = {
    root: { maxWidth: 820, padding: '10px 0 42px', color: colors.primary },
    card: { border: `1px solid ${colors.border}`, borderRadius: 14, padding: 18, background: colors.bg, marginTop: 14 },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 },
    label: { display: 'grid', gap: 6, color: colors.secondary, fontSize: 12 },
    input: { boxSizing: 'border-box', width: '100%', minHeight: 38, border: `1px solid ${colors.border}`, borderRadius: 9, padding: '7px 10px', background: colors.bg, color: colors.primary },
    button: { minHeight: 36, border: `1px solid ${colors.border}`, borderRadius: 9, padding: '7px 12px', background: colors.bg, color: colors.primary, cursor: 'pointer' },
    primary: { minHeight: 36, border: 0, borderRadius: 9, padding: '7px 14px', background: colors.accent, color: '#fff', cursor: 'pointer', fontWeight: 650 },
  }

  if (!draft) return <div style={styles.root}><p>{error || (snapshot.status === 'unavailable' ? t('unavailable') : t('loading'))}</p>{error && <button style={styles.button} onClick={() => load()}>{t('reload')}</button>}</div>
  const credentialReady = passwordConfigured || password !== ''
  const readReady = draft.email.trim() !== '' && draft.imapHost.trim() !== '' && credentialReady
  const sendReady = draft.email.trim() !== '' && draft.smtpHost.trim() !== '' && credentialReady
  const permission = (key: 'readEnabled' | 'sendEnabled', title: string, hint: string, ready: boolean) => (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: 13, border: `1px solid ${draft[key] ? colors.accent : colors.border}`, borderRadius: 11, background: colors.soft, opacity: !ready && !draft[key] ? .62 : 1 }}>
      <input type="checkbox" checked={draft[key]} disabled={!ready && !draft[key]} onChange={event => set(key, event.currentTarget.checked)} style={{ marginTop: 3 }} />
      <span><strong style={{ display: 'block', fontSize: 13 }}>{title}</strong><span style={{ display: 'block', marginTop: 4, color: colors.secondary, fontSize: 11, lineHeight: 1.5 }}>{hint}</span>{!ready && <span style={{ display: 'block', marginTop: 4, color: '#a82332', fontSize: 11 }}>{t('permissionNeedsSetup')}</span>}</span>
    </label>
  )
  const field = (label: string, key: string, type = 'text', hint?: string) => (
    <label style={styles.label}>{label}<input type={type} value={draft[key]} onChange={event => set(key, type === 'number' ? inputNumber(event.currentTarget.value) : event.currentTarget.value)} style={styles.input} />{hint && <span>{hint}</span>}</label>
  )
  const server = (prefix: 'imap' | 'smtp', title: string) => <div style={{ border: `1px solid ${colors.border}`, borderRadius: 11, padding: 13 }}>
    <strong style={{ fontSize: 13 }}>{title}</strong>
    <div style={{ ...styles.grid, gridTemplateColumns: 'minmax(180px, 2fr) minmax(90px, .7fr) minmax(130px, 1fr)', marginTop: 10 }}>
      {field(t('host'), `${prefix}Host`)}{field(t('port'), `${prefix}Port`, 'number')}
      <label style={styles.label}>{t('tls')}<select value={draft[`${prefix}Tls`]} onChange={event => set(`${prefix}Tls`, event.currentTarget.value)} style={styles.input}><option value="implicit">{t('implicit')}</option><option value="starttls">{t('starttls')}</option></select></label>
    </div>
  </div>

  return <div style={styles.root}>
    <h2 style={{ margin: 0, fontSize: 21 }}>{t('title')}</h2>
    <p style={{ margin: '7px 0 0', color: colors.secondary, fontSize: 12, lineHeight: 1.65 }}>{t('description')}</p>
    <section style={styles.card}><h3 style={{ margin: 0, fontSize: 15 }}>{t('identity')}</h3><p style={{ margin: '6px 0 13px', color: colors.secondary, fontSize: 11, lineHeight: 1.55 }}>{t('identityHint')}</p><div style={styles.grid}>
      {field(t('email'), 'email', 'email', t('emailHint'))}
      <label style={styles.label}><span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>{t('password')}<span style={{ borderRadius: 999, padding: '2px 7px', fontSize: 10, color: passwordConfigured ? '#32724e' : '#9d2f3f', background: passwordConfigured ? '#eaf6ef' : '#f8e9ec' }}>{passwordConfigured ? t('configured') : t('missing')}</span></span><input type="password" autoComplete="new-password" value={password} disabled={busy || !credentialWritable} placeholder={t('credentialPlaceholder')} onChange={event => setPassword(event.currentTarget.value)} style={styles.input} /><span>{t('passwordHint')}</span>{passwordConfigured && <button type="button" disabled={busy || !credentialWritable} style={{ ...styles.button, justifySelf: 'start', color: '#a82332' }} onClick={clearPassword}>{t('clearPassword')}</button>}</label>
      {field(t('fromName'), 'fromName', 'text', t('fromNameHint'))}
    </div>
    </section>
    <section style={styles.card}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 13 }}><div><h3 style={{ margin: 0, fontSize: 15 }}>{t('servers')}</h3><p style={{ margin: '6px 0 0', color: colors.secondary, fontSize: 11, lineHeight: 1.55 }}>{t('serversHint')}</p></div><label style={{ ...styles.label, minWidth: 210 }}>{t('preset')}<select value={preset} onChange={event => applyPreset(event.currentTarget.value)} style={styles.input}><option value="custom">{t('custom')}</option><option value="gmail">Gmail</option><option value="outlook">Outlook / Microsoft 365</option><option value="qq">QQ Mail</option><option value="163">163 Mail</option><option value="icloud">iCloud Mail</option></select></label></div><div style={{ display: 'grid', gap: 11 }}>{server('imap', t('imap'))}{server('smtp', t('smtp'))}</div></section>
    <section style={styles.card}><button type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(current => !current)} style={{ ...styles.button, width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left' }}><span><strong style={{ display: 'block', fontSize: 13 }}>{t('advanced')}</strong><span style={{ display: 'block', marginTop: 3, color: colors.secondary, fontSize: 11 }}>{t('advancedHint')}</span></span><span>{advancedOpen ? t('collapse') : '›'}</span></button>{advancedOpen && <div style={{ marginTop: 14 }}><div style={styles.grid}>{field(t('username'), 'username', 'text', t('usernameHint'))}{field(t('inbox'), 'inboxFolder', 'text', t('inboxHint'))}</div><h4 style={{ margin: '17px 0 10px', fontSize: 13 }}>{t('limits')}</h4><div style={styles.grid}>{field(t('bodyLimit'), 'maxBodyChars', 'number')}{field(t('messageLimit'), 'maxMessageBytes', 'number')}{field(t('attachmentLimit'), 'maxAttachmentBytes', 'number')}</div></div>}</section>
    <section style={styles.card}><h3 style={{ margin: 0, fontSize: 15 }}>{t('agentAccess')}</h3><p style={{ margin: '6px 0 13px', color: colors.secondary, fontSize: 11, lineHeight: 1.55 }}>{t('agentAccessHint')}</p><div style={styles.grid}>{permission('readEnabled', t('readPermission'), t('readHint'), readReady)}{permission('sendEnabled', t('sendPermission'), t('sendHint'), sendReady)}</div></section>
    <p style={{ color: colors.secondary, fontSize: 11, lineHeight: 1.55 }}>{t('usage')}</p>
    {!snapshot.writable && <p role="status" style={{ color: colors.secondary, fontSize: 12 }}>{t('readOnly')}</p>}
    {error && <p role="alert" style={{ color: '#a82332', fontSize: 12 }}>{error}</p>}{notice && <p role="status" style={{ color: '#32724e', fontSize: 12 }}>{notice}</p>}
    <button type="button" disabled={busy || !snapshot.writable} onClick={save} style={styles.primary}>{busy ? t('saving') : t('save')}</button>
  </div>
}

export function apply(ctx: any) {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, dictionaries), 'mail: dictionaries')
  const t = ctx.locale.bind(LOCALE_NS)
  const service = { scope: (nativeSettings ? ctx.configForms.get(NS) : ctx.settingsScope.bind({ namespace: NS })), credentials: ctx.remote.credentials }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'mail-assistant', locale: LOCALE_NS, order: 25, label: () => t('nav'), inject: () => ({ service }),
  }, MailSettings))
}
