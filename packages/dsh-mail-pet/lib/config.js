// Deployment-facing configuration. Every field is declared volatile so the
// generic plugin settings form can render it and so a saved change reaches this
// instance through `loader/volatile-update` without a restart.

import schema from '@deepseek-ai/schemastery'

/** Settings namespace and credential reference owned by @eduwork/dsh-mail. */
export const MAIL_NAMESPACE = 'dsh-mail-assistant'
export const PASSWORD_REF = 'DSH_MAIL_ASSISTANT_PASSWORD'

export const DEFAULTS = Object.freeze({
  enabled: false,
  intervalSeconds: 180,
  folder: 'INBOX',
  maxPerFlush: 5,
})

const live = field => typeof field.volatile === 'function' ? field.volatile() : field

export const Config = schema.object({
  enabled: live(schema.boolean().default(DEFAULTS.enabled)),
  intervalSeconds: live(schema.natural().min(5).max(3600).default(DEFAULTS.intervalSeconds)),
  folder: live(schema.string().default(DEFAULTS.folder)),
  // The registry queues one entry per message, so a burst of hundreds would take
  // minutes to walk. Only the newest few are described per poll; the rest stay in
  // the mailbox rather than being announced out of order.
  maxPerFlush: live(schema.natural().min(1).max(20).default(DEFAULTS.maxPerFlush)),
})
