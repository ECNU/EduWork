// Read-only IMAP probing for the new-mail watcher. Every call opens a short
// connection, asks for STATUS only, and fetches envelopes only when the
// predicted UIDNEXT advanced. Nothing here marks a message as read, moves it,
// or downloads a body: the mailbox is opened read-only and never written.

import { ImapFlow } from 'imapflow'

const CONNECT_TIMEOUT = 20_000
const SOCKET_TIMEOUT = 60_000

/**
 * Build a short-lived client from the mail assistant's own settings, so the
 * user configures one mailbox instead of two.
 * @param {{ imapHost: string, imapPort: number, imapTls: 'implicit'|'starttls', username: string, email: string }} settings
 * @param {string} password resolved credential value
 */
export function createClient(settings, password) {
  return new ImapFlow({
    host: settings.imapHost.trim(),
    port: settings.imapPort,
    secure: settings.imapTls === 'implicit',
    doSTARTTLS: settings.imapTls === 'starttls',
    auth: { user: (settings.username || settings.email).trim(), pass: password },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT,
    greetingTimeout: CONNECT_TIMEOUT,
    socketTimeout: SOCKET_TIMEOUT,
  })
}

/**
 * STATUS of one folder without selecting it: the cheapest way to learn whether
 * anything arrived. UIDVALIDITY is returned as a string because a mailbox
 * rebuild silently invalidates every stored UID.
 * @param {import('imapflow').ImapFlow} client connected client
 * @param {string} folder exact IMAP path
 * @returns {Promise<{ uidValidity: string, uidNext: number, messages: number }>}
 */
export async function probeFolder(client, folder) {
  const status = await client.status(folder, { uidNext: true, uidValidity: true, messages: true })
  if (status === false) throw new Error('Mailbox status is unavailable for this folder')
  const uidValidity = String(status.uidValidity ?? '')
  const uidNext = Number(status.uidNext)
  if (!/^\d+$/u.test(uidValidity)) throw new Error('Mailbox did not report a numeric UIDVALIDITY')
  if (!Number.isSafeInteger(uidNext) || uidNext < 1) throw new Error('Mailbox did not report a usable UIDNEXT')
  return { uidValidity, uidNext, messages: Number.isFinite(status.messages) ? Number(status.messages) : 0 }
}

/**
 * Count the arrivals in an inclusive UID range and describe only the newest
 * few. The range is bounded by the previous watermark and the new UIDNEXT, so
 * this never walks the whole mailbox, and a burst of hundreds of messages still
 * costs one bounded envelope fetch.
 * @param {import('imapflow').ImapFlow} client connected client
 * @param {string} folder exact IMAP path
 * @param {number} fromUid first UID that was not seen yet
 * @param {number} toUid last UID that exists now
 * @param {{ detail?: number }} options how many envelopes to describe
 * @returns {Promise<{ count: number, subject: string, newestUid: number, items: Array<{ uid: number, subject: string, from: string }> }>}
 */
export async function fetchArrivals(client, folder, fromUid, toUid, { detail = 3 } = {}) {
  const empty = { count: 0, subject: '', newestUid: 0, items: [] }
  if (!Number.isSafeInteger(fromUid) || !Number.isSafeInteger(toUid) || toUid < fromUid) return empty
  const lock = await client.getMailboxLock(folder, { readOnly: true })
  try {
    // Phase one: identities only, so the count is exact and the payload small.
    const listed = await client.fetchAll(`${fromUid}:${toUid}`, { uid: true }, { uid: true })
    const uids = listed
      .map(row => row.uid)
      .filter(uid => Number.isSafeInteger(uid) && uid >= fromUid && uid <= toUid)
      .sort((a, b) => a - b)
    if (uids.length === 0) return empty
    // Phase two: envelopes for the newest few, newest last.
    const tail = uids.slice(-Math.max(1, detail))
    const rows = await client.fetchAll(tail, { uid: true, envelope: true }, { uid: true })
    const newest = rows
      .filter(row => Number.isSafeInteger(row.uid))
      .sort((a, b) => a.uid - b.uid)
      .at(-1)
    // One notification is published per described envelope, so the caller needs
    // every row rather than only the newest subject.
    const items = rows
      .filter(row => Number.isSafeInteger(row.uid))
      .sort((a, b) => a.uid - b.uid)
      .map(row => ({
        uid: row.uid,
        subject: String(row.envelope?.subject ?? ''),
        from: String(row.envelope?.from?.[0]?.name ?? row.envelope?.from?.[0]?.address ?? ''),
      }))
    return { count: uids.length, subject: String(newest?.envelope?.subject ?? ''), newestUid: uids.at(-1), items }
  }
  finally {
    try { lock.release() } catch { /* the connection is closing anyway */ }
  }
}

/** Log out politely, or drop the socket when the session is already unusable. */
export async function closeClient(client) {
  try {
    if (client.usable) await client.logout()
    else client.close()
  }
  catch {
    try { client.close() } catch { /* already gone */ }
  }
}
