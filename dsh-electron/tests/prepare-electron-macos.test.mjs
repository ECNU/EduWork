import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pwsh = process.env.EDUWORK_PWSH ?? 'pwsh'
const available = command => spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0
const enabled = process.platform === 'darwin' && process.arch === 'arm64' && available(pwsh)
const script = fileURLToPath(new URL('../scripts/prepare-electron.ps1', import.meta.url))
const plist = version => `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'eduwork-electron-cache-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const upstream = join(directory, 'upstream')
  const output = join(directory, 'output')
  const packageDir = join(upstream, 'apps/desktop/node_modules/electron')
  const contents = join(output, 'runtime/Electron.app/Contents')
  await mkdir(packageDir, { recursive: true })
  await mkdir(join(contents, 'MacOS'), { recursive: true })
  await writeFile(join(contents, 'Info.plist'), plist('99.0.0'))
  const source = join(directory, 'main.c')
  const binary = join(contents, 'MacOS/Electron')
  await writeFile(source, 'int main(void) { return 0; }\n')
  const compile = arch => spawnSync('xcrun', ['clang', '-arch', arch, source, '-o', binary], { encoding: 'utf8' })
  const built = compile('arm64')
  assert.equal(built.status, 0, built.stderr)
  const archiveName = 'electron-v99.0.0-darwin-arm64.zip'
  const archive = join(output, archiveName)
  const zipped = spawnSync('ditto', ['-c', '-k', '--keepParent', 'Electron.app', archive], { cwd: join(output, 'runtime'), encoding: 'utf8' })
  assert.equal(zipped.status, 0, zipped.stderr)
  const sha = createHash('sha256').update(await readFile(archive)).digest('hex')
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ version: '99.0.0' }))
  await writeFile(join(packageDir, 'checksums.json'), JSON.stringify({ [archiveName]: sha }))
  const run = () => spawnSync(pwsh, ['-NoProfile', '-File', script, '-Upstream', upstream, '-Output', output], { encoding: 'utf8' })
  return { contents, output, compile, run }
}

test('macOS cache receipt records the validated Electron version and architecture', { skip: !enabled }, async t => {
  const f = await fixture(t)
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  const receipt = JSON.parse(await readFile(join(f.output, 'receipt.json'), 'utf8'))
  assert.equal(receipt.version, '99.0.0')
  assert.equal(receipt.arch, 'arm64')
})

test('macOS cache rejects an older Electron.app despite a current archive', { skip: !enabled }, async t => {
  const f = await fixture(t)
  await writeFile(join(f.contents, 'Info.plist'), plist('98.0.0'))
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Electron runtime version mismatch/)
})

test('macOS cache rejects a binary with the wrong architecture', { skip: !enabled }, async t => {
  const f = await fixture(t)
  const built = f.compile('x86_64')
  assert.equal(built.status, 0, built.stderr)
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Electron runtime architecture mismatch/)
})
