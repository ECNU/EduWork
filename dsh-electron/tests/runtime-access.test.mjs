import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureRuntimeAccess } from '../src/runtime-access.mjs'

test('explicit runtime repair uses the bundled helper without a shell or elevation', () => {
  const root = 'C:\\Synthetic EduWork'
  const calls = []
  ensureRuntimeAccess({ root, platform: 'win32', execute: (...args) => calls.push(args) })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], join(root, 'resources/update/EduWork-Updater.exe'))
  assert.deepEqual(calls[0][1], ['ensure-runtime-access', '--root', root])
  assert.equal(calls[0][2].windowsHide, true)
  assert.equal(calls[0][2].shell, undefined)
  assert.equal(calls[0][2].timeout, 15000)
})
test('other platforms do not run the Windows helper', () => {
  for (const platform of ['darwin', 'linux']) ensureRuntimeAccess({ root: '/synthetic', platform, execute: () => assert.fail('unexpected helper') })
})
test('explicit native repair failure retains the Windows error', () => {
  assert.throws(() => ensureRuntimeAccess({ root: 'C:\\Synthetic', platform: 'win32', execute: () => { throw Object.assign(new Error('exit 1'), { stderr: 'Access is denied.' }) } }), /无法准备 Windows 程序运行权限[\s\S]*Access is denied/)
})
test('normal product startup does not inspect or mutate runtime ACLs', () => {
  const source = readFileSync(new URL('../src/product.mjs', import.meta.url), 'utf8')
  const configure = source.slice(source.indexOf('export function configureEduworkPaths()'), source.indexOf('export function installEduworkFromDmg()'))
  assert.doesNotMatch(configure, /ensureRuntimeAccess\(|ensure-runtime-access|WRITE_DAC.*execFile/)
  assert.ok(configure.includes('attachAppActivation('))
})
test('upgrade health still follows actual main-window loading', () => {
  const source = readFileSync(new URL('../src/native-desktop.mjs', import.meta.url), 'utf8')
  const load = source.indexOf('await window.loadURL(')
  const ready = source.indexOf('await desktopReady()')
  assert.ok(load > 0 && ready > load)
  assert.match(source.slice(load, ready), /recovery\.active/)
})
