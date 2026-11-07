import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

const tokenPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u
const routeLimit = 200
const routeAge = 7 * 24 * 60 * 60 * 1000
const xml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const validText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max
  && value.isWellFormed() && !/[\u0000-\u001f\u007f]/u.test(value)

export function windowsToastCLSID(appId) {
  const bytes = createHash('sha256').update('EduWork Windows Toast\0' + appId).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex').toUpperCase()
  return '{' + [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-') + '}'
}

export function createWindowsToasts({ Notification, file, productName, activate, failed, now = Date.now }) {
  let routes = new Map()
  const live = new Map()
  try {
    const info = lstatSync(file)
    if (!info.isFile() || info.size > 512 * 1024) throw Error('Invalid Toast activation store')
    const rows = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(rows) || rows.length > routeLimit) throw Error('Invalid Toast activation records')
    for (const row of rows) {
      if (tokenPattern.test(row?.id ?? '') && validText(row.key, 600)
        && (row.sessionId === undefined || validText(row.sessionId, 256))
        && Number.isSafeInteger(row.expires) && row.expires > now()) routes.set(row.id, row)
    }
  } catch (error) { if (error.code !== 'ENOENT') failed() }
  const save = next => {
    const temporary = file + '.' + randomUUID() + '.tmp'
    try {
      writeFileSync(temporary, JSON.stringify([...next.values()]) + '\n', { flag: 'wx', mode: 0o600 })
      renameSync(temporary, file)
      routes = next
    } finally { rmSync(temporary, { force: true }) }
  }
  const take = id => {
    const route = routes.get(id)
    if (!route) return
    const next = new Map(routes); next.delete(id)
    try { save(next) } catch { routes.delete(id); failed() }
    live.delete(id)
    if (route.expires > now()) activate({ key: route.key, sessionId: route.sessionId })
  }
  Notification.handleActivation(details => {
    const prefix = 'eduwork-toast='
    if (details.type !== 'click' || typeof details.arguments !== 'string' || !details.arguments.startsWith(prefix)) return
    const id = details.arguments.slice(prefix.length)
    if (tokenPattern.test(id)) take(id)
  })
  // Electron creates its COM activator when the presenter is first initialized.
  const supported = Notification.isSupported()
  return {
    publish({ title, content, sound, key, sessionId }) {
      if (!supported) { failed(); return false }
      const id = randomUUID(), next = new Map([...routes].filter(([, row]) => row.expires > now()))
      while (next.size >= routeLimit) next.delete(next.keys().next().value)
      next.set(id, { id, key, sessionId, expires: now() + routeAge })
      save(next)
      for (const [previous, notification] of live) if (!next.has(previous)) {
        live.delete(previous); notification.close()
      }
      const toastXml = `<toast launch="eduwork-toast=${id}"><visual><binding template="ToastGeneric"><text>${xml(productName + ' · ' + title)}</text><text>${xml(content)}</text></binding></visual>${sound ? '' : '<audio silent="true"/>'}</toast>`
      const notification = new Notification({ id, toastXml })
      live.set(id, notification)
      // Windows can deliver both the in-process event and COM activation.
      notification.on('click', () => take(id))
      notification.on('close', () => live.delete(id))
      notification.on('failed', () => { live.delete(id); failed() })
      notification.show()
    },
    dismiss(key) {
      const next = new Map(routes)
      for (const [id, row] of routes) if (key === undefined || row.key === key) {
        next.delete(id)
        live.get(id)?.close()
        live.delete(id)
      }
      if (next.size !== routes.size) {
        try { save(next) } catch { routes = next; failed() }
      }
    },
  }
}
