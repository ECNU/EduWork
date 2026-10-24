import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const enabled = process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch)
const script = fileURLToPath(new URL('../scripts/prepare-electron.mjs', import.meta.url))
const plist = version => `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`

// Exercise the Node packaging path with real Mach-O binaries on both Mac runners.
// Node calls Intel x64, whereas lipo reports x86_64.
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'eduwork-electron-node-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const upstream = join(directory, 'upstream'), output = join(directory, 'output')
  const packageDir = join(upstream, 'apps/desktop/node_modules/electron')
  const contents = join(output, 'runtime/Electron.app/Contents')
  await mkdir(packageDir, { recursive: true })
  await mkdir(join(contents, 'MacOS'), { recursive: true })
  await writeFile(join(contents, 'Info.plist'), plist('99.0.0'))
  const source = join(directory, 'main.c'), binary = join(contents, 'MacOS/Electron')
  await writeFile(source, 'int main(void) { return 0; }\n')
  const compile = arch => {
    const result = spawnSync('xcrun', ['clang', '-arch', arch, source, '-o', binary], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  compile(process.arch === 'x64' ? 'x86_64' : 'arm64')
  const archiveName = `electron-v99.0.0-darwin-${process.arch}.zip`
  const archive = join(output, archiveName)
  const zipped = spawnSync('ditto', ['-c', '-k', '--keepParent', 'Electron.app', archive], { cwd: join(output, 'runtime'), encoding: 'utf8' })
  assert.equal(zipped.status, 0, zipped.stderr)
  const sha = createHash('sha256').update(await readFile(archive)).digest('hex')
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ version: '99.0.0' }))
  await writeFile(join(packageDir, 'checksums.json'), JSON.stringify({ [archiveName]: sha }))
  const run = () => spawnSync(process.execPath, [script, '--upstream', upstream, '--output', output], { encoding: 'utf8' })
  return { contents, output, compile, run }
}

test('Node Mac preparation accepts the native Mach-O architecture and records the npm architecture', { skip: !enabled }, async t => {
  const f = await fixture(t), result = f.run()
  assert.equal(result.status, 0, result.stderr)
  const receipt = JSON.parse(await readFile(join(f.output, 'receipt.json'), 'utf8'))
  assert.equal(receipt.arch, process.arch)
  assert.equal(receipt.version, '99.0.0')
})

test('Node Mac preparation rejects a cached binary of the other architecture', { skip: !enabled }, async t => {
  const f = await fixture(t)
  f.compile(process.arch === 'x64' ? 'arm64' : 'x86_64')
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Electron runtime architecture mismatch/)
})

test('Node Mac preparation rejects a cached runtime of a different version', { skip: !enabled }, async t => {
  const f = await fixture(t)
  await writeFile(join(f.contents, 'Info.plist'), plist('98.0.0'))
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Electron runtime version mismatch/)
})
