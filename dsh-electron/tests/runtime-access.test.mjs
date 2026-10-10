import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureRuntimeAccess } from '../src/runtime-access.mjs'

test('Windows startup runs the bundled helper synchronously, without a shell or elevation', () => {
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
test('native failure retains details and stops startup', () => {
  assert.throws(() => ensureRuntimeAccess({ root: 'C:\\Synthetic', platform: 'win32', execute: () => { throw Object.assign(new Error('exit 1'), { stderr: 'Access is denied.' }) } }), /无法准备 Windows 程序运行权限[\s\S]*Access is denied/)
})
test('shared product startup repairs before registering or creating windows', () => {
  const source = readFileSync(new URL('../src/product.mjs', import.meta.url), 'utf8')
  const configure = source.slice(source.indexOf('export async function configureEduworkPaths()'), source.indexOf('export function installEduworkFromDmg()'))
  assert.ok(configure.indexOf('ensureRuntimeAccess(') < configure.indexOf('attachAppActivation('))
  assert.match(configure, /dialog\.showErrorBox/)
  assert.match(configure, /app\.exit\(1\)/)
})
