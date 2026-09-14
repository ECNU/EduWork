import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const runtime = resolve(process.env.CHATECNU_TEST_RUNTIME || join(root, 'dist/dsh-cache/runtime-source-development-015-alpha1-normalized'))
const sharedRuntime = resolve(process.env.CHATECNU_TEST_SHARED_RUNTIME || join(root, 'dist/eduwork-stages123-20260909/generic-final/d'))
const hooks = registerHooks({ resolve(specifier, context, next) {
  const base = specifier.startsWith('@deepseek-ai/') ? runtime : specifier.startsWith('@eduwork/') ? sharedRuntime : null
  return next(specifier, base ? { ...context, parentURL: pathToFileURL(join(base, 'package.json')).href } : context)
} })
const [{ Context, Service }, connectionPlugin, { LocalFileSystem }, { WebServer }, { default: Preview }] = await Promise.all([
  import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-client-connection'), import('@deepseek-ai/dsh-fs-local'),
  import('@deepseek-ai/dsh-host-webserver'), import('../lib/index.js'),
])
test.after(() => hooks.deregister())
const tick = () => new Promise(resolve => setImmediate(resolve))

async function host(t) {
  const directory = await mkdtemp(join(tmpdir(), 'eduwork-preview-host-'))
  const workspace = join(directory, '中文 workspace'), outside = join(directory, 'outside')
  await mkdir(workspace); await mkdir(outside)
  await writeFile(join(workspace, 'media.mp4'), '0123456789')
  await writeFile(join(workspace, 'notes.md'), '# same workspace file')
  await writeFile(join(outside, 'private.mp4'), 'outside-private')
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  class Sessions extends Service {
    constructor(ctx) { super(ctx, 'sessions') }
    get(id) { return id === 'session' ? { header: { cwd: workspace } } : undefined }
  }
  await ctx.plugin(Sessions)
  await ctx.plugin(LocalFileSystem, { cwd: workspace })
  return { ctx, workspace, outside }
}
async function nativeConnection(ctx) {
  return ctx.plugin(connectionCtx => {
    new connectionPlugin.HostConnectionService(connectionCtx, [], {})
  })
}

test('real Connection + scoped plugin streams without webServer and cleans routes on unload', async t => {
  const { ctx } = await host(t)
  await nativeConnection(ctx)
  const plugin = await ctx.plugin(Preview)
  await tick()
  assert.equal(ctx.get('webServer'), undefined)
  const service = ctx.artifactPreview
  const preview = await service.read('session', 'media.mp4')
  assert.equal(preview.encoding, 'url')
  assert.equal(preview.downloadUrl, preview.data + '&download=1')
  assert.match(preview.downloadUrl, /^\/api\/artifactPreview\/file\?token=[A-Za-z0-9_-]{32}&download=1$/)
  assert.doesNotMatch(preview.downloadUrl, /workspace|media\.mp4|credential|access_token/)
  const carrier = ctx.connection.createSharedFetchHandler('/api')
  const request = new Request(`dsh-app://app${preview.downloadUrl}`, { headers: { range: 'bytes=2-5' } })
  const response = await carrier.fetch(request)
  assert.equal(response.status, 206); assert.equal(await response.text(), '2345')
  assert.match(response.headers.get('content-disposition'), /^attachment;/)
  const embedded = await carrier.fetch(new Request(`dsh-app://app${preview.data}`))
  assert.match(embedded.headers.get('content-disposition'), /^inline;/)
  await embedded.body.cancel()
  assert.equal(carrier.requestBodyMode({ method: 'GET', url: new URL(request.url) }), 'buffered')
  const head = await carrier.fetch(new Request(request.url, { method: 'HEAD' }))
  assert.equal(head.status, 200); assert.equal(head.body, null)
  const file = await service.read('session', 'notes.md')
  assert.equal(file.data, '# same workspace file')
  assert.equal(await (await carrier.fetch(new Request(`dsh-app://app${file.downloadUrl}`))).text(), file.data)
  await plugin.dispose()
  assert.equal((await carrier.fetch(request)).status, 404)
  assert.equal(service.streams.size, 0)
})

test('workspace/realpath boundaries, expired tickets, and unknown tickets remain enforced', async t => {
  const { ctx, workspace, outside } = await host(t)
  await nativeConnection(ctx); await ctx.plugin(Preview); await tick()
  const service = ctx.artifactPreview
  await assert.rejects(service.read('missing-session', 'media.mp4'), /workspace is unavailable/)
  await assert.rejects(service.read('session', '../outside/private.mp4'), /inside the current workspace/)
  const alias = join(workspace, 'alias')
  await symlink(outside, alias, 'junction')
  await assert.rejects(service.read('session', 'alias/private.mp4'), /inside the current workspace/)
  await unlink(alias)
  // A valid ticket cannot be reused if its original file becomes a link outside.
  const nested = join(workspace, 'nested'); await mkdir(nested)
  await writeFile(join(nested, 'private.mp4'), 'inside')
  const before = await service.read('session', 'nested/private.mp4')
  await rm(nested, { recursive: true }); await symlink(outside, nested, 'junction')
  const denied = await service.fetchStream(new Request(`https://app${before.downloadUrl}`))
  assert.equal(denied.status, 404); assert.equal(await denied.text(), '')
  await unlink(nested)
  const valid = await service.read('session', 'media.mp4')
  const token = new URL(valid.downloadUrl, 'https://app').searchParams.get('token')
  service.streams.get(token).expiresAt = Date.now() - 1
  assert.equal((await service.fetchStream(new Request(`https://app${valid.downloadUrl}`))).status, 404)
  assert.equal((await service.fetchStream(new Request('https://app/api/artifactPreview/file?token=unknown'))).status, 404)
  const deniedMethod = await service.fetchStream(new Request(`https://app${valid.downloadUrl}`, { method: 'POST' }))
  assert.equal(deniedMethod.status, 405); assert.equal(deniedMethod.headers.get('allow'), 'GET, HEAD')
})

test('legacy HTTP works with no Fetch registry; transport attach/detach preserves old issued tickets', async t => {
  const { ctx } = await host(t)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(Preview); await tick()
  const service = ctx.artifactPreview, origin = `http://127.0.0.1:${ctx.webServer.port}`
  const legacy = await service.read('session', 'media.mp4')
  assert.match(legacy.downloadUrl, /^\/chatecnu-work\/artifacts\/[A-Za-z0-9_-]{32}\?download=1$/)
  const full = await fetch(`${origin}${legacy.downloadUrl}`)
  assert.equal(full.status, 200); assert.equal(await full.text(), '0123456789')
  assert.match(full.headers.get('content-disposition'), /^attachment;/)
  const range = await fetch(`${origin}${legacy.downloadUrl}`, { headers: { range: 'bytes=-3' } })
  assert.equal(range.status, 206); assert.equal(await range.text(), '789')
  const head = await fetch(`${origin}${legacy.downloadUrl}`, { method: 'HEAD' })
  assert.equal(head.status, 200); assert.equal(await head.text(), '')
  const fiber = await nativeConnection(ctx); await tick()
  assert.match((await service.read('session', 'media.mp4')).downloadUrl, /^\/api\//)
  assert.equal((await fetch(`${origin}${legacy.downloadUrl}`)).status, 200)
  await fiber.dispose(); await tick()
  assert.match((await service.read('session', 'media.mp4')).downloadUrl, /^\/chatecnu-work\//)
})

test('official HTTP Connection still applies browser authentication and Host/Origin checks', async t => {
  const { ctx } = await host(t)
  class Credentials extends Service {
    constructor(ctx) { super(ctx, 'credentials'); this.records = new Map() }
    async modifyRecord(key, modify) {
      const record = await modify(this.records.get(key)); this.records.set(key, record); return record
    }
  }
  await ctx.plugin(Credentials)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(connectionPlugin); await ctx.plugin(Preview); await tick()
  const origin = `http://127.0.0.1:${ctx.webServer.port}`
  ctx.webServer.register({ kind: 'exact', path: '/', handler: (req, res) => {
    if (ctx.connection.authorizeIndex(req, res)) { res.writeHead(200); res.end('fixture') }
  } })
  const preview = await ctx.artifactPreview.read('session', 'media.mp4')
  assert.equal((await fetch(`${origin}${preview.downloadUrl}`)).status, 401)
  const exchange = await fetch(ctx.connection.authenticatedUrl(origin), { redirect: 'manual' })
  const cookie = exchange.headers.get('set-cookie').split(';')[0]
  const response = await fetch(`${origin}${preview.downloadUrl}`, { headers: { cookie } })
  assert.equal(response.status, 200); assert.equal(await response.text(), '0123456789')
  const foreign = await fetch(`${origin}${preview.downloadUrl}`, { headers: { cookie, origin: 'https://foreign.example' } })
  assert.equal(foreign.status, 403)
  const manifest = JSON.parse(await readFile(join(runtime, 'node_modules/@deepseek-ai/dsh-client-connection/package.json'), 'utf8'))
  assert.match(manifest.version, /^0\.1\.[35]-alpha\./)
})
