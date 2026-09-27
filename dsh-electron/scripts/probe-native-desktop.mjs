// Real Electron acceptance of built preload/native modules against synthetic
// pages. No production configuration, account, microphone or model is used.
import { createRequire } from 'node:module'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: { shell: { type: 'string' }, runtime: { type: 'string' }, electron: { type: 'string' }, output: { type: 'string' } } })
if (Object.values(values).length !== 4) throw new Error('Use --shell <built shell> --runtime <pinned Runtime> --electron <executable> --output <new evidence directory>')
const output = resolve(values.output), shell = resolve(values.shell)
await mkdir(output, { recursive: false })
const require = createRequire(join(resolve(values.runtime), 'package.json'))
const { build } = require('esbuild')
await build({ entryPoints: [fileURLToPath(new URL('../tests/fixtures/native-desktop-smoke.mjs', import.meta.url))],
  outfile: join(output, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'es2024', external: ['electron'],
  nodePaths: [join(resolve(values.runtime), 'node_modules')], alias: {
    'fixture-bridge': join(shell, 'src/native-desktop-bridge.mjs'), 'fixture-window': join(shell, 'src/main.ts'),
    'fixture-backend': join(shell, 'src/backend-controller.ts'), 'fixture-quit': join(shell, 'src/quit-confirmation.ts'),
    'fixture-recovery': join(shell, 'src/fatal-recovery.ts'), 'fixture-locale': join(shell, 'src/locale.ts'),
    'fixture-permissions': join(shell, 'src/microphone-permissions.ts'),
  } })
await writeFile(join(output, 'package.json'), JSON.stringify({ name: 'eduwork-native-desktop-probe', version: '0.0.0', main: 'main.cjs' }))
const env = { ...process.env, EDUWORK_PROBE_OUTPUT: output, EDUWORK_PROBE_PRELOAD: join(shell, 'lib/preload-app.cjs') }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(resolve(values.electron), [output], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
child.stdout.on('data', chunk => { log += chunk }); child.stderr.on('data', chunk => { log += chunk })
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
await writeFile(join(output, 'electron.log'), log)
const report = await readFile(join(output, 'report.json'), 'utf8').then(JSON.parse).catch(() => null)
if (code !== 0 || report?.ok !== true) throw new Error(`Native Electron qualification failed: ${JSON.stringify(report)}; see ${output}`)
console.log(JSON.stringify(report, null, 2))
