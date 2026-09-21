// Run the macOS-only first-launch initializer in Electron itself, whose fs
// implementation also handles app archives. Node-only tests cannot cover it.
import assert from 'node:assert/strict'
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2]), executable = resolve(process.argv[3])
const fixture = join(root, 'config-startup'), product = join(fixture, 'product'), config = join(fixture, 'user/eduwork.jsonc')
await mkdir(join(product, 'resources/desktop/examples'), { recursive: true })
await mkdir(join(fixture, 'user'), { recursive: true })
await writeFile(join(product, 'resources/desktop/eduwork.jsonc'), 'bundled configuration')
await writeFile(join(product, 'resources/desktop/examples/organization.jsonc'), 'example')
await copyFile(new URL('../src/initialize-user-config.mjs', import.meta.url), join(fixture, 'initialize.mjs'))
await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'eduwork-config-startup-test', version: '1.0.0', main: 'main.cjs' }))
await writeFile(join(fixture, 'main.cjs'), `
const {app}=require('electron');
const timer=setTimeout(()=>{console.error('Configuration initialization exceeded 20 seconds');app.exit(1)},20000);
app.whenReady().then(async()=>{
 const fs=require('node:fs/promises'),assert=require('node:assert/strict');
 const {initializeUserConfig}=await import('./initialize.mjs');
 const options=${JSON.stringify({ product, config })};
 console.log('Initializing a fresh config in Electron');
 await initializeUserConfig(options);
 assert.equal(await fs.readFile(options.config,'utf8'),'bundled configuration');
 await fs.writeFile(options.config,'user configuration');
 console.log('Preserving an existing config in Electron');
 await initializeUserConfig(options);
 assert.equal(await fs.readFile(options.config,'utf8'),'user configuration');
 console.log('CONFIGURATION_INITIALIZATION_OK');clearTimeout(timer);app.exit(0);
}).catch(error=>{console.error(error.stack);clearTimeout(timer);app.exit(1)});
`)
const child = spawn(executable, [fixture], { env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
child.stdout.on('data', bytes => { output += bytes; process.stdout.write(bytes) })
child.stderr.on('data', bytes => { output += bytes; process.stderr.write(bytes) })
const code = await new Promise((ok, bad) => { child.on('error', bad); child.on('close', ok) })
await writeFile(join(fixture, 'result.log'), output)
assert.equal(code, 0, output)
assert.match(output, /CONFIGURATION_INITIALIZATION_OK/)
assert.equal(await readFile(config, 'utf8'), 'user configuration')
