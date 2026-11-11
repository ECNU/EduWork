// Real Electron acceptance of built preload/native modules against synthetic
// pages. No production configuration, account, microphone or model is used.
import { createRequire } from 'node:module'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
const { values } = parseArgs({ options: { shell: { type: 'string' }, runtime: { type: 'string' }, electron: { type: 'string' }, output: { type: 'string' }, 'official-ui': { type: 'string' } } })
if (!values.shell || !values.runtime || !values.electron || !values.output) throw new Error('Use --shell <built shell> --runtime <pinned Runtime> --electron <executable> --output <new evidence directory> [--official-ui <locked official UI bundle>]')
const output = resolve(values.output), shell = resolve(values.shell), repository = resolve(fileURLToPath(new URL('../..', import.meta.url)))
await mkdir(output, { recursive: false })
const require = createRequire(join(resolve(values.runtime), 'package.json'))
const { build } = require('esbuild')
await build({
  stdin: { contents: `import React from 'react'
import { createRoot } from 'react-dom/client'
export { React, createRoot }
export { createUpdateController, UpdateFooter } from './dsh-plugins/workbench-native/src/updates.ts'`, resolveDir: repository, loader: 'ts' },
  outfile: join(output, 'workbench-updates.js'), bundle: true, format: 'iife', globalName: 'WorkbenchUpdates',
  platform: 'browser', target: 'es2022', jsx: 'automatic', nodePaths: [join(resolve(values.runtime), 'node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
})
if (values['official-ui']) await writeFile(join(output, 'official-ui.js'), await readFile(resolve(values['official-ui'])))
await build({ entryPoints: [fileURLToPath(new URL('../tests/fixtures/native-desktop-smoke.mjs', import.meta.url))],
  outfile: join(output, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'es2024', external: ['electron'],
  nodePaths: [join(resolve(values.runtime), 'node_modules'), join(repository, 'dsh-electron/vendor/orca/node_modules')], alias: {
    'fixture-bridge': join(shell, 'src/native-desktop-bridge.mjs'), 'fixture-updates': join(shell, 'src/update-observer.mjs'), 'fixture-window': join(shell, 'src/main.ts'),
    'fixture-backend': join(shell, 'src/backend-controller.ts'), 'fixture-quit': join(shell, 'src/quit-confirmation.ts'),
    'fixture-recovery': join(shell, 'src/fatal-recovery.ts'), 'fixture-locale': join(shell, 'src/locale.ts'),
    'fixture-permissions': join(shell, 'src/microphone-permissions.ts'),
    'fixture-menu': join(shell, 'src/desktop-menu.mjs'),
    'fixture-static': join(shell, 'src/eduwork-host-process.mjs'),
  } })
await writeFile(join(output, 'package.json'), JSON.stringify({ name: 'eduwork-native-desktop-probe', version: '0.0.0', main: 'main.cjs' }))
const env = { ...process.env, EDUWORK_PROBE_OUTPUT: output, EDUWORK_PROBE_PRELOAD: join(shell, 'lib/preload-app.cjs'),
  EDUWORK_PROBE_WORKBENCH_UPDATES: join(output, 'workbench-updates.js'),
  ...(values['official-ui'] ? { EDUWORK_PROBE_OFFICIAL_UI: join(output, 'official-ui.js') } : {}) }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(resolve(values.electron), [output], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
child.stdout.on('data', chunk => { log += chunk }); child.stderr.on('data', chunk => { log += chunk })
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
await writeFile(join(output, 'electron.log'), log)
const report = await readFile(join(output, 'report.json'), 'utf8').then(JSON.parse).catch(() => null)
if (code !== 0 || report?.ok !== true) throw new Error(`Native Electron qualification failed: ${JSON.stringify(report)}; see ${output}`)
console.log(JSON.stringify(report, null, 2))
