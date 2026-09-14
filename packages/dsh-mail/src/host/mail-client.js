import { randomUUID } from 'node:crypto'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import {
  attachmentHandle, messageHandle, parseAttachmentHandle, parseMessageHandle, parseSearchCursor, searchCursor,
} from './handles.js'
import { sanitizeFilename, truncateText, validateAddress } from './sanitize.js'

function addressList(value) {
  const list = Array.isArray(value) ? value : value?.value
  if (!Array.isArray(list)) return []
  return list.flatMap(candidate => {
    if (candidate === null || typeof candidate !== 'object') return []
    const address = typeof candidate.address === 'string' ? candidate.address : ''
    const name = typeof candidate.name === 'string' ? candidate.name : ''
    if (address === '' && name === '') return []
    return [{ ...(name === '' ? {} : { name }), ...(address === '' ? {} : { address }) }]
  })
}

function dateIso(value) {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : ''
}

function uidValidity(client) {
  const value = client.mailbox === false ? undefined : client.mailbox?.uidValidity
  const text = String(value ?? '')
  if (!/^\d+$/.test(text)) throw new Error('Mail server did not provide a valid UIDVALIDITY')
  return text
}

function collectAttachmentParts(node, output = []) {
  if (node === null || typeof node !== 'object') return output
  const filename = node.dispositionParameters?.filename ?? node.parameters?.name
  const isAttachment = node.disposition === 'attachment' || (typeof filename === 'string' && filename !== '')
  if (isAttachment && node.part !== undefined) {
    output.push({
      part: String(node.part),
      filename: sanitizeFilename(filename, `part-${String(node.part)}.bin`),
      contentType: typeof node.type === 'string' ? node.type : 'application/octet-stream',
      size: Number.isFinite(node.size) && node.size >= 0 ? Number(node.size) : 0,
    })
  }
  for (const child of Array.isArray(node.childNodes) ? node.childNodes : []) collectAttachmentParts(child, output)
  return output
}

function hasAttachment(node) {
  return collectAttachmentParts(node).length > 0
}

function listedMessage(message, folder, validity) {
  return {
    handle: messageHandle({ folder, uidValidity: validity, uid: message.uid }),
    receivedAt: dateIso(message.internalDate ?? message.envelope?.date),
    from: addressList(message.envelope?.from),
    to: addressList(message.envelope?.to),
    subject: String(message.envelope?.subject ?? ''),
    unread: message.flags?.has('\\Seen') !== true,
    hasAttachments: hasAttachment(message.bodyStructure),
    size: Number.isFinite(message.size) ? Number(message.size) : 0,
  }
}

function parseDate(value, endInclusive = false) {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > 64) throw new Error('Invalid date filter')
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const parsed = new Date(day ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid date filter')
  return endInclusive && day ? new Date(parsed.getTime() + 86_400_000) : parsed
}

function stripHtml(html) {
  return String(html)
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote|ul|ol|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

async function parsedMessage(source, maxBodyChars) {
  const parsed = await simpleParser(source, { skipTextToHtml: true })
  const rawText = parsed.text?.trim() ? parsed.text : (typeof parsed.html === 'string' ? stripHtml(parsed.html) : '')
  const body = truncateText(rawText, maxBodyChars)
  return {
    parsed,
    body,
    fields: {
      messageId: String(parsed.messageId ?? ''),
      receivedAt: dateIso(parsed.date),
      from: addressList(parsed.from),
      to: addressList(parsed.to),
      cc: addressList(parsed.cc),
      subject: String(parsed.subject ?? ''),
    },
  }
}

async function collectStream(stream, maxBytes, signal) {
  const chunks = []
  let size = 0
  for await (const chunk of stream) {
    if (signal?.aborted) throw signal.reason ?? new Error('Mail operation cancelled')
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error(`Attachment exceeds the ${maxBytes} byte limit`)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, size)
}

function createImap(settings, password) {
  return new ImapFlow({
    host: settings.imapHost.trim(),
    port: settings.imapPort,
    secure: settings.imapTls === 'implicit',
    doSTARTTLS: settings.imapTls === 'starttls',
    auth: { user: (settings.username || settings.email).trim(), pass: password },
    logger: false,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  })
}

async function withConnection(settings, password, signal, operation) {
  const client = createImap(settings, password)
  const abort = () => { try { client.close() } catch {} }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    if (signal?.aborted) throw signal.reason ?? new Error('Mail operation cancelled')
    await client.connect()
    return await operation(client)
  } finally {
    signal?.removeEventListener('abort', abort)
    try {
      if (client.usable) await client.logout()
      else client.close()
    } catch { try { client.close() } catch {} }
  }
}

async function withMailbox(settings, password, folder, signal, operation) {
  return withConnection(settings, password, signal, async (client) => {
    let lock
    try {
      lock = await client.getMailboxLock(folder, { readOnly: true })
      return await operation(client, uidValidity(client))
    } finally {
      try { lock?.release() } catch {}
    }
  })
}

function ensureHandleMailbox(client, parsed) {
  const current = uidValidity(client)
  if (current !== parsed.uidValidity) {
    throw new Error('Message handle is stale because the mailbox UIDVALIDITY changed. Run mail_find again.')
  }
}

async function fetchMetadata(client, uid) {
  const message = await client.fetchOne(uid, {
    uid: true, envelope: true, flags: true, size: true, bodyStructure: true, internalDate: true,
  }, { uid: true })
  if (message === false) throw new Error('Message no longer exists. Run mail_find again.')
  return message
}

function listedFolder(folder) {
  const flags = folder?.flags instanceof Set ? folder.flags : new Set()
  return {
    path: String(folder?.path ?? ''),
    name: String(folder?.name ?? folder?.path ?? ''),
    delimiter: String(folder?.delimiter ?? ''),
    specialUse: String(folder?.specialUse ?? ''),
    subscribed: folder?.subscribed !== false,
    selectable: !flags.has('\\Noselect'),
  }
}

export async function listMailFolders(settings, password, signal) {
  return withConnection(settings, password, signal, async (client) => {
    const listed = (await client.list()).map(listedFolder)
      .filter(folder => folder.path !== '')
      .sort((a, b) => Number(b.specialUse !== '') - Number(a.specialUse !== '') || a.path.localeCompare(b.path))
    const limit = 200
    return { folders: listed.slice(0, limit), truncated: listed.length > limit }
  })
}

function normalizeSearchArgs(settings, args) {
  const limit = Number.isSafeInteger(args.limit) ? Math.min(50, Math.max(1, args.limit)) : 20
  if (args.cursor !== undefined && args.cursor !== '') {
    if (typeof args.cursor !== 'string' || args.cursor.length > 4096) throw new Error('Invalid search cursor')
    const conflicting = ['query', 'folder', 'unreadOnly', 'since', 'until', 'order'].filter(key => args[key] !== undefined)
    if (conflicting.length > 0) throw new Error('A search cursor must be used without query, folder, unreadOnly, since, until, or order; only limit may change')
    const cursor = parseSearchCursor(args.cursor)
    const since = cursor.since === '' ? undefined : parseDate(cursor.since)
    const before = cursor.before === '' ? undefined : parseDate(cursor.before)
    return { ...cursor, since, before, limit }
  }

  const folder = typeof args.folder === 'string' && args.folder.trim() !== '' ? args.folder.trim() : settings.inboxFolder
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (query.length > 256) throw new Error('query must be at most 256 characters')
  const since = parseDate(args.since)
  const before = parseDate(args.until, true)
  if (since !== undefined && before !== undefined && since.getTime() >= before.getTime()) {
    throw new Error('Invalid date range: since must be earlier than until')
  }
  const order = args.order === undefined ? 'newest' : args.order
  if (!['newest', 'oldest'].includes(order)) throw new Error('order must be newest or oldest')
  return {
    folder, query, since, before, unreadOnly: args.unreadOnly === true, order, boundary: undefined,
    uidValidity: undefined, limit,
  }
}

function selectUidPage(uids, { order, boundary, limit }) {
  const sorted = [...new Set(uids.filter(uid => Number.isSafeInteger(uid) && uid > 0))]
    .sort(order === 'oldest' ? (a, b) => a - b : (a, b) => b - a)
  const eligible = boundary === undefined
    ? sorted
    : sorted.filter(uid => order === 'oldest' ? uid > boundary : uid < boundary)
  const selected = eligible.slice(0, limit)
  return { selected, hasMore: eligible.length > selected.length }
}

export async function findMail(settings, password, args, signal) {
  const search = normalizeSearchArgs(settings, args)
  const { folder, query, since, before, unreadOnly, order, boundary, limit } = search
  const dateRange = {}
  if (since !== undefined) dateRange.since = since
  if (before !== undefined) dateRange.before = before
  if (unreadOnly) dateRange.unseen = true

  return withMailbox(settings, password, folder, signal, async (client, validity) => {
    if (search.uidValidity !== undefined && search.uidValidity !== validity) {
      throw new Error('Search cursor is stale because the mailbox UIDVALIDITY changed. Start mail_find again without a cursor.')
    }
    let uids
    if (query === '') {
      const result = await client.search({ all: true, ...dateRange }, { uid: true })
      uids = result === false ? [] : result
    } else {
      const found = await Promise.all([
        client.search({ subject: query, ...dateRange }, { uid: true }),
        client.search({ from: query, ...dateRange }, { uid: true }),
        client.search({ to: query, ...dateRange }, { uid: true }),
        client.search({ cc: query, ...dateRange }, { uid: true }),
      ])
      uids = [...new Set(found.flatMap(result => result === false ? [] : result))]
    }
    const page = selectUidPage(uids, { order, boundary, limit })
    const continuation = page.hasMore && page.selected.length > 0
      ? searchCursor({
          folder, uidValidity: validity, boundary: page.selected.at(-1), query,
          since: since?.toISOString() ?? '', before: before?.toISOString() ?? '', unreadOnly, order,
        })
      : undefined
    if (page.selected.length === 0) {
      return { folder, order, matched: uids.length, returned: 0, hasMore: false, messages: [] }
    }
    const fetched = await client.fetchAll(page.selected, {
      uid: true, envelope: true, flags: true, size: true, bodyStructure: true, internalDate: true,
    }, { uid: true })
    const position = new Map(page.selected.map((uid, index) => [uid, index]))
    const messages = fetched.sort((a, b) => (position.get(a.uid) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.uid) ?? Number.MAX_SAFE_INTEGER))
    return {
      folder, order,
      matched: uids.length,
      returned: messages.length,
      hasMore: page.hasMore,
      ...(continuation === undefined ? {} : { nextCursor: continuation }),
      messages: messages.map(message => listedMessage(message, folder, validity)),
    }
  })
}

export async function readMail(settings, password, handle, signal) {
  const parsedHandle = parseMessageHandle(handle)
  return withMailbox(settings, password, parsedHandle.folder, signal, async (client) => {
    ensureHandleMailbox(client, parsedHandle)
    const metadata = await fetchMetadata(client, parsedHandle.uid)
    if (Number(metadata.size ?? 0) > settings.maxMessageBytes) {
      throw new Error(`Message is larger than the configured ${settings.maxMessageBytes} byte safety limit`)
    }
    const sourceResult = await client.fetchOne(parsedHandle.uid, { source: true }, { uid: true })
    if (sourceResult === false || sourceResult.source === undefined) throw new Error('Message no longer exists. Run mail_find again.')
    const parsed = await parsedMessage(sourceResult.source, settings.maxBodyChars)
    const attachments = collectAttachmentParts(metadata.bodyStructure).map(part => ({
      handle: attachmentHandle({ message: handle, ...part }),
      filename: part.filename,
      contentType: part.contentType,
      size: part.size,
    }))
    return {
      handle,
      ...parsed.fields,
      untrustedText: parsed.body.text,
      truncated: parsed.body.truncated,
      attachments,
    }
  })
}

export async function downloadAttachment(settings, password, handle, signal) {
  const attachment = parseAttachmentHandle(handle)
  const message = parseMessageHandle(attachment.message)
  return withMailbox(settings, password, message.folder, signal, async (client) => {
    ensureHandleMailbox(client, message)
    const metadata = await fetchMetadata(client, message.uid)
    const part = collectAttachmentParts(metadata.bodyStructure).find(candidate => candidate.part === attachment.part)
    if (part === undefined) throw new Error('Attachment no longer exists. Read the message again.')
    if (part.size > settings.maxAttachmentBytes || attachment.size > settings.maxAttachmentBytes) {
      throw new Error(`Attachment exceeds the configured ${settings.maxAttachmentBytes} byte limit`)
    }
    const download = await client.download(message.uid, part.part, { uid: true, maxBytes: settings.maxAttachmentBytes })
    const bytes = await collectStream(download.content, settings.maxAttachmentBytes, signal)
    return {
      bytes,
      filename: sanitizeFilename(download.meta?.filename ?? part.filename),
      contentType: String(download.meta?.contentType ?? part.contentType),
    }
  })
}

export async function replyHeaders(settings, password, handle, signal) {
  const message = await readMail(settings, password, handle, signal)
  return {
    inReplyTo: message.messageId || undefined,
    references: message.messageId ? [message.messageId] : undefined,
  }
}

function outboundMessageId(settings) {
  const domain = settings.email.includes('@') ? settings.email.slice(settings.email.lastIndexOf('@') + 1).replace(/[^A-Za-z0-9.-]/g, '') : 'localhost'
  return `<${randomUUID()}@${domain || 'localhost'}>`
}

function deliveryMayBeUnknown(error) {
  const command = String(error?.command ?? '').toUpperCase()
  const code = String(error?.code ?? '').toUpperCase()
  return command === 'DATA' && ['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNRESET'].includes(code)
}

export async function sendMail(settings, password, message, signal) {
  const transporter = nodemailer.createTransport({
    host: settings.smtpHost.trim(),
    port: settings.smtpPort,
    secure: settings.smtpTls === 'implicit',
    requireTLS: settings.smtpTls === 'starttls',
    auth: { user: (settings.username || settings.email).trim(), pass: password },
    tls: { rejectUnauthorized: true },
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  })
  const messageId = outboundMessageId(settings)
  const abort = () => { try { transporter.close() } catch {} }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const info = await transporter.sendMail({
      from: settings.fromName.trim() === ''
        ? validateAddress(settings.email, 'sender address')
        : { name: settings.fromName.trim(), address: validateAddress(settings.email, 'sender address') },
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      subject: message.subject,
      text: message.text,
      messageId,
      inReplyTo: message.inReplyTo,
      references: message.references,
      attachments: message.attachments,
    })
    return {
      status: 'sent',
      messageId: String(info.messageId || messageId),
      accepted: (info.accepted ?? []).map(String),
      rejected: (info.rejected ?? []).map(String),
    }
  } catch (error) {
    if (deliveryMayBeUnknown(error)) {
      return {
        status: 'unknown',
        messageId,
        accepted: [],
        rejected: [],
      }
    }
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
    transporter.close()
  }
}

export const internals = Object.freeze({
  addressList,
  collectAttachmentParts,
  parseDate,
  listedFolder,
  normalizeSearchArgs,
  selectUidPage,
  deliveryMayBeUnknown,
})
