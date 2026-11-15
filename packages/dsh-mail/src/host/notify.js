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
  let connecting = null
  let activePoll = null
  let lifetime = new AbortController()
  let reported = ''

  const current = signal => !stopped && signal === lifetime.signal && !signal.aborted
  const enabled = settings => settings.notifyEnabled === true && settings.readEnabled === true

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

  async function resetConnection() {
    const pending = connecting
    const connected = session
    lifetime.abort()
    lifetime = new AbortController()
    connecting = null
    session = null
    // Detach before waiting: a late connection belongs to the cancelled lifetime
    // and must close itself, without touching a replacement account's session.
    await Promise.all([pending?.catch(() => {}), connected && mail.closeSession(connected)])
  }

  async function sessionFor(settings, signal) {
    if (session) return session
    if (connecting) return connecting
    const pending = (async () => {
      const password = await getPassword()
      if (!current(signal)) return null
      const connected = await mail.openSession(settings, password, signal)
      if (!current(signal)) {
        await mail.closeSession(connected)
        return null
      }
      session = connected
      return connected
    })()
    connecting = pending
    try { return await pending }
    finally { if (connecting === pending) connecting = null }
  }

  async function runPoll(signal) {
    const settings = getSettings()
    if (!enabled(settings)) {
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
    if (source && source.scope !== scope) {
      await closeSession()
      if (!current(signal)) return 'cancelled'
    }
    const handle = ensureSource(scope)
    let probe, client
    try {
      client = await sessionFor(settings, signal)
      if (!current(signal)) return 'cancelled'
      probe = await mail.probeFolder(client, folder)
      if (!current(signal)) return 'cancelled'
    } catch (error) {
      if (!current(signal)) return 'cancelled'
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
      arrivals = await mail.fetchArrivals(client, folder, { afterUid: mark.uidNext - 1, limit: MAX_PER_POLL })
      if (!current(signal)) return 'cancelled'
    } catch (error) {
      if (!current(signal)) return 'cancelled'
      await closeSession()
      report('warn', `Mail reminder fetch failed: ${error instanceof Error ? error.message : String(error)}`)
      return 'unreachable'
    }
    let highest = mark.uidNext - 1
    for (const message of arrivals.messages) {
      if (message.uid < mark.uidNext) continue
      try {
        const excerpt = await mail.readExcerpt(client, folder, message.uid, {
          maxBytes: PREVIEW_BYTES,
          maxChars: settings.notifyExcerptChars ?? PREVIEW_CHARS,
          signal,
        })
        if (!current(signal)) return 'cancelled'
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
        if (!current(signal)) return 'cancelled'
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
          if (!current(signal)) return 'cancelled'
          report('warn', `Mail reminder could not be published: ${publishError instanceof Error ? publishError.message : String(publishError)}`)
        }
      }
      if (!current(signal)) return 'cancelled'
      highest = Math.max(highest, message.uid)
    }
    marks.set(key, { uidValidity: probe.uidValidity, uidNext: highest + 1 })
    return 'published'
  }

  function pollOnce() {
    if (stopped) return Promise.resolve('stopped')
    const signal = lifetime.signal
    if (activePoll?.signal === signal) return activePoll.promise
    const operation = { signal, promise: null }
    operation.promise = runPoll(signal).finally(() => {
      if (activePoll === operation) activePoll = null
    })
    activePoll = operation
    return operation.promise
  }

  function intervalMs(settings) {
    const seconds = Number(settings.notifyIntervalSeconds ?? 120)
    return Math.min(3600, Math.max(30, Number.isFinite(seconds) ? seconds : 120)) * 1000
  }

  async function tick() {
    timer = null
    if (stopped) return
    const signal = lifetime.signal
    let settings
    try { settings = getSettings() } catch (error) {
      report('warn', `Mail reminder settings are invalid: ${error instanceof Error ? error.message : String(error)}`)
      schedule(DISABLED_RECHECK_MS)
      return
    }
    if (!enabled(settings)) {
      const finishing = finish('')
      const resetSignal = lifetime.signal
      await finishing
      if (current(resetSignal)) schedule(DISABLED_RECHECK_MS)
      return
    }
    try {
      await pollOnce()
    } catch (error) {
      if (current(signal)) report('warn', `Mail reminder poll failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (current(signal)) schedule(intervalMs(settings))
  }

  function schedule(delay) {
    if (stopped || timer !== null) return
    timer = timers.setTimeout(() => { timer = null; void tick() }, delay)
    timer?.unref?.()
  }

  /** Disabling polling releases the connection and the source registration. */
  async function finish(reason) {
    source?.handle.dispose()
    source = null
    marks.clear()
    await resetConnection()
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
      if (timer !== null) { timers.clearTimeout(timer); timer = null }
      let settings
      try { settings = getSettings() } catch { await finish(''); return }
      const resetting = !enabled(settings) || (source !== null && source.scope !== accountScope(settings)) ? finish('') : resetConnection()
      const signal = lifetime.signal
      await resetting
      if (current(signal)) schedule(enabled(settings) ? 3_000 : DISABLED_RECHECK_MS)
    },
    pollOnce,
    get state() {
      return { source: source?.scope ?? null, session: session !== null, marks: new Map(marks) }
    },
  }
}
