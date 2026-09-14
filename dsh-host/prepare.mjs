import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'

export const upstreamCommit = 'fb2c4b9e698e30edb738bca4cf0618587db7d203'
export const sources = Object.freeze({
  'LICENSE': 'ebb4f09972aee8608be255debaf78451a68e95c290f55c240dec2ecfa16ea6be',
  'apps/desktop/src/host-process.ts': '9bc9bce5de490b100db053066f248983d5faa2027a89b209c8f4a1704b263acf',
  'apps/desktop/src/host-protocol.ts': 'ef608222e30a4976d3d93e9f0e7fcc004161b346fa8b0cd005a370dc44824065',
  'apps/desktop-host/src/index.ts': '7e7583f07800f6c257809d1dfb328d3942e84e6df97a78dd8af877b5e3bc27f3',
  'apps/desktop-host/src/wire.ts': '887589acaa7df830fd559e2b9abbc69b667ccfb68df2670731db83a59b33a4df',
  'apps/desktop-host/config/desktop.cordis.patch.yml': '28b57c998d65fa7f028a2db097e0f19ac79c8f5525ccfa7cc6ad8b886442f852',
  'apps/desktop-host/package.json': 'af242e7e539f0850e8e254b39dbbbfbbce331cfe09a8bcf155508f4a1607eeee',
})
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw new Error('locked desktop Host adaptation target changed')
  return text.replace(before, after)
}

export function adaptHostProcess(source) {
  let text = source.replaceAll('\r\n', '\n')
  text = replaceOnce(text, "from './host-protocol.ts'", "from './host-protocol.mjs'")
  text = replaceOnce(text, '    private readonly inspectPort?: number,', `    private readonly inspectPort?: number,
    private readonly options: {
      bootstrap?: unknown,
      allowLinkedProfile?: boolean,
      onFailure?: (error: Error) => void,
      onLog?: (chunk: string) => void,
    } = {},`)
  text = replaceOnce(text, "...(this.inspectPort === undefined ? [] : ['--allow-linked-profile']),", "...((this.options.allowLinkedProfile === true || this.inspectPort !== undefined) ? ['--allow-linked-profile'] : []),")
  text = replaceOnce(text, "stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe', 'ipc'],", "stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'ipc'],\n      windowsHide: true,")
  text = replaceOnce(text, "    const entry = join(this.projectDir,", `    const bootstrap = this.options.bootstrap === undefined ? '' : JSON.stringify(this.options.bootstrap) + '\\n'
    if (Buffer.byteLength(bootstrap) > 2048) throw new Error('desktop bootstrap exceeds the maximum length')
    const entry = join(this.projectDir,`)
  text = replaceOnce(text, '    this.child = child', `    child.stdin?.once('error', (error) => { this.fail(error) })
    child.stdin?.end(bootstrap)
    this.child = child`)
  text = replaceOnce(text, "child.stderr?.on('data', (chunk: string) => { this.stderr += chunk })", "child.stderr?.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-65536) })")
  text = replaceOnce(text, 'child.stdout?.pipe(process.stdout)', `child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.options.onLog?.(chunk))
    child.stderr?.on('data', (chunk: string) => this.options.onLog?.(chunk))
    child.stdout?.pipe(process.stderr)
    child.stderr?.pipe(process.stderr)`)
  text = replaceOnce(text, '  private fail(error: Error): void {', '  private fail(error: Error): void {\n    this.options.onFailure?.(error)')
  return text
}

export function adaptHostEntry(source) {
  let text = source.replaceAll('\r\n', '\n').replaceAll("'./wire.ts'", "'./wire.js'")
  // Node streams own their fd even with autoClose:false when destroy() is called.
  // A separate closeSync races their pending Windows I/O and can double-close it.
  text = replaceOnce(text, 'import { closeSync, createReadStream,', 'import { createReadStream,')
  text = replaceOnce(text, '      closeSync(DESKTOP_REQUEST_PIPE_FD)\n', '')
  text = replaceOnce(text, '      closeSync(DESKTOP_RESPONSE_PIPE_FD)\n', '')
  return replaceOnce(text,
    "roots: [{ path: join(dshRoot, 'config', 'agent-presets'), trust: 'system' }],",
    `// Product profile roots are part of the selected composition; keep them.
        roots: Array.isArray((agentPresets.config as Record<string, unknown> | undefined)?.roots)
          ? (agentPresets.config as Record<string, unknown>).roots
          : [{ path: join(dshRoot, 'config', 'agent-presets'), trust: 'system' }],`)
}

export async function prepare({ upstream, output }) {
  const input = {}
  for (const [name, expected] of Object.entries(sources)) {
    const bytes = await readFile(join(upstream, name))
    if (hash(bytes) !== expected) throw new Error(`official source hash mismatch: ${name}`)
    input[name] = bytes.toString('utf8')
  }
  const outputs = {}
  const emit = async (name, body) => {
    const path = join(output, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, body)
    outputs[name] = hash(body)
  }
  const transform = text => stripTypeScriptTypes(text, { mode: 'transform' })
  await emit('host-process.mjs', transform(adaptHostProcess(input['apps/desktop/src/host-process.ts'])))
  await emit('host-protocol.mjs', transform(input['apps/desktop/src/host-protocol.ts']))
  await emit('desktop-host/lib/index.js', transform(adaptHostEntry(input['apps/desktop-host/src/index.ts'])))
  await emit('desktop-host/lib/wire.js', transform(input['apps/desktop-host/src/wire.ts']))
  await emit('desktop-host/config/desktop.cordis.patch.yml', input['apps/desktop-host/config/desktop.cordis.patch.yml'])
  const manifest = JSON.parse(input['apps/desktop-host/package.json'])
  manifest.files = ['lib/index.js', 'lib/wire.js', 'config/desktop.cordis.patch.yml']
  // This is a local overlay, never npm-published. The product profile owns dependencies.
  await emit('desktop-host/package.json', JSON.stringify(manifest, null, 2) + '\n')
  await emit('LICENSE-DeepSeek', input.LICENSE)
  await emit('desktop-host/LICENSE', input.LICENSE)
  const receipt = {
    schemaVersion: 1, upstreamCommit, upstreamVersion: '0.1.5-rc.2', protocolVersion: 3,
    nodeVersion: process.version, preparationVersion: 1, sources, outputs,
    adaptations: ['preserve-product-agent-presets-roots', 'explicit-candidate-linked-profile', 'stdin-bootstrap', 'stdout-logs-to-stderr', 'bounded-stderr-tail', 'lifecycle-failure-callback', 'stream-owned-pipe-shutdown'],
  }
  await emit('receipt.json', JSON.stringify(receipt, null, 2) + '\n')
  return receipt
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.length !== 4 || args[0] !== '--upstream' || args[2] !== '--output') throw new Error('Usage: node dsh-host/prepare.mjs --upstream <locked-source> --output <new-candidate>')
  await prepare({ upstream: resolve(args[1]), output: resolve(args[3]) })
  console.log('Prepared shared desktop Host and pipe client from verified official sources.')
}
