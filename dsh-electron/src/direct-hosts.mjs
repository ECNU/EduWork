import { readFileSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'

const PROXY = ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']
const HOST = /^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/i
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/**
 * Hosts the publisher must reach directly (e.g. campus-only gateways), and an
 * optional probe that confirms a direct connection really has the required
 * network identity, from the publisher's configuration policy.
 */
export function readDirectRouting(policyFile, read = readFileSync) {
  let policy
  try { policy = JSON.parse(read(policyFile, 'utf8')) } catch { return { hosts: [] } }
  const hosts = Array.isArray(policy.directHosts) ? policy.directHosts.filter(host => typeof host === 'string' && HOST.test(host)) : []
  const probe = policy.directProbe
  if (!probe || typeof probe.url !== 'string' || !FIELD.test(probe.field ?? '')) return { hosts }
  try {
    const url = new URL(probe.url)
    if (url.protocol !== 'https:' || url.username || url.password) return { hosts }
    return { hosts, probe: { url: url.href, field: probe.field } }
  } catch { return { hosts } }
}

/** Ask the probe without any proxy. Only an explicit confirmation counts. */
export function probeDirect(probe, { timeoutMs = 1500, request = httpsRequest } = {}) {
  if (!probe) return Promise.resolve(undefined)
  return new Promise(resolve => {
    let settled = false
    const done = value => { if (!settled) { settled = true; resolve(value) } }
    try {
      const req = request(probe.url, { method: 'GET', agent: false, timeout: timeoutMs, headers: { accept: 'application/json', 'cache-control': 'no-store' } }, response => {
        if (response.statusCode !== 200) { response.resume(); done(false); return }
        let body = ''
        response.setEncoding('utf8')
        response.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy() })
        response.on('end', () => {
          try { const value = JSON.parse(body)?.[probe.field]; done(value === 1 || value === true) } catch { done(false) }
        })
        response.on('error', () => done(false))
      })
      req.on('timeout', () => req.destroy())
      req.on('error', () => done(false))
      req.end()
    } catch { done(false) }
  })
}

/** First HTTP(S) proxy in a Chromium proxy decision ("PROXY h:p; DIRECT"); SOCKS and DIRECT give none. */
export function proxyFromDecision(decision) {
  const first = String(decision ?? '').split(';')[0].trim()
  const match = /^(PROXY|HTTPS)\s+([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\]):(\d{1,5})$/.exec(first)
  if (!match || Number(match[3]) > 65535) return undefined
  return `${match[1] === 'HTTPS' ? 'https' : 'http'}://${match[2]}:${match[3]}`
}

/**
 * The renderer follows the system proxy while the Host only reads proxy
 * variables, so a system-only proxy (for example a campus tunnel in HTTP mode)
 * left model requests on a different path than the network indicator. Give the
 * Host the system proxy when it has none of its own. Publisher hosts then skip
 * the proxy only when a direct connection is confirmed (`direct === true`); a
 * policy without a probe keeps the earlier unconditional behaviour.
 */
export function routeHostEnvironment(environment, { hosts = [], probe, direct, systemProxy } = {}) {
  let next = environment
  if (systemProxy && !PROXY.some(name => next[name])) {
    next = { ...next, http_proxy: systemProxy, https_proxy: systemProxy, HTTP_PROXY: systemProxy, HTTPS_PROXY: systemProxy }
  }
  if (hosts.length === 0 || !PROXY.some(name => next[name])) return next
  if (probe && direct !== true) return next
  const existing = (next.NO_PROXY ?? next.no_proxy ?? '').split(',').map(item => item.trim()).filter(Boolean)
  const merged = [...new Set([...existing, ...hosts])].join(',')
  return { ...next, NO_PROXY: merged, no_proxy: merged }
}
