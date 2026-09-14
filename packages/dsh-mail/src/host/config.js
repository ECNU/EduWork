import z from '@deepseek-ai/schemastery'
import { DEFAULTS, SETTINGS_NAMESPACE } from './constants.js'

export const MailSettingsSchema = z.object({
  readEnabled: z.boolean().default(DEFAULTS.readEnabled),
  sendEnabled: z.boolean().default(DEFAULTS.sendEnabled),
  email: z.string().default(DEFAULTS.email),
  username: z.string().default(DEFAULTS.username),
  fromName: z.string().default(DEFAULTS.fromName),
  inboxFolder: z.string().default(DEFAULTS.inboxFolder),
  imapHost: z.string().default(DEFAULTS.imapHost),
  imapPort: z.number().default(DEFAULTS.imapPort),
  imapTls: z.union(['implicit', 'starttls']).default(DEFAULTS.imapTls),
  smtpHost: z.string().default(DEFAULTS.smtpHost),
  smtpPort: z.number().default(DEFAULTS.smtpPort),
  smtpTls: z.union(['implicit', 'starttls']).default(DEFAULTS.smtpTls),
  maxBodyChars: z.number().default(DEFAULTS.maxBodyChars),
  maxMessageBytes: z.number().default(DEFAULTS.maxMessageBytes),
  maxAttachmentBytes: z.number().default(DEFAULTS.maxAttachmentBytes),
})

export function settingsBase(config = {}) {
  const base = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    if (config[key] !== undefined) base[key] = config[key]
  }
  return base
}

export function validateSettings(value) {
  for (const [label, port] of [['IMAP', value.imapPort], ['SMTP', value.smtpPort]]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`${label} port must be an integer between 1 and 65535`)
    }
  }
  if (!['implicit', 'starttls'].includes(value.imapTls)) throw new Error('Unsupported IMAP TLS mode')
  if (!['implicit', 'starttls'].includes(value.smtpTls)) throw new Error('Unsupported SMTP TLS mode')
  if (!Number.isInteger(value.maxBodyChars) || value.maxBodyChars < 1_000 || value.maxBodyChars > 200_000) {
    throw new Error('maxBodyChars must be an integer between 1000 and 200000')
  }
  if (!Number.isInteger(value.maxMessageBytes) || value.maxMessageBytes < 1_048_576 || value.maxMessageBytes > 104_857_600) {
    throw new Error('maxMessageBytes must be between 1 MiB and 100 MiB')
  }
  if (!Number.isInteger(value.maxAttachmentBytes) || value.maxAttachmentBytes < 1_024 || value.maxAttachmentBytes > 104_857_600) {
    throw new Error('maxAttachmentBytes must be between 1 KiB and 100 MiB')
  }
  for (const key of ['email', 'username', 'fromName', 'inboxFolder', 'imapHost', 'smtpHost']) {
    if (typeof value[key] !== 'string') throw new Error(`${key} must be a string`)
    if (/[\r\n\u0000]/.test(value[key])) throw new Error(`${key} contains forbidden control characters`)
  }
}

export function currentSettings(ctx, scope, rowConfig = {}) {
  const descriptor = (ctx.settings.describe?.() ?? []).find(candidate => String(candidate.ns) === SETTINGS_NAMESPACE)
  const user = descriptor?.user ?? {}
  const resolved = { ...settingsBase(rowConfig), ...scope.get(), ...user }
  validateSettings(resolved)
  return resolved
}

export function assertConfigured(value, capability) {
  const fields = capability === 'read'
    ? [['email', value.email], ['IMAP host', value.imapHost]]
    : [['email', value.email], ['SMTP host', value.smtpHost]]
  const missing = fields.filter(([, candidate]) => String(candidate ?? '').trim() === '').map(([label]) => label)
  if (missing.length > 0) {
    throw new Error(`Mail assistant is not configured: missing ${missing.join(', ')}. Open Settings -> Mail assistant.`)
  }
}

export { SETTINGS_NAMESPACE }
