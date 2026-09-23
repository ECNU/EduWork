// Explicit 0.1.7 candidate mode. The published desktop build keeps its own pin.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import { parseArgs } from 'node:util'

const upstreamCommit = '00102833dfaee1da9f48a3a8eae9d34005a75218'
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
  text = replace(text, '    child.stdout?.pipe(process.stdout)', `    bindRedactedLog(child.stdout, this.product.onLog)
    bindRedactedLog(child.stderr, this.product.onLog)`)
  return "import { bindRedactedLog } from './redacted-log.mjs'\n" + text
}

export function adaptNativeHostEntry(input) {
  let text = input.replaceAll('\r\n', '\n')
  text = replace(text, "import * as desktopOffice from './office.ts'", "import { parse } from 'yaml'\nimport { stageLegacySettings, importLegacySettings } from './settings-migration.mjs'")
  text = replace(text, "import { installPlatformSessionPublisher } from './platform-session.ts'\n", '')
  text = text.replaceAll("'./update-tasks.ts'", "'./update-tasks.js'").replaceAll("'./office-engine.ts'", "'./office-engine.js'")
  text = replace(text, '  const application = runProfile({', '  const migration = await stageLegacySettings(resolveDshHome())\n  const application = runProfile({')
  text = replace(text, "args: ['--no-open', '--port', '19387'],", "args: ['--no-open', '--host', '127.0.0.1', '--port', '0'],")
  text = replace(text, `  await ctx.plugin(desktopOffice, {
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
  for (const file of ['node-environment', 'web-document']) await emit(`${file}.mjs`, transform(input[`apps/desktop/src/${file}.ts`]))
  await emit('desktop-host/lib/index.js', transform(adaptNativeHostEntry(input['apps/desktop-host/src/index.ts'])))
  // This hook is installed after profile plugins. Prepend it so a plugin's
  // handled media/API response cannot bypass update admission.
  const admission = replace(input['apps/desktop-host/src/update-tasks.ts'].replaceAll('\r\n', '\n'),
    '  })\n  return async (action) => {', '  }, true)\n  return async (action) => {')
  await emit('desktop-host/lib/update-tasks.js', transform(admission))
  await emit('desktop-host/lib/office-engine.js', transform(input['apps/desktop-host/src/office-engine.ts']))
  await emit('desktop-host/lib/settings-migration.mjs', await readFile(new URL('./settings-migration.mjs', import.meta.url), 'utf8'))
  const manifest = JSON.parse(input['apps/desktop-host/package.json'])
  manifest.files = ['lib/']; manifest.private = true
  await emit('desktop-host/package.json', JSON.stringify(manifest, null, 2) + '\n')
  await emit('LICENSE-DeepSeek', input.LICENSE)
  await emit('desktop-host/LICENSE', input.LICENSE)
  const receipt = { schemaVersion: 1, upstreamCommit, upstreamVersion: '0.1.7-alpha.2', protocolVersion: 4,
    sources, outputs, nodeVersion: process.version, adaptations: ['private-stdin-bootstrap', 'bounded-redacted-log-callback',
      'loopback-ephemeral-port', 'recoverable-product-settings-migration', 'composition-owned-office-and-accounts', 'prepend-update-admission'] }
  await emit('receipt.json', JSON.stringify(receipt, null, 2) + '\n')
  return receipt
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { upstream: { type: 'string' }, output: { type: 'string' } } })
  if (!values.upstream || !values.output) throw new Error('Use --upstream <pinned alpha.2 source> --output <new directory>')
  await prepareNative({ upstream: resolve(values.upstream), output: resolve(values.output) })
  console.log('Prepared pinned 0.1.7 Web Host and HTTP transport.')
}
