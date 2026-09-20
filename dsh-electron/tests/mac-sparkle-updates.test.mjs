import test from 'node:test'
import assert from 'node:assert/strict'
import { startMacSparkleUpdates } from '../src/mac-sparkle-updates.mjs'

test('Sparkle stays disabled on Windows or in a candidate without a feed', () => {
  const fail = () => { throw Error('native module must not load') }
  assert.equal(startMacSparkleUpdates({ appPath: '/synthetic', version: '0.3.6', platform: 'win32', enabled: true, loadAddon: fail }), null)
  assert.equal(startMacSparkleUpdates({ appPath: '/synthetic', version: '0.3.6', platform: 'darwin', loadAddon: fail }), null)
})

test('manual check delegates once to native Sparkle without inventing Windows update states', async () => {
  const calls = []
  const bridge = startMacSparkleUpdates({ appPath: '/synthetic.app/Contents/Resources/app', version: '0.3.6', platform: 'darwin', enabled: true,
    loadAddon: path => { calls.push(path); return { start: () => calls.push('start'), check: () => calls.push('check') } } })
  const before = await bridge.action('status')
  assert.equal(before.update.nativeUI, true)
  assert.equal(before.update.state, 'idle')
  assert.equal((await bridge.action('check-updates')).phase, 'ready')
  assert.deepEqual(calls, ['/synthetic.app/Contents/Resources/app/native/sparkle.node', 'start', 'check'])
  await assert.rejects(bridge.action('download-update'), /系统更新窗口/)
})

test('missing native framework disables updates without aborting the desktop', async () => {
  const bridge = startMacSparkleUpdates({appPath:'/synthetic.app',version:'0.3.6',platform:'darwin',enabled:true,
    loadAddon:()=>{throw Error('framework missing')}})
  assert.equal((await bridge.action('status')).update.enabled,false)
  assert.match((await bridge.action('status')).message,/framework missing/)
  await assert.rejects(bridge.action('check-updates'),/framework missing/)
})
