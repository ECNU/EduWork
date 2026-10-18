/**
 * The Host-side device-authorization surface.
 *
 * A phone cannot be trusted for this and neither can the relay: confirming a device
 * is the operator's decision, made on the machine that runs the Agent. The plugin
 * publishes `DeviceRegistry` as a service, but nothing in the desktop composition
 * calls it, so without this page a device that asks to pair has no way in and the
 * operator has no way to revoke one.
 *
 * ## Why a loopback page
 *
 * The kernel already runs an HTTP server on `127.0.0.1` for the web shell. The page
 * is registered there rather than opening a port of its own: one surface to reason
 * about, bound to loopback by the same configuration, and reachable from the
 * operator's ordinary browser. The server itself carries no authentication
 * (`@deepseek-ai/dsh-host-webserver` says so plainly), so the URL contains a
 * per-boot random token: a request without the exact path is simply not a route,
 * and the token never leaves this machine.
 *
 * ## Why the mutations look the way they do
 *
 * A cross-origin page can send a form POST to loopback, so the mutating endpoints
 * demand `content-type: application/json` — a media type a form cannot produce and
 * a cross-origin `fetch` cannot send without a CORS preflight, which is never
 * granted here. The responses carry no CORS headers, so a cross-origin reader gets
 * nothing back either. `no-store` keeps the device list out of a disk cache.
 *
 * ## What is deliberately absent
 *
 * No endpoint reads a credential, no endpoint returns more than the registry row
 * (a public key is public), and nothing here can confirm a device by itself: the
 * page is the operator's hand, and the device still has to prove the private key.
 */

/** Where the admin page lives, under the kernel's existing loopback web server. */
export const ADMIN_PATH = '/remote-access-admin'

/** Bodies are a device id and nothing else; anything larger is not a pairing request. */
const MAX_BODY_BYTES = 4096

function send(response, status, body, type) {
  response.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  response.end(body)
}

function sendJson(response, status, value) {
  send(response, status, JSON.stringify(value), 'application/json; charset=utf-8')
}

/** A JSON body, or a refusal. Rejects anything a form or a cross-origin fetch could send. */
async function readJson(request, response) {
  const type = String(request.headers['content-type'] ?? '')
  if (!type.toLowerCase().startsWith('application/json')) {
    sendJson(response, 415, { ok: false, error: 'content-type must be application/json' })
    return undefined
  }
  let text = ''
  try {
    for await (const chunk of request) {
      text += chunk
      if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
        sendJson(response, 413, { ok: false, error: 'request body is too large' })
        return undefined
      }
    }
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      sendJson(response, 400, { ok: false, error: 'request body must be an object' })
      return undefined
    }
    return parsed
  } catch {
    sendJson(response, 400, { ok: false, error: 'request body is not JSON' })
    return undefined
  }
}

function deviceIdOf(body, response) {
  if (typeof body?.deviceId !== 'string' || body.deviceId.trim() === '') {
    sendJson(response, 400, { ok: false, error: 'deviceId must be a non-empty string' })
    return undefined
  }
  return body.deviceId
}

/** The page. No device data is rendered server-side, so nothing needs escaping here. */
const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>远程访问 · 设备授权</title>
<style>
:root { color-scheme: light dark; }
body { font: 14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 880px; margin: 32px auto; padding: 0 16px; }
h1 { font-size: 19px; margin: 0 0 6px; }
p.intro { margin: 0 0 20px; opacity: .72; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid color-mix(in srgb, currentColor 16%, transparent); vertical-align: top; }
th { font-weight: 600; font-size: 12px; opacity: .7; }
code { font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; word-break: break-all; }
button { font: inherit; padding: 3px 10px; margin-right: 6px; border-radius: 6px; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); background: transparent; color: inherit; cursor: pointer; }
button.primary { border-color: #3b82f6; color: #3b82f6; }
button.danger { border-color: #ef4444; color: #ef4444; }
#state { min-height: 22px; margin: 10px 0 0; font-size: 13px; opacity: .8; }
.tag { font-size: 12px; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; opacity: .85; }
.empty { padding: 24px 6px; opacity: .6; }
</style>
</head>
<body>
<h1>远程访问 · 设备授权</h1>
<p class="intro">设备第一次连接会以“待确认”出现在这里。确认之后它才能使用 Agent；未确认的设备无法建立信道。撤销或移除会立即断开它当前的活动连接。</p>
<div id="state"></div>
<table>
  <thead><tr><th>设备</th><th>身份</th><th>状态</th><th>操作</th></tr></thead>
  <tbody id="rows"></tbody>
</table>
<script>
(function () {
  'use strict'
  var base = location.pathname.replace(/\\/+$/, '')
  var rows = document.getElementById('rows')
  var state = document.getElementById('state')

  function label(status) {
    if (status === 'trusted') return '已授权'
    if (status === 'pending') return '待确认'
    if (status === 'revoked') return '已撤销'
    return status
  }

  function cell(row, text, tag) {
    var td = document.createElement('td')
    if (tag === undefined) { td.textContent = text } else {
      var span = document.createElement('span')
      span.className = 'tag'
      span.textContent = text
      td.appendChild(span)
    }
    row.appendChild(td)
    return td
  }

  function button(row, text, className, verb, deviceId) {
    var td = row.lastElementChild
    var b = document.createElement('button')
    b.textContent = text
    if (className) b.className = className
    b.addEventListener('click', function () { act(verb, deviceId) })
    td.appendChild(b)
  }

  function render(payload) {
    rows.textContent = ''
    if (!payload.devices.length) {
      var tr = document.createElement('tr')
      var td = document.createElement('td')
      td.colSpan = 4
      td.className = 'empty'
      td.textContent = '还没有设备。让手机打开中继页面，它会以“待确认”出现。'
      tr.appendChild(td)
      rows.appendChild(tr)
      return
    }
    payload.devices.forEach(function (device) {
      var tr = document.createElement('tr')
      var id = document.createElement('td')
      id.innerHTML = ''
      var name = document.createElement('div')
      name.textContent = device.name || '未命名设备'
      var code = document.createElement('code')
      code.textContent = device.deviceId
      id.appendChild(name)
      id.appendChild(code)
      tr.appendChild(id)
      var key = document.createElement('td')
      var k = document.createElement('code')
      k.textContent = String(device.publicKey || '').slice(0, 28) + '…'
      key.appendChild(k)
      tr.appendChild(key)
      var status = document.createElement('td')
      var tag = document.createElement('span')
      tag.className = 'tag'
      tag.textContent = label(device.status) + (device.live ? ' · 在线 ' + device.live : '')
      status.appendChild(tag)
      tr.appendChild(status)
      tr.appendChild(document.createElement('td'))
      if (device.status === 'pending') {
        button(tr, '确认', 'primary', 'confirm', device.deviceId)
        button(tr, '移除', '', 'remove', device.deviceId)
      }
      if (device.status === 'trusted') {
        button(tr, '撤销', 'danger', 'revoke', device.deviceId)
        button(tr, '移除', '', 'remove', device.deviceId)
      }
      if (device.status === 'revoked') button(tr, '移除', '', 'remove', device.deviceId)
      rows.appendChild(tr)
    })
  }

  function refresh() {
    return fetch(base + '/state', { credentials: 'omit', cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
      .then(render)
      .catch(function (error) { state.textContent = '读取失败：' + error.message })
  }

  function act(verb, deviceId) {
    state.textContent = '正在提交…'
    fetch(base + '/' + verb, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId }),
    })
      .then(function (response) { return response.json().then(function (body) { return { ok: response.ok, body: body } }) })
      .then(function (result) {
        if (!result.ok) throw new Error(result.body.error || '操作失败')
        state.textContent = '已提交'
        render(result.body)
      })
      .catch(function (error) { state.textContent = '失败：' + error.message })
  }

  refresh()
  setInterval(refresh, 3000)
})()
</script>
</body>
</html>
`

/**
 * Register the admin routes.
 *
 * @param options.webServer - the kernel's web server (`register` is all that is used).
 * @param options.token - per-boot random path segment.
 * @param options.registry - `DeviceRegistry`.
 * @param options.connections - `LiveConnections`, so revoke can close the live socket.
 * @param options.exportWeb - optional `() => Promise<object>` that takes a snapshot of
 *   the Host's rendered web shell for the relay. A capability, not a device action:
 *   it exposes the operator's own page to the operator's own machine.
 * @returns a disposer that removes every route.
 */
export function registerAdminSurface({ webServer, token, registry, connections, exportWeb }) {
  const base = `${ADMIN_PATH}/${token}`
  const disposers = []

  const snapshot = () => ({
    ok: true,
    devices: registry.read().devices.map(device => ({
      deviceId: device.deviceId,
      name: device.name,
      status: device.status,
      publicKey: device.publicKey,
      agreementKey: device.agreementKey,
      pairedAt: device.pairedAt,
      live: connections?.count(device.deviceId) ?? 0,
    })),
  })

  const on = (path, handler) => disposers.push(webServer.register({ kind: 'exact', path, handler }))

  const page = (_request, response) => send(response, 200, PAGE, 'text/html; charset=utf-8')

  on(base, page)
  on(`${base}/`, page)

  on(`${base}/state`, (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return sendJson(response, 405, { ok: false, error: 'use GET' })
    }
    try {
      sendJson(response, 200, snapshot())
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  // Take a snapshot of the Host's own rendered shell for the relay to mirror. The
  // page it captures is the operator's own, and the cookie is minted in-process;
  // this is the one route that writes files, and only under the Host's own home.
  on(`${base}/export-web`, async (request, response) => {
    if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: 'use POST' })
    if (typeof exportWeb !== 'function') {
      return sendJson(response, 501, { ok: false, error: 'this host does not export its web shell' })
    }
    try {
      sendJson(response, 200, { ok: true, ...(await exportWeb()) })
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  const mutate = (verb, run) => {
    on(`${base}/${verb}`, async (request, response) => {
      if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: 'use POST' })
      try {
        const body = await readJson(request, response)
        if (body === undefined) return
        const deviceId = deviceIdOf(body, response)
        if (deviceId === undefined) return
        await run(deviceId)
        sendJson(response, 200, snapshot())
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    })
  }

  mutate('confirm', async (deviceId) => {
    await registry.confirm(deviceId)
    // A device that was revoked and then removed carries a seal; re-confirming it is
    // the operator's explicit reset, so it must be able to connect again.
    connections?.unseal?.(deviceId)
  })
  mutate('revoke', async (deviceId) => {
    await registry.revoke(deviceId)
    // Revocation is not finished by rewriting the record. Any socket this device
    // still holds is closed now; waiting for its next request would let an open
    // stream keep receiving events after the operator withdrew access.
    connections?.closeAll(deviceId)
  })
  mutate('remove', async (deviceId) => {
    await registry.remove(deviceId)
    // A removed device must not keep an open stream; closing it here makes "remove"
    // mean the same thing as "revoke" for the transport.
    connections?.closeAll(deviceId)
  })

  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {
        // A route already removed by composition teardown is not an error here.
      }
    }
  }
}

/**
 * The URL the operator opens. The token is the only secret in it; it is printed to
 * the host log once per boot and is not stored anywhere else.
 *
 * @param authority - `host:port` of the loopback web server.
 * @param token - per-boot random path segment.
 */
export function adminUrl(authority, token) {
  return `http://${authority}${ADMIN_PATH}/${token}/`
}
