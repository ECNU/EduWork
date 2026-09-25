// Explicit 0.1.7 candidate mode. The published desktop build keeps its own pin.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import { parseArgs } from 'node:util'

const upstreamCommit = '477b4f420553e8a52c2fbccc464d7561b239c443'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const sources = JSON.parse((await readFile(new URL('./upstream-inputs-017.json', import.meta.url), 'utf8')).replace(/^\uFEFF/, ''))
function replace(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(`Pinned native Host anchor changed: ${before.slice(0, 80)}`)
  return text.replace(before, after)
}

export function adaptNativeHostProcess(input) {
  let text = input.replaceAll('\r\n', '\n').replaceAll("'./node-environment.ts'", "'./node-environment.mjs'")
  text = replace(text, '    private readonly onPlatformSession?: (session: PlatformSession | null) => void,',
    `    private readonly onPlatformSession?: (session: PlatformSession | null) => void,
    private readonly product: { bootstrap?: unknown; onLog?: (chunk: string) => void; hostEntry?: string } = {},`)
  text = replace(text, "const entry = join(this.runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js')",
    `const entry = this.product.hostEntry ?? join(this.runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js')
    const bootstrap = this.product.bootstrap === undefined ? '' : JSON.stringify(this.product.bootstrap) + '\\n'
    if (Buffer.byteLength(bootstrap) > 2048) throw new Error('Desktop bootstrap exceeds the maximum length')`)
  text = replace(text, "stdio: ['ignore', 'pipe', 'pipe', 'ipc'],", "stdio: ['pipe', 'pipe', 'pipe', 'ipc'],\n      windowsHide: true,")
  text = replace(text, '    this.child = child', `    child.stdin?.once('error', error => this.fail(error))
    child.stdin?.end(bootstrap)
    this.child = child`)
  text = replace(text, "    child.stderr?.setEncoding('utf8')\n    child.stderr?.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-MAX_HOST_DIAGNOSTIC_CHARS) })", '')
  text = replace(text, '    child.stdout?.pipe(process.stdout)', `    bindRedactedLog(child.stdout, this.product.onLog)
    bindRedactedLog(child.stderr, line => {
      this.stderr = (this.stderr + line).slice(-MAX_HOST_DIAGNOSTIC_CHARS)
      this.product.onLog?.(line)
    })`)
  text = replace(text, 'new DesktopHostFatalError(message.message, message.diagnostic)',
    'new DesktopHostFatalError(redactHostDiagnostic(message.message), message.diagnostic === undefined ? undefined : redactHostDiagnostic(message.diagnostic))')
  return "import { bindRedactedLog, redactHostDiagnostic } from './redacted-log.mjs'\n" + text
}

export function adaptNativeHostEntry(input) {
  let text = input.replaceAll('\r\n', '\n')
  text = replace(text, "import * as desktopOffice from './office.ts'", "import { parse } from 'yaml'\nimport { stageLegacySettings, importLegacySettings } from './settings-migration.mjs'")
  text = replace(text, "import { installPlatformSessionPublisher } from './platform-session.ts'\n", '')
  // The product manifest owns its bundled extensions as well as DSH. Using
  // the CLI manifest here makes profile resolution omit all product packages.
  text = replace(text, "const installAnchor = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')", "const installAnchor = join(runtimeDir, 'package.json')")
  for (const module of ['update-tasks', 'office-engine', 'quit-inspection']) {
    text = text.replaceAll(`'./${module}.ts'`, `'./${module}.js'`)
  }
  text = replace(text, '  const application = runProfile({', '  const migration = await stageLegacySettings(resolveDshHome())\n  const application = runProfile({')
  text = replace(text, "args: ['--no-open', '--port', '19387'],", "args: ['--no-open', '--host', '127.0.0.1', '--port', '0'],")
  text = replace(text, `  await ctx.plugin(desktopOffice, {
    runtimeDir,
    source: process.argv[4] ?? join(runtimeDir, '..', 'runtime', 'primary-runtime'),
    root: join(resolveDshHome(), 'dsh-runtimes', 'dsh-primary-runtime'),
  })
  installPlatformSessionPublisher(ctx, (session) => {
    if (process.connected) process.send?.({ type: 'platform-session', session })
  })`, `  // EduWork's selected composition owns Office authoring dependencies and
  // organization login. Do not install a second set of skills/account hooks.
  await ctx.loader.await()
  await importLegacySettings(ctx, migration, parse)`)
  return text
}

export function adaptNativeWebDocument(input) {
  // Node fetch decodes compressed bodies. Retain the official header filtering,
  // but preserve representation length for unencoded files (HEAD, Range and
  // download progress). Never forward the compressed body's old byte count.
  return replace(input.replaceAll('\r\n', '\n'),
    '  for (const name of WITHHELD_RESPONSE_HEADERS) outgoing.delete(name)',
    `  for (const name of WITHHELD_RESPONSE_HEADERS) outgoing.delete(name)
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase()
  const length = response.headers.get('content-length')
  if ((!encoding || encoding === 'identity') && length !== null
    && /^(0|[1-9]\\d*)$/u.test(length) && Number.isSafeInteger(Number(length))) {
    outgoing.set('content-length', length)
  }`)
}

export async function prepareNative({ upstream, output }) {
  const input = {}, outputs = {}
  for (const [path, hash] of Object.entries(sources)) {
    const bytes = await readFile(join(upstream, path))
    if (digest(bytes) !== hash) throw new Error(`Native Host source hash mismatch: ${path}`)
    input[path] = bytes.toString('utf8')
  }
  await mkdir(output, { recursive: false })
  const emit = async (path, body) => {
    await mkdir(dirname(join(output, path)), { recursive: true })
    await writeFile(join(output, path), body)
    outputs[path] = digest(body)
  }
  const transform = text => stripTypeScriptTypes(text, { mode: 'transform' })
  await emit('host-process.mjs', transform(adaptNativeHostProcess(input['apps/desktop/src/host-process.ts'])))
  await emit('redacted-log.mjs', await readFile(new URL('./redacted-log.mjs', import.meta.url), 'utf8'))
  await emit('node-environment.mjs', transform(input['apps/desktop/src/node-environment.ts']))
  await emit('web-document.mjs', transform(adaptNativeWebDocument(input['apps/desktop/src/web-document.ts'])))
  await emit('desktop-host/lib/index.js', transform(adaptNativeHostEntry(input['apps/desktop-host/src/index.ts'])))
  // This hook is installed after profile plugins. Prepend it so a plugin's
  // handled media/API response cannot bypass update admission.
  const admission = replace(input['apps/desktop-host/src/update-tasks.ts'].replaceAll('\r\n', '\n'),
    '  })\n  return async (action) => {', '  }, true)\n  return async (action) => {')
  await emit('desktop-host/lib/update-tasks.js', transform(admission))
  await emit('desktop-host/lib/quit-inspection.js', transform(input['apps/desktop-host/src/quit-inspection.ts']
    .replaceAll("'./update-tasks.ts'", "'./update-tasks.js'")))
  await emit('desktop-host/lib/office-engine.js', transform(input['apps/desktop-host/src/office-engine.ts']))
  await emit('desktop-host/lib/settings-migration.mjs', await readFile(new URL('./settings-migration.mjs', import.meta.url), 'utf8'))
  const manifest = JSON.parse(input['apps/desktop-host/package.json'])
  manifest.files = ['lib/']; manifest.private = true
  await emit('desktop-host/package.json', JSON.stringify(manifest, null, 2) + '\n')
  await emit('LICENSE-DeepSeek', input.LICENSE)
  await emit('desktop-host/LICENSE', input.LICENSE)
  const receipt = { schemaVersion: 1, upstreamCommit, upstreamVersion: '0.1.7-rc.2', protocolVersion: 4,
    sources, outputs, nodeVersion: process.version, adaptations: ['private-stdin-bootstrap', 'bounded-redacted-log-callback',
      'loopback-ephemeral-port', 'recoverable-product-settings-migration', 'composition-owned-office-and-accounts', 'prepend-update-admission',
      'preserve-unencoded-response-length'] }
  await emit('receipt.json', JSON.stringify(receipt, null, 2) + '\n')
  return receipt
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { upstream: { type: 'string' }, output: { type: 'string' } } })
  if (!values.upstream || !values.output) throw new Error('Use --upstream <pinned rc.2 source> --output <new directory>')
  await prepareNative({ upstream: resolve(values.upstream), output: resolve(values.output) })
  console.log('Prepared pinned 0.1.7 Web Host and HTTP transport.')
}
