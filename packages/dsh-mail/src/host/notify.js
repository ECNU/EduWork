// New-mail reminders: an optional watcher that publishes through the third-party
// notification protocol. It reuses the mail assistant's own settings, credentials
// and read-only IMAP access, so the reminder feature is part of this plugin rather
// than a separate package, and it keeps working when no desktop pet is installed.
//
// Read-only means exactly what it means for the tools: the mailbox is opened with
// a read-only lock and no flags are stored, so a reminder never marks mail as read.
//
// Watermarks live in memory on purpose. The first probe of a mailbox only records
// the current position, so a restart does not replay the whole inbox; reminders
// are for mail that arrives while the app is running.

import { PREVIEW_BYTES, PREVIEW_CHARS } from './preview.js'

export const SOURCE_ID = 'mail'
export const EVENT_ID = 'new-mail'
const TITLE_CHARS = 120
const PREVIEW_CHARS_LIMIT = 400
const MAX_PER_POLL = 3
const DISABLED_RECHECK_MS = 30_000

const clip = (value, max) => {
  const points = [...String(value ?? '').toWellFormed()]
  return points.length > max ? points.slice(0, max).join('') : points.join('')
}

/** The account a mailbox belongs to: reminders must never cross between accounts. */
export function accountScope(settings) {
  const host = String(settings?.imapHost ?? '').trim().toLowerCase()
  const user = String(settings?.username || settings?.email || '').trim().toLowerCase()
  return clip(`${host}:${user}`, 240)
}

const markKey = (scope, folder) => `${scope}\u0000${folder}`
const sender = from => {
  const first = Array.isArray(from) ? from[0] : undefined
  return clip(first?.name || first?.address || '', 80)
}

export function reminderContent(message, excerpt) {
  const subject = clip(message.subject ?? '', TITLE_CHARS).trim()
  const from = sender(message.from)
  const body = clip(excerpt ?? '', PREVIEW_CHARS_LIMIT)
  const preview = clip([from, body].filter(part => part !== '').join(' · '), PREVIEW_CHARS_LIMIT)
  return { title: subject === '' ? '（无主题）' : subject, preview }
}

/**
 * @param {object} options
 * @param {() => object} options.getSettings resolved settings, read on every poll
 * @param {() => Promise<string>} options.getPassword resolves the stored credential
 * @param {object} options.mail IMAP operations: openSession, closeSession, probeFolder, fetchArrivals, readExcerpt
 * @param {(definition: object) => object} options.register registers a notification source and returns its handle
 * @param {{info: (message: string) => void, warn: (message: string) => void}} options.log
 */
export function createMailReminders({ getSettings, getPassword, mail, register, log, timers = globalThis }) {
  const marks = new Map()
  /** @type {{scope: string, handle: object} | null} */
  let source = null
  /** @type {object | null} */
  let session = null
  let timer = null
  let stopped = true
  let polling = false
  let reported = ''

  const report = (level, message) => {
    if (reported === message) return
    reported = message
    log[level](message)
  }

  function ensureSource(scope) {
    if (source?.scope === scope) return source.handle
    source?.handle.dispose()
    const handle = register({
      version: 1,
      source: SOURCE_ID,
      scope,
      label: '邮件',
      events: [{
        id: EVENT_ID,
        label: '新邮件',
        level: 'info',
        requiresAction: false,
        actions: ['open'],
      }],
      // A reminder has nothing to act on beyond bringing the app forward, which the
      // shell already does for the click; resolving the entry is the whole action.
      onAction: () => false,
    })
    source = { scope, handle }
    reported = ''
    return handle
  }

  async function closeSession() {
    const current = session
    session = null
    if (current) await mail.closeSession(current)
  }

  async function sessionFor(settings) {
    if (session) return session
    const password = await getPassword()
    session = await mail.openSession(settings, password)
    return session
  }

  async function pollOnce() {
    const settings = getSettings()
    if (settings.notifyEnabled !== true || settings.readEnabled !== true) {
      // Off means off: release the connection and the registration here rather than
      // leaving a mailbox open until the timer happens to stop.
      await finish('')
      return 'disabled'
    }
    if (String(settings.imapHost ?? '').trim() === '') {
      await finish('')
      return 'disabled'
    }
    const scope = accountScope(settings)
    const folder = String(settings.inboxFolder ?? '').trim() || 'INBOX'
    const handle = ensureSource(scope)
    let probe
    try {
      probe = await mail.probeFolder(await sessionFor(settings), folder)
    } catch (error) {
      await closeSession()
      report('warn', `Mail reminder probe failed: ${error instanceof Error ? error.message : String(error)}`)
      return 'unreachable'
    }
    const key = markKey(scope, folder)
    const mark = marks.get(key)
    if (mark === undefined || mark.uidValidity !== probe.uidValidity) {
      // A different UIDVALIDITY means the old numbers address other messages:
      // start from the current position instead of guessing.
      if (mark !== undefined) report('info', `Mailbox ${folder} was renumbered (UIDVALIDITY changed); reminders continue from the newest mail.`)
      marks.set(key, { uidValidity: probe.uidValidity, uidNext: probe.uidNext })
      return mark === undefined ? 'baseline' : 'renumbered'
    }
    if (probe.uidNext <= mark.uidNext) return 'idle'
    let arrivals
    try {
      arrivals = await mail.fetchArrivals(session, folder, { afterUid: mark.uidNext - 1, limit: MAX_PER_POLL })
    } catch (error) {
      await closeSession()
      report('warn', `Mail reminder fetch failed: ${error instanceof Error ? error.message : String(error)}`)
      return 'unreachable'
    }
    let highest = mark.uidNext - 1
    for (const message of arrivals.messages) {
      if (message.uid < mark.uidNext) continue
      try {
        const excerpt = await mail.readExcerpt(session, folder, message.uid, {
          maxBytes: PREVIEW_BYTES,
          maxChars: settings.notifyExcerptChars ?? PREVIEW_CHARS,
        })
        const content = reminderContent(message, excerpt.text)
        await handle.publish({
          id: `${probe.uidValidity}:${message.uid}`,
          event: EVENT_ID,
          action: 'open',
          title: content.title,
          preview: content.preview,
          target: { folder, uid: message.uid },
        })
      } catch (error) {
        // A body that cannot be read must not hide the mail: fall back to the header
        // fields, and never replay the message on the next poll.
        try {
          const content = reminderContent(message, '')
          await handle.publish({
            id: `${probe.uidValidity}:${message.uid}`,
            event: EVENT_ID,
            action: 'open',
            title: content.title,
            preview: content.preview,
            target: { folder, uid: message.uid },
          })
        } catch (publishError) {
          report('warn', `Mail reminder could not be published: ${publishError instanceof Error ? publishError.message : String(publishError)}`)
        }
      }
      highest = Math.max(highest, message.uid)
    }
    marks.set(key, { uidValidity: probe.uidValidity, uidNext: highest + 1 })
    return 'published'
  }

  function intervalMs(settings) {
    const seconds = Number(settings.notifyIntervalSeconds ?? 120)
    return Math.min(3600, Math.max(30, Number.isFinite(seconds) ? seconds : 120)) * 1000
  }

  async function tick() {
    timer = null
    if (stopped) return
    let settings
    try { settings = getSettings() } catch (error) {
      report('warn', `Mail reminder settings are invalid: ${error instanceof Error ? error.message : String(error)}`)
      schedule(DISABLED_RECHECK_MS)
      return
    }
    if (settings.notifyEnabled !== true || settings.readEnabled !== true) {
      await finish('')
      schedule(DISABLED_RECHECK_MS)
      return
    }
    if (polling) return schedule(intervalMs(settings))
    polling = true
    try {
      const state = await pollOnce()
      if (state === 'unreachable') {
        schedule(intervalMs(settings))
        return
      }
    } catch (error) {
      report('warn', `Mail reminder poll failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      polling = false
    }
    schedule(intervalMs(settings))
  }

  function schedule(delay) {
    if (stopped || timer !== null) return
    timer = timers.setTimeout(() => { timer = null; void tick() }, delay)
    timer?.unref?.()
  }

  /** Disabling polling releases the connection and the source registration. */
  async function finish(reason) {
    await closeSession()
    source?.handle.dispose()
    source = null
    marks.clear()
    if (reason !== '') report('info', reason)
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      // Probe once shortly after startup, then keep the configured cadence.
      schedule(3_000)
    },
    async stop() {
      stopped = true
      if (timer !== null) { timers.clearTimeout(timer); timer = null }
      await finish('')
    },
    /** Settings changed: drop the session when the account or the interval changed. */
    async refresh() {
      let settings
      try { settings = getSettings() } catch { return }
      if (settings.notifyEnabled !== true || settings.readEnabled !== true) {
        await finish('')
        return
      }
      if (source !== null && source.scope !== accountScope(settings)) await finish('')
      if (session !== null) await closeSession()
      if (stopped) return
      if (timer !== null) { timers.clearTimeout(timer); timer = null }
      schedule(3_000)
    },
    pollOnce,
    get state() {
      return { source: source?.scope ?? null, session: session !== null, marks: new Map(marks) }
    },
  }
}
