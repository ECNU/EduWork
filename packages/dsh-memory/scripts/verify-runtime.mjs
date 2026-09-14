import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, stat, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
assert.ok(process.argv[2], 'Pass the approved Runtime directory')
assert.ok(process.env.npm_execpath, 'Run through npm run verify:runtime -- <runtime>')
const runtime = await realpath(path.resolve(process.argv[2]))
const pkg = JSON.parse(await readFile(path.join(root, 'package.json')))
await mkdir(path.join(root, 'artifacts'), { recursive: true })
const stage = await mkdtemp(path.join(root, 'artifacts', 'runtime-stage-'))
console.log('Isolated verification stage: ' + stage)
for (const name of ['src', 'scripts', 'test', 'docs', 'package.json', 'package-lock.json', 'cordis.patch.yml', 'README.md', 'README_EN.md', 'LICENSE', 'NOTICE', 'UPSTREAM.md', 'SECURITY.md', 'CHANGELOG.md']) {
  await cp(path.join(root, name), path.join(stage, name), { recursive: true })
}
const modules = path.join(stage, 'node_modules')
await mkdir(modules)
for (const name of await readdir(path.join(runtime, 'node_modules'))) {
  if (name.startsWith('.') || ['esbuild', 'playwright'].includes(name)) continue
  const target = path.join(runtime, 'node_modules', name)
  if ((await stat(target)).isDirectory()) await symlink(target, path.join(modules, name), process.platform === 'win32' ? 'junction' : 'dir')
}
// Build/browser tooling is not a DSH runtime dependency and stays pinned to this checkout.
for (const name of ['esbuild', 'playwright']) {
  await symlink(path.join(root, 'node_modules', name), path.join(modules, name), process.platform === 'win32' ? 'junction' : 'dir')
}
const require = createRequire(path.join(stage, 'package.json'))
const names = [...new Set(Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.devDependencies }).filter(name => name.startsWith('@deepseek-ai/')))]
const resolutions = []
for (const name of names) {
  const manifest = await realpath(require.resolve(name + '/package.json'))
  const relative = path.relative(runtime, manifest)
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), name + ' escaped the selected Runtime')
  const actual = JSON.parse(await readFile(manifest))
  if (name.startsWith('@deepseek-ai/dsh')) assert.equal(actual.version, pkg.devDependencies['@deepseek-ai/dsh'])
  resolutions.push({ name, version: actual.version, manifest })
}
const env = { ...process.env, MEMORY_RUNTIME: runtime, MEMORY_EXPECTED_DSH_VERSION: pkg.devDependencies['@deepseek-ai/dsh'] }
await mkdir(path.join(stage, 'artifacts'))
await writeFile(path.join(stage, 'artifacts', 'runtime-resolutions.json'), JSON.stringify({ runtime, resolutions }, null, 2))
const run = args => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd: stage, env, stdio: 'inherit', windowsHide: true })
  child.on('error', reject)
  child.on('exit', code => code === 0 ? resolve() : reject(new Error('Stage command failed: ' + args.join(' ') + ' (' + code + ')')))
})
await run([process.env.npm_execpath, 'run', 'verify'])
await run(['scripts/check-session-contract.mjs', runtime])
await run(['scripts/check-prompt-contract.mjs', runtime])
await run(['scripts/check-query-contract.mjs', runtime])
const report = JSON.parse(await readFile(path.join(stage, 'artifacts', 'verification.json')))
assert.equal(report.passed, true)
await writeFile(path.join(root, 'artifacts', 'runtime-verification-latest.json'), JSON.stringify({ ...report, stage, resolutions }, null, 2))
console.log('Isolated Runtime verification passed: ' + stage)
