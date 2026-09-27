import { chromium } from 'playwright-core'

export async function desktopBrowser(ctx, mode = 'background', signal, purpose = 'managed', owner) {
  if (process.env.EDUWORK_EXPERIMENTAL_ELECTRON_BROWSER !== '1') return null
  const service = ctx.get('desktopServices', false)
  if (!service?.browserConnection) return null
  const connection = await service.browserConnection(signal)
  if (!connection) return null
  const url = new URL(connection.baseURL)
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || !/^[A-Za-z0-9_-]{43}$/u.test(connection.token)) throw Error('Invalid desktop browser endpoint')
  signal?.throwIfAborted()
  const browser = await chromium.connectOverCDP(`${url.origin}/${purpose}?mode=${mode}${owner ? '&owner=' + encodeURIComponent(owner) : ''}`, { headers: { authorization: 'Bearer ' + connection.token }, timeout: 15000 })
  if (signal?.aborted) { await browser.close(); signal.throwIfAborted() }
  return browser
}
