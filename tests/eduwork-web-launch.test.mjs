import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

const exec = promisify(execFile)
const launcher = fileURLToPath(new URL('../scripts/dev-eduwork-web.mjs', import.meta.url))
const json = async (path, value) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value)) }

for (const relative of [true, false]) test(`Web start/status/stop preserves ${relative ? 'relative' : 'absolute'} paths across the worker cwd`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork launch 中文 '))
  const assembly = join(root, 'dist/verify-generic/assembly')
  const home = join(root, '.local/user-home'), logs = join(root, '.local/web-logs')
  const config = join(root, '.local/web.private.json')
  const run = command => exec(process.execPath, [launcher, command, config], { cwd: root, windowsHide: true })
  t.after(async () => { await run('stop').catch(() => {}); await rm(root, { recursive: true, force: true }) })
  const socket = createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  await json(join(assembly, 'assembly.json'), { kind: 'synthetic-web', version: 'fixture', managedPackages: { '@eduwork': {} } })
  for (const name of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-persona', '@chatecnu-work/dsh-skill-control-native', '@eduwork/dsh-artifact-services', '@eduwork/dsh-knowledge-studio']) {
    await json(join(assembly, 'd/node_modules', name, 'package.json'), { name, type: 'module' })
  }
  // Only the DSH CLI is synthetic: exercise the real launcher, Windows linker,
  // detached worker, readiness record and authenticated shutdown lifecycle.
  const cli = join(assembly, 'd/node_modules/@deepseek-ai/dsh/lib/bin.js')
  await mkdir(join(cli, '..'), { recursive: true })
  await writeFile(cli, `import {createServer} from 'node:http';
    export async function runCli() {
      const port=Number(process.argv[process.argv.indexOf('--port')+1]);
      const server=createServer((req,res)=>res.end(JSON.stringify({cwd:process.cwd(),home:process.env.DSH_HOME})));
      await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
      process.once('SIGTERM',()=>server.close(()=>process.exit(0)));
      console.log('http://127.0.0.1:'+port+'/?token=synthetic');
    }`)
  await json(config, { assembly: relative ? 'dist/verify-generic/assembly' : assembly, home: relative ? '.local/user-home' : home, logs: relative ? '.local/web-logs' : logs, profileName: 'test', port })
  const original = await readFile(config, 'utf8')
  assert.match((await run('start')).stdout, /Ready:/)
  const status = JSON.parse((await run('status')).stdout)
  assert.equal(status.running, true)
  assert.equal(status.logs, logs)
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}`)).json(), { cwd: assembly, home })
  assert.match(await readFile(join(logs, 'url.txt'), 'utf8'), /token=synthetic/)
  assert.equal(await readFile(config, 'utf8'), original, 'Launching must not rewrite private configuration')
  await run('stop')
  assert.equal(JSON.parse((await run('status')).stdout).running, false)
})
