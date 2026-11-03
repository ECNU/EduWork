// New mail is one notification source among several: the registry owns queueing,
// preferences, deduplication and display, so this plugin only polls the mailbox,
// publishes what arrived and validates a click target.

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { Config, MAIL_NAMESPACE, PASSWORD_REF } from './config.js'
import { readMessage } from './message.js'
import { describeArrival, readingPayload } from './text.js'
import { closeClient, createClient, fetchArrivals, probeFolder } from './watcher.js'

export const name = 'dsh-mail-pet'
// The notification service is optional on purpose: without it the plugin still
// loads, and only the reminder channel is missing.
export const inject = ['settings', 'credentials', 'storageDomain']

/** One row per watched folder: the highest UID already accounted for. */
const MAIL_PET_DOMAIN = defineDomain({
  // Domain names must match the storage hub's UNIT_NAME_RE (/^[a-z][a-z0-9_]*$/),
  // so this cannot reuse the dashed package id.
  name: 'mail_pet',
  version: 1,
  tables: {
    watermarks: domainTable(z.object({
      uidValidity: z.string().regex(/^\d+$/u),
      uidNext: z.number().int().positive(),
      updatedAt: z.string(),
    }).strict()),
  },
})

// The first probe of a session runs almost immediately; later probes keep the
// configured interval.
const FIRST_PROBE_DELAY = 3_000

const readField = field => typeof field?.get === 'function' ? field.get() : field

export function apply(ctx, config = {}) {
  const read = () => ({
    enabled: readField(config.enabled) === true,
    intervalSeconds: Number(readField(config.intervalSeconds)),
    folder: String(readField(config.folder) ?? '').trim() || 'INBOX',
    maxPerFlush: Math.max(1, Number(readField(config.maxPerFlush)) || 5),
  })

  let table
  const ready = ctx.storageDomain.open(MAIL_PET_DOMAIN).then(domain => {
    table = domain.table('watermarks')
    return domain
  })
  // A disabled instance never polls, so keep a failure observed instead of
  // surfacing it as an unhandled rejection; the poll loop reports it once.
  ready.catch(() => {})

  // The shell's logger is not guaranteed to exist; a missing logger must never
  // turn a harmless warning into an exception.
  const log = message => {
    try { console.log(`[mail-pet] ${message}`) } catch {}
  }

  const warned = new Set()
  const warnOnce = (key, message) => {
    if (warned.has(key)) return
    warned.add(key)
    log(message)
  }

  /** Read the mail assistant's live settings instead of duplicating the form. */
  const mailSettings = () => {
    let row
    try {
      row = (ctx.settings.describe?.() ?? []).find(entry => String(entry.ns) === MAIL_NAMESPACE)
    }
    catch (error) {
      warnOnce('settings', `mail-pet: mail settings are unavailable: ${error.message}`)
      return null
    }
    const value = row?.value
    if (value === undefined || value.readEnabled !== true) return null
    const imapHost = String(value.imapHost ?? '').trim()
    if (imapHost === '') return null
    return {
      imapHost,
      imapPort: value.imapPort,
      imapTls: value.imapTls,
      username: String(value.username ?? ''),
      email: String(value.email ?? ''),
    }
  }

  /** Open a short-lived read-only session, used by the click handler only. */
  const withMailbox = async (folder, work) => {
    const mail = mailSettings()
    const resolved = await ctx.credentials.resolve(PASSWORD_REF).catch(() => undefined)
    if (mail === null || resolved?.value === undefined || resolved.value === '') return undefined
    const client = createClient(mail, resolved.value)
    try {
      await client.connect()
      return await work(client, folder)
    }
    finally {
      await closeClient(client)
    }
  }

  // A short interval only makes sense when it costs one STATUS round-trip rather
  // than a fresh login: the watcher keeps one read-only session and reuses it.
  // The session is dropped when the mailbox settings change or the socket dies,
  // and the next tick reconnects with the usual backoff.
  const session = { client: undefined, signature: '', dead: false }

  const closeSession = async () => {
    const client = session.client
    session.client = undefined
    session.signature = ''
    session.dead = false
    if (client !== undefined) await closeClient(client)
  }

  const sessionClient = async (mail, password) => {
    const signature = JSON.stringify([mail.imapHost, mail.imapPort, mail.imapTls, mail.username || mail.email])
    if (session.client !== undefined && (session.signature !== signature || session.dead)) await closeSession()
    session.signature = signature
    if (session.client === undefined) {
      // A reused session must outlive the interval between two probes, otherwise
      // the socket times out before the next STATUS and every poll reconnects.
      const client = createClient(mail, password, { socketTimeout: Math.max(120_000, read().intervalSeconds * 3_000) })
      await client.connect()
      // A dropped socket must never be reused: mark it and let the next tick
      // reconnect, so a poll never waits on a dead connection twice.
      const fail = () => { session.dead = true }
      client.on('error', fail)
      client.on('close', fail)
      session.client = client
    }
    return session.client
  }
  ctx.inject(['notifications'], inner => {
    if (inner.notifications.version !== 1) throw Error('dsh-mail-pet requires notification protocol 1')

    const handle = inner.notifications.register(inner, {
      version: 1,
      source: 'mail',
      // The scope identifies the mailbox without carrying its address: the
      // registry stores it, and switching accounts must register a new one.
      scope: 'inbox',
      label: '邮件',
      events: [{
        id: 'received',
        label: '收到新邮件',
        level: 'info',
        requiresAction: false,
        actions: ['open'],
      }],
      /**
       * The clicked message is read once, read-only, and returned as a bounded
       * reference plus an excerpt: the client receives whatever this returns and
       * the protocol caps a target at 4096 characters.
       */
      async onAction({ target, signal }) {
        if (signal.aborted) return false
        const folder = String(target?.folder ?? read().folder)
        const uid = Number(target?.uid)
        if (!Number.isSafeInteger(uid) || uid < 1) return false
        const message = await withMailbox(folder, (client, name) => readMessage(client, name, uid))
        if (signal.aborted || message === undefined || message === null) return false
        return readingPayload(message, { folder, uid })
      },
    })

    const state = { stopped: false, timer: undefined, polling: false, failures: 0 }

    const publish = async arrivals => {
      const options = read()
      // Oldest first, so the notice for the newest message is published last: the
      // registry stamps createdAt when a notice is published, and the desktop pet
      // highlights the newest one. Publishing newest first would give today's mail
      // the oldest timestamp and pin the bubble to the batch's oldest message.
      // arrivals.items already holds only the newest maxPerFlush envelopes, so a
      // backlog cannot push today's message out of the batch.
      const items = [...(arrivals.items ?? [])].slice(0, options.maxPerFlush)
      for (const item of items) {
        // One message, one notice: both the id and the target point at that UID,
        // so a click cannot land on a neighbouring message.
        const text = describeArrival({ subject: item.subject, from: item.from })
        const result = await handle.publish({
          id: `inbox:${item.uid}`,
          event: 'received',
          action: 'open',
          title: text.title,
          preview: text.preview,
          target: { folder: options.folder, uid: item.uid },
        })
        if (result.status !== 'accepted' && result.status !== 'disabled') {
          log(`mail-pet: notification for ${item.uid} was ${result.status}`)
        }
      }
      if (arrivals.count > items.length) {
        // The rest stays unannounced on purpose: one notice per message is
        // honest, and a single summary is enough to say the mailbox has more.
        const text = describeArrival({ subject: arrivals.subject, from: '', count: arrivals.count })
        await handle.publish({
          id: `inbox:bulk:${arrivals.newestUid}`,
          event: 'received',
          action: 'open',
          title: text.title,
          preview: text.preview,
          target: { folder: options.folder, uid: arrivals.newestUid },
        })
      }
    }

    const poll = async () => {
      if (state.polling) return
      const options = read()
      if (!options.enabled) return
      const mail = mailSettings()
      if (mail === null) {
        warnOnce('configuration', 'mail-pet: the mail assistant is not enabled or not configured, so polling is skipped')
        return
      }
      const resolved = await ctx.credentials.resolve(PASSWORD_REF).catch(() => undefined)
      if (resolved?.value === undefined || resolved.value === '') {
        warnOnce('credential', 'mail-pet: the mail password is not stored yet, so polling is skipped')
        return
      }

      await ready
      state.polling = true
      try {
        const client = await sessionClient(mail, resolved.value)
        const status = await probeFolder(client, options.folder)
        const saved = table.get(options.folder)
        const stamp = new Date().toISOString()
        let current = null
        if (saved === undefined || saved.uidValidity !== status.uidValidity) {
          // First probe, or the server rebuilt UIDs: record the waterline and
          // stay quiet, because the old UIDs no longer mean anything.
          await table.put(options.folder, { uidValidity: status.uidValidity, uidNext: status.uidNext, updatedAt: stamp })
        }
        else if (status.uidNext > saved.uidNext) {
          current = await fetchArrivals(client, options.folder, saved.uidNext, status.uidNext - 1, { detail: options.maxPerFlush })
          // Advance before publishing: a failed notification must never replay.
          await table.put(options.folder, { uidValidity: status.uidValidity, uidNext: status.uidNext, updatedAt: stamp })
        }
        if (current === null || current.count === 0) return
        state.failures = 0
        warned.delete('configuration')
        warned.delete('credential')
        await publish(current)
      }
      catch (error) {
        // The session may be half-dead; reconnect on the next tick.
        session.dead = true
        state.failures = Math.min(4, state.failures + 1)
        throw error
      }
      finally {
        state.polling = false
      }
    }

    const schedule = (delayMs) => {
      clearTimeout(state.timer)
      state.timer = undefined
      if (state.stopped) return
      const wait = delayMs ?? Math.round(Math.max(5, read().intervalSeconds) * 1000 * Math.min(4, 2 ** state.failures))
      state.timer = setTimeout(() => { void tick() }, wait)
    }

    const tick = async () => {
      state.timer = undefined
      try { await poll() }
      catch (error) { log(`mail-pet: poll failed: ${error.message}`) }
      schedule()
    }

    const restart = () => {
      clearTimeout(state.timer)
      state.timer = undefined
      if (read().enabled !== true) return
      // Probe soon after start so mail that arrived while the application was
      // closed is reported within seconds instead of after a whole interval.
      schedule(FIRST_PROBE_DELAY)
    }

    inner.on('loader/volatile-update', restart)
    inner.effect(() => () => {
      state.stopped = true
      clearTimeout(state.timer)
      state.timer = undefined
      void closeSession()
      handle.dispose()
    })
    restart()
  })

  ctx.effect(() => () => ready.then(domain => domain.close()).catch(() => {}))
}

export { Config, MAIL_PET_DOMAIN }
export default { name, inject, Config, apply }
