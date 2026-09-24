// Pinned, real Web Host qualification. Only synthetic data and a fresh home.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { writeNativeProfile } from '../dsh-host/native-profile.mjs'

const { values } = parseArgs({ options: { runtime: { type: 'string' }, host: { type: 'string' }, output: { type: 'string' } } })
if (!values.runtime || !values.host || !values.output) throw new Error('Use --runtime <candidate> --host <prepared native Host> --output <new directory>')
const runtime = resolve(values.runtime), hostRoot = resolve(values.host), output = resolve(values.output)
const receipt = JSON.parse(await readFile(join(hostRoot, 'receipt.json'), 'utf8'))
assert.equal(receipt.upstreamCommit, '46a7f68b0922371ce7144b668b90e377d8e799f4')
assert.equal(receipt.protocolVersion, 4)
await mkdir(output)
await symlink(join(runtime, 'node_modules'), join(hostRoot, 'desktop-host/node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const { DesktopHostProcess } = await import(pathToFileURL(join(hostRoot, 'host-process.mjs')).href)
const { authenticateWebHost, forwardWebRequest } = await import(pathToFileURL(join(hostRoot, 'web-document.mjs')).href)
const home = join(output, 'home'), profile = join(home, 'profiles', 'synthetic-desktop')
await mkdir(profile, { recursive: true })
const fixture = join(output, 'http-fixture.mjs')
await writeFile(fixture, `
export const inject = ['connection'];
export function apply(ctx) {
  let cancelled = 0;
  ctx.on('connection/request', async (request, response, next) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/api/__probe/ping') { response.end(JSON.stringify({ cancelled })); return; }
    if (path === '/api/__probe/media') {
      const bytes = Buffer.from('0123456789');
      response.setHeader('accept-ranges', 'bytes');
      response.setHeader('content-type', 'application/octet-stream');
      if (request.headers.range === 'bytes=2-5') { response.statusCode = 206; response.setHeader('content-range', 'bytes 2-5/10'); response.end(request.method === 'HEAD' ? undefined : bytes.subarray(2, 6)); }
      else { response.setHeader('content-length', bytes.length); response.end(request.method === 'HEAD' ? undefined : bytes); }
      return;
    }
    if (path === '/api/__probe/stream') {
      response.setHeader('content-type', 'application/octet-stream');
      const timer = setInterval(() => response.write(Buffer.alloc(16384, 65)), 10);
      response.once('close', () => { clearInterval(timer); cancelled++; });
      return;
    }
    return next();
  });
}
`)
await writeNativeProfile({ profile, bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], patches: [
  ...['session-log-deepseek', 'deepseek-account', 'account-controller', 'ui-settings-account', 'plugin-package-inventory-deepseek'].map(id => ({ id, disabled: true })),
  { insert: [{ id: 'synthetic-http', name: pathToFileURL(fixture).href }] },
] })
const logs = []
const host = new DesktopHostProcess(process.execPath, runtime, profile, undefined, { ...process.env,
  DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, undefined, undefined, undefined, undefined,
  { hostEntry: join(hostRoot, 'desktop-host/lib/index.js'), bootstrap: {}, onLog: text => logs.push(text) })
const report = { success: false, version: '0.1.7-rc.1', protocol: 4, scope: 'real Host, authenticated HTTP, synthetic media' }
try {
  const ready = await host.start()
  const origin = new URL(ready.url).origin
  assert.equal(new URL(origin).hostname, '127.0.0.1')
  const cookie = await authenticateWebHost(ready.url)
  const request = (path, options = {}) => forwardWebRequest(new Request('dsh-app://app' + path, options), origin, cookie)
  const unauthenticated = await fetch(origin + '/api/__probe/ping')
  assert.notEqual(unauthenticated.status, 200); await unauthenticated.body?.cancel()
  const denied = await request('/api/__probe/ping', { headers: { origin: 'https://untrusted.invalid' } })
  assert.equal(denied.status, 403)
  const range = await request('/api/__probe/media', { headers: { range: 'bytes=2-5' } })
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 2-5/10')
  assert.equal(await range.text(), '2345'); assert.equal(range.headers.get('set-cookie'), null)
  const head = await request('/api/__probe/media', { method: 'HEAD' })
  assert.equal(head.status, 200); assert.equal(await head.text(), '')
  const abort = new AbortController()
  const stream = await request('/api/__probe/stream', { signal: abort.signal })
  const reader = stream.body.getReader(); assert.equal((await reader.read()).value.byteLength > 0, true)
  // An unread stream must not hold up independent RPC/HTTP requests.
  const ping = await request('/api/__probe/ping', { signal: AbortSignal.timeout(5000) })
  assert.equal(ping.status, 200); await ping.body.cancel()
  abort.abort(); await reader.cancel().catch(() => {})
  let cancelled = false
  for (let attempt = 0; attempt < 50; attempt++) {
    const state = await (await request('/api/__probe/ping')).json()
    if (state.cancelled > 0) { cancelled = true; break }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.ok(cancelled, 'Cancelled stream continued running on the Host')
  assert.equal(await host.updateTasks('inspect'), false)
  assert.equal(await host.updateTasks('lock'), false)
  assert.equal((await request('/api/__probe/ping')).status, 503)
  await host.updateTasks('unlock')
  const resumed = await request('/api/__probe/ping'); assert.equal(resumed.status, 200); await resumed.body.cancel()
  await host.stop()
  assert.ok(logs.every(text => !/[?&]token=(?!\[redacted\])/.test(text)), 'Launch credential leaked to log callback')
  report.success = true
  report.verified = ['real-child-startup', 'loopback-authentication', 'foreign-origin-denied', 'byte-range', 'head',
    'concurrent-unread-stream', 'cancellation', 'update-admission-lock', 'clean-shutdown', 'redacted-launch-log']
} catch (error) { report.error = { message: error.message, diagnostic: error.diagnostic }; process.exitCode = 1 }
finally {
  await host.stop().catch(error => { report.shutdownError = error.message })
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await writeFile(join(output, 'host.log'), logs.join(''))
  console.log(JSON.stringify({ success: report.success, error: report.error?.message, verified: report.verified }))
}
