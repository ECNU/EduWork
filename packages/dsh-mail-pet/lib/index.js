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
      // Newest first: a large burst must not delay today's message behind last
      // week's backlog, and the registry drops what it cannot show.
      const items = [...(arrivals.items ?? [])].reverse().slice(0, options.maxPerFlush)
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
      if (mailSettings() === null) {
        warnOnce('configuration', 'mail-pet: the mail assistant is not enabled or not configured, so polling is skipped')
        return
      }

      await ready
      state.polling = true
      try {
        const current = await withMailbox(options.folder, async (client, folder) => {
          const status = await probeFolder(client, folder)
          const saved = table.get(folder)
          const stamp = new Date().toISOString()
          if (saved === undefined || saved.uidValidity !== status.uidValidity) {
            // First probe, or the server rebuilt UIDs: record the waterline and
            // stay quiet, because the old UIDs no longer mean anything.
            await table.put(folder, { uidValidity: status.uidValidity, uidNext: status.uidNext, updatedAt: stamp })
            return null
          }
          if (status.uidNext <= saved.uidNext) return null
          const arrivals = await fetchArrivals(client, folder, saved.uidNext, status.uidNext - 1, { detail: read().maxPerFlush })
          // Advance before publishing: a failed notification must never replay.
          await table.put(folder, { uidValidity: status.uidValidity, uidNext: status.uidNext, updatedAt: stamp })
          return arrivals
        })
        if (current === undefined || current === null || current.count === 0) return
        state.failures = 0
        warned.delete('configuration')
        warned.delete('credential')
        await publish(current)
      }
      catch (error) {
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
      // The first probe waits one interval so a desktop start does not race the
      // mailbox while the rest of the application is still loading.
      schedule()
    }

    inner.on('loader/volatile-update', restart)
    inner.effect(() => () => {
      state.stopped = true
      clearTimeout(state.timer)
      state.timer = undefined
      handle.dispose()
    })
    restart()
  })

  ctx.effect(() => () => ready.then(domain => domain.close()).catch(() => {}))
}

export { Config, MAIL_PET_DOMAIN }
export default { name, inject, Config, apply }
