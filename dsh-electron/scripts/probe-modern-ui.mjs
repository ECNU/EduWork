// Native component smoke for a prepared shell. Uses a synthetic layout page;
// run a complete product separately before accepting a desktop release.
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: Object.fromEntries(['shell', 'runtime', 'electron', 'output', 'icon'].map(key => [key, { type: 'string' }])) })
if (['shell', 'runtime', 'electron', 'output', 'icon'].some(key => !values[key])) throw new Error('Use --shell --runtime --electron --output --icon (unpackaged Electron runtime)')
const output = resolve(values.output), shell = resolve(values.shell), runtime = resolve(values.runtime)
await mkdir(output, { recursive: false })
const { build } = createRequire(join(runtime, 'package.json'))('esbuild')
await build({ entryPoints: [fileURLToPath(new URL('../tests/fixtures/modern-ui-smoke.mjs', import.meta.url))],
  outfile: join(output, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
  alias: { 'fixture-window': join(shell, 'src/main.ts') } })
await writeFile(join(output, 'motion-preload.cjs'), await readFile(new URL('../src/window-motion-preload.cjs', import.meta.url)))
await writeFile(join(output, 'package.json'), JSON.stringify({ name: 'eduwork-modern-ui-probe', version: '0.0.0', main: 'main.cjs' }))
const env = { ...process.env, EDUWORK_UI_RUNTIME: runtime, EDUWORK_UI_EVIDENCE: output, EDUWORK_UI_PRELOAD: join(output, 'motion-preload.cjs'),
  EDUWORK_UI_LOGO: 'data:image/png;base64,' + (await readFile(resolve(values.icon))).toString('base64') }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(resolve(values.electron), [output], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
child.stdout.on('data', chunk => { log += chunk }); child.stderr.on('data', chunk => { log += chunk })
const timer = setTimeout(() => child.kill(), 60_000)
let code
try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) }) }
finally { clearTimeout(timer) }
await writeFile(join(output, 'electron.log'), log)
const report = await readFile(join(output, 'modern-ui-report.json'), 'utf8').then(JSON.parse).catch(() => null)
if (code !== 0 || report?.passed !== true) throw new Error(`Modern UI qualification failed; see ${output}`)
console.log(JSON.stringify(report, null, 2))
