import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

export const inject = ['slots', 'remote', 'remote.credentials', 'settingsScope']

const NS = 'dsh-mail-assistant'
const PASSWORD_REF = 'DSH_MAIL_ASSISTANT_PASSWORD'
const zh = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')

const copy = zh ? {
  nav: '邮件助手', title: '邮件助手', description: '让 Agent 通过标准 IMAP 只读检索邮件，并按当前 DSH 权限模式通过 SMTP 发信。它不是邮箱客户端，不会移动、删除、归档或修改邮件状态。',
  loading: '正在读取配置…', save: '保存', saving: '正在保存…', saved: '配置已保存，新调用立即生效。',
  readPermission: '允许 Agent 读信', readHint: '可列出目录、分页查找、读取邮件和下载附件；IMAP 始终只读。',
  sendPermission: '允许 Agent 发信', sendHint: '可发送纯文本邮件；普通权限逐次确认，Full Access 不再弹窗。',
  identity: '邮箱账号', identityHint: '先填写日常使用的邮箱信息。多数邮箱要求使用客户端授权码，而不是网页登录密码。',
  email: '邮箱地址', emailHint: '用于收信和发信。', username: '登录用户名', usernameHint: '仅当服务商要求时填写；留空则使用邮箱地址。', fromName: '发件人显示名称', fromNameHint: '收件人看到的名称；可留空。', inbox: '收件箱目录', inboxHint: '通常保持 INBOX。',
  password: '密码 / 客户端授权码', passwordHint: '安全写入 DSH 凭据存储，不会写进 settings.yaml，也不会回显。', configured: '已保存', missing: '未填写', credentialPlaceholder: '输入授权码；已保存时留空不会改变', clearPassword: '清除授权码',
  servers: '邮箱服务器', serversHint: '选择常见服务商可自动填写；单位邮箱或自建邮箱请选择“手动配置”。', preset: '邮箱服务商', custom: '手动配置', imap: '收信（IMAP）', smtp: '发信（SMTP）', host: '服务器地址', port: '端口', tls: '加密', implicit: '隐式 TLS', starttls: 'STARTTLS',
  advanced: '高级设置', advancedHint: '登录用户名、收件箱目录和安全上限通常不需要修改。', collapse: '收起',
  agentAccess: '开放给 Agent', agentAccessHint: '账号和服务器保存好后，再按需要分别开放读信或发信。', permissionNeedsSetup: '请先填写邮箱地址、授权码和相应的服务器。',
  limits: '安全上限', bodyLimit: '正文字符', messageLimit: '整封邮件字节', attachmentLimit: '附件总字节',
  usage: '保存后，在对话里让 Agent“查一下最近邮件”即可验证。插件不会在启动或保存时主动连接邮箱。',
  error: '保存失败', reload: '重新加载', unavailable: '当前 DSH 连接未提供此设置命名空间。', readOnly: '当前连接为只读模式，无法保存设置。', credentialPartial: '授权码已经保存，但其他配置保存失败；请修正后再次保存。',
} : {
  nav: 'Mail assistant', title: 'Mail assistant', description: 'Let the agent search mail through read-only IMAP and send through SMTP under the current DSH permission preset. This is not a mail client: it never moves, deletes, archives, or changes message state.',
  loading: 'Loading configuration…', save: 'Save', saving: 'Saving…', saved: 'Saved. New calls use the configuration immediately.',
  readPermission: 'Allow the agent to read mail', readHint: 'List folders, page through searches, read messages, and download attachments. IMAP always stays read-only.',
  sendPermission: 'Allow the agent to send mail', sendHint: 'Send plain-text messages. Ordinary permissions ask each time; Full Access does not prompt.',
  identity: 'Mailbox account', identityHint: 'Start with the mailbox information you normally use. Most providers require an app password instead of the web-login password.',
  email: 'Email address', emailHint: 'Used for both incoming and outgoing mail.', username: 'Login username', usernameHint: 'Only set this when required by your provider; otherwise the email address is used.', fromName: 'Sender display name', fromNameHint: 'The name recipients see; optional.', inbox: 'Inbox folder', inboxHint: 'Usually keep INBOX.',
  password: 'Password / app password', passwordHint: 'Stored securely in DSH Credentials. It is never written to settings.yaml or returned to this page.', configured: 'Saved', missing: 'Missing', credentialPlaceholder: 'Enter an app password; leave blank to keep the saved value', clearPassword: 'Clear app password',
  servers: 'Mail servers', serversHint: 'Choose a common provider to fill these automatically, or use Manual configuration for institutional and self-hosted mail.', preset: 'Mail provider', custom: 'Manual configuration', imap: 'Incoming (IMAP)', smtp: 'Outgoing (SMTP)', host: 'Server address', port: 'Port', tls: 'Encryption', implicit: 'Implicit TLS', starttls: 'STARTTLS',
  advanced: 'Advanced settings', advancedHint: 'Login username, inbox folder, and safety limits usually need no changes.', collapse: 'Collapse',
  agentAccess: 'Agent access', agentAccessHint: 'After saving the account and servers, enable reading and sending independently as needed.', permissionNeedsSetup: 'Enter the email address, app password, and corresponding server first.',
  limits: 'Safety limits', bodyLimit: 'Body characters', messageLimit: 'Whole-message bytes', attachmentLimit: 'Total attachment bytes',
  usage: 'After saving, ask the agent to find recent mail. The plugin never connects to a mailbox during startup or save.',
  error: 'Save failed', reload: 'Reload', unavailable: 'This DSH connection does not expose the mail settings namespace.', readOnly: 'This connection exposes settings in read-only mode.', credentialPartial: 'The app password was stored, but the remaining settings failed to save. Fix the form and save again.',
}

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

function MailSettings({ service }: any) {
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
      setNotice(copy.saved)
    } catch (cause: any) {
      setError(passwordStored ? copy.credentialPartial : (cause?.message || `${copy.error}`))
    } finally { setBusy(false) }
  }
  const clearPassword = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      await unwrap(service.credentials.unset(PASSWORD_REF))
      setPasswordConfigured(false); setPassword(''); setNotice(copy.saved)
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

  if (!draft) return <div style={styles.root}><p>{error || (snapshot.status === 'unavailable' ? copy.unavailable : copy.loading)}</p>{error && <button style={styles.button} onClick={() => load()}>{copy.reload}</button>}</div>
  const credentialReady = passwordConfigured || password !== ''
  const readReady = draft.email.trim() !== '' && draft.imapHost.trim() !== '' && credentialReady
  const sendReady = draft.email.trim() !== '' && draft.smtpHost.trim() !== '' && credentialReady
  const permission = (key: 'readEnabled' | 'sendEnabled', title: string, hint: string, ready: boolean) => (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: 13, border: `1px solid ${draft[key] ? colors.accent : colors.border}`, borderRadius: 11, background: colors.soft, opacity: !ready && !draft[key] ? .62 : 1 }}>
      <input type="checkbox" checked={draft[key]} disabled={!ready && !draft[key]} onChange={event => set(key, event.currentTarget.checked)} style={{ marginTop: 3 }} />
      <span><strong style={{ display: 'block', fontSize: 13 }}>{title}</strong><span style={{ display: 'block', marginTop: 4, color: colors.secondary, fontSize: 11, lineHeight: 1.5 }}>{hint}</span>{!ready && <span style={{ display: 'block', marginTop: 4, color: '#a82332', fontSize: 11 }}>{copy.permissionNeedsSetup}</span>}</span>
    </label>
  )
  const field = (label: string, key: string, type = 'text', hint?: string) => (
    <label style={styles.label}>{label}<input type={type} value={draft[key]} onChange={event => set(key, type === 'number' ? inputNumber(event.currentTarget.value) : event.currentTarget.value)} style={styles.input} />{hint && <span>{hint}</span>}</label>
  )
  const server = (prefix: 'imap' | 'smtp', title: string) => <div style={{ border: `1px solid ${colors.border}`, borderRadius: 11, padding: 13 }}>
    <strong style={{ fontSize: 13 }}>{title}</strong>
    <div style={{ ...styles.grid, gridTemplateColumns: 'minmax(180px, 2fr) minmax(90px, .7fr) minmax(130px, 1fr)', marginTop: 10 }}>
      {field(copy.host, `${prefix}Host`)}{field(copy.port, `${prefix}Port`, 'number')}
      <label style={styles.label}>{copy.tls}<select value={draft[`${prefix}Tls`]} onChange={event => set(`${prefix}Tls`, event.currentTarget.value)} style={styles.input}><option value="implicit">{copy.implicit}</option><option value="starttls">{copy.starttls}</option></select></label>
    </div>
  </div>

  return <div style={styles.root}>
    <h2 style={{ margin: 0, fontSize: 21 }}>{copy.title}</h2>
    <p style={{ margin: '7px 0 0', color: colors.secondary, fontSize: 12, lineHeight: 1.65 }}>{copy.description}</p>
    <section style={styles.card}><h3 style={{ margin: 0, fontSize: 15 }}>{copy.identity}</h3><p style={{ margin: '6px 0 13px', color: colors.secondary, fontSize: 11, lineHeight: 1.55 }}>{copy.identityHint}</p><div style={styles.grid}>
      {field(copy.email, 'email', 'email', copy.emailHint)}
      <label style={styles.label}><span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>{copy.password}<span style={{ borderRadius: 999, padding: '2px 7px', fontSize: 10, color: passwordConfigured ? '#32724e' : '#9d2f3f', background: passwordConfigured ? '#eaf6ef' : '#f8e9ec' }}>{passwordConfigured ? copy.configured : copy.missing}</span></span><input type="password" autoComplete="new-password" value={password} disabled={busy || !credentialWritable} placeholder={copy.credentialPlaceholder} onChange={event => setPassword(event.currentTarget.value)} style={styles.input} /><span>{copy.passwordHint}</span>{passwordConfigured && <button type="button" disabled={busy || !credentialWritable} style={{ ...styles.button, justifySelf: 'start', color: '#a82332' }} onClick={clearPassword}>{copy.clearPassword}</button>}</label>
      {field(copy.fromName, 'fromName', 'text', copy.fromNameHint)}
    </div>
    </section>
    <section style={styles.card}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 13 }}><div><h3 style={{ margin: 0, fontSize: 15 }}>{copy.servers}</h3><p style={{ margin: '6px 0 0', color: colors.secondary, fontSize: 11, lineHeight: 1.55 }}>{copy.serversHint}</p></div><label style={{ ...styles.label, minWidth: 210 }}>{copy.preset}<select value={preset} onChange={event => applyPreset(event.currentTarget.value)} style={styles.input}><option value="custom">{copy.custom}</option><option value="gmail">Gmail</option><option value="outlook">Outlook / Microsoft 365</option><option value="qq">QQ Mail</option><option value="163">163 Mail</option><option value="icloud">iCloud Mail</option></select></label></div><div style={{ display: 'grid', gap: 11 }}>{server('imap', copy.imap)}{server('smtp', copy.smtp)}</div></section>
    <section style={styles.card}><button type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(current => !current)} style={{ ...styles.button, width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left' }}><span><strong style={{ display: 'block', fontSize: 13 }}>{copy.advanced}</strong><span style={{ display: 'block', marginTop: 3, color: colors.secondary, fontSize: 11 }}>{copy.advancedHint}</span></span><span>{advancedOpen ? copy.collapse : '›'}</span></button>{advancedOpen && <div style={{ marginTop: 14 }}><div style={styles.grid}>{field(copy.username, 'username', 'text', copy.usernameHint)}{field(copy.inbox, 'inboxFolder', 'text', copy.inboxHint)}</div><h4 style={{ margin: '17px 0 10px', fontSize: 13 }}>{copy.limits}</h4><div style={styles.grid}>{field(copy.bodyLimit, 'maxBodyChars', 'number')}{field(copy.messageLimit, 'maxMessageBytes', 'number')}{field(copy.attachmentLimit, 'maxAttachmentBytes', 'number')}</div></div>}</section>
    <section style={styles.card}><h3 style={{ margin: 0, fontSize: 15 }}>{copy.agentAccess}</h3><p style={{ margin: '6px 0 13px', color: colors.secondary, fontSize: 11, lineHeight: 1.55 }}>{copy.agentAccessHint}</p><div style={styles.grid}>{permission('readEnabled', copy.readPermission, copy.readHint, readReady)}{permission('sendEnabled', copy.sendPermission, copy.sendHint, sendReady)}</div></section>
    <p style={{ color: colors.secondary, fontSize: 11, lineHeight: 1.55 }}>{copy.usage}</p>
    {!snapshot.writable && <p role="status" style={{ color: colors.secondary, fontSize: 12 }}>{copy.readOnly}</p>}
    {error && <p role="alert" style={{ color: '#a82332', fontSize: 12 }}>{error}</p>}{notice && <p role="status" style={{ color: '#32724e', fontSize: 12 }}>{notice}</p>}
    <button type="button" disabled={busy || !snapshot.writable} onClick={save} style={styles.primary}>{busy ? copy.saving : copy.save}</button>
  </div>
}

export function apply(ctx: any) {
  const service = { scope: ctx.settingsScope.bind({ namespace: NS }), credentials: ctx.remote.credentials }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'mail-assistant', order: 25, label: () => copy.nav, inject: () => ({ service }),
  }, MailSettings))
}
